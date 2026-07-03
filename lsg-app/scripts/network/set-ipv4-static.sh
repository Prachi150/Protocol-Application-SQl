#!/bin/bash
# Usage: set-ipv4-static.sh <ifname> <address/prefix> [gateway]
# Sets a static IPv4 address. Tries nmcli first, falls back to ip commands.

set -e
IFNAME="$1"
ADDR_PREFIX="$2"  # e.g. 192.168.1.100/24
GATEWAY="${3:-}"

[ -z "$IFNAME" ]      && { echo "Error: interface name required" >&2; exit 1; }
[ -z "$ADDR_PREFIX" ] && { echo "Error: address/prefix required (e.g. 192.168.1.100/24)" >&2; exit 1; }

use_nmcli() {
    command -v nmcli &>/dev/null && \
    nmcli -t -f RUNNING general status 2>/dev/null | grep -qi 'running'
}

nm_con_name() {
    nmcli -t -f NAME,DEVICE con show 2>/dev/null \
        | awk -F: -v dev="$IFNAME" '$2 == dev { print $1; exit }' \
        | head -1
}

nm_iftype() {
    [ -d "/sys/class/net/$IFNAME/wireless" ] && echo "wifi" || echo "ethernet"
}

if use_nmcli; then
    # Delete all existing connections for this device to avoid duplicate-name conflicts
    for _uuid in $(nmcli -t -f UUID,DEVICE con show 2>/dev/null \
            | awk -F: -v dev="$IFNAME" '$2 == dev { print $1 }'); do
        nmcli con delete uuid "$_uuid" 2>/dev/null || true
    done

    nmcli con add type "$(nm_iftype)" ifname "$IFNAME" con-name "$IFNAME" \
        ipv4.method manual \
        ipv4.addresses "$ADDR_PREFIX" \
        ${GATEWAY:+ipv4.gateway "$GATEWAY"} \
        ipv6.method ignore \
        connection.autoconnect yes
    nmcli device connect "$IFNAME"
else
    # Fallback: raw ip commands (temporary — does not survive reboot)
    ip addr flush dev "$IFNAME" scope global
    ip addr add "$ADDR_PREFIX" dev "$IFNAME"
    if [ -n "$GATEWAY" ]; then
        ip route del default dev "$IFNAME" 2>/dev/null || true
        ip route add default via "$GATEWAY" dev "$IFNAME"
    fi
    ip link set "$IFNAME" up
fi
