#!/usr/bin/env bash
# update-forwarder-secrets.sh
# Called by the lsg-app backend (via sudo) to persist custom forwarder credentials.
#
# Usage:
#   sudo bash scripts/update-forwarder-secrets.sh KEY=VALUE [KEY=VALUE ...]
#
# What it does:
#   1. Reads existing /etc/lsg-app/forwarder-secrets.env.age (if present)
#   2. Merges in all KEY=VALUE args (new values overwrite existing ones)
#   3. Re-encrypts the merged set → /etc/lsg-app/forwarder-secrets.env.age
#   4. Rebuilds /run/lsg-app/secrets.env from both age files so running
#      redpanda-connect services pick up the new values after a restart.

set -euo pipefail

ETC_LSG="/etc/lsg-app"
AGE_IDENTITY="${ETC_LSG}/age-identity"
AGE_IDENTITY_PUB="${ETC_LSG}/age-identity.pub"
FORWARDER_SECRETS_AGE="${ETC_LSG}/forwarder-secrets.env.age"
MAIN_SECRETS_AGE="${ETC_LSG}/secrets.env.age"
SECRETS_ENV="/run/lsg-app/secrets.env"

[[ $EUID -ne 0 ]] && { echo "Must be run as root" >&2; exit 1; }
[[ $# -eq 0 ]]    && { echo "Usage: $0 KEY=VALUE [KEY=VALUE ...]" >&2; exit 1; }

command -v age >/dev/null 2>&1 || { echo "age not found in PATH" >&2; exit 1; }

# ── 1. Read existing forwarder secrets ───────────────────────────────────────
declare -A vars

if [[ -f "$FORWARDER_SECRETS_AGE" ]]; then
  while IFS= read -r line; do
    # Accept KEY=VALUE lines; skip comments and blanks
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      key="${line%%=*}"
      vars["$key"]="${line#*=}"
    fi
  done < <(age -d -i "$AGE_IDENTITY" "$FORWARDER_SECRETS_AGE" 2>/dev/null || true)
fi

# ── 2. Merge new values ───────────────────────────────────────────────────────
for arg in "$@"; do
  [[ "$arg" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || { echo "Skipping invalid argument: $arg" >&2; continue; }
  key="${arg%%=*}"
  vars["$key"]="${arg#*=}"
done

# ── 3. Write temp plaintext and encrypt ───────────────────────────────────────
TMP=$(mktemp)
chmod 600 "$TMP"

for key in "${!vars[@]}"; do
  printf '%s=%s\n' "$key" "${vars[$key]}"
done > "$TMP"

age -R "$AGE_IDENTITY_PUB" -o "$FORWARDER_SECRETS_AGE" "$TMP"
chmod 640 "$FORWARDER_SECRETS_AGE"

# Shred plaintext temp file
if command -v shred &>/dev/null; then
  shred -u "$TMP"
else
  rm -f "$TMP"
fi

echo "[INFO] Forwarder secrets encrypted → ${FORWARDER_SECRETS_AGE}"

# ── 4. Rebuild /run/lsg-app/secrets.env from both age files ──────────────────
if [[ -f "$MAIN_SECRETS_AGE" ]]; then
  age -d -i "$AGE_IDENTITY" -o "$SECRETS_ENV" "$MAIN_SECRETS_AGE"
fi

age -d -i "$AGE_IDENTITY" "$FORWARDER_SECRETS_AGE" >> "$SECRETS_ENV"
chmod 600 "$SECRETS_ENV"

echo "[INFO] /run/lsg-app/secrets.env rebuilt with forwarder secrets."
