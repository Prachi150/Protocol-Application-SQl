#!/bin/bash
# Usage: set-ipv6-static.sh <ifname> <address/prefix> [gateway]
# Sets a static IPv6 address. Tries nmcli first, falls back to ip commands.

set -e
IFNAME="$1"
ADDR_PREFIX="$2"
GATEWAY="${3:-}"

[ -z "$IFNAME" ]      && { echo "Error: interface name required" >&2; exit 1; }
[ -z "$ADDR_PREFIX" ] && { echo "Error: address/prefix required" >&2; exit 1; }

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
    CON=$(nm_con_name)
    if [ -z "$CON" ]; then
        nmcli con add type "$(nm_iftype)" ifname "$IFNAME" con-name "$IFNAME" \
            ipv6.method manual \
            ipv6.addresses "$ADDR_PREFIX" \
            ${GATEWAY:+ipv6.gateway "$GATEWAY"}
        CON="$IFNAME"
    else
        nmcli con mod "$CON" \
            ipv6.method manual \
            ipv6.addresses "$ADDR_PREFIX" \
            ${GATEWAY:+ipv6.gateway "$GATEWAY"}
    fi
    nmcli con up "$CON" ifname "$IFNAME" || nmcli device connect "$IFNAME"
else
    sysctl -w "net.ipv6.conf.${IFNAME}.accept_ra=0"
    ip -6 addr flush dev "$IFNAME" scope global
    ip -6 addr add "$ADDR_PREFIX" dev "$IFNAME"
    if [ -n "$GATEWAY" ]; then
        ip -6 route del default dev "$IFNAME" 2>/dev/null || true
        ip -6 route add default via "$GATEWAY" dev "$IFNAME"
    fi
fi
