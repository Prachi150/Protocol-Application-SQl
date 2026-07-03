#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
#  add-config.sh
#  Registers a Redpanda Connect .yml pipeline
#  as a new systemctl service and starts it.
#
#  Usage:
#    sudo ./add-config.sh <path/to/pipeline.yml>
#
#  The service name is derived from the yml filename.
#  e.g.  http_ingest.yml  → redpanda-connect@http_ingest
#
#  Credentials are loaded automatically from
#  /tmp/credentials (KEY=VALUE format) at service
#  start — no secrets needed inside the yml.
# ─────────────────────────────────────────────

CONNECT_PIPELINES_DIR="/etc/redpanda-connect/pipelines"
CONNECT_LOG_DIR="/var/log/redpanda-connect"
CREDS_FILE="/run/lsg-app/secrets.env"

# ── Colour helpers ────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Checks ────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run as root: sudo ./add-config.sh <config.yml>"
[[ $# -lt 1 ]]   && error "Usage: sudo ./add-config.sh <path/to/pipeline.yml>"

YML_SRC="$1"
[[ ! -f "$YML_SRC" ]] && error "File not found: $YML_SRC"

# Accept only .yml or .yaml
EXT="${YML_SRC##*.}"
[[ "$EXT" != "yml" && "$EXT" != "yaml" ]] && error "File must be a .yml or .yaml file."

# ── Derive pipeline name: prefer explicit arg, fall back to filename ──
BASENAME=$(basename "$YML_SRC")
if [[ -n "${2:-}" ]]; then
  PIPELINE_NAME="$2"
else
  PIPELINE_NAME="${BASENAME%.*}"
fi
SERVICE_NAME="redpanda-connect@${PIPELINE_NAME}"
DEST_YML="${CONNECT_PIPELINES_DIR}/${PIPELINE_NAME}.yml"

# ── Validate the yml with Connect before installing ──
info "Validating ${BASENAME}..."

# Load credentials so any ${VAR} refs in the yml resolve during lint.
# Uses a while-read loop instead of `source` to avoid bash expanding special
# characters in values (e.g. bcrypt hashes contain literal $ signs).
if [[ -f "$CREDS_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip blank lines and comments
    [[ -z "${line// }" || "$line" =~ ^[[:space:]]*# ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    # Only export valid shell variable names
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    export "$key=$value"
  done < "$CREDS_FILE"
  info "Credentials loaded from ${CREDS_FILE} for validation."
else
  warn "No credentials file found at ${CREDS_FILE}."
  warn "lsg-app must be running first so secrets are decrypted to ${CREDS_FILE}."
  # Dev fallback: try the project-root .env two levels above this script
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  DEV_ENV="$(dirname "$(dirname "$SCRIPT_DIR")")/.env"
  if [[ -f "$DEV_ENV" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -z "${line// }" || "$line" =~ ^[[:space:]]*# ]] && continue
      key="${line%%=*}"
      value="${line#*=}"
      [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
      export "$key=$value"
    done < "$DEV_ENV"
    info "Dev fallback: loaded env vars from ${DEV_ENV} for lint."
  fi
fi

if command -v redpanda-connect &>/dev/null; then
  if ! redpanda-connect lint --skip-env-var-check "$YML_SRC" 2>&1; then
    error "YAML validation failed. Fix the errors above and try again."
  fi
  info "Validation passed."
else
  warn "redpanda-connect not found — skipping lint. Run data-broker/redpanda/install.sh to install it."
fi

# ── Copy yml into the pipelines directory ─────
mkdir -p "$CONNECT_PIPELINES_DIR"
cp "$YML_SRC" "$DEST_YML"
chmod 644 "$DEST_YML"
info "Config installed to ${DEST_YML}"

# ── Ensure log file exists ────────────────────
mkdir -p "$CONNECT_LOG_DIR"
touch "${CONNECT_LOG_DIR}/${PIPELINE_NAME}.log"

# ── Handle already-existing service ──────────
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  warn "Service ${SERVICE_NAME} is already running — reloading..."
  systemctl restart "$SERVICE_NAME"
  info "Service restarted."
  echo ""
  info "  Status : systemctl status ${SERVICE_NAME}"
  info "  Logs   : tail -f ${CONNECT_LOG_DIR}/${PIPELINE_NAME}.log"
  exit 0
fi

# ── Enable and start the service ──────────────
info "Enabling and starting ${SERVICE_NAME}..."
systemctl daemon-reload
systemctl enable  "$SERVICE_NAME"
systemctl start   "$SERVICE_NAME"

# ── Confirm ───────────────────────────────────
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  info "Pipeline '${PIPELINE_NAME}' is running."
else
  echo ""
  warn "Service may have failed to start. Check logs:"
  journalctl -u "$SERVICE_NAME" --no-pager -n 30
  error "Service ${SERVICE_NAME} is not active."
fi

echo ""
info "Pipeline '${PIPELINE_NAME}' registered successfully."
info "  Status  : systemctl status ${SERVICE_NAME}"
info "  Logs    : tail -f ${CONNECT_LOG_DIR}/${PIPELINE_NAME}.log"
info "  Stop    : systemctl stop ${SERVICE_NAME}"
info "  Restart : systemctl restart ${SERVICE_NAME}"
echo ""
info "Note: credentials are loaded from ${CREDS_FILE} at each service start."
info "If you rotate credentials, restart the service:"
info "  sudo systemctl restart ${SERVICE_NAME}"
echo ""
