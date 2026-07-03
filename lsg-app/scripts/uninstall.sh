#!/usr/bin/env bash
# =============================================================================
# uninstall.sh — LSG-App Uninstaller
#
# Reverses everything install.sh did:
#   1. Removes the Nginx server config and disables the site
#   2. Stops, disables, and removes the systemd service
#   3. Removes the Nginx snippet directory (and all protocol-app snippets)
#   4. Removes NGINX_SNIPPET_DIR and LSG_APPS_HOME from /etc/environment
#
# NOTE: The apps/ directory inside the lsg-app folder is kept by default to prevent data loss.
#       Pass --purge to also delete it.
#
# Usage:
#   sudo bash scripts/uninstall.sh
#   sudo bash scripts/uninstall.sh --purge
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

[[ "$EUID" -ne 0 ]] && error "Please run as root: sudo bash scripts/uninstall.sh"

PURGE=false
for arg in "$@"; do [[ "$arg" == "--purge" ]] && PURGE=true; done

FAILED_APPS=()   # tracks apps whose uninstall script returned non-zero

# Resolve repo root from script location (same logic as install.sh)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Must match values in install.sh
SERVICE_NAME="lsg-app"
NGINX_SITE_FILE="/etc/nginx/sites-available/${SERVICE_NAME}"
NGINX_SITE_LINK="/etc/nginx/sites-enabled/${SERVICE_NAME}"
NGINX_SNIPPET_DIR="/etc/nginx/lsg-app-locations.d"
LSG_APPS_HOME="${APP_DIR}/apps"
SYSTEMD_UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
SYS_ENV_FILE="/etc/environment"

DATA_BROKER_DIR="${APP_DIR}/data-broker"

info "Starting LSG-App uninstallation..."
$PURGE && warn "--purge flag set: '$LSG_APPS_HOME' will also be deleted."

# 1. UNINSTALL DATA BROKER (Redpanda pipelines + broker)
info "Uninstalling data broker (Redpanda broker + Redpanda Connect)..."
DATA_FORWARDER_SCRIPT="${DATA_BROKER_DIR}/redpanda/uninstall.sh"
if [[ -f "$DATA_FORWARDER_SCRIPT" ]]; then
    if $PURGE; then
        bash "$DATA_FORWARDER_SCRIPT" --purge || warn "data-broker/redpanda/uninstall.sh failed — continuing."
    else
        bash "$DATA_FORWARDER_SCRIPT" || warn "data-broker/redpanda/uninstall.sh failed — continuing."
    fi
else
    warn "data-broker/redpanda/uninstall.sh not found at ${DATA_FORWARDER_SCRIPT} — skipping."
fi

# Export so child uninstall scripts can read them (bash subprocesses don't inherit plain shell vars)
export LSG_APPS_HOME
export NGINX_SNIPPET_DIR

# 2. UNINSTALL PROTOCOL APPS
info "Uninstalling protocol apps in $LSG_APPS_HOME ..."
if [[ -d "$LSG_APPS_HOME" ]]; then
    for app_dir in "$LSG_APPS_HOME"/*/; do
        [[ -d "$app_dir" ]] || continue
        app_name="$(basename "$app_dir")"
        uninstall_script="${app_dir}scripts/uninstall.sh"
        if [[ -f "$uninstall_script" ]]; then
            info "  Uninstalling: $app_name"
            app_args=()
            $PURGE && app_args+=("--purge")
            if bash "$uninstall_script" "${app_args[@]}"; then
                success "  ✓ $app_name"
            else
                warn "  ✗ $app_name — script failed (exit $?), continuing."
                FAILED_APPS+=("$app_name")
            fi
        else
            warn "  No scripts/uninstall.sh for $app_name — skipping."
            FAILED_APPS+=("$app_name (no uninstall.sh)")
        fi

        # Always remove the app directory and registry entry after uninstall attempt.
        if [[ -d "$app_dir" ]]; then
            rm -rf "$app_dir"
            info "  Removed directory: $app_dir"
        fi
        REGISTRY_FILE="${APP_DIR}/config/app-registry.json"
        if [[ -f "$REGISTRY_FILE" ]]; then
            python3 -c "
import json, sys
f, key = sys.argv[1], sys.argv[2]
try:
    with open(f) as fh: d = json.load(fh)
    d.pop(key, None)
    with open(f, 'w') as fh: json.dump(d, fh, indent=2)
except Exception as e:
    print(f'[WARN] Registry update failed: {e}', file=sys.stderr)
" "$REGISTRY_FILE" "$app_name" && info "  Removed '$app_name' from app registry."
        fi
    done
    success "Protocol app uninstall pass complete."
else
    info "Apps directory not found ($LSG_APPS_HOME) — nothing to uninstall."
fi

# 3. NGINX
info "Removing Nginx site configuration..."
if [[ -L "$NGINX_SITE_LINK" ]]; then
    rm -f "$NGINX_SITE_LINK" && success "Removed symlink : $NGINX_SITE_LINK"
else
    warn "Site symlink not found (already removed?): $NGINX_SITE_LINK"
fi
if [[ -f "$NGINX_SITE_FILE" ]]; then
    rm -f "$NGINX_SITE_FILE" && success "Removed config  : $NGINX_SITE_FILE"
else
    warn "Site config not found (already removed?): $NGINX_SITE_FILE"
fi
if command -v nginx &>/dev/null && nginx -t 2>/dev/null; then
    systemctl reload nginx && success "Nginx reloaded."
fi

# 4. SYSTEMD
info "Removing systemd service: ${SERVICE_NAME}..."
systemctl is-active  --quiet "${SERVICE_NAME}" 2>/dev/null \
    && systemctl stop    "${SERVICE_NAME}" && success "Service stopped."  || true
systemctl is-enabled --quiet "${SERVICE_NAME}" 2>/dev/null \
    && systemctl disable "${SERVICE_NAME}" && success "Service disabled." || true
if [[ -f "$SYSTEMD_UNIT" ]]; then
    rm -f "$SYSTEMD_UNIT"
    systemctl daemon-reload
    success "Systemd unit removed and daemon reloaded."
else
    warn "Systemd unit not found (already removed?): $SYSTEMD_UNIT"
fi

# 5. NGINX SNIPPET DIRECTORY
info "Removing Nginx snippet directory → $NGINX_SNIPPET_DIR"
if [[ -d "$NGINX_SNIPPET_DIR" ]]; then
    COUNT=$(find "$NGINX_SNIPPET_DIR" -name "*.conf" | wc -l)
    [[ "$COUNT" -gt 0 ]] && warn "$COUNT protocol-app snippet(s) still present — removing anyway."
    rm -rf "$NGINX_SNIPPET_DIR" && success "Removed: $NGINX_SNIPPET_DIR"
else
    warn "Snippet directory not found (already removed?): $NGINX_SNIPPET_DIR"
fi

# 6. APPS FOLDER (--purge only)
if $PURGE; then
    info "Purging apps directory → $LSG_APPS_HOME"
    [[ -d "$LSG_APPS_HOME" ]] \
        && rm -rf "$LSG_APPS_HOME" && success "Removed: $LSG_APPS_HOME" \
        || warn "Apps directory not found: $LSG_APPS_HOME"
else
    info "Keeping '$LSG_APPS_HOME' (use --purge to also delete it)."
fi

# 6b. LSG_APP_DATA directory (--purge only)
# Read the path before step 9 removes it from /etc/environment.
LSG_APP_DATA="$(grep '^LSG_APP_DATA=' "$SYS_ENV_FILE" 2>/dev/null | cut -d= -f2 || true)"
if $PURGE; then
    if [[ -n "$LSG_APP_DATA" && -d "$LSG_APP_DATA" ]]; then
        info "Purging app data directory → $LSG_APP_DATA"
        rm -rf "$LSG_APP_DATA" && success "Removed: $LSG_APP_DATA"
    else
        info "App data directory not found or not set — skipping."
    fi
fi

# 7. SUDOERS
info "Removing sudoers entry → /etc/sudoers.d/${SERVICE_NAME}"
SUDOERS_FILE="/etc/sudoers.d/${SERVICE_NAME}"
if [[ -f "$SUDOERS_FILE" ]]; then
    rm -f "$SUDOERS_FILE" && success "Removed: $SUDOERS_FILE"
else
    warn "Sudoers file not found (already removed?): $SUDOERS_FILE"
fi
rm -f "${SUDOERS_FILE}-network-dev" 2>/dev/null || true

# 8. SECRETS DIRECTORY
ETC_LSG="/etc/lsg-app"
RUN_LSG="/run/lsg-app"
info "Removing secrets directory → $ETC_LSG"
if [[ -d "$ETC_LSG" ]]; then
    rm -rf "$ETC_LSG" && success "Removed: $ETC_LSG"
else
    warn "Secrets directory not found (already removed?): $ETC_LSG"
fi
rm -rf "$RUN_LSG" 2>/dev/null || true

# 9. /etc/environment
info "Removing environment variables from $SYS_ENV_FILE..."
sed -i '/^NGINX_SNIPPET_DIR=/d'                "$SYS_ENV_FILE"
sed -i '/^LSG_APPS_HOME=/d'                    "$SYS_ENV_FILE"
sed -i '/^LSG_APP_DATA=/d'                     "$SYS_ENV_FILE"
sed -i '/^NGINX_PORT=/d'                       "$SYS_ENV_FILE"
sed -i '/^REDPANDA_BROKER_PORT=/d'             "$SYS_ENV_FILE"
sed -i '/^REDPANDA_BROKER_HOST=/d'             "$SYS_ENV_FILE"
sed -i '/^REDPANDA_KAFKA_ADDRESS=/d'           "$SYS_ENV_FILE"
sed -i '/^REDPANDA_ADMIN_PORT=/d'              "$SYS_ENV_FILE"
sed -i '/^REDPANDA_ADMIN_ADDRESS=/d'           "$SYS_ENV_FILE"
sed -i '/^REDPANDA_SCHEMA_REGISTRY_PORT=/d'    "$SYS_ENV_FILE"
sed -i '/^REDPANDA_SCHEMA_REGISTRY_ADDRESS=/d' "$SYS_ENV_FILE"
sed -i '/^REDPANDA_PANDAPROXY_PORT=/d'         "$SYS_ENV_FILE"
sed -i '/^REDPANDA_PANDAPROXY_ADDRESS=/d'      "$SYS_ENV_FILE"
sed -i '/^BROKER_TYPE=/d'                      "$SYS_ENV_FILE"
sed -i '/^REDPANDA_KAFKA_SECURITY_PROTOCOL=/d' "$SYS_ENV_FILE"
sed -i '/^REDPANDA_KAFKA_SASL_MECHANISM=/d'    "$SYS_ENV_FILE"
success "Removed LSG env vars (NGINX, LSG_APPS_HOME, LSG_APP_DATA, Redpanda, BROKER_TYPE) from $SYS_ENV_FILE."

if [[ ${#FAILED_APPS[@]} -gt 0 ]]; then
    echo ""
    warn "The following apps had uninstall errors and may need manual cleanup:"
    for app in "${FAILED_APPS[@]}"; do
        warn "  • $app"
        warn "    Manual: sudo systemctl stop <service>  &&  sudo rm -rf ${LSG_APPS_HOME}/${app}"
    done
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  LSG-App uninstallation complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo ""
$PURGE || echo "  Note: '$LSG_APPS_HOME' was kept. Re-run with --purge to delete it."
echo ""
