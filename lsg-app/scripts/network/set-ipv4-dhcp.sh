#!/bin/bash
# Usage: set-ipv4-dhcp.sh <ifname>
# Switches interface to DHCP. Tries nmcli first, falls back to systemd-networkd.

set -e
IFNAME="$1"
[ -z "$IFNAME" ] && { echo "Error: interface name required" >&2; exit 1; }

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
            ipv4.method auto
        CON="$IFNAME"
    else
        nmcli con mod "$CON" ipv4.method auto ipv4.addresses "" ipv4.gateway ""
    fi
    nmcli con up "$CON" ifname "$IFNAME" || nmcli device connect "$IFNAME"
else
    # Fallback: write systemd-networkd config and restart
    NETD_FILE="/etc/systemd/network/10-${IFNAME}.network"
    cat > "$NETD_FILE" <<EOF
[Match]
Name=${IFNAME}

[Network]
DHCP=ipv4
EOF
    systemctl restart systemd-networkd
fi
