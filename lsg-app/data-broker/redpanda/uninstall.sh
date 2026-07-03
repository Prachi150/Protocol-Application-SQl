#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
#  uninstall.sh
#  Stops all Redpanda Connect pipeline services,
#  removes their unit files, then uninstalls
#  Redpanda Connect and the Redpanda broker.
#
#  Usage:
#    sudo ./uninstall.sh
#    sudo ./uninstall.sh --purge   (also removes data dirs and configs)
# ─────────────────────────────────────────────

CONNECT_PIPELINES_DIR="/etc/redpanda-connect/pipelines"
CONNECT_CONFIG_DIR="/etc/redpanda-connect"
CONNECT_STATE_DIR="/var/lib/redpanda-connect"
CONNECT_LOG_DIR="/var/log/redpanda-connect"
PURGE=false

# ── Colour helpers ────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Checks ────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run as root: sudo ./uninstall.sh"

[[ "${1:-}" == "--purge" ]] && PURGE=true

# ── Confirm ───────────────────────────────────
echo ""
warn "This will stop and remove ALL Redpanda Connect pipelines"
warn "and uninstall the Redpanda broker."
if $PURGE; then
  warn "--purge: config files, logs, and data directories will also be deleted."
fi
echo ""
read -r -p "Continue? [y/N] " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }
echo ""

# ─────────────────────────────────────────────
#  1. Stop and disable all Connect pipeline services
# ─────────────────────────────────────────────
info "Stopping Redpanda Connect pipeline services..."

# Find all instantiated redpanda-connect@* services
SERVICES=$(systemctl list-units --type=service --all \
  --no-legend --plain 2>/dev/null \
  | awk '{print $1}' \
  | grep '^redpanda-connect@' || true)

if [[ -n "$SERVICES" ]]; then
  while IFS= read -r SVC; do
    info "  Stopping ${SVC}..."
    systemctl stop    "$SVC" 2>/dev/null || warn "  Could not stop ${SVC} (may already be stopped)"
    systemctl disable "$SVC" 2>/dev/null || true
  done <<< "$SERVICES"
else
  info "  No active Connect pipeline services found."
fi

# Remove the template unit file
TEMPLATE_UNIT="/etc/systemd/system/redpanda-connect@.service"
if [[ -f "$TEMPLATE_UNIT" ]]; then
  info "Removing systemctl template unit..."
  rm -f "$TEMPLATE_UNIT"
fi

systemctl daemon-reload
systemctl reset-failed 2>/dev/null || true
info "All Connect services stopped and removed."

# ─────────────────────────────────────────────
#  2. Uninstall Redpanda Connect
# ─────────────────────────────────────────────
info "Uninstalling Redpanda Connect..."

if dpkg -l redpanda-connect 2>/dev/null | grep -q '^ii'; then
  apt-get remove -y redpanda-connect
  info "Redpanda Connect package removed."
else
  warn "Redpanda Connect package not found — skipping."
fi

# ─────────────────────────────────────────────
#  3. Stop and uninstall Redpanda broker
# ─────────────────────────────────────────────
info "Stopping Redpanda broker service..."
systemctl stop    redpanda 2>/dev/null || warn "Redpanda broker was not running."
systemctl disable redpanda 2>/dev/null || true

info "Uninstalling Redpanda broker..."
if dpkg -l redpanda 2>/dev/null | grep -q '^ii'; then
  apt-get remove -y redpanda
  info "Redpanda broker package removed."
else
  warn "Redpanda broker package not found — skipping."
fi

# ─────────────────────────────────────────────
#  4. Optional --purge: remove all data and configs
# ─────────────────────────────────────────────
if $PURGE; then
  info "Purging config, log, and data directories..."

  # Connect dirs
  rm -rf "$CONNECT_CONFIG_DIR"
  rm -rf "$CONNECT_STATE_DIR"
  rm -rf "$CONNECT_LOG_DIR"
  info "  Removed: ${CONNECT_CONFIG_DIR}"
  info "  Removed: ${CONNECT_STATE_DIR}"
  info "  Removed: ${CONNECT_LOG_DIR}"

  # Redpanda broker data
  REDPANDA_DATA_DIRS=("/var/lib/redpanda" "/etc/redpanda")
  for DIR in "${REDPANDA_DATA_DIRS[@]}"; do
    if [[ -d "$DIR" ]]; then
      rm -rf "$DIR"
      info "  Removed: ${DIR}"
    fi
  done

  # Remove apt repo config added by Redpanda installer (if present from a prior online install)
  rm -f /etc/apt/sources.list.d/redpanda*.list
  rm -f /usr/share/keyrings/redpanda*.gpg
  apt-get update -qq

  info "Purge complete."
else
  info "Config and data directories preserved."
  info "Run with --purge to also remove them:"
  info "  sudo ./uninstall.sh --purge"
fi

# ─────────────────────────────────────────────
#  Done
# ─────────────────────────────────────────────
echo ""
info "Uninstall complete."
echo ""
