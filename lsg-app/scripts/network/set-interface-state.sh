#!/bin/bash
# Usage: set-interface-state.sh <ifname> <up|down>
# Sets the interface up or down. Tries nmcli first, falls back to ip link.

set -e
IFNAME="$1"
STATE="$2"

[ -z "$IFNAME" ] && { echo "Error: interface name required" >&2; exit 1; }
[ "$STATE" != "up" ] && [ "$STATE" != "down" ] && { echo "Error: state must be 'up' or 'down'" >&2; exit 1; }

use_nmcli() {
    command -v nmcli &>/dev/null && \
    nmcli -t -f RUNNING general status 2>/dev/null | grep -qi 'running'
}

if use_nmcli; then
    if [ "$STATE" = "up" ]; then
        nmcli device connect "$IFNAME"
    else
        nmcli device disconnect "$IFNAME" || true
        ip link set "$IFNAME" down
    fi
else
    ip link set "$IFNAME" "$STATE"
fi
