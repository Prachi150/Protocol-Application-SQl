#!/bin/bash
# [SECTION: SERVICE LIFECYCLE — STOP]
# Sourced .env to pick up APP_NAME (set by Jenkins / install.sh).
# Then proxies to systemctl so the LSG-App orchestrator can stop the protocol service.
# Called by the LSG-App via: sudo bash scripts/stop.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
CONFIG_FILE="${PROJECT_ROOT}/.env"

if [ -f "${CONFIG_FILE}" ]; then
    set -a; source "${CONFIG_FILE}"; set +a
fi

# REPLACE: Update the fallback name to match your APP_NAME default in .env.example.
SVC="${APP_NAME:-ioconnect-sql}"  # REPLACE
systemctl stop "${SVC}.service"
