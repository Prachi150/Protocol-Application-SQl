#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
#  install.sh
#  Installs Redpanda broker + Redpanda Connect
#  on Ubuntu / Debian.
#  Starts the broker as a systemctl service.
#  Must be run as root (or with sudo).
# ─────────────────────────────────────────────

CONNECT_CONFIG_DIR="/etc/redpanda-connect"
CONNECT_SERVICES_DIR="/etc/redpanda-connect/pipelines"
CONNECT_STATE_DIR="/var/lib/redpanda-connect"
CONNECT_LOG_DIR="/var/log/redpanda-connect"

# Kafka API port for the Redpanda broker.
# Inherited from the parent install.sh via `export REDPANDA_BROKER_PORT`, or
# read from /etc/environment if called standalone. Falls back to 9092.
KAFKA_PORT="${REDPANDA_BROKER_PORT:-9092}"
ADMIN_PORT="${REDPANDA_ADMIN_PORT:-9644}"
SCHEMA_REGISTRY_PORT="${REDPANDA_SCHEMA_REGISTRY_PORT:-8081}"
PANDAPROXY_PORT="${REDPANDA_PANDAPROXY_PORT:-8082}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=versions.env
source "${SCRIPT_DIR}/versions.env"
PACKAGES_DIR="${SCRIPT_DIR}/packages"

# ── Colour helpers ────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Root check ────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run this script as root: sudo ./install.sh"

# ── Package manager — use value from scripts/install.sh or auto-detect ────────
if [[ -z "${PKG_MANAGER:-}" ]]; then
  if command -v apt-get &>/dev/null; then
    PKG_MANAGER="apt"
  elif command -v dnf &>/dev/null || command -v yum &>/dev/null; then
    PKG_MANAGER="rpm"
  else
    error "No supported package manager found (apt-get/dnf/yum)."
  fi
  info "Package manager (auto-detected): ${PKG_MANAGER}"
fi

# ─────────────────────────────────────────────
#  1. Install Redpanda broker + Redpanda Connect
# ─────────────────────────────────────────────
info "Installing Redpanda broker + Redpanda Connect (v${REDPANDA_VERSION})..."

# Use glob matching — apt-get download may append a revision suffix (e.g. _26.1.6-1_)
REDPANDA_PKG=$(find "$PACKAGES_DIR" -maxdepth 1 \( -name "redpanda_*.deb" -o -name "redpanda_*.rpm" \) 2>/dev/null | head -1)
CONNECT_PKG=$(find "$PACKAGES_DIR" -maxdepth 1 \( -name "redpanda-connect_*.deb" -o -name "redpanda-connect_*.rpm" \) 2>/dev/null | head -1)

if [[ -n "$REDPANDA_PKG" && -n "$CONNECT_PKG" ]]; then
  info "Offline packages found — installing from packages/..."
  info "  broker : $(basename "$REDPANDA_PKG")"
  info "  connect: $(basename "$CONNECT_PKG")"
  if [[ "$PKG_MANAGER" == "apt" ]]; then
    apt-get install -y "$REDPANDA_PKG" || error "Failed to install redpanda from offline package."
    apt-get install -y "$CONNECT_PKG"  || error "Failed to install redpanda-connect from offline package."
  else
    # TODO(option-a): switch to dnf install for proper dependency resolution on RPM systems
    rpm -i "$REDPANDA_PKG"  || error "Failed to install redpanda from offline package."
    rpm -i "$CONNECT_PKG"   || error "Failed to install redpanda-connect from offline package."
  fi
else
  # TODO(option-a): RPM online fallback — use bash.rpm.sh + dnf/yum instead of apt-get
  [[ "$PKG_MANAGER" == "rpm" ]] && error "RPM online fallback not yet implemented. Run download-packages.sh first to populate packages/."
  info "Offline packages not found — installing from Redpanda apt repo..."
  if [[ "$PKG_MANAGER" == "apt" ]]; then
    apt-get update -qq
    apt-get install -y -qq curl gnupg
  fi
  curl -1sLf 'https://dl.redpanda.com/nzc4ZYQK3WRGd9sy/redpanda/cfg/setup/bash.deb.sh' | bash
  apt-get install -y redpanda         || error "Failed to install redpanda via apt. Check apt output above."
  apt-get install -y redpanda-connect || error "Failed to install redpanda-connect via apt. Check apt output above."
fi

# Verify broker binary is available
if ! command -v rpk &>/dev/null; then
  error "rpk binary not found after install. Redpanda broker installation failed."
fi
info "Redpanda broker installed: $(rpk version 2>&1 | head -1)"

# Verify connect binary is available
if ! command -v redpanda-connect &>/dev/null; then
  error "redpanda-connect binary not found after install. Installation failed."
fi
info "Redpanda Connect installed: $(redpanda-connect --version 2>&1 | head -1)"

# ─────────────────────────────────────────────
#  2. Configure and start the broker service
# ─────────────────────────────────────────────
info "Configuring Redpanda broker..."

# Write a static config instead of using rpk bootstrap.
# Listen on 0.0.0.0 so the config survives IP changes (DHCP).
# Advertise on 127.0.0.1 — Redpanda Connect runs on the same machine
# so it never needs to reach the broker over the network.
REDPANDA_CFG="/etc/redpanda/redpanda.yaml"
KAFKA_ADVERTISE_PORT="${KAFKA_PORT}"

info "Writing ${REDPANDA_CFG}..."
cat > "$REDPANDA_CFG" <<RPCFG
redpanda:
    data_directory: /var/lib/redpanda/data
    seed_servers: []
    rpc_server:
        address: 0.0.0.0
        port: 33145
    kafka_api:
        - address: 0.0.0.0
          port: ${KAFKA_ADVERTISE_PORT}
    admin:
        - address: 0.0.0.0
          port: ${ADMIN_PORT}
    advertised_rpc_api:
        address: 127.0.0.1
        port: 33145
    advertised_kafka_api:
        - address: 127.0.0.1
          port: ${KAFKA_ADVERTISE_PORT}
    developer_mode: true
    auto_create_topics_enabled: true
rpk:
    overprovisioned: true
    coredump_dir: /var/lib/redpanda/coredump
pandaproxy:
    pandaproxy_api:
        - address: 0.0.0.0
          port: ${PANDAPROXY_PORT}
    advertised_pandaproxy_api:
        - address: 127.0.0.1
          port: ${PANDAPROXY_PORT}
schema_registry:
    schema_registry_api:
        - address: 0.0.0.0
          port: ${SCHEMA_REGISTRY_PORT}
    advertised_schema_registry_api:
        - address: 127.0.0.1
          port: ${SCHEMA_REGISTRY_PORT}
RPCFG
info "Redpanda config written."

# Tune the system for Redpanda (non-interactive)
rpk redpanda tune all --interactive=false 2>/dev/null || true

info "Enabling and starting redpanda systemctl service..."
systemctl daemon-reload
systemctl enable redpanda
systemctl start  redpanda

# Wait briefly and confirm
sleep 3
if systemctl is-active --quiet redpanda; then
  info "Redpanda broker is running."
else
  error "Redpanda broker failed to start. Check: journalctl -u redpanda"
fi

# ─────────────────────────────────────────────
#  3. Create directories
# ─────────────────────────────────────────────
info "Creating Connect config/state directories..."
mkdir -p "$CONNECT_CONFIG_DIR"
mkdir -p "$CONNECT_SERVICES_DIR"
mkdir -p "$CONNECT_STATE_DIR"
mkdir -p "$CONNECT_LOG_DIR"

# ─────────────────────────────────────────────
#  4. Create the systemctl template service
#     Used by add-config.sh to launch per-pipeline
#     services as redpanda-connect@<name>.service
# ─────────────────────────────────────────────
info "Creating systemctl template unit: redpanda-connect@.service"

cat > /etc/systemd/system/redpanda-connect@.service <<'EOF'
[Unit]
Description=Redpanda Connect pipeline — %i
After=network.target redpanda.service lsg-app.service
Requires=redpanda.service
Wants=lsg-app.service

[Service]
Type=simple
User=root
WorkingDirectory=/etc/redpanda-connect/pipelines

# Safe non-secret config (MASTER_MQTT_HOST, MASTER_MQTT_PORT, etc.)
EnvironmentFile=-/etc/lsg-app/config.env
# Decrypted secrets — written by lsg-app at boot from /etc/lsg-app/secrets.env.age.
# lsg-app also appends /etc/lsg-app/forwarder-secrets.env.age here if it exists,
# so FORWARDER_MQTT_* and all other custom credentials land in this single file.
EnvironmentFile=-/run/lsg-app/secrets.env

ExecStart=/usr/bin/redpanda-connect run /etc/redpanda-connect/pipelines/%i.yml
ExecReload=/bin/kill -HUP $MAINPID

Restart=on-failure
RestartSec=5s

StandardOutput=append:/var/log/redpanda-connect/%i.log
StandardError=append:/var/log/redpanda-connect/%i.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
info "Template service unit created."

# ─────────────────────────────────────────────
#  Done
# ─────────────────────────────────────────────
echo ""
info "Installation complete."
info "  Redpanda broker  : systemctl status redpanda"
info "  Add a pipeline   : sudo ./add-config.sh <path/to/config.yml>"
info "  Credentials file : /tmp/credentials  (KEY=VALUE, loaded automatically)"
echo ""
