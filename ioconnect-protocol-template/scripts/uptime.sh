#!/bin/bash
# [SECTION: SERVICE LIFECYCLE — UPTIME]
# Prints the Unix epoch timestamp (seconds) when the service last became active.
# Returns exit code 1 if the service is not running or the timestamp is unavailable.
# Called by the LSG-App to display uptime in the management UI.
#
# NOTE: APP_NAME is auto-derived from the package directory name — no REPLACE needed.
# The script resolves its own parent directory at runtime, so it works correctly
# regardless of where the package is installed.
APP_NAME=$(basename "$(cd "$(dirname "$0")/.." && pwd)")
TS=$(systemctl show "$APP_NAME" --property=ActiveEnterTimestamp --value 2>/dev/null)
[ -z "$TS" ] || [ "$TS" = "n/a" ] && exit 1
date -d "$TS" +%s 2>/dev/null || exit 1
