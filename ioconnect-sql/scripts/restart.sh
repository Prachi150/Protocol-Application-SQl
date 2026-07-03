#!/bin/bash
# [SECTION: SERVICE LIFECYCLE — RESTART]
# Restarts the SQL adapter (systemd unit if present, else stop + start the process).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
CONFIG_FILE="${PROJECT_ROOT}/.env"
[ -f "${CONFIG_FILE}" ] && { set -a; source "${CONFIG_FILE}"; set +a; }

SVC="${APP_NAME:-ioconnect-sql}"

# ── Production path ──
if command -v systemctl >/dev/null 2>&1 && systemctl cat "${SVC}.service" >/dev/null 2>&1; then
    systemctl restart "${SVC}.service"
    exit $?
fi

# ── Local/dev path ──
bash "${SCRIPT_DIR}/stop.sh"
sleep 1
bash "${SCRIPT_DIR}/start.sh"
exit $?
