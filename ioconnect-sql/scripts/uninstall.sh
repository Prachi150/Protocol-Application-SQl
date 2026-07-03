#!/bin/bash
# ==============================================================================
# uninstall.sh — IoConnect Protocol Adapter Uninstaller (TEMPLATE)
#
# [SECTION: WHAT THIS SCRIPT DOES]
# Reverses install.sh. Steps:
#   1. Stop, disable and remove both systemd services
#   2. Preserve frontend/backend build artifacts (so re-install is fast)
#   3. Replace nginx location block with a 404 tombstone, then reload
#   4. Delete the Python virtual environment
#   5. Remove env/.env.api and release reserved ports
#   6. Remove app_manifest.json
#   7. (--purge only) Delete the entire package directory
#
# Usage: sudo bash uninstall.sh [--purge] [--no-ui] [--no-ioconnect]
#   --purge           Also delete the package directory after uninstalling.
#                     Without this flag, config files and logs are preserved so
#                     the package can be re-installed without losing data.
#
# [SECTION: CUSTOMIZATION POINTS]
# Search for "REPLACE" to find all per-protocol customization sites (2 total):
#   1. APP_NAME default    — must match install.sh
#   2. Banner title string — update to reflect your protocol name
# ==============================================================================
set -uo pipefail

# ──────────────────────────────────────────────
# Colour helpers (same as install.sh)
# ──────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ──────────────────────────────────────────────
# Parse arguments
# ──────────────────────────────────────────────
PURGE=false
NO_UI=false
NO_IOCONNECT=false
for arg in "$@"; do
    case "${arg}" in
        --purge) PURGE=true ;;
        --no-ui) NO_UI=true ;;
        --no-ioconnect) NO_IOCONNECT=true ;;
        *) error "Unknown argument: '${arg}'\n  Usage: sudo bash uninstall.sh [--purge] [--no-ui] [--no-ioconnect]" ;;
    esac
done

echo -e "\n${BOLD}══════════════════════════════════════════${NC}"
# REPLACE: Update the protocol name in the banner title below.
echo -e "${BOLD}   MyProto Package — Uninstall Script     ${NC}"  # REPLACE: e.g. "OPC-UA Package", "Modbus Package"
if [[ "${PURGE}" == "true" ]]; then
    echo -e "${BOLD}${RED}   Mode: PURGE (package directory will be deleted)${NC}"
fi
if [[ "${NO_UI}" == "true" ]]; then
    echo -e "${BOLD}${CYAN}   Mode: NO UI (configurator skipped)${NC}"
fi
if [[ "${NO_IOCONNECT}" == "true" ]]; then
    echo -e "${BOLD}${CYAN}   Mode: NO IOCONNECT (interactive prompts enabled)${NC}"
fi
echo -e "${BOLD}══════════════════════════════════════════${NC}\n"

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
# 0. Service names — must match install.sh
# ──────────────────────────────────────────────
# REPLACE: Change the fallback to match your APP_NAME default in install.sh.
APP_NAME="${APP_NAME:-my-myproto-app}"  # REPLACE: match install.sh APP_NAME default
SERVICE_NAME="${APP_NAME}"
CONFIGURATOR_SERVICE_NAME="${APP_NAME}-configurator"

info "Service names:"
info "  Protocol app : ${SERVICE_NAME}"
info "  Backend API  : ${CONFIGURATOR_SERVICE_NAME}"

# ──────────────────────────────────────────────
# Resolve paths (same logic as install.sh)
# ──────────────────────────────────────────────
echo ""
info "Resolving paths..."

if [[ "${NO_IOCONNECT}" == "true" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    DEFAULT_APPS_HOME="$(dirname "$(cd "${SCRIPT_DIR}/.." && pwd)")"

    read -p "Enter LSG_APPS_HOME [${DEFAULT_APPS_HOME}]: " USER_APPS_HOME
    export LSG_APPS_HOME="${USER_APPS_HOME:-${DEFAULT_APPS_HOME}}"
elif [[ -z "${LSG_APPS_HOME:-}" ]]; then
    error "Environment variable LSG_APPS_HOME is not set.\n  Example: export LSG_APPS_HOME=/opt/lsg-apps"
fi

if [[ -z "${NGINX_SNIPPET_DIR:-}" ]]; then
    if [[ "${NO_IOCONNECT}" == "true" ]]; then
        if [[ "${NO_UI}" == "true" ]]; then
            warn "NGINX_SNIPPET_DIR not set and --no-ui specified — skipping nginx tombstone."
        else
            DEFAULT_NGINX_DIR="/etc/nginx/snippets"
            read -p "Enter NGINX_SNIPPET_DIR [${DEFAULT_NGINX_DIR}]: " USER_NGINX_DIR
            export NGINX_SNIPPET_DIR="${USER_NGINX_DIR:-${DEFAULT_NGINX_DIR}}"
        fi
    else
        error "Environment variable NGINX_SNIPPET_DIR is not set. Set it in /etc/environment and re-run."
    fi
fi

BASE_DIR="${LSG_APPS_HOME%/}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_NAME="$(basename "$(cd "${SCRIPT_DIR}/.." && pwd)")"
PACKAGE_DIR="${BASE_DIR}/${PACKAGE_NAME}"

PROTOCOL_DIR="${PACKAGE_DIR}"
VENV_DIR="${PROTOCOL_DIR}/venv"
SERVICES_DIR="${PACKAGE_DIR}/services"
CONFIGURATOR_DIR="${PACKAGE_DIR}/configurator"

info "Package dir = ${PACKAGE_DIR}"

# ──────────────────────────────────────────────
# Logging — tee all output to a persistent log file
# ──────────────────────────────────────────────
LOGS_DIR="${PACKAGE_DIR}/logs"
mkdir -p "${LOGS_DIR}"
UNINSTALL_LOG="${LOGS_DIR}/uninstall.log"
exec > >(tee -a "${UNINSTALL_LOG}") 2>&1
info "Full uninstall log: ${UNINSTALL_LOG}"

# ──────────────────────────────────────────────
# 1. Stop, disable and remove systemd services
# ──────────────────────────────────────────────
echo ""
info "Step 1 — Removing systemd services..."

remove_service() {
    local name="$1"
    local unit="/etc/systemd/system/${name}.service"

    info "Stopping  ${name}..."
    systemctl stop    "${name}" 2>/dev/null || true
    info "Disabling ${name}..."
    systemctl disable "${name}" 2>/dev/null || true
    info "Removing  ${unit}..."
    rm -f "${unit}"
    success "Service '${name}' removed."

    local local_file="${SERVICES_DIR}/${name}.service"
    if [[ -f "${local_file}" ]]; then
        rm -f "${local_file}"
        info "Removed local service file: ${local_file}"
    fi
}

remove_service "${SERVICE_NAME}"
remove_service "${CONFIGURATOR_SERVICE_NAME}"

systemctl daemon-reload
success "systemd reloaded."

# ──────────────────────────────────────────────
# 2. Preserve frontend and backend build artifacts
#    The dist folders are kept so a re-install does not require
#    re-building the frontend or backend.
# ──────────────────────────────────────────────
echo ""
info "Step 2 — Preserving build artifacts (configurator/dist and configurator/server/dist kept)."

# ──────────────────────────────────────────────
# 3. Replace nginx config with a 404 tombstone, then reload
#
# Simply deleting the snippet leaves the path served by the parent
# server block's catch-all (try_files → index.html → 200 OK).
# A tombstone location block that returns 404 takes precedence and
# makes the path properly unreachable after uninstall.
# ──────────────────────────────────────────────
if [[ -n "${NGINX_SNIPPET_DIR:-}" ]]; then
    echo ""
    info "Step 3 — Installing nginx 404 tombstone for /apps/${SERVICE_NAME}/..."

    NGINX_SNIPPET_FILE="${NGINX_SNIPPET_DIR}/${SERVICE_NAME}.conf"

    cat > "${NGINX_SNIPPET_FILE}" <<EOF
# Tombstone written by uninstall.sh — $(date)
# ${SERVICE_NAME} has been uninstalled. These location blocks return 404
# and instruct browsers to clear any locally cached app data (PWA shell,
# service workers, storage) so the UI cannot be opened from browser cache.
location ^~ /apps/${SERVICE_NAME}/ {
    add_header Clear-Site-Data '"cache", "cookies", "storage"' always;
    return 404;
}
location ^~ /apps/api/${SERVICE_NAME}/ {
    return 404;
}
EOF
    success "Tombstone written: ${NGINX_SNIPPET_FILE}"

    for dir in "/etc/nginx/sites-enabled" "/etc/nginx/sites-available"; do
        target="${dir}/${SERVICE_NAME}.conf"
        if [[ -f "${target}" ]] || [[ -L "${target}" ]]; then
            rm -f "${target}"
            info "Removed stale config: ${target}"
        fi
    done

    if nginx -t 2>&1; then
        if systemctl reload nginx; then
            success "nginx reloaded — /apps/${SERVICE_NAME}/ now returns 404."
        else
            error "nginx reload failed. The path may still be reachable until nginx is reloaded manually.\n  Run: sudo systemctl reload nginx"
        fi
    else
        error "nginx -t failed after writing tombstone — remaining nginx config has errors.\n  Fix the config and run: sudo systemctl reload nginx"
    fi
else
    echo ""
    info "Step 3 — Skipping nginx tombstone creation (NGINX_SNIPPET_DIR not set)"
fi

# ──────────────────────────────────────────────
# 4. Delete the Python virtual environment
# ──────────────────────────────────────────────
echo ""
info "Step 4 — Removing Python virtual environment..."

if [[ -d "${VENV_DIR}" ]]; then
    rm -rf "${VENV_DIR}"
    success "Removed: ${VENV_DIR}"
else
    warn "venv not found at ${VENV_DIR} — skipping."
fi

# ──────────────────────────────────────────────
# 5. Delete the backend .env file
# ──────────────────────────────────────────────
echo ""
info "Step 5 — Removing backend .env file..."

RESERVED_PORTS_FILE="${LSG_APP_DATA:-/var/lib/lsg-app-data}/reserved-ports"

ENV_API="${PACKAGE_DIR}/env/.env.api"
if [[ -f "${ENV_API}" ]]; then
    if [[ -f "${RESERVED_PORTS_FILE}" ]]; then
        sed -i "/^[0-9][0-9]* ${SERVICE_NAME} /d" "${RESERVED_PORTS_FILE}"
        success "Released reserved ports for ${SERVICE_NAME}"
    fi
    rm -f "${ENV_API}"
    success "Removed: ${ENV_API}"
else
    warn ".env.api not found at ${ENV_API} — skipping."
fi

# ──────────────────────────────────────────────
# 6. Delete app_manifest.json
# ──────────────────────────────────────────────
echo ""
info "Step 6 — Removing app_manifest.json..."

APP_MANIFEST="${PACKAGE_DIR}/app_manifest.json"
if [[ -f "${APP_MANIFEST}" ]]; then
    rm -f "${APP_MANIFEST}"
    success "Removed: ${APP_MANIFEST}"
else
    warn "app_manifest.json not found at ${APP_MANIFEST} — skipping."
fi

# ──────────────────────────────────────────────
# 7. (--purge only) Delete the entire package directory
# ──────────────────────────────────────────────
if [[ "${PURGE}" == "true" ]]; then
    echo ""
    info "Step 7 — Purging package directory..."

    if [[ -d "${PACKAGE_DIR}" ]]; then
        rm -rf "${PACKAGE_DIR}"
        success "Removed package directory: ${PACKAGE_DIR}"
    else
        warn "Package directory not found: ${PACKAGE_DIR} — skipping."
    fi
fi

# ──────────────────────────────────────────────
# Done
# ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}   Uninstall completed successfully.      ${NC}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${NC}"
echo ""
if [[ "${PURGE}" == "true" ]]; then
    echo -e "  Package directory ${CYAN}${PACKAGE_DIR}${NC} has been deleted."
else
    echo -e "  The following were ${RED}NOT${NC} removed (data preserved):"
    echo -e "    ${CYAN}${PACKAGE_DIR}/logs/${NC}      — log files"
    echo -e "    ${CYAN}${PACKAGE_DIR}/src/${NC}       — protocol code"
    echo -e "    ${CYAN}${PACKAGE_DIR}/*.csv${NC}      — config files"
    echo ""
    echo -e "  Re-install at any time with:"
    echo -e "    ${YELLOW}sudo bash ${SCRIPT_DIR}/install.sh${NC}"
    echo ""
    echo -e "  To fully remove all data:"
    echo -e "    ${YELLOW}sudo bash ${SCRIPT_DIR}/uninstall.sh --purge${NC}"
fi
echo ""
exit 0
