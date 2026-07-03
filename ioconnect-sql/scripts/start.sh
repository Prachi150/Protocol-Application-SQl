#!/bin/bash
# [SECTION: SERVICE LIFECYCLE — START]
# Sourced .env to pick up APP_NAME (set by Jenkins / install.sh).
# Then proxies to systemctl so the LSG-App orchestrator can start the protocol service.
# Called by the LSG-App via: sudo bash scripts/start.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
CONFIG_FILE="${PROJECT_ROOT}/.env"

if [ -f "${CONFIG_FILE}" ]; then
    set -a; source "${CONFIG_FILE}"; set +a
fi

# REPLACE: Update the fallback name to match your APP_NAME default in .env.example.
# This fallback is only used for manual ad-hoc invocations outside of an installed context.
SVC="${APP_NAME:-ioconnect-sql}"  # REPLACE
systemctl start "${SVC}.service"
