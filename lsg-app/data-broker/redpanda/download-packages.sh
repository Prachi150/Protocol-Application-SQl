#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
#  download-packages.sh
#  Downloads Redpanda broker and Redpanda Connect
#  .deb packages into packages/ for offline install.
#
#  Reads versions.env for defaults.
#  Must be run as root (apt-get download requires it).
#
#  Usage:
#    sudo bash download-packages.sh
# ─────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=versions.env
source "${SCRIPT_DIR}/versions.env"
PACKAGES_DIR="${SCRIPT_DIR}/packages"

# ── Colour helpers ────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash download-packages.sh"

command -v curl &>/dev/null || error "curl is required. Install with: apt-get install curl"

mkdir -p "$PACKAGES_DIR"

# TODO(option-a): Add distro detection here — use `dnf download redpanda` + the RPM
# Cloudsmith repo (https://dl.redpanda.com/nzc4ZYQK3WRGd9sy/redpanda/cfg/setup/bash.rpm.sh)
# for RHEL/CentOS/Fedora, and save .rpm files to packages/ instead of .deb.
# install.sh's offline path and online fallback both need matching RPM handling.
# ─────────────────────────────────────────────
#  1. Redpanda broker — via apt-get download
#     Redpanda does not publish standalone .deb
#     files; packages are only available via their
#     apt repository.
# ─────────────────────────────────────────────
info "Setting up Redpanda apt repo..."
apt-get install -y -qq curl gnupg
curl -1sLf 'https://dl.redpanda.com/nzc4ZYQK3WRGd9sy/redpanda/cfg/setup/bash.deb.sh' | bash
apt-get update -qq

info "Downloading Redpanda broker v${REDPANDA_VERSION} (without installing)..."
# apt-get download saves the .deb to the current directory
(cd "$PACKAGES_DIR" && apt-get download "redpanda=${REDPANDA_VERSION}" 2>/dev/null) \
  || (cd "$PACKAGES_DIR" && apt-get download redpanda)

REDPANDA_DEB=$(find "$PACKAGES_DIR" -maxdepth 1 -name "redpanda_*.deb" | head -1)
[[ -z "$REDPANDA_DEB" ]] && error "Failed to download redpanda package."
info "Saved: $(basename "$REDPANDA_DEB")"

# ─────────────────────────────────────────────
#  2. Redpanda Connect — direct GitHub download
# ─────────────────────────────────────────────
# TODO(option-a): For RPM-based distros, GitHub also publishes .rpm assets for
# redpanda-connect. Switch the filename to redpanda-connect_<ver>_<arch>.rpm and
# update the URL to the rpm asset when distro detection is in place.
CONNECT_DEB="redpanda-connect_${REDPANDA_CONNECT_VERSION}_${REDPANDA_ARCH}.deb"
CONNECT_URL="https://github.com/redpanda-data/connect/releases/download/v${REDPANDA_CONNECT_VERSION}/${CONNECT_DEB}"

info "Downloading Redpanda Connect v${REDPANDA_CONNECT_VERSION} (${REDPANDA_ARCH})..."
curl -fSL --progress-bar "$CONNECT_URL" -o "${PACKAGES_DIR}/${CONNECT_DEB}"
info "Saved: ${CONNECT_DEB}"

# ── Checksums ─────────────────────────────────
echo ""
info "SHA256 checksums:"
sha256sum "$REDPANDA_DEB"
sha256sum "${PACKAGES_DIR}/${CONNECT_DEB}"

echo ""
info "Done. Run install.sh to install using these offline packages."
