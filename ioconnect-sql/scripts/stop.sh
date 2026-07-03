#!/bin/bash
# [SECTION: SERVICE LIFECYCLE — STOP]
# Stops the SQL adapter (systemd unit if present, else the direct background process).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
CONFIG_FILE="${PROJECT_ROOT}/.env"
[ -f "${CONFIG_FILE}" ] && { set -a; source "${CONFIG_FILE}"; set +a; }

SVC="${APP_NAME:-ioconnect-sql}"

# ── Production path ──
if command -v systemctl >/dev/null 2>&1 && systemctl cat "${SVC}.service" >/dev/null 2>&1; then
    systemctl stop "${SVC}.service"
    exit $?
fi

# ── Local/dev path ──
PIDFILE="${PROJECT_ROOT}/.adapter.pid"
if [ -f "${PIDFILE}" ] && kill -0 "$(cat "${PIDFILE}")" 2>/dev/null; then
    kill "$(cat "${PIDFILE}")" 2>/dev/null
    rm -f "${PIDFILE}"
    echo "ioconnect-sql stopped"
else
    rm -f "${PIDFILE}"
    echo "ioconnect-sql not running"
fi
exit 0
