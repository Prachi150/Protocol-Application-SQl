#!/bin/bash
# [SECTION: SERVICE LIFECYCLE — START]
# Starts the SQL adapter.
#   • Production (LSG-App): if a systemd unit "${APP_NAME}.service" exists, use it.
#   • Local/dev: no systemd unit → run the adapter directly as a background
#     process (PID file + log), routing data to the configurator's monitor
#     ingest so Live Values works without a Kafka/Redpanda broker.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
CONFIG_FILE="${PROJECT_ROOT}/.env"
[ -f "${CONFIG_FILE}" ] && { set -a; source "${CONFIG_FILE}"; set +a; }

SVC="${APP_NAME:-ioconnect-sql}"

# ── Production path: systemd unit present ──
if command -v systemctl >/dev/null 2>&1 && systemctl cat "${SVC}.service" >/dev/null 2>&1; then
    sudo -n systemctl start "${SVC}.service"
    exit $?
fi

# ── Local/dev path: run directly ──
PIDFILE="${PROJECT_ROOT}/.adapter.pid"
LOGDIR="${PROJECT_ROOT}/logs"; mkdir -p "${LOGDIR}"
PY="${PROJECT_ROOT}/venv/bin/python"

if [ -f "${PIDFILE}" ] && kill -0 "$(cat "${PIDFILE}")" 2>/dev/null; then
    echo "ioconnect-sql already running (pid $(cat "${PIDFILE}"))"
    exit 0
fi

cd "${PROJECT_ROOT}"
FILES_BASE_DIR="${FILES_BASE_DIR:-${PROJECT_ROOT}/data}" \
METRICS_PORT="${METRICS_PORT:-9470}" \
SERVICE_NAME="${SVC}" \
LOG_DIR="${LOGDIR}" \
HTTP_POST_URL="${HTTP_POST_URL:-http://localhost:6767/api/monitor/ingest}" \
    nohup "${PY}" src/app.py >> "${LOGDIR}/adapter.out" 2>&1 &

echo $! > "${PIDFILE}"
echo "ioconnect-sql started (pid $(cat "${PIDFILE}"))"
exit 0
