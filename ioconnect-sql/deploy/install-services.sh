#!/bin/bash
# ==============================================================================
# install-services.sh — install the always-on systemd services for the
# SQL Configurator (port 6767) + the SQL adapter, so both auto-start on boot
# and restart on crash. Run with sudo:  sudo bash deploy/install-services.sh
#
# Idempotent. Detects absolute paths from the repo location. Assumes:
#   • the configurator lives next to this repo (../ioconnect-protocol-configurator)
#   • node + a Python venv already exist (npm install / python -m venv done)
#   • MariaDB/MySQL is available as a service (or adjust the After= lines)
# ==============================================================================
set -euo pipefail

SQL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CFG_DIR="$(cd "${SQL_DIR}/../ioconnect-protocol-configurator" && pwd)"
RUN_USER="${SUDO_USER:-$(whoami)}"
PY="${SQL_DIR}/venv/bin/python"
# Resolve a real (non-shell-specific) node binary.
NODE="$(readlink -f "$(command -v node)")"

echo "SQL_DIR = ${SQL_DIR}"
echo "CFG_DIR = ${CFG_DIR}"
echo "USER    = ${RUN_USER}"
echo "PY      = ${PY}"
echo "NODE    = ${NODE}"

render () {  # template -> /etc/systemd/system
  sed -e "s#@@SQL_DIR@@#${SQL_DIR}#g" \
      -e "s#@@CFG_DIR@@#${CFG_DIR}#g" \
      -e "s#@@USER@@#${RUN_USER}#g" \
      -e "s#@@PY@@#${PY}#g" \
      -e "s#@@NODE@@#${NODE}#g" \
      "$1" | sudo tee "/etc/systemd/system/$(basename "$1")" >/dev/null
}

# 1. Build the configurator server if needed
if [ ! -f "${CFG_DIR}/server/dist/index.js" ]; then
  echo "Building configurator server..."
  ( cd "${CFG_DIR}/server" && npm run build )
fi

# 2. Install unit files
render "${SQL_DIR}/deploy/systemd/ioconnect-sql-configurator.service"
render "${SQL_DIR}/deploy/systemd/ioconnect-sql.service"

# 3. Allow the configurator (RUN_USER) to control the adapter service from the UI
sudo tee /etc/sudoers.d/ioconnect-sql >/dev/null <<EOF
${RUN_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl start ioconnect-sql.service, /usr/bin/systemctl stop ioconnect-sql.service, /usr/bin/systemctl restart ioconnect-sql.service, /usr/bin/systemctl is-active ioconnect-sql.service
EOF
sudo chmod 440 /etc/sudoers.d/ioconnect-sql
sudo visudo -cf /etc/sudoers.d/ioconnect-sql

# 4. Enable + start
sudo systemctl daemon-reload
sudo systemctl enable --now ioconnect-sql-configurator.service
sudo systemctl enable --now ioconnect-sql.service

echo ""
echo "Done. Status:"
for s in ioconnect-sql-configurator ioconnect-sql; do
  printf "  %-30s active=%s boot=%s\n" "$s" "$(systemctl is-active $s)" "$(systemctl is-enabled $s)"
done
