#!/bin/bash
# Output: {"addresses":[...], "routes":[...]}
# Uses ip -j (iproute2 JSON support, available on modern Linux: Ubuntu 18.04+, Debian 10+, Fedora 27+, RPi OS)
# Excludes nothing — loopback filtering is done by the caller.

set -e

ADDRS=$(ip -j addr show 2>/dev/null) || {
    echo '{"error":"ip command with JSON support (-j) not available on this system"}' >&2
    exit 1
}

# Routes: graceful empty fallback
ROUTES=$(ip -j route show 2>/dev/null || echo '[]')

printf '{"addresses":%s,"routes":%s}\n' "$ADDRS" "$ROUTES"
