#!/bin/bash
# [SECTION: SERVICE LIFECYCLE — STATUS]
# Sourced .env to pick up APP_NAME (set by Jenkins / install.sh).
# Returns the systemd active/inactive status of the protocol service.
# Called by the LSG-App via: sudo bash scripts/status.sh
# Exit code: 0 = active, non-zero = inactive/failed (standard systemctl is-active behavior).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
CONFIG_FILE="${PROJECT_ROOT}/.env"

if [ -f "${CONFIG_FILE}" ]; then
    set -a; source "${CONFIG_FILE}"; set +a
fi

# REPLACE: Update the fallback name to match your APP_NAME default in .env.example.
SVC="${APP_NAME:-my-myproto-app}"  # REPLACE
systemctl is-active "${SVC}.service"
