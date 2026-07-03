#!/usr/bin/env bash
# =============================================================================
# apply-basic-auth.sh — One-shot patch to add Nginx Basic Auth to a live install
#
# Use this on devices that were installed BEFORE Basic Auth was added to
# install.sh. New installs get this automatically — do not run this on top of
# a fresh install.
#
# What this script does:
#   1. Prompts for a username + password (read -s, no echo)
#   2. Writes /etc/nginx/lsg-app.htpasswd  (root:www-data 0640, APR1-MD5)
#   3. Backs up /etc/nginx/sites-available/lsg-app to lsg-app.bak.<timestamp>
#   4. Inserts auth_basic + auth_basic_user_file inside the server { ... } block
#      (idempotent — re-running just rotates credentials)
#   5. Inserts `auth_basic off;` inside the location /api/ block so the API,
#      which is already JWT-gated, doesn't trigger per-request Basic Auth
#      prompts in the browser. (idempotent)
#   6. nginx -t — aborts if invalid (config left untouched)
#   7. systemctl reload nginx
#   8. Verifies with curl: 401 anon on /, 401 anon on /api/* with no Basic Auth challenge
#
# Usage:  sudo bash scripts/apply-basic-auth.sh
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

[[ "$EUID" -ne 0 ]] && error "Run as root: sudo bash scripts/apply-basic-auth.sh"

SERVICE_NAME="lsg-app"
NGINX_SITE_FILE="/etc/nginx/sites-available/${SERVICE_NAME}"
NGINX_AUTH_FILE="/etc/nginx/${SERVICE_NAME}.htpasswd"

[[ -f "$NGINX_SITE_FILE" ]] || error "$NGINX_SITE_FILE not found — is lsg-app installed?"
command -v openssl >/dev/null || error "openssl is required."
command -v nginx   >/dev/null || error "nginx is required."

# ── Prompt for credentials ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}  ── Nginx Basic Auth ────────────────────────────────────────────${NC}"
echo "  Restricts ALL HTTP access to this device (frontend + /api/ + app UIs)."
echo ""

while true; do
  printf "  Basic Auth username: "
  read -r BASIC_AUTH_USER
  [[ -n "$BASIC_AUTH_USER" ]] && break
  echo "  Username cannot be empty."
done

while true; do
  printf "  Basic Auth password (min 8 chars): "
  read -rs BASIC_AUTH_PASS; echo ""
  if [[ ${#BASIC_AUTH_PASS} -lt 8 ]]; then
    echo "  Password must be at least 8 characters."
    continue
  fi
  printf "  Confirm password: "
  read -rs BASIC_AUTH_PASS_CONFIRM; echo ""
  if [[ "$BASIC_AUTH_PASS" != "$BASIC_AUTH_PASS_CONFIRM" ]]; then
    echo "  Passwords do not match. Try again."
    continue
  fi
  break
done

# ── Write htpasswd file ───────────────────────────────────────────────────────
info "Writing Nginx Basic Auth file → $NGINX_AUTH_FILE"
BASIC_AUTH_HASH="$(openssl passwd -apr1 -stdin <<< "$BASIC_AUTH_PASS")"
printf '%s:%s\n' "$BASIC_AUTH_USER" "$BASIC_AUTH_HASH" > "$NGINX_AUTH_FILE"
unset BASIC_AUTH_PASS BASIC_AUTH_PASS_CONFIRM BASIC_AUTH_HASH
chown root:www-data "$NGINX_AUTH_FILE"
chmod 640 "$NGINX_AUTH_FILE"
success "htpasswd written for user '${BASIC_AUTH_USER}'."

# ── Patch the nginx site config ───────────────────────────────────────────────
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="${NGINX_SITE_FILE}.bak.${TS}"

if grep -q "auth_basic_user_file ${NGINX_AUTH_FILE};" "$NGINX_SITE_FILE"; then
  info "auth_basic already present in $NGINX_SITE_FILE — credentials rotated only."
else
  info "Backing up nginx site → $BACKUP"
  cp -p "$NGINX_SITE_FILE" "$BACKUP"

  info "Inserting auth_basic into $NGINX_SITE_FILE"
  # Insert two directives on the line immediately after `server_name _;`.
  # Using a sed address pattern keeps this resilient to whitespace variation.
  sed -i "/^[[:space:]]*server_name[[:space:]]\+_;[[:space:]]*$/a\\
\\
    # ── Basic Auth (server-level — applies to all locations including snippets) ──\\
    auth_basic           \"LSG Gateway\";\\
    auth_basic_user_file ${NGINX_AUTH_FILE};
" "$NGINX_SITE_FILE"

  if ! grep -q "auth_basic_user_file ${NGINX_AUTH_FILE};" "$NGINX_SITE_FILE"; then
    warn "Failed to insert auth_basic via sed — restoring backup."
    cp -p "$BACKUP" "$NGINX_SITE_FILE"
    error "Could not patch $NGINX_SITE_FILE. Edit it manually and add the two directives inside the server block."
  fi
fi

# ── Exempt /api/ from Basic Auth (idempotent) ────────────────────────────────
# The API is already gated by JWT + setupGuard. Keeping Basic Auth here would
# re-prompt the browser on every polling fetch (Topbar uptime, status pages,
# etc.). Frontend, static assets, and protocol-app UIs remain Basic Auth gated.
if awk '/^[[:space:]]*location \/api\/ {/,/^[[:space:]]*}[[:space:]]*$/' "$NGINX_SITE_FILE" \
     | grep -q "auth_basic off;"; then
  info "/api/ already exempt from Basic Auth — skipping."
else
  if [[ ! -f "$BACKUP" ]]; then
    info "Backing up nginx site → $BACKUP"
    cp -p "$NGINX_SITE_FILE" "$BACKUP"
  fi
  info "Adding 'auth_basic off;' to the /api/ block"
  sed -i '/^[[:space:]]*location \/api\/ {[[:space:]]*$/a\        auth_basic off;' "$NGINX_SITE_FILE"
fi

# ── Validate and reload ───────────────────────────────────────────────────────
info "Validating nginx config..."
if ! nginx -t 2>&1; then
  if [[ -f "$BACKUP" ]]; then
    warn "Reverting nginx site from backup."
    cp -p "$BACKUP" "$NGINX_SITE_FILE"
  fi
  error "nginx -t failed. Site reverted; no reload performed."
fi

info "Reloading nginx..."
systemctl reload nginx
success "nginx reloaded."

# ── Verify ────────────────────────────────────────────────────────────────────
LISTEN_PORT="$(grep -oE 'listen[[:space:]]+[0-9]+' "$NGINX_SITE_FILE" | head -1 | awk '{print $2}')"
LISTEN_PORT="${LISTEN_PORT:-80}"

info "Verifying — anonymous request should now return 401:"
HTTP_CODE_NOAUTH="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${LISTEN_PORT}/" || echo "000")"
if [[ "$HTTP_CODE_NOAUTH" == "401" ]]; then
  success "  GET /  → ${HTTP_CODE_NOAUTH}  (Basic Auth is now enforced)"
else
  warn "  GET /  → ${HTTP_CODE_NOAUTH}  (expected 401 — check the site config manually)"
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Basic Auth applied${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo "  htpasswd file : $NGINX_AUTH_FILE"
[[ -f "$BACKUP" ]] && echo "  Site backup   : $BACKUP"
echo "  Listen port   : $LISTEN_PORT"
echo ""
echo "  Test from your laptop:"
echo "    curl -I -u ${BASIC_AUTH_USER}:<password> http://<device-ip>:${LISTEN_PORT}/"
echo ""
echo "  Rotate later:"
echo "    sudo bash scripts/apply-basic-auth.sh"
echo ""
