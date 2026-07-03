#!/usr/bin/env bash
# ftp-config.sh — read/write vsftpd.conf key-value pairs
# Usage:
#   sudo bash ftp-config.sh get-all
#   sudo bash ftp-config.sh get <key>
#   sudo bash ftp-config.sh set <key> <value>

set -euo pipefail

VSFTPD_CONF="/etc/vsftpd.conf"

# Ensure vsftpd.conf exists with sensible defaults if missing
init_conf() {
  [[ -f "$VSFTPD_CONF" ]] && return
  cat > "$VSFTPD_CONF" <<'DEFAULTS'
listen=NO
listen_ipv6=YES
anonymous_enable=NO
local_enable=YES
write_enable=YES
local_umask=022
dirmessage_enable=YES
use_localtime=YES
xferlog_enable=YES
connect_from_port_20=YES
chroot_local_user=YES
allow_writeable_chroot=YES
secure_chroot_dir=/var/run/vsftpd/empty
pam_service_name=vsftpd
pasv_enable=YES
pasv_min_port=40000
pasv_max_port=40100
listen_port=21
DEFAULTS
}

case "${1:-}" in
  get-all)
    init_conf
    grep -v '^#' "$VSFTPD_CONF" | grep -v '^[[:space:]]*$' || true
    ;;

  get)
    key="${2:-}"
    [[ -z "$key" ]] && { echo "Usage: $0 get <key>" >&2; exit 1; }
    init_conf
    grep -i "^${key}=" "$VSFTPD_CONF" 2>/dev/null | cut -d= -f2- | tail -1 || true
    ;;

  set)
    key="${2:-}"
    value="${3:-}"
    [[ -z "$key" ]] && { echo "Usage: $0 set <key> <value>" >&2; exit 1; }
    init_conf
    if grep -qi "^${key}=" "$VSFTPD_CONF"; then
      sed -i "s/^${key}=.*/${key}=${value}/I" "$VSFTPD_CONF"
    else
      echo "${key}=${value}" >> "$VSFTPD_CONF"
    fi
    ;;

  *)
    echo "Usage: $0 get-all | get <key> | set <key> <value>" >&2
    exit 1
    ;;
esac
