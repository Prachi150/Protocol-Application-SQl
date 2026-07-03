#!/usr/bin/env bash
# ssh-config.sh — read/write SSH port via a drop-in config snippet
# Usage:
#   sudo bash ssh-config.sh get-port
#   sudo bash ssh-config.sh set-port <port>

set -euo pipefail

DROPIN="/etc/ssh/sshd_config.d/lsg-app.conf"

case "${1:-}" in
  get-port)
    # Try the drop-in first, then scan all sshd_config files for the last Port directive
    if [[ -f "$DROPIN" ]]; then
      port=$(grep -i '^Port ' "$DROPIN" 2>/dev/null | awk '{print $2}' | tail -1)
      [[ -n "$port" ]] && echo "$port" && exit 0
    fi
    # Fall back to scanning all included configs
    port=$(grep -ri '^Port ' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/ 2>/dev/null \
           | awk -F: '{print $NF}' | awk '{print $2}' | tail -1)
    echo "${port:-22}"
    ;;

  set-port)
    port="${2:-}"
    [[ -z "$port" ]] && { echo "Usage: $0 set-port <port>" >&2; exit 1; }
    mkdir -p /etc/ssh/sshd_config.d
    printf 'Port %s\n' "$port" | tee "$DROPIN" > /dev/null
    ;;

  *)
    echo "Usage: $0 get-port | set-port <port>" >&2
    exit 1
    ;;
esac
