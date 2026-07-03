#!/bin/bash
# Usage: set-dns.sh <ifname> <server1> [server2] [server3...]
# Sets DNS servers. Tries nmcli first, falls back to /etc/resolv.conf.

set -e
IFNAME="$1"
shift
SERVERS=("$@")

[ -z "$IFNAME" ]            && { echo "Error: interface name required" >&2; exit 1; }
[ "${#SERVERS[@]}" -eq 0 ]  && { echo "Error: at least one DNS server required" >&2; exit 1; }

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
    DNS_LIST="${SERVERS[*]}"
    if [ -z "$CON" ]; then
        nmcli con add type "$(nm_iftype)" ifname "$IFNAME" con-name "$IFNAME" \
            ipv4.dns "$DNS_LIST" \
            ipv4.ignore-auto-dns yes
        CON="$IFNAME"
    else
        nmcli con mod "$CON" \
            ipv4.dns "$DNS_LIST" \
            ipv4.ignore-auto-dns yes
    fi
    nmcli con up "$CON" ifname "$IFNAME" || nmcli device connect "$IFNAME"
else
    RESOLV=/etc/resolv.conf
    cp "$RESOLV" "${RESOLV}.backup" 2>/dev/null || true
    {
        for srv in "${SERVERS[@]}"; do
            echo "nameserver $srv"
        done
    } > "$RESOLV"
fi
