#!/bin/bash
# [SECTION: SERVICE LIFECYCLE — STATUS]
# Reports whether the SQL adapter is running.
# Exit code: 0 = active, non-zero = inactive (matches systemctl is-active behavior,
# which the configurator uses to light the Start/Stop indicator).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
CONFIG_FILE="${PROJECT_ROOT}/.env"
[ -f "${CONFIG_FILE}" ] && { set -a; source "${CONFIG_FILE}"; set +a; }

SVC="${APP_NAME:-ioconnect-sql}"

# ── Production path ──
if command -v systemctl >/dev/null 2>&1 && systemctl cat "${SVC}.service" >/dev/null 2>&1; then
    systemctl is-active "${SVC}.service"
    exit $?
fi

# ── Local/dev path ──
PIDFILE="${PROJECT_ROOT}/.adapter.pid"
if [ -f "${PIDFILE}" ] && kill -0 "$(cat "${PIDFILE}")" 2>/dev/null; then
    echo "active"
    exit 0
else
    echo "inactive"
    exit 3
fi
