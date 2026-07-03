#!/usr/bin/env bash
# =============================================================================
# install.sh — LSG-App Installer
#
# What this script does:
#   1.  Preflight checks (root, node, nginx, frontend build)
#   2.  Installs 'age' encryption tool if not present
#   3.  Creates /etc/lsg-app/ — system config directory (outside the repo)
#   4.  Writes /etc/lsg-app/config.env — safe, non-secret configuration
#   5.  Generates a device-specific age identity key pair
#   6.  Generates JWT_SECRET + INTERNAL_API_KEY (cryptographically random)
#   7.  [Interactive] Prompts for user secrets, encrypts full secrets.env.age
#       [Defer]       Encrypts minimal secrets; UI wizard completes setup later
#   8.  Prompts for Nginx Basic Auth credentials and writes the htpasswd file
#   9.  Creates the Nginx site config (frontend static + backend proxy, Basic Auth gated)
#   10. Creates & enables a systemd service with age-decrypt ExecStartPre
#   10. Creates the Nginx snippet dir and apps installation dir
#   11. Writes NGINX_SNIPPET_DIR and LSG_APPS_HOME to /etc/environment
#   12. Adds a sudoers entry so the service can restart itself after setup
#   13. Starts the service
#
# Usage:
#   sudo bash scripts/install.sh                 # interactive (default)
#   sudo bash scripts/install.sh --defer-setup   # skip prompts, use UI wizard
#
# Interactive mode (default):
#   Prompts for admin credentials, MQTT passwords, GitHub token.
#   Service starts fully configured — no browser setup needed.
#   Passwords use 'read -s' (no echo, not stored in shell history).
#
# Defer-setup mode (--defer-setup flag):
#   Skips all secret prompts. Service starts in setup mode.
#   Open http://<device-ip> to complete setup via the browser wizard.
#
# Requirements:
#   - nginx installed
#   - node / npm installed
#   - Frontend built:  cd client && npm run build
#   - Must be run as root (or with sudo)
# =============================================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Root check ────────────────────────────────────────────────────────────────
[[ "$EUID" -ne 0 ]] && error "Please run as root: sudo bash scripts/install.sh"

# ── Flag parsing ──────────────────────────────────────────────────────────────
# --defer-setup : skip interactive prompts; use the browser UI wizard instead
DEFER_SETUP=false
for arg in "$@"; do
  case "$arg" in
    --defer-setup) DEFER_SETUP=true ;;
    *) error "Unknown argument: $arg\nUsage: sudo bash scripts/install.sh [--defer-setup]" ;;
  esac
done

# ── Resolve repo root (works regardless of call location) ────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Configurable values ───────────────────────────────────────────────────────
SERVICE_NAME="lsg-app"
APP_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"
[[ "$APP_USER" == "root" ]] && error "Cannot determine a non-root service user.
  Pass the installing user explicitly: sudo SUDO_USER=<username> bash scripts/install.sh"
PORT="${PORT:-3001}"

NGINX_SITE_FILE="/etc/nginx/sites-available/${SERVICE_NAME}"
NGINX_SITE_LINK="/etc/nginx/sites-enabled/${SERVICE_NAME}"
NGINX_SNIPPET_DIR="/etc/nginx/lsg-app-locations.d"
NGINX_AUTH_FILE="/etc/nginx/${SERVICE_NAME}.htpasswd"
LSG_APPS_HOME="${APP_DIR}/apps"
LSG_APP_DATA="${LSG_APP_DATA:-/var/lib/lsg-app-data}"
MASTER_MQTT_HOST="${MASTER_MQTT_HOST:-hap.faclon.com}"
MASTER_MQTT_PORT="${MASTER_MQTT_PORT:-1883}"
DATA_BROKER_DIR="${APP_DIR}/data-broker"
CONNECT_PIPELINES_DIR="/etc/redpanda-connect/pipelines"
FRONTEND_BUILD="${APP_DIR}/client/build"
SYSTEMD_UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
LOGS_DIR="/var/log/${SERVICE_NAME}"
ETC_LSG="/etc/lsg-app"
CONFIG_ENV="${ETC_LSG}/config.env"
SECRETS_AGE="${ETC_LSG}/secrets.env.age"
AGE_IDENTITY="${ETC_LSG}/age-identity"
AGE_IDENTITY_PUB="${ETC_LSG}/age-identity.pub"
SUDOERS_FILE="/etc/sudoers.d/${SERVICE_NAME}"

# ─────────────────────────────────────────────────────────────────────────────
# 1. Preflight checks  (ALL hard failures — no silent continues)
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}  LSG-App Installer${NC}"
echo ""
info "App directory        : $APP_DIR"
info "Service owner (user) : $APP_USER"
info "Backend port         : $PORT"
echo ""

# ── Runtime version requirements ──────────────────────────────────────────────
MIN_NODE_MAJOR=20
MIN_PYTHON_MAJOR=3
MIN_PYTHON_MINOR=12

install_node() {
  info "Removing conflicting apt nodejs packages..."
  apt-get remove -y nodejs libnode-dev libnode72 2>/dev/null || true
  apt-get autoremove -y 2>/dev/null || true
  info "Installing Node.js ${MIN_NODE_MAJOR} via NodeSource..."
  curl -fsSL "https://deb.nodesource.com/setup_${MIN_NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
}

install_python() {
  info "Installing Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR} via deadsnakes PPA..."
  apt-get install -y software-properties-common
  add-apt-repository -y ppa:deadsnakes/ppa
  apt-get update -q
  apt-get install -y \
    "python${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}" \
    "python${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}-venv" \
    "python${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}-dev"
}

# ── Node.js ───────────────────────────────────────────────────────────────────
NODE_BIN="$(command -v node 2>/dev/null || true)"

if [[ -z "$NODE_BIN" ]]; then
  warn "Node.js is not installed."
  printf "  Install Node.js ${MIN_NODE_MAJOR} automatically? [Y/n]: "
  read -r _yn
  [[ "${_yn,,}" == "n" ]] && error "Node.js ${MIN_NODE_MAJOR}+ is required. Install manually:
    curl -fsSL https://deb.nodesource.com/setup_${MIN_NODE_MAJOR}.x | sudo -E bash -
    sudo apt-get install -y nodejs"
  install_node
  NODE_BIN="$(command -v node)"
else
  NODE_MAJOR="$("$NODE_BIN" -e 'process.stdout.write(process.versions.node.split(".")[0])')"
  if [[ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]]; then
    warn "Node.js $("$NODE_BIN" --version) found — version ${MIN_NODE_MAJOR}+ is required."
    printf "  Upgrade to Node.js ${MIN_NODE_MAJOR} automatically? [Y/n]: "
    read -r _yn
    [[ "${_yn,,}" == "n" ]] && error "Please upgrade Node.js manually:
      sudo apt-get remove -y nodejs libnode-dev libnode72
      curl -fsSL https://deb.nodesource.com/setup_${MIN_NODE_MAJOR}.x | sudo -E bash -
      sudo apt-get install -y nodejs"
    install_node
    NODE_BIN="$(command -v node)"
  fi
fi
NODE_VERSION="$("$NODE_BIN" --version)"
info "Node.js              : $NODE_VERSION  ($NODE_BIN)"

# ── pm2 ───────────────────────────────────────────────────────────────────────
PM2_BIN="$(command -v pm2 2>/dev/null || true)"
if [[ -z "$PM2_BIN" ]]; then
  warn "pm2 is not installed."
  printf "  Install pm2 globally via npm? [Y/n]: "
  read -r _yn
  [[ "${_yn,,}" == "n" ]] && error "pm2 is required. Install it manually:
    sudo npm install -g pm2"
  npm install -g pm2
  PM2_BIN="$(command -v pm2)"
fi
info "pm2                  : $(pm2 --version 2>&1 | head -1)  ($PM2_BIN)"

# ── Python ────────────────────────────────────────────────────────────────────
PYTHON_BIN="$(command -v "python${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}" 2>/dev/null \
           || command -v python3 2>/dev/null || true)"

need_python=false
if [[ -z "$PYTHON_BIN" ]]; then
  warn "Python 3 is not installed."
  need_python=true
else
  PY_VER="$("$PYTHON_BIN" -c 'import sys; print(str(sys.version_info.major)+"."+str(sys.version_info.minor))')"
  PY_MAJOR="${PY_VER%%.*}"
  PY_MINOR="${PY_VER##*.}"
  if [[ "$PY_MAJOR" -lt "$MIN_PYTHON_MAJOR" ]] || \
     { [[ "$PY_MAJOR" -eq "$MIN_PYTHON_MAJOR" ]] && [[ "$PY_MINOR" -lt "$MIN_PYTHON_MINOR" ]]; }; then
    warn "Python ${PY_VER} found — ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ is required."
    need_python=true
  fi
fi

if [[ "$need_python" == "true" ]]; then
  printf "  Install Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR} automatically? [Y/n]: "
  read -r _yn
  [[ "${_yn,,}" == "n" ]] && error "Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ is required. Install manually:
    sudo add-apt-repository ppa:deadsnakes/ppa
    sudo apt-get install -y python${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR} python${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}-venv"
  install_python
  PYTHON_BIN="$(command -v "python${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}")"
fi
PYTHON_VERSION="$("$PYTHON_BIN" --version)"
info "Python               : $PYTHON_VERSION  ($PYTHON_BIN)"

# ── python-venv ───────────────────────────────────────────────────────────────
if ! "$PYTHON_BIN" -m venv --help &>/dev/null 2>&1; then
  warn "python-venv is not available for $PYTHON_VERSION."
  printf "  Install python${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}-venv automatically? [Y/n]: "
  read -r _yn
  [[ "${_yn,,}" == "n" ]] && error "python-venv is required. Install it manually:
    sudo apt-get install -y python${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}-venv"
  apt-get install -y "python${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}-venv"
fi
info "python-venv          : available  ($PYTHON_BIN -m venv)"

# ── python-pip ────────────────────────────────────────────────────────────────
if ! "$PYTHON_BIN" -m pip --version &>/dev/null 2>&1; then
  warn "pip is not available for $PYTHON_VERSION."
  printf "  Install pip for Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR} automatically? [Y/n]: "
  read -r _yn
  [[ "${_yn,,}" == "n" ]] && error "pip is required. Install it manually:
    sudo apt-get install -y python3-pip
    # or: sudo ${PYTHON_BIN} -m ensurepip --upgrade"
  "$PYTHON_BIN" -m ensurepip --upgrade 2>/dev/null || apt-get install -y python3-pip
fi
info "pip                  : $("$PYTHON_BIN" -m pip --version 2>&1 | head -1)"

# Nginx — hard abort
command -v nginx &>/dev/null \
  || error "Nginx not found. Install it first: apt-get install -y nginx"

# Backend node_modules — hard abort
if [[ ! -d "${APP_DIR}/node_modules" ]]; then
  error "Backend dependencies not installed — node_modules not found.
  Install them first:
    cd \"${APP_DIR}\" && npm install"
fi
if [[ ! -d "${APP_DIR}/node_modules/bcryptjs" ]]; then
  error "bcryptjs missing from node_modules (required to hash passwords during install).
  Reinstall backend dependencies:
    cd \"${APP_DIR}\" && npm install"
fi
info "Backend node_modules : ${APP_DIR}/node_modules  ✓"

# Frontend node_modules — hard abort (required to produce the build)
if [[ ! -d "${APP_DIR}/client/node_modules" ]]; then
  error "Frontend dependencies not installed — client/node_modules not found.
  Install them first:
    cd \"${APP_DIR}/client\" && npm install"
fi
info "Frontend node_modules: ${APP_DIR}/client/node_modules  ✓"

# Frontend build — hard abort
# The frontend MUST be built before installation; nginx will serve its static files.
if [[ ! -d "$FRONTEND_BUILD" || ! -f "${FRONTEND_BUILD}/index.html" ]]; then
  error "Frontend build not found at '$FRONTEND_BUILD'.
  Build it first:
    cd \"${APP_DIR}/client\" && npm run build"
fi
_build_js=$(find "${FRONTEND_BUILD}/assets" -maxdepth 1 -name "*.js" 2>/dev/null | head -1 || true)
if [[ -z "$_build_js" ]]; then
  error "Frontend build in '$FRONTEND_BUILD' is incomplete — no compiled JS found in assets/.
  Rebuild:
    cd \"${APP_DIR}/client\" && npm run build"
fi
info "Frontend build       : $FRONTEND_BUILD  ✓"

# Nginx (www-data) must be able to traverse the path to the build directory.
# Home dirs are often 750/751 which blocks www-data; ensure o+x on each ancestor.
_dir="$FRONTEND_BUILD"
while [[ "$_dir" != "/" ]]; do
  chmod o+x "$_dir" 2>/dev/null || true
  _dir="$(dirname "$_dir")"
done
chown -R "${APP_USER}:www-data" "$FRONTEND_BUILD"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Install 'age' encryption tool
# ─────────────────────────────────────────────────────────────────────────────
if ! command -v age &>/dev/null; then
  info "Installing age encryption tool..."
  if command -v apt-get &>/dev/null; then
    apt-get install -y age
  elif command -v dnf &>/dev/null; then
    dnf install -y age
  elif command -v brew &>/dev/null; then
    brew install age
  else
    # Fallback: download from GitHub releases
    warn "Package manager not detected. Attempting direct download of age..."
    AGE_VERSION="v1.1.1"
    AGE_ARCH="linux-amd64"
    TMP_AGE=$(mktemp -d)
    curl -fsSL "https://github.com/FiloSottile/age/releases/download/${AGE_VERSION}/age-${AGE_VERSION}-${AGE_ARCH}.tar.gz" \
      | tar -xz -C "$TMP_AGE"
    install -m 755 "${TMP_AGE}/age/age" /usr/local/bin/age
    install -m 755 "${TMP_AGE}/age/age-keygen" /usr/local/bin/age-keygen
    rm -rf "$TMP_AGE"
  fi
fi

AGE_BIN="$(command -v age)"
AGE_KEYGEN_BIN="$(command -v age-keygen)"
info "age                  : $("$AGE_BIN" --version 2>&1 | head -1)  ($AGE_BIN)"

# ─────────────────────────────────────────────────────────────────────────────
# 3. Create /etc/lsg-app/ — system config directory
# ─────────────────────────────────────────────────────────────────────────────
info "Creating system config directory → $ETC_LSG"
mkdir -p "$ETC_LSG"

# ─────────────────────────────────────────────────────────────────────────────
# 4. Write /etc/lsg-app/config.env — safe, non-secret configuration
# ─────────────────────────────────────────────────────────────────────────────
info "Writing non-secret config → $CONFIG_ENV"

# Source the env.example as the canonical defaults; operator can edit CONFIG_ENV
# after installation without re-running this script.
cat > "$CONFIG_ENV" << CONFIG
# LSG-App — Non-secret configuration
# Generated by install.sh on $(date)
# Edit this file to change runtime settings (does not contain any secrets).

PORT=${PORT}
NODE_ENV=production
API_PREFIX=/api
CORS_ORIGIN=*

MAX_PAYLOAD_SIZE=10mb
IOT_RATE_LIMIT_PER_DEVICE=100
IOT_DATA_RETENTION_DAYS=30
IOT_FORWARDING_METHOD=mqtt

MQTT_ENABLED=false
MQTT_BROKER=mqtt://localhost:1883
MQTT_TOPIC=iot/data
MQTT_QOS=1
MQTT_CLIENT_ID=${SERVICE_NAME}

HTTP_ENABLED=false
HTTP_ENDPOINT=http://localhost:8080/data
HTTP_METHOD=POST
HTTP_TIMEOUT=5000
HTTP_MAX_RETRIES=3
HTTP_RETRY_DELAY=1000

MASTER_MQTT_HOST=${MASTER_MQTT_HOST}
MASTER_MQTT_PORT=${MASTER_MQTT_PORT}

DATA_DIR=/opt/lsg-app/data
MAX_STORAGE_DAYS=30
CLEANUP_INTERVAL=86400000

RETRY_MAX_ATTEMPTS=3
RETRY_INITIAL_DELAY=1000
RETRY_MAX_DELAY=30000
RETRY_BACKOFF_FACTOR=2
RETRY_PERSIST_FAILURES=false

BATCH_ENABLED=false
BATCH_SIZE=100
BATCH_FLUSH_INTERVAL=5000
BATCH_MAX_WAIT_TIME=30000
BATCH_RETRY_INDIVIDUALLY=false

JWT_EXPIRY=24h
RATE_LIMIT_WINDOW=15m
RATE_LIMIT_MAX=100

ENABLE_DATA_VALIDATION=true
ENABLE_AUTO_RECONNECT=true
ENABLE_BATCH_PROCESSING=false
ENABLE_COMPRESSION=true

HEARTBEAT_INTERVAL=30000
IOADMIN_URL=
CONFIG

chown root:${APP_USER} "$CONFIG_ENV"
chmod 664 "$CONFIG_ENV"
success "config.env written."

# ─────────────────────────────────────────────────────────────────────────────
# 5. Generate device-specific age identity key pair
# ─────────────────────────────────────────────────────────────────────────────
if [[ -f "$AGE_IDENTITY" ]]; then
  warn "age identity already exists at $AGE_IDENTITY — skipping key generation."
  warn "(Delete $ETC_LSG and re-run install.sh to regenerate keys.)"
else
  info "Generating device age identity → $AGE_IDENTITY"
  "$AGE_KEYGEN_BIN" -o "$AGE_IDENTITY" 2>/dev/null
  # Extract the public key from the identity file comment
  # age-keygen writes: "# public key: age1..."
  grep "^# public key:" "$AGE_IDENTITY" | awk '{print $4}' > "$AGE_IDENTITY_PUB"
  success "age identity generated."
fi

chmod 400 "$AGE_IDENTITY"
chmod 444 "$AGE_IDENTITY_PUB"
chown "${APP_USER}:${APP_USER}" "$AGE_IDENTITY" "$AGE_IDENTITY_PUB"

# ─────────────────────────────────────────────────────────────────────────────
# 6. Generate machine secrets (JWT + internal API key)
#    These are written once at install time and never change unless reinstalled.
# ─────────────────────────────────────────────────────────────────────────────
info "Generating machine secrets (JWT_SECRET, INTERNAL_API_KEY)..."

# Check if secrets already exist — preserve them on re-install
if [[ -f "$SECRETS_AGE" ]]; then
  warn "Existing secrets.env.age found — machine secrets will be regenerated."
  warn "All existing sessions will be invalidated. Continue? [y/N]"
  read -r CONFIRM
  [[ "${CONFIRM,,}" != "y" ]] && { info "Installation aborted by user."; exit 0; }
fi

JWT_SECRET="$(openssl rand -hex 32)"
INTERNAL_API_KEY="$(openssl rand -hex 32)"
SETUP_TOKEN="$(openssl rand -hex 16)"

# ─────────────────────────────────────────────────────────────────────────────
# 6a. Infrastructure port configuration (always prompted — runs in both modes)
# ─────────────────────────────────────────────────────────────────────────────

# Returns 0 if the TCP port is not listening, 1 if it is.
# Greps for ":PORT " — the Local Address:Port is always followed by a space
# (the Peer Address column), so this is safe across all ss output formats.
port_is_free() {
  ! ss -tln 2>/dev/null | grep -qE ":${1}( |$)"
}

# prompt_port VAR_NAME LABEL DEFAULT
# Loops until the user picks a valid, free port.
# If the chosen port is in use, finds the next free one and re-suggests it.
prompt_port() {
  local var_name="$1" label="$2" default="$3"
  local _port _next
  while true; do
    printf "  %s [%s]: " "$label" "$default"
    read -r _port
    _port="${_port:-$default}"
    if ! [[ "$_port" =~ ^[0-9]+$ ]] || (( _port < 1 || _port > 65535 )); then
      echo "  Invalid port. Enter a number between 1 and 65535."
      continue
    fi
    if port_is_free "$_port"; then
      break
    fi
    _next=$(( _port + 1 ))
    while ! port_is_free "$_next" && (( _next < 65535 )); do (( _next++ )); done
    warn "  Port $_port is already in use. Suggested: $_next"
    default="$_next"
  done
  printf -v "$var_name" '%s' "$_port"
}

echo ""
echo -e "${BOLD}${CYAN}  ── Infrastructure Ports ────────────────────────────────────────${NC}"
echo ""

prompt_port NGINX_PORT "Nginx server port" "80"

# ── Nginx Basic Auth (always prompted — guards the entire app at the proxy) ──
# These credentials gate ALL HTTP access to this device (frontend + /api/),
# independent of the application's admin login. Run in both interactive and
# --defer-setup modes since the wizard endpoints sit behind this gate too.
echo ""
echo -e "${BOLD}${CYAN}  ── Nginx Basic Auth ────────────────────────────────────────────${NC}"
echo "  Restricts all HTTP access to the device. Required even with --defer-setup,"
echo "  because the browser setup wizard is served through the same Nginx."
echo ""

while true; do
  printf "  Basic Auth username: "
  read -r BASIC_AUTH_USER
  [[ -n "$BASIC_AUTH_USER" ]] && break
  echo "  Username cannot be empty."
done

while true; do
  printf "  Basic Auth password (min 8 chars): "
  read -rs BASIC_AUTH_PASS; echo ""
  if [[ ${#BASIC_AUTH_PASS} -lt 8 ]]; then
    echo "  Password must be at least 8 characters."
    continue
  fi
  printf "  Confirm password: "
  read -rs BASIC_AUTH_PASS_CONFIRM; echo ""
  if [[ "$BASIC_AUTH_PASS" != "$BASIC_AUTH_PASS_CONFIRM" ]]; then
    echo "  Passwords do not match. Try again."
    continue
  fi
  break
done

info "Writing Nginx Basic Auth file → $NGINX_AUTH_FILE"
# openssl passwd -apr1 produces an htpasswd-compatible APR1-MD5 hash; nginx accepts it.
# Using -stdin keeps the plaintext password out of argv / process listings.
BASIC_AUTH_HASH="$(openssl passwd -apr1 -stdin <<< "$BASIC_AUTH_PASS")"
printf '%s:%s\n' "$BASIC_AUTH_USER" "$BASIC_AUTH_HASH" > "$NGINX_AUTH_FILE"
unset BASIC_AUTH_PASS BASIC_AUTH_PASS_CONFIRM BASIC_AUTH_HASH
chown root:www-data "$NGINX_AUTH_FILE"
chmod 640 "$NGINX_AUTH_FILE"
success "Basic Auth credentials written for user '${BASIC_AUTH_USER}'."

# ── Broker selection ──────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}  ── Data Broker ─────────────────────────────────────────────────${NC}"
echo ""

SELECTED_BROKER=""
SELECTED_BROKER_DIR=""
PKG_MANAGER=""

# Discover available brokers (any subdir of data-broker/ that contains install.sh)
AVAILABLE_BROKERS=()
if [[ -d "$DATA_BROKER_DIR" ]]; then
  while IFS= read -r -d '' _bdir; do
    [[ -f "${_bdir}/install.sh" ]] && AVAILABLE_BROKERS+=("$(basename "$_bdir")")
  done < <(find "$DATA_BROKER_DIR" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)
fi

if [[ ${#AVAILABLE_BROKERS[@]} -eq 0 ]]; then
  warn "No brokers found in ${DATA_BROKER_DIR} — skipping broker installation."
else
  echo "  Available brokers:"
  for _i in "${!AVAILABLE_BROKERS[@]}"; do
    echo "    $((_i+1))) ${AVAILABLE_BROKERS[$_i]}"
  done
  echo "    0) None (skip broker installation)"
  echo ""
  while true; do
    printf "  Select broker [1]: "
    read -r _choice
    _choice="${_choice:-1}"
    if [[ "$_choice" == "0" ]]; then
      break
    elif [[ "$_choice" =~ ^[0-9]+$ ]] && (( _choice >= 1 && _choice <= ${#AVAILABLE_BROKERS[@]} )); then
      SELECTED_BROKER="${AVAILABLE_BROKERS[$((_choice-1))]}"
      SELECTED_BROKER_DIR="${DATA_BROKER_DIR}/${SELECTED_BROKER}"
      break
    fi
    echo "  Invalid selection."
  done
fi

# Redpanda-specific: detect package manager + prompt for ports
REDPANDA_BROKER_PORT=9092
REDPANDA_SCHEMA_REGISTRY_PORT=8081
REDPANDA_PANDAPROXY_PORT=8082
REDPANDA_ADMIN_PORT=9644
if [[ "$SELECTED_BROKER" == "redpanda" ]]; then
  if command -v apt-get &>/dev/null; then
    PKG_MANAGER="apt"
  elif command -v dnf &>/dev/null; then
    PKG_MANAGER="rpm"
  elif command -v yum &>/dev/null; then
    PKG_MANAGER="rpm"
  else
    error "No supported package manager found (apt-get/dnf/yum). Cannot install Redpanda."
  fi
  info "Package manager     : ${PKG_MANAGER}"

  prompt_port REDPANDA_BROKER_PORT          "Redpanda broker Kafka port"      "9092"
  prompt_port REDPANDA_ADMIN_PORT           "Redpanda admin API port"         "9644"
  prompt_port REDPANDA_SCHEMA_REGISTRY_PORT "Redpanda schema registry port"   "8081"
  prompt_port REDPANDA_PANDAPROXY_PORT      "Redpanda pandaproxy (HTTP) port" "8082"
fi

[[ -n "$SELECTED_BROKER" ]] && info "Selected broker     : ${SELECTED_BROKER}" || info "Data broker         : none"
info "Nginx server port   : ${NGINX_PORT}"
if [[ "$SELECTED_BROKER" == "redpanda" ]]; then
  info "Redpanda Kafka port : ${REDPANDA_BROKER_PORT}"
  info "Redpanda admin port : ${REDPANDA_ADMIN_PORT}"
  info "Schema registry     : ${REDPANDA_SCHEMA_REGISTRY_PORT}"
  info "Pandaproxy port     : ${REDPANDA_PANDAPROXY_PORT}"
fi
echo ""

# Append port config to config.env now that the values are known
echo "REDPANDA_BROKER_PORT=${REDPANDA_BROKER_PORT}"                       >> "$CONFIG_ENV"
echo "REDPANDA_SCHEMA_REGISTRY_PORT=${REDPANDA_SCHEMA_REGISTRY_PORT}"     >> "$CONFIG_ENV"
echo "REDPANDA_PANDAPROXY_PORT=${REDPANDA_PANDAPROXY_PORT}"               >> "$CONFIG_ENV"

# ───────────────────────────────────────────────────────────────────────────────
# 6b. Interactive secret collection (skipped when --defer-setup is passed)
#
# Passwords use 'read -s' — they are never echoed to the terminal and do not
# appear in shell history (the variable exists only in this shell session).
# ───────────────────────────────────────────────────────────────────────────────
if [[ "$DEFER_SETUP" == "true" ]]; then
  info "--defer-setup: skipping secret prompts. Complete setup via the browser UI."
else
  echo ""
  echo -e "${BOLD}${CYAN}  ── Secret Configuration ────────────────────────────────────────${NC}"
  echo "  Passwords are collected with 'read -s' (no echo, not in history)."
  echo ""

  # ── Admin credentials ────────────────────────────────────────────────────
  while true; do
    printf "  Admin username [admin]: "
    read -r ADMIN_USERNAME
    ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
    [[ -n "$ADMIN_USERNAME" ]] && break
    echo "  Username cannot be empty."
  done

  while true; do
    printf "  Admin password (min 8 chars): "
    read -rs ADMIN_PASSWORD; echo ""
    if [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then
      echo "  Password must be at least 8 characters."
      continue
    fi
    printf "  Confirm password: "
    read -rs ADMIN_PASSWORD_CONFIRM; echo ""
    if [[ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_CONFIRM" ]]; then
      echo "  Passwords do not match. Try again."
      continue
    fi
    break
  done

  # Generate bcrypt hash using the app's own bcryptjs dependency
  info "Hashing admin password..."
  ADMIN_PASSWORD_HASH="$(cd "$APP_DIR" && "$NODE_BIN" -e \
    "require('bcryptjs').hash(process.argv[1], 12).then(h => process.stdout.write(h))" \
    "$ADMIN_PASSWORD")"
  unset ADMIN_PASSWORD ADMIN_PASSWORD_CONFIRM  # clear plaintext from memory
  success "Admin password hashed."

  # ── IoAdmin (Master) MQTT ──────────────────────────────────────────────
  echo ""
  while true; do
    printf "  IoAdmin MQTT host [hap.faclon.com]: "
    read -r MASTER_MQTT_HOST_INPUT
    MASTER_MQTT_HOST="${MASTER_MQTT_HOST_INPUT:-hap.faclon.com}"
    [[ -n "$MASTER_MQTT_HOST" ]] && break
  done
  while true; do
    printf "  IoAdmin MQTT port [1883]: "
    read -r MASTER_MQTT_PORT_INPUT
    MASTER_MQTT_PORT="${MASTER_MQTT_PORT_INPUT:-1883}"
    [[ "$MASTER_MQTT_PORT" =~ ^[0-9]+$ ]] && break
    echo "  Port must be a number."
  done
  # Update config.env with user-provided values (written earlier with defaults)
  sed -i "s|^MASTER_MQTT_HOST=.*|MASTER_MQTT_HOST=${MASTER_MQTT_HOST}|" "$CONFIG_ENV"
  sed -i "s|^MASTER_MQTT_PORT=.*|MASTER_MQTT_PORT=${MASTER_MQTT_PORT}|" "$CONFIG_ENV"
  while true; do
    printf "  IoAdmin MQTT username: "
    read -r MASTER_MQTT_USERNAME
    [[ -n "$MASTER_MQTT_USERNAME" ]] && break
    echo "  Username cannot be empty."
  done
  printf "  IoAdmin MQTT password: "
  read -rs MASTER_MQTT_PASSWORD; echo ""

  # ── App data directory ────────────────────────────────────────────────────
  echo ""
  printf "  App data directory [/var/lib/lsg-app-data]: "
  read -r LSG_APP_DATA_INPUT
  LSG_APP_DATA="${LSG_APP_DATA_INPUT:-/var/lib/lsg-app-data}"

  # ── GitHub token ──────────────────────────────────────────────────────────
  echo ""
  while true; do
    printf "  GitHub personal access token (ghp_...): "
    read -rs GITHUB_TOKEN; echo ""
    [[ ${#GITHUB_TOKEN} -gt 10 ]] && break
    echo "  Token appears too short. Please enter a valid GitHub PAT."
  done

  # ── IoT API keys (optional) ─────────────────────────────────────────────
  echo ""
  printf "  IoT API keys (comma-separated, or press Enter to skip): "
  read -r API_KEYS_RAW

  # Convert comma-separated API keys to a JSON array using node
  API_KEYS_JSON="[]"
  if [[ -n "$API_KEYS_RAW" ]]; then
    API_KEYS_JSON="$(cd "$APP_DIR" && "$NODE_BIN" -e \
      "const k=process.argv[1].split(',').map(s=>s.trim()).filter(Boolean);" \
      -e "process.stdout.write(JSON.stringify(k))" \
      "$API_KEYS_RAW")"
  fi

  echo ""
  success "All secrets collected."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 7. Write secrets file and encrypt it
# ─────────────────────────────────────────────────────────────────────────────
info "Encrypting secrets → $SECRETS_AGE"

TMP_SECRETS="$(mktemp)"
chmod 600 "$TMP_SECRETS"

if [[ "$DEFER_SETUP" == "true" ]]; then
  # ── Minimal: machine-only secrets, SETUP_COMPLETE=false ───────────────────
  # User credentials will be added later via the browser UI wizard.
  cat > "$TMP_SECRETS" << SECRETS
# LSG-App initial secrets — install.sh --defer-setup — $(date)
# Complete setup by opening the device IP in a browser.
JWT_SECRET=${JWT_SECRET}
INTERNAL_API_KEY=${INTERNAL_API_KEY}
SETUP_COMPLETE=false
SECRETS
else
  # ── Full: all credentials collected interactively, SETUP_COMPLETE=true ─────
  # Service will start fully configured — no browser UI wizard needed.
  {
    echo "# LSG-App secrets — install.sh interactive mode — $(date)"
    echo "JWT_SECRET=${JWT_SECRET}"
    echo "INTERNAL_API_KEY=${INTERNAL_API_KEY}"
    echo "SETUP_COMPLETE=true"
    echo "ADMIN_USERNAME=${ADMIN_USERNAME}"
    echo "ADMIN_PASSWORD_HASH=${ADMIN_PASSWORD_HASH}"
    echo "MASTER_MQTT_USERNAME=${MASTER_MQTT_USERNAME}"
    echo "MASTER_MQTT_PASSWORD=${MASTER_MQTT_PASSWORD}"
    echo "GITHUB_TOKEN=${GITHUB_TOKEN}"
    [[ "$API_KEYS_JSON" != "[]" ]] && echo "API_KEYS=${API_KEYS_JSON}"
  } > "$TMP_SECRETS"
  # Clear sensitive shell variables immediately after writing
  unset ADMIN_PASSWORD_HASH MASTER_MQTT_PASSWORD GITHUB_TOKEN MQTT_PASSWORD
fi

# Encrypt with the device's age public key
"$AGE_BIN" -R "$AGE_IDENTITY_PUB" -o "$SECRETS_AGE" "$TMP_SECRETS"

# Shred the plaintext temp file immediately
if command -v shred &>/dev/null; then
  shred -u "$TMP_SECRETS"
else
  rm -f "$TMP_SECRETS"
fi

chmod 640 "$SECRETS_AGE"
chown "root:${APP_USER}" "$SECRETS_AGE"
success "Secrets encrypted."

# Write the one-time setup token — only needed for defer-setup mode
if [[ "$DEFER_SETUP" == "true" ]]; then
  info "Writing setup token → $ETC_LSG/setup-token"
  printf '%s' "$SETUP_TOKEN" > "$ETC_LSG/setup-token"
  chmod 600 "$ETC_LSG/setup-token"
  chown "${APP_USER}:${APP_USER}" "$ETC_LSG/setup-token"
  success "Setup token written."
fi


# Set ownership of the config directory so the service user can re-encrypt during setup
chown -R "${APP_USER}:${APP_USER}" "$ETC_LSG"
# But keep the identity file root-readable only (extra hardening for the private key)
chown "root:${APP_USER}" "$AGE_IDENTITY"
chmod 440 "$AGE_IDENTITY"

# ──────────────────────────────────────────────────────────────────────
# 8. Nginx server config
# ─────────────────────────────────────────────────────────────────────────────
info "Creating Nginx configuration → $NGINX_SITE_FILE"
mkdir -p "$LOGS_DIR"

cat > "$NGINX_SITE_FILE" << NGINX
# Auto-generated by ${SERVICE_NAME} install.sh — $(date)
# Do not edit manually; re-run install.sh to regenerate.

server {
    listen ${NGINX_PORT};
    server_name _;

    # ── Basic Auth (server-level — applies to all locations including snippets) ──
    auth_basic           "LSG Gateway";
    auth_basic_user_file ${NGINX_AUTH_FILE};

    # ── React Frontend (static files) ────────────────────────────────────────
    root ${FRONTEND_BUILD};
    index index.html;

    # index.html — never cache; browser must revalidate on every navigation.
    # JS/CSS filenames are content-hashed by CRA so they can be cached forever,
    # but index.html must always be fresh so the browser doesn't serve a stale
    # shell after the service is stopped or uninstalled.
    location = /index.html {
        add_header Cache-Control "no-store, no-cache, must-revalidate";
        add_header Pragma "no-cache";
        expires 0;
    }

    # Client-side routing fallback — only triggers when no other location wins
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # ── Express Backend ───────────────────────────────────────────────────────
    location /api/ {
        # Exempt /api/ from server-level Basic Auth — the API is gated by JWT
        # (jwtAuth middleware) and setupGuard. Keeping Basic Auth here would
        # cause the browser to re-prompt on every polling fetch.
        auth_basic off;
        proxy_pass         http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_set_header   Connection        "";
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
    }

    # ── Protocol-App Location Snippets ────────────────────────────────────────
    include ${NGINX_SNIPPET_DIR}/*.conf;

    # ── Static Asset Caching ──────────────────────────────────────────────────
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # ── Compression ───────────────────────────────────────────────────────────
    gzip on;
    gzip_types text/plain text/css application/json application/javascript
               text/xml application/xml text/javascript image/svg+xml;
    gzip_min_length 1024;
    gzip_vary on;

    # ── Logging ───────────────────────────────────────────────────────────────
    access_log ${LOGS_DIR}/nginx-access.log;
    error_log  ${LOGS_DIR}/nginx-error.log;
}
NGINX

[[ ! -L "$NGINX_SITE_LINK" ]] && ln -s "$NGINX_SITE_FILE" "$NGINX_SITE_LINK"

if [[ -L /etc/nginx/sites-enabled/default ]]; then
    warn "Disabling nginx default site (port 80 conflict prevention)."
    rm -f /etc/nginx/sites-enabled/default
fi

nginx -t || error "Nginx config test failed — check $NGINX_SITE_FILE"
systemctl reload nginx
success "Nginx configured and reloaded."

# ─────────────────────────────────────────────────────────────────────────────
# 9. Systemd service
#    ExecStartPre decrypts secrets.env.age → /run/lsg-app/secrets.env (RAM only)
#    The service reads both config.env (safe vars) and the decrypted secrets.
# ─────────────────────────────────────────────────────────────────────────────
info "Creating systemd service → $SYSTEMD_UNIT"

cat > "$SYSTEMD_UNIT" << UNIT
# Auto-generated by ${SERVICE_NAME} install.sh — $(date)
# Re-run install.sh to regenerate. Manual edits will be overwritten.

[Unit]
Description=LSG-App Node.js Backend
Documentation=file://${APP_DIR}/README.md
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}

# ── Secret decryption (runs before the Node process) ─────────────────────────
# age decrypts secrets.env.age → /run/lsg-app/secrets.env (tmpfs, RAM only).
# /run/lsg-app/ is created by RuntimeDirectory below.
ExecStartPre=${AGE_BIN} -d -i ${AGE_IDENTITY} -o /run/${SERVICE_NAME}/secrets.env ${SECRETS_AGE}
# Append forwarder-specific credentials (custom MQTT etc.) if they exist.
ExecStartPre=/bin/sh -c 'test -f ${ETC_LSG}/forwarder-secrets.env.age && ${AGE_BIN} -d -i ${AGE_IDENTITY} ${ETC_LSG}/forwarder-secrets.env.age >> /run/${SERVICE_NAME}/secrets.env || true'
ExecStartPre=/bin/chmod 600 /run/${SERVICE_NAME}/secrets.env

# Main process
ExecStart=${NODE_BIN} src/index.js

# Wipe the decrypted secrets from RAM when the service stops
ExecStopPost=/bin/sh -c 'command -v shred >/dev/null && shred -u /run/${SERVICE_NAME}/secrets.env || rm -f /run/${SERVICE_NAME}/secrets.env'

# ── Environment ───────────────────────────────────────────────────────────────
# Decrypted secrets (RAM-only tmpfs, populated by ExecStartPre above)
EnvironmentFile=-/run/${SERVICE_NAME}/secrets.env
# Safe non-secret configuration
EnvironmentFile=${CONFIG_ENV}
# System-wide variables (NGINX_SNIPPET_DIR, LSG_APPS_HOME, etc.)
EnvironmentFile=-/etc/environment

# ── Restart ───────────────────────────────────────────────────────────────────
Restart=on-failure
RestartSec=3s

# ── Runtime tmpfs directory ───────────────────────────────────────────────────
# systemd creates /run/${SERVICE_NAME}/ (mode 0700, owned by User) before ExecStartPre.
RuntimeDirectory=${SERVICE_NAME}
RuntimeDirectoryMode=0700

# ── Logging ───────────────────────────────────────────────────────────────────
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# ── Security hardening ────────────────────────────────────────────────────────
# NoNewPrivileges is intentionally omitted: the backend runs privileged helper
# scripts via sudo for secrets management and pipeline control. Privilege
# escalation is constrained by /etc/sudoers.d/lsg-app (specific commands only).
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

# ─────────────────────────────────────────────────────────────────────────────
# 10. Sudoers entry — allows the service user to restart itself after setup
#     The setup wizard re-encrypts secrets and then restarts the service.
# ─────────────────────────────────────────────────────────────────────────────
info "Writing sudoers entry → $SUDOERS_FILE"
cat > "$SUDOERS_FILE" << SUDOERS
# LSG-App — auto-generated by install.sh
# Allows the service user to perform app-management operations without a password.

# Self-restart after setup wizard completes
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart ${SERVICE_NAME}

# Forwarder secrets encryption (custom MQTT / HTTP credentials)
${APP_USER} ALL=(root) NOPASSWD: /bin/bash ${APP_DIR}/scripts/update-forwarder-secrets.sh *

# Network interface configuration scripts
${APP_USER} ALL=(root) NOPASSWD: /bin/bash ${APP_DIR}/scripts/network/set-*.sh *

# Firewall management
${APP_USER} ALL=(root) NOPASSWD: /usr/sbin/ufw *

# Protocol app lifecycle scripts (start/stop/restart/status/etc. for any installed app)
${APP_USER} ALL=(root) NOPASSWD: /bin/bash ${LSG_APPS_HOME}/*/scripts/*.sh
${APP_USER} ALL=(root) NOPASSWD: /bin/rm -rf ${LSG_APPS_HOME}/*
SUDOERS

if [[ "$SELECTED_BROKER" == "redpanda" ]]; then
  cat >> "$SUDOERS_FILE" << SUDOERS_REDPANDA

# Redpanda Connect pipeline management
${APP_USER} ALL=(root) NOPASSWD: /bin/bash ${SELECTED_BROKER_DIR}/add-config.sh *
${APP_USER} ALL=(root) NOPASSWD: /bin/bash ${SELECTED_BROKER_DIR}/update-broker-config.sh *
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl stop redpanda-connect@*
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl disable redpanda-connect@*
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl daemon-reload
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart redpanda-connect@*
${APP_USER} ALL=(root) NOPASSWD: /bin/rm -f ${CONNECT_PIPELINES_DIR}/*
SUDOERS_REDPANDA
fi

cat >> "$SUDOERS_FILE" << SUDOERS_SERVICES

# SSH server management
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl start ssh
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl stop ssh
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl enable ssh
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl disable ssh
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart ssh

# FTP server management
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl start vsftpd
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl stop vsftpd
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl enable vsftpd
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl disable vsftpd
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart vsftpd

# Service config helpers
${APP_USER} ALL=(root) NOPASSWD: /bin/bash ${APP_DIR}/services/ssh-config.sh *
${APP_USER} ALL=(root) NOPASSWD: /bin/bash ${APP_DIR}/services/ftp-config.sh *

# Scheduled system tasks
${APP_USER} ALL=(root) NOPASSWD: /sbin/shutdown -r now
SUDOERS_SERVICES
chmod 440 "$SUDOERS_FILE"
# Validate the sudoers file before accepting it
visudo -c -f "$SUDOERS_FILE" || {
  rm -f "$SUDOERS_FILE"
  error "sudoers entry validation failed — file removed. Check $APP_USER username."
}
success "Sudoers entry written."

# ─────────────────────────────────────────────────────────────────────────────
# 11. Harden network scripts — root owns them so APP_USER cannot overwrite
#     scripts it is allowed to sudo (privilege escalation prevention)
# ─────────────────────────────────────────────────────────────────────────────
info "Hardening network script ownership → root:root"
chown root:root "${APP_DIR}/scripts/network/"*.sh
chmod 755 "${APP_DIR}/scripts/network/"*.sh
success "Network scripts locked to root."

# ─────────────────────────────────────────────────────────────────────────────
# 12. Nginx snippet directory
# ─────────────────────────────────────────────────────────────────────────────
info "Creating Nginx snippet directory → $NGINX_SNIPPET_DIR"
mkdir -p "$NGINX_SNIPPET_DIR"
cat > "${NGINX_SNIPPET_DIR}/.keep" << 'PLACEHOLDER'
# LSG-App — Nginx protocol-app snippet directory
# Protocol app install.sh scripts write *.conf files here.
# Do NOT delete this directory; the main nginx config includes it.
PLACEHOLDER
success "Nginx snippet directory ready."

# ─────────────────────────────────────────────────────────────────────────────
# 13. Apps installation directory
# ─────────────────────────────────────────────────────────────────────────────
info "Creating apps directory → $LSG_APPS_HOME"
mkdir -p "$LSG_APPS_HOME"
chown "${APP_USER}:${APP_USER}" "$LSG_APPS_HOME"
success "Apps directory ready."

info "Creating app data directory → $LSG_APP_DATA"
mkdir -p "$LSG_APP_DATA"
chmod 755 "$LSG_APP_DATA"
success "App data directory ready."

# ─────────────────────────────────────────────────────────────────────────────
# 14. /etc/environment — system-wide variables
# ─────────────────────────────────────────────────────────────────────────────
info "Writing system-wide environment variables → /etc/environment"

set_env_var() {
    local key="$1" value="$2"
    sed -i "/^${key}=/d" /etc/environment
    echo "${key}=${value}" >> /etc/environment
}

REDPANDA_BROKER_HOST="127.0.0.1"

set_env_var "NGINX_SNIPPET_DIR"               "$NGINX_SNIPPET_DIR"
set_env_var "LSG_APPS_HOME"                   "$LSG_APPS_HOME"
set_env_var "LSG_APP_DATA"                    "$LSG_APP_DATA"
set_env_var "NGINX_PORT"                      "$NGINX_PORT"
set_env_var "REDPANDA_BROKER_PORT"            "$REDPANDA_BROKER_PORT"
set_env_var "REDPANDA_BROKER_HOST"            "$REDPANDA_BROKER_HOST"
set_env_var "REDPANDA_KAFKA_ADDRESS"          "${REDPANDA_BROKER_HOST}:${REDPANDA_BROKER_PORT}"
set_env_var "REDPANDA_ADMIN_PORT"             "$REDPANDA_ADMIN_PORT"
set_env_var "REDPANDA_ADMIN_ADDRESS"          "${REDPANDA_BROKER_HOST}:${REDPANDA_ADMIN_PORT}"
set_env_var "REDPANDA_SCHEMA_REGISTRY_PORT"   "$REDPANDA_SCHEMA_REGISTRY_PORT"
set_env_var "REDPANDA_SCHEMA_REGISTRY_ADDRESS" "${REDPANDA_BROKER_HOST}:${REDPANDA_SCHEMA_REGISTRY_PORT}"
set_env_var "REDPANDA_PANDAPROXY_PORT"        "$REDPANDA_PANDAPROXY_PORT"
set_env_var "REDPANDA_PANDAPROXY_ADDRESS"     "${REDPANDA_BROKER_HOST}:${REDPANDA_PANDAPROXY_PORT}"
set_env_var "BROKER_TYPE"                     "REDPANDA"
set_env_var "REDPANDA_KAFKA_SECURITY_PROTOCOL" "PLAINTEXT"
set_env_var "REDPANDA_KAFKA_SASL_MECHANISM"   ""
success "  NGINX_SNIPPET_DIR=$NGINX_SNIPPET_DIR"
success "  LSG_APPS_HOME=$LSG_APPS_HOME"
success "  LSG_APP_DATA=$LSG_APP_DATA"
success "  NGINX_PORT=$NGINX_PORT"
success "  REDPANDA_BROKER_PORT=$REDPANDA_BROKER_PORT"
success "  REDPANDA_BROKER_HOST=$REDPANDA_BROKER_HOST"
success "  REDPANDA_KAFKA_ADDRESS=${REDPANDA_BROKER_HOST}:${REDPANDA_BROKER_PORT}"
success "  REDPANDA_ADMIN_PORT=$REDPANDA_ADMIN_PORT"
success "  REDPANDA_ADMIN_ADDRESS=${REDPANDA_BROKER_HOST}:${REDPANDA_ADMIN_PORT}"
success "  REDPANDA_SCHEMA_REGISTRY_PORT=$REDPANDA_SCHEMA_REGISTRY_PORT"
success "  REDPANDA_SCHEMA_REGISTRY_ADDRESS=${REDPANDA_BROKER_HOST}:${REDPANDA_SCHEMA_REGISTRY_PORT}"
success "  REDPANDA_PANDAPROXY_PORT=$REDPANDA_PANDAPROXY_PORT"
success "  REDPANDA_PANDAPROXY_ADDRESS=${REDPANDA_BROKER_HOST}:${REDPANDA_PANDAPROXY_PORT}"
success "  BROKER_TYPE=REDPANDA"
success "  REDPANDA_KAFKA_SECURITY_PROTOCOL=PLAINTEXT"
success "  REDPANDA_KAFKA_SASL_MECHANISM=(none)"

# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
# 15. Enable and start the service
# ─────────────────────────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

# Brief pause to let the service settle
sleep 2
if systemctl is-active --quiet "${SERVICE_NAME}"; then
  if [[ "$DEFER_SETUP" == "true" ]]; then
    success "Service started (setup mode — open browser to complete)."
  else
    success "Service started — fully configured and ready."
  fi
else
  warn "Service did not start cleanly. Check logs:"
  warn "  sudo journalctl -u ${SERVICE_NAME} -n 30"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 16. Install data broker
# ─────────────────────────────────────────────────────────────────────────────
if [[ -n "$SELECTED_BROKER" ]]; then
  info "Installing data broker (${SELECTED_BROKER})..."
  BROKER_INSTALL_SCRIPT="${SELECTED_BROKER_DIR}/install.sh"
  if [[ -f "$BROKER_INSTALL_SCRIPT" ]]; then
    export REDPANDA_BROKER_PORT
    export REDPANDA_ADMIN_PORT
    export REDPANDA_SCHEMA_REGISTRY_PORT
    export REDPANDA_PANDAPROXY_PORT
    export PKG_MANAGER
    if bash "$BROKER_INSTALL_SCRIPT"; then
      success "${SELECTED_BROKER} broker installed."
    else
      error "${SELECTED_BROKER}/install.sh failed. Fix the errors above and re-run: sudo bash scripts/install.sh"
    fi
  else
    error "${BROKER_INSTALL_SCRIPT} not found. Ensure ${SELECTED_BROKER_DIR} is present."
  fi
else
  info "No data broker selected — skipping."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 17. Install service packages (openssh-server, vsftpd)
# ─────────────────────────────────────────────────────────────────────────────
SERVICES_PKG_DIR="${APP_DIR}/services/packages"
info "Installing service packages (openssh-server, vsftpd)..."
for pkg in openssh-server vsftpd; do
  if dpkg -s "$pkg" &>/dev/null 2>&1; then
    info "  $pkg already installed — skipping."
  else
    offline_pkg=$(find "${SERVICES_PKG_DIR}" -name "${pkg}_*.deb" 2>/dev/null | head -1 || true)
    if [[ -n "$offline_pkg" ]]; then
      info "  Installing $pkg from offline package: $(basename "$offline_pkg")"
      apt-get install -y "$offline_pkg" || warn "  Failed to install $pkg from offline package."
    else
      info "  Installing $pkg from apt..."
      apt-get install -y "$pkg" || warn "  Failed to install $pkg via apt."
    fi
  fi
done

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  LSG-App installation complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo ""
printf "  %-26s %s\n" "Frontend build:"    "$FRONTEND_BUILD"
printf "  %-26s %s\n" "Backend port:"      "$PORT"
printf "  %-26s %s\n" "Nginx port:"        "$NGINX_PORT"
printf "  %-26s %s\n" "Redpanda Kafka:"    "$REDPANDA_BROKER_PORT"
printf "  %-26s %s\n" "Redpanda admin:"    "$REDPANDA_ADMIN_PORT"
printf "  %-26s %s\n" "Redpanda SR:"       "$REDPANDA_SCHEMA_REGISTRY_PORT"
printf "  %-26s %s\n" "Redpanda proxy:"    "$REDPANDA_PANDAPROXY_PORT"
printf "  %-26s %s\n" "Nginx config:"      "$NGINX_SITE_FILE"
printf "  %-26s %s\n" "Systemd unit:"      "$SYSTEMD_UNIT"
printf "  %-26s %s\n" "System config:"     "$CONFIG_ENV"
printf "  %-26s %s\n" "Encrypted secrets:" "$SECRETS_AGE"
printf "  %-26s %s\n" "age identity:"      "$AGE_IDENTITY"
printf "  %-26s %s\n" "Nginx snippets:"    "$NGINX_SNIPPET_DIR"
printf "  %-26s %s\n" "Apps folder:"       "$LSG_APPS_HOME"
echo ""

if [[ "$DEFER_SETUP" == "true" ]]; then
  echo -e "${YELLOW}  ⚠  Next step: Complete first-run setup in the browser${NC}"
  echo ""
  echo "     Open your browser and navigate to:"
  echo -e "       ${BOLD}http://$(hostname -I | awk '{print $1}'):${NGINX_PORT}${NC}"
  echo ""
  echo "     You will be prompted to set:"
  echo "       • Admin username & password"
  echo "       • IoAdmin MQTT credentials"
  echo "       • Protocol MQTT credentials (optional)"
  echo "       • GitHub token"
  echo ""
  echo -e "  ${BOLD}Setup token (enter this in the browser):${NC}"
  echo -e "     ${YELLOW}${SETUP_TOKEN}${NC}"
  echo ""
  echo "     Token also saved at: $ETC_LSG/setup-token"
else
  echo -e "${GREEN}  ✓  Device is fully configured and ready to use.${NC}"
  echo ""
  echo "     Log in at:"
  echo -e "       ${BOLD}http://$(hostname -I | awk '{print $1}'):${NGINX_PORT}${NC}"
fi

echo ""
echo "  Useful commands:"
echo "    sudo systemctl status ${SERVICE_NAME}"
echo "    sudo journalctl -u ${SERVICE_NAME} -f"
echo "    sudo nginx -t && sudo systemctl reload nginx"
echo ""