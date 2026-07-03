#!/bin/bash
# Internet connectivity check.
# Output: JSON with dns/ping/http/latency/interface/route fields.
# No jq dependency — pure bash + standard tools.

DNS=false
PING=false
HTTP=false
LATENCY=null
IFACE=""
ROUTE_OUT=""

# --- DNS check: dig preferred, nslookup fallback ---
if command -v dig &>/dev/null; then
    dig +short +timeout=2 +tries=1 google.com 2>/dev/null | grep -qE '^[0-9]' && DNS=true || true
fi
if [ "$DNS" = false ] && command -v nslookup &>/dev/null; then
    nslookup -timeout=2 google.com 2>/dev/null | grep -q 'Address:' && DNS=true || true
fi
if [ "$DNS" = false ] && command -v host &>/dev/null; then
    host -W 2 google.com 2>/dev/null | grep -q 'has address' && DNS=true || true
fi

# --- Ping check ---
PING_OUT=$(ping -c 1 -W 2 8.8.8.8 2>/dev/null) && {
    PING=true
    MS=$(printf '%s' "$PING_OUT" | grep -oP 'time=\K[0-9.]+' | head -1 || true)
    [ -n "$MS" ] && LATENCY="\"$MS\""
} || true

# --- HTTP check: accept any 2xx or 3xx ---
if command -v curl &>/dev/null; then
    CODE=$(curl -s --connect-timeout 2 -o /dev/null -w "%{http_code}" https://google.com 2>/dev/null || echo "0")
    printf '%s' "$CODE" | grep -qE '^[23]' && HTTP=true || true
fi

# --- Egress route info ---
ROUTE_OUT=$(ip route get 8.8.8.8 2>/dev/null | head -1 || true)
IFACE=$(printf '%s' "$ROUTE_OUT" | grep -oP 'dev \K\S+' || true)

# Escape double-quotes and backslashes for JSON string values
json_str() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

printf '{"dns":%s,"ping":%s,"http":%s,"latency":%s,"interface":"%s","route":"%s"}\n' \
    "$DNS" "$PING" "$HTTP" "${LATENCY:-null}" \
    "$(json_str "$IFACE")" "$(json_str "$ROUTE_OUT")"
