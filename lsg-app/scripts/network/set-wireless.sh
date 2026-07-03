#!/bin/bash
# Usage: set-wireless.sh <ifname> <ssid> <security> [password]
# Connects to a wireless network. Tries nmcli first, falls back to wpa_supplicant.

set -e
IFNAME="$1"
SSID="$2"
SECURITY="$3"
PASSWORD="${4:-}"

[ -z "$IFNAME" ] && { echo "Error: interface name required" >&2; exit 1; }
[ -z "$SSID" ]   && { echo "Error: SSID required" >&2; exit 1; }

use_nmcli() {
    command -v nmcli &>/dev/null && \
    nmcli -t -f RUNNING general status 2>/dev/null | grep -qi 'running'
}

nm_con_name() {
    nmcli -t -f NAME,DEVICE con show 2>/dev/null \
        | awk -F: -v dev="$IFNAME" '$2 == dev { print $1; exit }' \
        | head -1
}

if use_nmcli; then
    # Delete existing connection for this SSID if present (avoid conflicts)
    EXISTING=$(nmcli -t -f NAME,TYPE con show 2>/dev/null \
        | awk -F: '$2 == "802-11-wireless" { print $1 }' | head -1 || true)
    [ -n "$EXISTING" ] && nmcli con delete "$EXISTING" 2>/dev/null || true

    if [ -z "$PASSWORD" ] || [ "$SECURITY" = "none" ] || [ "$SECURITY" = "open" ]; then
        nmcli dev wifi connect "$SSID" ifname "$IFNAME"
    else
        nmcli dev wifi connect "$SSID" password "$PASSWORD" ifname "$IFNAME"
    fi
else
    WPA_CONF="/etc/wpa_supplicant/wpa_supplicant-${IFNAME}.conf"
    cp "$WPA_CONF" "${WPA_CONF}.backup" 2>/dev/null || true

    if [ -z "$PASSWORD" ] || [ "$SECURITY" = "none" ] || [ "$SECURITY" = "open" ]; then
        cat > "$WPA_CONF" <<EOF
ctrl_interface=/var/run/wpa_supplicant
update_config=1

network={
    ssid="$SSID"
    key_mgmt=NONE
}
EOF
    else
        cat > "$WPA_CONF" <<EOF
ctrl_interface=/var/run/wpa_supplicant
update_config=1

network={
    ssid="$SSID"
    psk="$PASSWORD"
    key_mgmt=WPA-PSK
}
EOF
    fi

    chmod 600 "$WPA_CONF"
    if command -v wpa_cli &>/dev/null && wpa_cli -i "$IFNAME" status &>/dev/null; then
        wpa_cli -i "$IFNAME" reconfigure
    else
        # Start wpa_supplicant if not running
        killall wpa_supplicant 2>/dev/null || true
        wpa_supplicant -B -i "$IFNAME" -c "$WPA_CONF"
    fi
fi
