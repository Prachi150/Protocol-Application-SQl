#!/bin/bash
# ==============================================================================
# install.sh — IoConnect Protocol Adapter Installer (TEMPLATE)
#
# [SECTION: WHAT THIS SCRIPT DOES]
# Installs a protocol adapter as a systemd service on an IoConnect device.
# Steps:
#   1.  Check system dependencies (python3.12, node, nginx)
#   2.  Resolve installation paths from LSG_APPS_HOME env var
#   3.  Resolve LSG_APP_DATA and create the data directory
#   4.  Create Python venv + install requirements.txt (offline from packages/ if available)
#   5.  Install Node.js dependencies for the configurator (frontend + backend)
#   6.  Tear down any existing services, detect free TCP ports
#   7.  Generate env/.env.api (runtime config with absolute paths + allocated ports)
#   8.  Write systemd service unit files to services/
#   9.  Copy and enable services via systemctl
#   10. Write Nginx location snippet to NGINX_SNIPPET_DIR
#   11. Test nginx config and reload
#   12. Generate app_manifest.json (used by LSG-App to manage this adapter)
#
# [SECTION: DEPLOYMENT MODES]
# Mode 1 — IoConnect production (default): full install, platform provides LSG_APPS_HOME etc.
# Mode 2 — --no-ui: headless, Python daemon only, no configurator UI
# Mode 3 — --no-ioconnect: standalone with Nginx; prompts for paths interactively
#
# [SECTION: CUSTOMIZATION POINTS]
# This script is structurally identical for all protocol adapters.
# Search for "REPLACE" to find all per-protocol customization sites (3 total):
#   1. APP_NAME default      (~line 60) — fallback slug when .env is absent
#   2. Protocol service Description= in the systemd unit template
#   3. Configurator service Description= in the systemd unit template
# ==============================================================================
set -uo pipefail

# ──────────────────────────────────────────────
# Colour helpers
# ──────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ──────────────────────────────────────────────
# 0. Flag parsing
# ──────────────────────────────────────────────
NO_UI=false
NO_IOCONNECT=false
for arg in "$@"; do
  case "$arg" in
    --no-ui) NO_UI=true ;;
    --no-ioconnect) NO_IOCONNECT=true ;;
    *) error "Unknown argument: '${arg}'\n  Usage: sudo bash install.sh [--no-ui] [--no-ioconnect]" ;;
  esac
done

# ──────────────────────────────────────────────
# 0. Load .env if present
# ──────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
CONFIG_FILE="${PROJECT_ROOT}/.env"

if [ -f "${CONFIG_FILE}" ]; then
    info "Loading configuration from ${CONFIG_FILE}..."
    set -a; source "${CONFIG_FILE}"; set +a
fi

# ──────────────────────────────────────────────
# 0. Service name variables (derived from APP_NAME)
# ──────────────────────────────────────────────
# REPLACE: Change the fallback slug to match your protocol's APP_NAME default.
# This fallback is only used when .env is absent (e.g. manual invocation).
APP_NAME="${APP_NAME:-my-myproto-app}"  # REPLACE: e.g. my-opcua-app, my-modbus-line1
SERVICE_NAME="${APP_NAME}"
CONFIGURATOR_SERVICE_NAME="${APP_NAME}-configurator"

info "Service names:"
info "  Python app : ${SERVICE_NAME}"
if [[ "${NO_UI}" == false ]]; then
    info "  Backend API: ${CONFIGURATOR_SERVICE_NAME}"
else
    info "  Backend API: (skipped via --no-ui)"
fi

# ──────────────────────────────────────────────
# Rollback state flags (set after each step succeeds)
# If any step fails, the trap below reverts completed steps.
# ──────────────────────────────────────────────
_VENV_CREATED=false
_ENV_FILE_CREATED=false
_PROTOCOL_SVC_INSTALLED=false
_CONFIGURATOR_SVC_INSTALLED=false
_NGINX_SNIPPET_CREATED=false

rollback() {
    echo ""
    warn "Installation failed — rolling back completed steps..."

    if [[ "${_NGINX_SNIPPET_CREATED}" == true ]]; then
        warn "  Removing nginx snippet..."
        rm -f "${NGINX_SNIPPET_FILE}" 2>/dev/null || true
        nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
    fi

    if [[ "${_CONFIGURATOR_SVC_INSTALLED}" == true ]]; then
        warn "  Removing configurator service..."
        systemctl stop    "${CONFIGURATOR_SERVICE_NAME}" 2>/dev/null || true
        systemctl disable "${CONFIGURATOR_SERVICE_NAME}" 2>/dev/null || true
        rm -f "/etc/systemd/system/${CONFIGURATOR_SERVICE_NAME}.service" 2>/dev/null || true
        systemctl daemon-reload 2>/dev/null || true
    fi

    if [[ "${_PROTOCOL_SVC_INSTALLED}" == true ]]; then
        warn "  Removing protocol service..."
        systemctl stop    "${SERVICE_NAME}" 2>/dev/null || true
        systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
        rm -f "/etc/systemd/system/${SERVICE_NAME}.service" 2>/dev/null || true
        systemctl daemon-reload 2>/dev/null || true
    fi

    if [[ "${_ENV_FILE_CREATED}" == true ]]; then
        warn "  Removing .env file..."
        rm -f "${ENV_FILE}" 2>/dev/null || true
    fi

    if [[ "${_VENV_CREATED}" == true ]]; then
        warn "  Removing Python venv..."
        rm -rf "${VENV_DIR}" 2>/dev/null || true
    fi

    echo ""
    echo -e "${RED}Installation failed and has been rolled back.${NC}"
}

trap rollback ERR

# ──────────────────────────────────────────────
# 1. Check dependencies (node, python3)
# ──────────────────────────────────────────────
echo ""
info "Step 1 — Checking required tools..."

# check_cmd <command> [version-flag]   (version-flag defaults to --version)
check_cmd() {
    local cmd="$1"
    local ver_flag="${2:---version}"
    if ! command -v "${cmd}" &>/dev/null; then
        error "'${cmd}' is not installed or not in PATH. Please install it and re-run."
    fi
    local ver
    ver=$("${cmd}" "${ver_flag}" 2>&1 | head -1)
    success "${cmd} found: ${ver}"
}

if ! command -v python3.12 &>/dev/null; then
    error "'python3.12' is not installed or not in PATH. Run: sudo apt install python3.12"
fi
PY312_VERSION=$(python3.12 --version 2>&1 | head -1)
success "python3.12 found: ${PY312_VERSION}"

# Check python3.12-venv is available (required to create virtual environments)
# We test 'import ensurepip' — that's the module that actually fails when
# python3.12-venv is missing on Debian/Ubuntu.
if ! python3.12 -c "import ensurepip" &>/dev/null 2>&1; then
    error "python3.12-venv is not installed. Run: sudo apt install python3.12-venv"
fi
success "python3.12-venv found"

if [[ "${NO_UI}" == false ]]; then
    check_cmd node
    check_cmd npm
fi
check_cmd nginx -v

# ──────────────────────────────────────────────
# 2. Resolve base paths from LSG_APPS_HOME
# ──────────────────────────────────────────────
echo ""
info "Step 2 — Resolving installation paths..."

if [[ "${NO_IOCONNECT}" == true ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    # For local-dev, default to the parent folder of the package
    DEFAULT_APPS_HOME="$(dirname "$(cd "${SCRIPT_DIR}/.." && pwd)")"

    read -p "Enter LSG_APPS_HOME [${DEFAULT_APPS_HOME}]: " USER_APPS_HOME
    export LSG_APPS_HOME="${USER_APPS_HOME:-${DEFAULT_APPS_HOME}}"
elif [[ -z "${LSG_APPS_HOME:-}" ]]; then
    error "Environment variable LSG_APPS_HOME is not set. Export it and re-run.\n  Example: export LSG_APPS_HOME=/opt/lsg-apps"
fi

# Strip any trailing slash to avoid double-slash in composed paths
BASE_DIR="${LSG_APPS_HOME%/}"
info "LSG_APPS_HOME (parent) = ${BASE_DIR}"

# Derive the package folder name from this script's own location:
#   install.sh lives at <package_root>/scripts/install.sh
#   so package_root is one level above the scripts/ dir.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_NAME="$(basename "$(cd "${SCRIPT_DIR}/.." && pwd)")"
PACKAGE_DIR="${BASE_DIR}/${PACKAGE_NAME}"

info "Package name    = ${PACKAGE_NAME}"
info "Package dir     = ${PACKAGE_DIR}"

# Absolute paths derived from the package dir.
# In the 2-repo architecture, the protocol code is in the root of the package.
PROTOCOL_DIR="${PACKAGE_DIR}"
CONFIGURATOR_DIR="${PACKAGE_DIR}/configurator"
CONFIGURATOR_SERVER_DIR="${CONFIGURATOR_DIR}/server"
SCRIPTS_DIR="${PACKAGE_DIR}/scripts"
ENV_DIR="${PACKAGE_DIR}/env"
SERVICES_DIR="${PACKAGE_DIR}/services"
LOGS_DIR="${PACKAGE_DIR}/logs"

# Validate that the package root looks right
[[ -d "${PACKAGE_DIR}" ]]        || error "Package directory not found: ${PACKAGE_DIR}"
[[ -f "${PROTOCOL_DIR}/requirements.txt" ]] || error "requirements.txt not found in ${PROTOCOL_DIR}"

if [[ "${NO_UI}" == false ]]; then
    [[ -d "${CONFIGURATOR_DIR}" ]] \
        || error "Configurator directory not found: ${CONFIGURATOR_DIR}"
    [[ -d "${CONFIGURATOR_DIR}/dist" ]] \
        || error "Frontend build missing: ${CONFIGURATOR_DIR}/dist\n  Run 'npm run build' inside ${CONFIGURATOR_DIR}"
    [[ -f "${CONFIGURATOR_DIR}/dist/index.html" ]] \
        || error "Frontend build incomplete — index.html not found in ${CONFIGURATOR_DIR}/dist"
    [[ -d "${CONFIGURATOR_SERVER_DIR}/dist" ]] \
        || error "Backend build missing: ${CONFIGURATOR_SERVER_DIR}/dist\n  Run 'npm run build' inside ${CONFIGURATOR_SERVER_DIR}"
    [[ -f "${CONFIGURATOR_SERVER_DIR}/dist/index.js" ]] \
        || error "Backend build incomplete — index.js not found in ${CONFIGURATOR_SERVER_DIR}/dist"
fi
[[ -d "${SCRIPTS_DIR}" ]]        || error "Scripts directory not found: ${SCRIPTS_DIR}"

# Ensure output dirs exist
mkdir -p "${ENV_DIR}" "${SERVICES_DIR}" "${LOGS_DIR}"
success "All paths resolved."

# ──────────────────────────────────────────────
# Logging — tee all output to a persistent log file
# ──────────────────────────────────────────────
INSTALL_LOG="${LOGS_DIR}/install.log"
exec > >(tee -a "${INSTALL_LOG}") 2>&1
info "Full install log: ${INSTALL_LOG}"

# ──────────────────────────────────────────────
# 2b. Resolve LSG_APP_DATA and create data directory
# ──────────────────────────────────────────────
echo ""
info "Step 2b — Resolving LSG_APP_DATA data directory..."

if [[ -z "${LSG_APP_DATA:-}" ]]; then
    if [[ "${NO_IOCONNECT}" == true ]]; then
        DEFAULT_APP_DATA="/var/lib/lsg-app-data"
        read -p "Enter LSG_APP_DATA [${DEFAULT_APP_DATA}]: " USER_APP_DATA
        export LSG_APP_DATA="${USER_APP_DATA:-${DEFAULT_APP_DATA}}"
    else
        error "Environment variable LSG_APP_DATA is not set. Set it in /etc/environment and re-run."
    fi
fi

DATA_DIR="${LSG_APP_DATA%/}/${SERVICE_NAME}"
info "Data directory = ${DATA_DIR}"

mkdir -p "${DATA_DIR}"
success "Data directory ready: ${DATA_DIR}"

# Copy sample configs to the data directory if they don't already exist.
# This populates sys_parameters.json and config.csv on first install.
# On re-install, existing user configs are preserved.
for f in sys_parameters.json config.csv; do
    if [[ -f "${PROTOCOL_DIR}/${f}" ]] && [[ ! -f "${DATA_DIR}/${f}" ]]; then
        cp "${PROTOCOL_DIR}/${f}" "${DATA_DIR}/${f}"
        info "Migrated ${f} → ${DATA_DIR}/${f}"
    fi
done

# ──────────────────────────────────────────────
# 3. Create Python venv and install packages
# GENERIC-APP NOTE: Skip this entire step for pure Node.js apps (no Python runtime needed).
# Remove the python3.12 check in Step 1 and this step, then update Step 7a ExecStart.
# ──────────────────────────────────────────────
echo ""
info "Step 3 — Setting up Python virtual environment..."

VENV_DIR="${PROTOCOL_DIR}/venv"
REQUIREMENTS="${PROTOCOL_DIR}/requirements.txt"
PACKAGES_DIR="${PROTOCOL_DIR}/packages"

[[ -f "${REQUIREMENTS}" ]] || error "requirements.txt not found: ${REQUIREMENTS}"

if [[ -d "${VENV_DIR}" ]]; then
    warn "Virtual environment already exists at ${VENV_DIR} — reusing."
else
    info "Creating venv at ${VENV_DIR} using python3.12..."
    python3.12 -m venv "${VENV_DIR}"
    success "Virtual environment created."
fi

# Returns 0 if all bundled wheels are compatible with the installed Python, 1 otherwise.
# Uses Python itself to parse wheel filenames — handles build tags and abi3 stable-ABI wheels.
check_bundled_python_packages() {
    local pkgs_dir="$1"
    local mismatch
    mismatch=$(python3.12 - "${pkgs_dir}" <<'PYEOF'
import sys, os, re
pkgs_dir = sys.argv[1]
v = sys.version_info
installed_tag = f"cp{v.major}{v.minor}"
try:
    whl_files = [f for f in os.listdir(pkgs_dir) if f.endswith('.whl')]
except OSError:
    sys.exit(0)
for fname in whl_files:
    parts = fname[:-4].split('-')
    if len(parts) == 5:
        py_tag, abi_tag = parts[2], parts[3]
    elif len(parts) == 6:
        py_tag, abi_tag = parts[3], parts[4]
    else:
        continue
    if re.match(r'^(py\d+|none)$', py_tag):
        continue
    if abi_tag == 'abi3' and re.match(r'^cp\d+$', py_tag):
        if int(py_tag[2:]) <= int(installed_tag[2:]):
            continue
    if py_tag == installed_tag:
        continue
    print(f"{fname} (targets {py_tag}, installed is {installed_tag})")
    sys.exit(1)
sys.exit(0)
PYEOF
    )
    local rc=$?
    [[ $rc -ne 0 && -n "${mismatch}" ]] && warn "  Incompatible wheel: ${mismatch}"
    return $rc
}

# Try offline installation from packages/ first (required for air-gapped devices).
# Falls back to PyPI download if packages/ is empty or contains mismatched wheels.
if [[ -d "${PACKAGES_DIR}" ]] && [[ -n "$(ls -A "${PACKAGES_DIR}" 2>/dev/null)" ]]; then
    info "Checking bundled Python packages compatibility with ${PY312_VERSION}..."
    if check_bundled_python_packages "${PACKAGES_DIR}"; then
        success "Bundled packages are compatible — installing offline."
        "${VENV_DIR}/bin/pip" install --quiet --no-index \
            --find-links="${PACKAGES_DIR}" \
            -r "${REQUIREMENTS}"
        success "Python packages installed from bundled cache."
    else
        warn "Bundled packages are NOT compatible with ${PY312_VERSION} — downloading from PyPI..."
        "${VENV_DIR}/bin/pip" install --quiet -r "${REQUIREMENTS}"
        success "Python packages downloaded and installed from PyPI."
    fi
else
    warn "No offline .whl files found in ${PACKAGES_DIR} — installing from PyPI..."
    "${VENV_DIR}/bin/pip" install --quiet -r "${REQUIREMENTS}"
    success "Python packages installed from PyPI."
fi
_VENV_CREATED=true

# ──────────────────────────────────────────────
# 4. npm install for configurator (frontend + server)
# GENERIC-APP NOTE: This step is only needed for apps that use the shared opc-ua-configurator
# UI. For headless apps, pass --no-ui (already handled below). For apps with a custom UI in
# a different directory layout, update CONFIGURATOR_DIR and CONFIGURATOR_SERVER_DIR above.
# ──────────────────────────────────────────────
echo ""
if [[ "${NO_UI}" == false ]]; then
    info "Step 4 — Installing Node.js dependencies..."

    if [[ "${NO_IOCONNECT}" == true ]]; then
        # Local dev: full install for both frontend and backend
        install_npm_deps() {
            local dir="$1"
            local label="$2"
            if [[ ! -f "${dir}/package.json" ]]; then
                warn "No package.json in ${dir}, skipping npm i for ${label}."
                return
            fi
            if [[ -d "${dir}/node_modules" ]]; then
                info "${label}: node_modules already present — running npm ci to verify..."
                (cd "${dir}" && npm ci --prefer-offline)
            else
                info "${label}: Installing dependencies..."
                (cd "${dir}" && npm install)
            fi
            success "${label}: npm install done."
        }

        install_npm_deps "${CONFIGURATOR_DIR}"        "configurator (frontend)"
        install_npm_deps "${CONFIGURATOR_SERVER_DIR}" "configurator/server (backend)"
    else
        # IOConnect deploy: frontend is served from pre-built dist — no node_modules needed at runtime.
        # Backend installs production dependencies only.
        if [[ -d "${CONFIGURATOR_DIR}/dist" ]]; then
            info "configurator (frontend): pre-built dist present, skipping npm install."
        else
            warn "configurator (frontend): dist not found — running full install + build as fallback."
            if [[ -f "${CONFIGURATOR_DIR}/package.json" ]]; then
                (cd "${CONFIGURATOR_DIR}" && npm install && npm run build)
            fi
        fi
        success "configurator (frontend): ready."

        if [[ ! -f "${CONFIGURATOR_SERVER_DIR}/package.json" ]]; then
            warn "No package.json in ${CONFIGURATOR_SERVER_DIR}, skipping."
        else
            # Returns 0 if node_modules is ABI-compatible with installed Node.js, 1 otherwise.
            # Pure-JS packages (no .node native addons) always return 0.
            check_bundled_node_modules() {
                local nm_dir="$1"
                local first_native
                first_native=$(find "${nm_dir}" -name "*.node" -not -path "*/.bin/*" -print -quit 2>/dev/null)
                if [[ -z "${first_native}" ]]; then
                    info "  → No native addons — compatible with any Node.js version."
                    return 0
                fi
                info "  → Native addons found — checking ABI compatibility..."
                local incompat
                incompat=$(NM_DIR="${nm_dir}" node -e "
const fs = require('fs'), path = require('path');
const nmDir = process.env.NM_DIR;
let incompat = null;
function scan(dir) {
  let entries; try { entries = fs.readdirSync(dir); } catch(_) { return; }
  for (const f of entries) {
    if (incompat || f === '.bin') continue;
    const full = path.join(dir, f);
    let st; try { st = fs.lstatSync(full); } catch(_) { continue; }
    if (st.isDirectory()) { scan(full); continue; }
    if (!f.endsWith('.node')) continue;
    try { process.dlopen({ exports: {} }, full); }
    catch(e) {
      const msg = (e && e.message) || '';
      if (msg.includes('different Node.js version') || msg.includes('NODE_MODULE_VERSION'))
        incompat = path.basename(full);
    }
  }
}
scan(nmDir);
if (incompat) { process.stdout.write(incompat); process.exit(1); }
process.exit(0);
" 2>/dev/null)
                local rc=$?
                [[ $rc -ne 0 && -n "${incompat}" ]] && warn "  Native addon '${incompat}' built for a different Node.js ABI"
                return $rc
            }

            if [[ -d "${CONFIGURATOR_SERVER_DIR}/node_modules" ]]; then
                info "configurator/server (backend): checking pre-bundled node_modules compatibility..."
                if check_bundled_node_modules "${CONFIGURATOR_SERVER_DIR}/node_modules"; then
                    info "configurator/server (backend): pre-bundled node_modules compatible — skipping npm install."
                else
                    warn "configurator/server (backend): node_modules incompatible with installed Node.js — reinstalling..."
                    (cd "${CONFIGURATOR_SERVER_DIR}" && npm install --omit=dev)
                fi
                success "configurator/server (backend): dependencies ready."
            else
                info "configurator/server (backend): node_modules missing — installing production dependencies..."
                (cd "${CONFIGURATOR_SERVER_DIR}" && npm install --omit=dev)
                success "configurator/server (backend): dependencies ready."
            fi
        fi
    fi
else
    info "Step 4 — Skipping Node.js dependencies (--no-ui)"
fi

# ──────────────────────────────────────────────
# 5. Tear down any existing services, then find free port
# ──────────────────────────────────────────────
echo ""
info "Step 5 — Cleaning up existing services and detecting free port..."

# Stop, disable and remove a service if it is currently registered in systemd.
# This ensures the port it held is released before we scan for a free one,
# and makes install.sh safe to re-run without an explicit uninstall first.
teardown_service() {
    local name="$1"
    if systemctl list-unit-files --type=service 2>/dev/null | grep -q "^${name}.service"; then
        info "Existing service '${name}' found — stopping, disabling and removing..."
        systemctl stop    "${name}" 2>/dev/null || true
        systemctl disable "${name}" 2>/dev/null || true
        rm -f "/etc/systemd/system/${name}.service"
        systemctl daemon-reload
        success "Service '${name}' removed."
    fi
}

teardown_service "${SERVICE_NAME}"
if [[ "${NO_UI}" == false ]]; then
    teardown_service "${CONFIGURATOR_SERVICE_NAME}"
fi

RESERVED_PORTS_FILE="${LSG_APP_DATA:-/var/lib/lsg-app-data}/reserved-ports"

# Find the first TCP port >= start_port that is neither in use (ss) nor reserved
# by another LSG app (RESERVED_PORTS_FILE).
find_free_port() {
    local start_port="${1:-5000}"
    local port="${start_port}"
    while ss -tlnH "sport = :${port}" 2>/dev/null | grep -q ":${port}" \
       || { [[ -f "${RESERVED_PORTS_FILE}" ]] && grep -qE "^${port}[[:space:]]" "${RESERVED_PORTS_FILE}"; }; do
        (( port++ ))
    done
    echo "${port}"
}

reserve_port() {
    local port="$1"
    echo "${port} ${SERVICE_NAME} $(date -Iseconds)" >> "${RESERVED_PORTS_FILE}"
}

API_PORT=$(find_free_port 5000)
METRICS_PORT=$(find_free_port $((API_PORT + 1)))
reserve_port "${API_PORT}"
reserve_port "${METRICS_PORT}"
success "Free ports selected: API=${API_PORT}, Metrics=${METRICS_PORT}"

# ──────────────────────────────────────────────
# 6. Create .env file for backend (api) layer
# ──────────────────────────────────────────────
echo ""
info "Step 6 — Creating env/.env.api (runtime config for Python daemon + Node backend)..."

ENV_FILE="${ENV_DIR}/.env.api"

# NOTE: This file is generated at install time and must not be hand-edited.
# It is loaded by both systemd services via EnvironmentFile= in the unit files.
cat > "${ENV_FILE}" <<EOF
# Auto-generated by install.sh — $(date)
# Do NOT edit manually. Re-run install.sh to regenerate.

# Network (dynamically allocated free ports)
PORT=${API_PORT}
METRICS_PORT=${METRICS_PORT}

# Service identity — derived from APP_NAME in .env
SERVICE_NAME=${SERVICE_NAME}

# Absolute paths (resolved at install time from LSG_APP_DATA / package location)
SCRIPTS_DIR=${SCRIPTS_DIR}
FILES_BASE_DIR=${DATA_DIR}

# Kafka client identity (sourced from .env, or defaulted from APP_NAME)
KAFKA_CLIENT_ID=${KAFKA_CLIENT_ID:-${SERVICE_NAME}-configurator}
KAFKA_GROUP_ID=${KAFKA_GROUP_ID:-${SERVICE_NAME}-monitor}

# Default filenames served by /api/files/read-default
CSV_FILENAME=config.csv
JSON_FILENAME=sys_parameters.json

# Logging
LOG_DIR=${LOGS_DIR}
NODE_ENV=production
EOF

success ".env written to ${ENV_FILE}"
_ENV_FILE_CREATED=true

# ──────────────────────────────────────────────
# 7. Create systemd service files
# ──────────────────────────────────────────────
echo ""
info "Step 7 — Creating systemd service files..."

# ── 7a. Protocol (Python) service ─────────────
# REPLACE: Update the Description= line to name your specific protocol.
# Convention: "<Protocol> Protocol Service (<service-name>)"
# Examples: "OPC-UA Protocol Service", "Modbus Serial Protocol Service", "S7 Protocol Service"
# GENERIC-APP NOTE: Change ExecStart= for non-Python runtimes:
#   Node.js : ExecStart=$(which node) ${PACKAGE_DIR}/src/index.js
#   Java    : ExecStart=/usr/bin/java -jar ${PACKAGE_DIR}/app.jar
#   Go      : ExecStart=${PACKAGE_DIR}/bin/myapp
PROTOCOL_SERVICE_FILE="${SERVICES_DIR}/${SERVICE_NAME}.service"

cat > "${PROTOCOL_SERVICE_FILE}" <<EOF
# Auto-generated by install.sh — $(date)
[Unit]
Description=MyProto Protocol Service (${SERVICE_NAME})
After=network.target
Wants=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${PROTOCOL_DIR}
EnvironmentFile=-/etc/environment
EnvironmentFile=${ENV_FILE}
ExecStart=${VENV_DIR}/bin/python ${PROTOCOL_DIR}/src/app.py
Restart=on-failure
RestartSec=5
Environment="PYTHONUNBUFFERED=1"
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF
# ^^^ REPLACE: "MyProto Protocol Service" above with your protocol name.
# If your app is not Python, update ExecStart= to your runtime (e.g. node, java, etc.)

success "Protocol service file: ${PROTOCOL_SERVICE_FILE}"

# ── 7b. Backend (Configurator API) service ────
# REPLACE: Update the Description= line to name your specific protocol.
if [[ "${NO_UI}" == false ]]; then
    CONFIGURATOR_DIST="${CONFIGURATOR_SERVER_DIR}/dist/index.js"
    API_SERVICE_FILE="${SERVICES_DIR}/${CONFIGURATOR_SERVICE_NAME}.service"

    cat > "${API_SERVICE_FILE}" <<EOF
# Auto-generated by install.sh — $(date)
[Unit]
Description=MyProto Configurator API Service (${CONFIGURATOR_SERVICE_NAME})
After=network.target
Wants=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${CONFIGURATOR_SERVER_DIR}
EnvironmentFile=-/etc/environment
EnvironmentFile=${ENV_FILE}
ExecStart=$(which node) ${CONFIGURATOR_DIST}
Restart=on-failure
RestartSec=5
StandardOutput=append:${LOGS_DIR}/${CONFIGURATOR_SERVICE_NAME}.log
StandardError=append:${LOGS_DIR}/${CONFIGURATOR_SERVICE_NAME}.err.log
SyslogIdentifier=${CONFIGURATOR_SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF
# ^^^ REPLACE: "MyProto Configurator API Service" above with your protocol name.

    success "Configurator service file: ${API_SERVICE_FILE}"
fi

# ──────────────────────────────────────────────
# 8. Copy service files and start backend service
# ──────────────────────────────────────────────
echo ""
info "Step 8 — Installing systemd services..."

install_service() {
    local name="$1"
    local file="$2"
    local start="$3"   # "yes" or "no"

    local dest="/etc/systemd/system/${name}.service"

    info "Copying ${file} → ${dest}"
    cp "${file}" "${dest}"
    systemctl daemon-reload

    if [[ "${start}" == "yes" ]]; then
        info "Enabling and starting ${name}..."
        systemctl enable "${name}"
        systemctl start  "${name}"
        sleep 1
        if systemctl is-active --quiet "${name}"; then
            success "Service '${name}' is running."
        else
            warn "Service '${name}' may not have started. Check: journalctl -u ${name} -n 30"
        fi
    else
        # NOTE: Protocol service is enabled but NOT started here.
        # The user must configure sys_parameters.json and config.csv first,
        # then start it manually or via the configurator UI.
        info "Enabling (but NOT starting) ${name} — start it manually when ready."
        systemctl enable "${name}"
        success "Service '${name}' enabled (not started)."
    fi
}

install_service "${SERVICE_NAME}"              "${PROTOCOL_SERVICE_FILE}"  "no"
_PROTOCOL_SVC_INSTALLED=true

if [[ "${NO_UI}" == false ]]; then
    install_service "${CONFIGURATOR_SERVICE_NAME}" "${API_SERVICE_FILE}"     "yes"
    _CONFIGURATOR_SVC_INSTALLED=true
fi

# ──────────────────────────────────────────────
# 10. Create nginx snippet file
# ──────────────────────────────────────────────
echo ""
if [[ "${NO_UI}" == false ]]; then
    info "Step 10 — Creating nginx location snippet..."

    # Frontend static files are in configurator/dist
    FRONTEND_ROOT="${CONFIGURATOR_DIR}/dist"

    if [[ -z "${NGINX_SNIPPET_DIR:-}" ]]; then
        if [[ "${NO_IOCONNECT}" == true ]]; then
            DEFAULT_NGINX_DIR="/etc/nginx/snippets"
            read -p "Enter NGINX_SNIPPET_DIR [${DEFAULT_NGINX_DIR}]: " USER_NGINX_DIR
            export NGINX_SNIPPET_DIR="${USER_NGINX_DIR:-${DEFAULT_NGINX_DIR}}"
            mkdir -p "${NGINX_SNIPPET_DIR}"
        else
            error "Environment variable NGINX_SNIPPET_DIR is not set. Set it in /etc/environment and re-run."
        fi
    fi

    NGINX_SNIPPET_FILE="${NGINX_SNIPPET_DIR}/${SERVICE_NAME}.conf"

    # NOTE: The snippet adds three Nginx location blocks:
    #   /apps/<name>/api/  — proxies to the Node.js backend (port API_PORT)
    #   /apps/api/<name>/  — same, platform-alias path used by LSG-App
    #   /apps/<name>/      — serves the React static build from configurator/dist
    cat > "${NGINX_SNIPPET_FILE}" <<EOF
# Auto-generated by install.sh — $(date)
# Protocol App: ${SERVICE_NAME}
#   UI  : http://<host>/apps/${SERVICE_NAME}/
#   API : http://<host>/apps/${SERVICE_NAME}/api/   (used by the frontend)
#   API : http://<host>/apps/api/${SERVICE_NAME}/   (platform / ioconnect alias)

# ── Backend API — app-relative path (/apps/<name>/api/) ──────────────────────
location /apps/${SERVICE_NAME}/api/ {
    proxy_pass         http://127.0.0.1:${API_PORT}/api/;
    proxy_http_version 1.1;
    proxy_set_header   Host              \$host;
    proxy_set_header   X-Real-IP         \$remote_addr;
    proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto \$scheme;
    proxy_set_header   Connection        "";
    proxy_read_timeout 60s;
    proxy_connect_timeout 10s;
}

# ── Backend API — platform alias (/apps/api/<name>/) ─────────────────────────
location /apps/api/${SERVICE_NAME}/ {
    proxy_pass         http://127.0.0.1:${API_PORT}/api/;
    proxy_http_version 1.1;
    proxy_set_header   Host              \$host;
    proxy_set_header   X-Real-IP         \$remote_addr;
    proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto \$scheme;
    proxy_set_header   Connection        "";
    proxy_read_timeout 60s;
    proxy_connect_timeout 10s;
}

# ── Frontend static build ────────────────────────────────────────────────────
location ^~ /apps/${SERVICE_NAME}/ {
    alias ${FRONTEND_ROOT}/;
    index index.html;
    try_files \$uri \$uri/ @${SERVICE_NAME}_index;

    location ~* /index\.html$ {
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
        add_header Pragma        "no-cache"                            always;
        expires 0;
    }
}

location @${SERVICE_NAME}_index {
    rewrite ^ /apps/${SERVICE_NAME}/index.html last;
}

# Redirect bare path → trailing slash
location = /apps/${SERVICE_NAME} {
    return 301 \$scheme://\$host/apps/${SERVICE_NAME}/;
}
EOF

    success "nginx snippet written: ${NGINX_SNIPPET_FILE}"
    _NGINX_SNIPPET_CREATED=true

    # ──────────────────────────────────────────────
    # 11. Test nginx config and reload
    # ──────────────────────────────────────────────
    echo ""
    info "Step 11 — Testing nginx configuration and reloading..."

    if nginx -t 2>&1; then
        success "nginx -t passed."
        info "Reloading nginx..."
        systemctl reload nginx
        success "nginx reloaded successfully."
    else
        rm -f "${NGINX_SNIPPET_FILE}"
        error "nginx configuration test failed. Snippet removed.\n  Review the platform nginx config that includes: ${NGINX_SNIPPET_DIR}"
    fi
else
    info "Step 10 — Skipping Nginx snippet creation (--no-ui)"
fi

# ──────────────────────────────────────────────
# 12. Generate app_manifest.json
# ──────────────────────────────────────────────
echo ""
info "Step 12 — Generating app_manifest.json..."

# NOTE: app_manifest.json is NOT included in the release zip.
# It is generated here at install time with absolute paths for this specific device.
# The LSG-App reads this file to discover the adapter (ports, health check, scripts).
#
# GENERIC-APP NOTE: Adjust these fields for non-protocol apps:
#   "description"       — change "Protocol service" to describe your app type
#   "monitoring"        — remove this block entirely if your app has no Prometheus endpoint
#   "uiEnabled": false  — set false for headless apps (also remove uiPath and apiPath)
#   "healthCheckPath"   — set null if your app has no HTTP server
#   "startupDelaySeconds" — increase for slow-starting JVM or model-loading apps
APP_MANIFEST_FILE="${PACKAGE_DIR}/app_manifest.json"

MANIFEST_MANUAL_CONFIG=""
if [[ "${NO_IOCONNECT}" == true ]]; then
    MANIFEST_MANUAL_CONFIG=",
  \"manualConfig\": {
    \"lsgAppsHome\":    \"${LSG_APPS_HOME}\",
    \"lsgAppData\":     \"${LSG_APP_DATA}\",
    \"nginxSnippetDir\":\"${NGINX_SNIPPET_DIR:-}\"
  }"
fi

cat > "${APP_MANIFEST_FILE}" <<EOF
{
  "appName": "${SERVICE_NAME}",
  "displayName": "${SERVICE_NAME}",
  "version": "${BUILD_VERSION:-1.0.0}",
  "description": "Protocol service: ${SERVICE_NAME}",
  "port": ${API_PORT},
  "monitoring": {
    "enabled": true,
    "metricsPort": ${METRICS_PORT},
    "metricsPath": "/metrics"
  },
  "uiEnabled": true,
  "uiPath": "/apps/${SERVICE_NAME}/",
  "apiPath": "/apps/api/${SERVICE_NAME}/",
  "healthCheckPath": "/health",
  "scripts": {
    "start":     { "path": "scripts/start.sh",     "requiresSudo": true },
    "stop":      { "path": "scripts/stop.sh",      "requiresSudo": true },
    "restart":   { "path": "scripts/restart.sh",   "requiresSudo": true },
    "status":    { "path": "scripts/status.sh",    "requiresSudo": true },
    "uninstall": { "path": "scripts/uninstall.sh", "requiresSudo": true }
  },
  "startupDelaySeconds": 5${MANIFEST_MANUAL_CONFIG}
}
EOF

success "app_manifest.json written: ${APP_MANIFEST_FILE}"

# ──────────────────────────────────────────────
# Done
# ──────────────────────────────────────────────
trap - ERR

echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}   Installation completed successfully!   ${NC}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo -e "  Python service  : ${CYAN}${SERVICE_NAME}${NC}              (installed, NOT started)"
if [[ "${NO_UI}" == false ]]; then
    echo -e "  Backend service : ${CYAN}${CONFIGURATOR_SERVICE_NAME}${NC}  (installed and started)"
    echo -e "  Backend port    : ${CYAN}${API_PORT}${NC}"
    echo -e "  nginx snippet   : ${CYAN}${NGINX_SNIPPET_FILE}${NC}"
fi
echo -e "  .env file       : ${CYAN}${ENV_FILE}${NC}"
echo -e "  app manifest    : ${CYAN}${APP_MANIFEST_FILE}${NC}"
echo ""
echo -e "  To start the protocol service when ready:"
echo -e "    ${YELLOW}sudo systemctl start ${SERVICE_NAME}${NC}"
echo ""
echo -e "  Logs → ${CYAN}${LOGS_DIR}/${NC}"
echo ""
