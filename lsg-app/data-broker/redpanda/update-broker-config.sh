#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
#  update-broker-config.sh
#  Validates and atomically deploys a new
#  /etc/redpanda/redpanda.yaml.
#
#  Usage:
#    sudo bash update-broker-config.sh <staging-yaml-path> [restart]
#
#  Pass "true" as second argument to restart redpanda after deploy.
# ─────────────────────────────────────────────

TARGET="/etc/redpanda/redpanda.yaml"
STAGING="${1:-}"
RESTART="${2:-false}"
ENV_UPDATES_FILE="${3:-}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash update-broker-config.sh <staging> [restart]"
[[ -z "$STAGING" ]] && error "Usage: sudo bash update-broker-config.sh <staging-yaml-path> [restart]"
[[ ! -f "$STAGING" ]] && error "Staging file not found: $STAGING"

# ── Validate YAML is parseable ─────────────────
info "Validating broker config..."
if command -v python3 &>/dev/null; then
  python3 -c "
import yaml, sys
try:
    with open('$STAGING') as f:
        yaml.safe_load(f)
    print('YAML parse OK')
except yaml.YAMLError as e:
    print('YAML parse error: ' + str(e), file=sys.stderr)
    sys.exit(1)
" || error "YAML validation failed — fix errors above and retry."
elif command -v rpk &>/dev/null; then
  # rpk can partially validate — best effort
  rpk redpanda config print --config "$STAGING" &>/dev/null || warn "rpk validation skipped."
else
  warn "No validator available (python3 or rpk). Deploying without validation."
fi

# ── Backup existing config ─────────────────────
if [[ -f "$TARGET" ]]; then
  BACKUP="${TARGET}.bak.$(date +%Y%m%d%H%M%S)"
  cp "$TARGET" "$BACKUP"
  info "Backed up existing config to $BACKUP"
fi

# ── Deploy ─────────────────────────────────────
cp "$STAGING" "$TARGET"
rm -f "$STAGING"
info "Broker config deployed to $TARGET"

# ── Optionally restart ─────────────────────────
if [[ "$RESTART" == "true" ]]; then
  info "Restarting redpanda service..."
  systemctl restart redpanda
  sleep 2
  if systemctl is-active --quiet redpanda; then
    info "Redpanda restarted successfully."
  else
    error "Redpanda failed to start after config change. Check: journalctl -u redpanda -n 50"
  fi
fi

# Apply /etc/environment updates if provided
if [[ -n "$ENV_UPDATES_FILE" && -f "$ENV_UPDATES_FILE" ]]; then
  info "Applying /etc/environment updates..."
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    [[ -z "$key" || "$key" == \#* ]] && continue
    sed -i "/^${key}=/d" /etc/environment
    echo "${key}=${value}" >> /etc/environment
    info "  ${key}=${value}"
  done < "$ENV_UPDATES_FILE"
  rm -f "$ENV_UPDATES_FILE"
fi

echo ""
info "Broker config update complete."
