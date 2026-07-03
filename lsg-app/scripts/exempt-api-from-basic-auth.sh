#!/usr/bin/env bash
# =============================================================================
# exempt-api-from-basic-auth.sh — Add `auth_basic off;` to the /api/ location
#
# Why: server-level Basic Auth was prompting the browser on every backend
# polling request. /api/ is already gated by JWT (jwtAuth middleware) and
# setupGuard, so exempting it from the nginx Basic Auth challenge gives the
# expected "prompt once at page load" UX without weakening the application's
# auth model. Frontend, static assets, and protocol-app UIs remain Basic-Auth
# gated.
#
# Idempotent — re-running is a no-op if the directive is already present.
#
# Usage:  sudo bash scripts/exempt-api-from-basic-auth.sh
# =============================================================================

set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

[[ "$EUID" -ne 0 ]] && error "Run as root: sudo bash scripts/exempt-api-from-basic-auth.sh"

SITE_FILE="/etc/nginx/sites-available/lsg-app"
[[ -f "$SITE_FILE" ]] || error "$SITE_FILE not found — is lsg-app installed?"

# Idempotency check: look for `auth_basic off;` inside the /api/ location block.
# `awk` extracts the /api/ block; `grep -q` checks for the directive.
if awk '/^[[:space:]]*location \/api\/ {/,/^[[:space:]]*}[[:space:]]*$/' "$SITE_FILE" \
     | grep -q "auth_basic off;"; then
  success "/api/ block already has 'auth_basic off;' — nothing to do."
  exit 0
fi

TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="${SITE_FILE}.bak.${TS}"
info "Backing up → $BACKUP"
cp -p "$SITE_FILE" "$BACKUP"

info "Inserting 'auth_basic off;' inside the /api/ block"
# Insert as the first directive inside the location /api/ block — applies before any proxy_pass.
sed -i '/^[[:space:]]*location \/api\/ {[[:space:]]*$/a\        auth_basic off;' "$SITE_FILE"

if ! awk '/^[[:space:]]*location \/api\/ {/,/^[[:space:]]*}[[:space:]]*$/' "$SITE_FILE" \
     | grep -q "auth_basic off;"; then
  warn "sed insertion failed — restoring backup."
  cp -p "$BACKUP" "$SITE_FILE"
  error "Could not patch $SITE_FILE. Edit it manually and add 'auth_basic off;' inside the location /api/ block."
fi

info "Validating nginx config..."
if ! nginx -t 2>&1; then
  warn "nginx -t failed — restoring backup."
  cp -p "$BACKUP" "$SITE_FILE"
  error "Validation failed; site reverted; no reload performed."
fi

info "Reloading nginx..."
systemctl reload nginx
success "nginx reloaded."

# ── Verify ────────────────────────────────────────────────────────────────────
info "Verifying:"
ANON_FRONTEND="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/)"
ANON_HEALTH="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/api/health)"
ANON_OVERVIEW_HEADERS="$(curl -s -I http://127.0.0.1/api/system/overview)"

if [[ "$ANON_FRONTEND" == "401" ]]; then
  success "  GET /                  (anon) → 401  (frontend Basic Auth still required ✓)"
else
  warn   "  GET /                  (anon) → ${ANON_FRONTEND}  (expected 401)"
fi

if [[ "$ANON_HEALTH" == "200" ]]; then
  success "  GET /api/health        (anon) → 200  (exempt ✓)"
else
  warn   "  GET /api/health        (anon) → ${ANON_HEALTH}  (expected 200 — exempt should work)"
fi

if echo "$ANON_OVERVIEW_HEADERS" | grep -qi 'WWW-Authenticate:.*Basic'; then
  warn   "  GET /api/system/overview still has nginx WWW-Authenticate: Basic — exemption did not take effect."
else
  success "  GET /api/system/overview no longer triggers Basic Auth challenge ✓"
fi

echo ""
echo "  Source-file equivalents have been updated:"
echo "    scripts/install.sh             — new installs get this by default"
echo "    scripts/apply-basic-auth.sh    — re-running it also applies this"
echo ""
echo "  Backup of previous nginx site:"
echo "    $BACKUP"
echo ""
