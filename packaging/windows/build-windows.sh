#!/usr/bin/env bash
# ==============================================================================
# JobFoundry - Windows MSIX payload builder (runs on the AlmaLinux container)
#
# Cross-assembles the writable payload of the Windows MSIX package:
#   - Node.js 26 (win-x64 from nodejs.org, SHA-verified)
#   - Python 3.12 (python-build-standalone win-x64 install_only, SHA-verified)
#   - chrome-headless-shell (win64, SHA pinned for the default version)
#   - Python deps cross-installed with uv --python-platform windows (no Windows
#     interpreter needed; wheels only, so native .pyd files land ready to run)
#   - better-sqlite3 v13 ships its prebuilds inside the npm tarball, so the
#     plain npm ci yields prebuilds/win32-x64.node - no native build
#   - App code: ingest API, scorer + tailor Python services, prebuilt web SPA,
#     PDF toolchain (folio-export + puppeteer + themes)
#   - JobFoundry.exe (Go shim) and MSIX assets generated with the bundled Go
#     toolchain
#
# The payload is then packed into a signed .msix by the package-windows-msix
# GitHub Actions job (runs on windows-latest with makeappx + signtool, the
# officially supported pack/sign path).
#
# Usage:
#   packaging/windows/build-windows.sh
#
# Env overrides:
#   NODE_MAJOR=26  PYTHON_SERIES=3.12  APP_VERSION=0.1.0
#   GO_VERSION=1.26.5  UV_VERSION=latest  CHROME_VERSION=153.0.8010.36
#   BUILD_DIR=<workdir>  OUTPUT_DIR=<artifact dir>  SKIP_WEB_BUILD=1
#
# Requirements on the build host: curl, tar, unzip, xz, /usr/bin/file, python3.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

NODE_MAJOR="${NODE_MAJOR:-26}"
PYTHON_SERIES="${PYTHON_SERIES:-3.12}"
APP_VERSION="${APP_VERSION:-${GITHUB_REF_NAME:-}}"
APP_VERSION="${APP_VERSION#v}"
if [ -z "$APP_VERSION" ]; then
  APP_VERSION="$(python3 -c "import json; print(json.load(open('$REPO_ROOT/package.json'))['version'])")"
fi

BUILD_DIR="${BUILD_DIR:-$REPO_ROOT/build/windows}"
OUTPUT_DIR="${OUTPUT_DIR:-$BUILD_DIR/output}"
WORK="$BUILD_DIR/work"
STAGE="$BUILD_DIR/stage"
PAYLOAD="$BUILD_DIR/payload"

ARCH="x64"
MSIX_NAME="JobFoundry-${APP_VERSION}-${ARCH}.msix"

echo "[windows] JobFoundry $APP_VERSION ($ARCH payload)"
echo "[windows] work: $BUILD_DIR"
rm -rf "$WORK" "$STAGE" "$PAYLOAD"
mkdir -p "$WORK" "$STAGE" "$OUTPUT_DIR" "$PAYLOAD/usr/lib" "$PAYLOAD/usr/share"

# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------
download() {
  local url="$1" dest="$2"
  echo "[windows] fetching $(basename "$dest")..."
  curl -fsSL --retry 3 --retry-delay 5 -o "$dest" "$url"
}

pyjson() {
  # usage: cmd | pyjson '<python expr on data>'
  python3 -c "import json,sys; data = json.load(sys.stdin); $1"
}

# ------------------------------------------------------------------------------
# 1. Resolve + download runtimes
# ------------------------------------------------------------------------------

# --- Node.js (win-x64): latest NODE_MAJOR.x from nodejs.org (SHA-verified) ---
NODE_VERSION="$(curl -fsSL --retry 5 --retry-delay 10 https://nodejs.org/dist/index.json \
  | pyjson "print([r['version'] for r in data if r['version'].startswith('v$NODE_MAJOR.')][0])")"
NODE_VERSION="${NODE_VERSION#v}"
echo "[windows] node: $NODE_VERSION"
NODE_ZIP="node-v${NODE_VERSION}-win-x64.zip"
download "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}" "$WORK/$NODE_ZIP"
download "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" "$WORK/SHASUMS256.txt"
(cd "$WORK" && grep "  $NODE_ZIP\$" SHASUMS256.txt | sha256sum -c -)

# --- Go (linux) for the shim + asset generator (SHA from go.dev) ------------
GO_VERSION="${GO_VERSION:-}"
if [ -z "$GO_VERSION" ]; then
  GO_VERSION="$(curl -fsSL "https://go.dev/dl/?mode=json" | pyjson "
    print([v['version'] for v in data if v.get('stable')][0])")"
fi
GO_ARCHIVE="$(curl -fsSL "https://go.dev/dl/?mode=json" | pyjson "
    v=[x for x in data if x.get('version')=='$GO_VERSION'][0]
    f=[f for f in v['files'] if f['os']=='linux' and f['arch']=='amd64' and f['kind']=='archive'][0]
    print(f['filename']); print(f['sha256'])")"
GO_TGZ="$(echo "$GO_ARCHIVE" | sed -n 1p)"
GO_SHA="$(echo "$GO_ARCHIVE" | sed -n 2p)"
echo "[windows] go: $GO_VERSION ($GO_TGZ)"
download "https://dl.google.com/go/${GO_TGZ}" "$WORK/$GO_TGZ"
echo "${GO_SHA}  $WORK/$GO_TGZ" | sha256sum -c -
tar -xzf "$WORK/$GO_TGZ" -C "$WORK"
GO_BIN="$WORK/go/bin/go"
GOROOT="$WORK/go"
export GOROOT
export PATH="$WORK/go/bin:$PATH"

# --- uv (linux) for cross-platform Python wheel resolution (SHA from API) ---
UV_RELEASE="$(curl -fsSL --retry 5 --retry-delay 5 https://api.github.com/repos/astral-sh/uv/releases/latest)"
UV_VERSION="${UV_VERSION:-"$(echo "$UV_RELEASE" | pyjson "print(data['tag_name'])")"}"
UV_TGZ_URL="$(echo "$UV_RELEASE" | pyjson "print([a['browser_download_url'] for a in data['assets'] if a['name']=='uv-x86_64-unknown-linux-gnu.tar.gz'][0])")"
UV_SHA="$(echo "$UV_RELEASE" | pyjson "print([a['digest'] for a in data['assets'] if a['name']=='uv-x86_64-unknown-linux-gnu.tar.gz'][0].split(':')[1])")"
UV_TGZ="$WORK/uv.tar.gz"
echo "[windows] uv: $UV_VERSION"
download "$UV_TGZ_URL" "$UV_TGZ"
echo "${UV_SHA}  $UV_TGZ" | sha256sum -c -
tar -xzf "$UV_TGZ" -C "$WORK"
UV_BIN="$WORK/uv-x86_64-unknown-linux-gnu/uv"

# --- Python 3.12 (win-x64 install_only, SHA256SUMS-verified) ----------------
PYBS_RELEASE="$(curl -fsSL --retry 5 --retry-delay 5 https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest)"
PYBS_TAG="$(echo "$PYBS_RELEASE" | pyjson "print(data['tag_name'])")"
PY_TGZ="$(echo "$PYBS_RELEASE" | pyjson "print([a['name'] for a in data['assets'] if a['name'].startswith('cpython-${PYTHON_SERIES}.') and 'x86_64-pc-windows-msvc' in a['name'] and a['name'].endswith('install_only.tar.gz')][0])")"
echo "[windows] python-build-standalone: $PY_TGZ"
download "https://github.com/astral-sh/python-build-standalone/releases/download/${PYBS_TAG}/${PY_TGZ}" "$WORK/$PY_TGZ"
download "https://github.com/astral-sh/python-build-standalone/releases/download/${PYBS_TAG}/SHA256SUMS" "$WORK/PYBS_SHA256SUMS"
(cd "$WORK" && grep "  ${PY_TGZ}\$" PYBS_SHA256SUMS | sha256sum -c -)

# --- chrome-headless-shell (win64, URL from chrome-for-testing) ---------------
# The official chrome-for-testing metadata exposes no digest for
# chrome-headless-shell (only 'platform' + 'url'), so the SHA-256 of the
# pinned default version is reviewed and pinned here, then verified at
# download time. Overridden versions without a checksum degrade to a warning.
CHROME_VERSION="${CHROME_VERSION:-153.0.8010.36}"
CHROME_SHA256_DEFAULT="dc59aeda4f9ce8a9a329693617ac5d8b75ceea52ac3d794c4af06cdee261040e"
echo "[windows] chrome-headless-shell: $CHROME_VERSION"
CHROME_META="$(curl -fsSL --retry 5 --retry-delay 5 \
  "https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json" \
  | pyjson "
    vs=[v for v in data['versions'] if v['version']=='$CHROME_VERSION']
    if not vs:
        print('UNKNOWN_VERSION'); raise SystemExit(1)
    dl=[d for d in vs[0]['downloads']['chrome-headless-shell'] if d['platform']=='win64'][0]
    print(dl.get('url', '')); print(dl.get('sha256', ''))")"
CHROME_ZIP_URL="$(echo "$CHROME_META" | sed -n 1p)"
CHROME_SHA256="$(echo "$CHROME_META" | sed -n 2p)"
if [ "$CHROME_VERSION" = "153.0.8010.36" ]; then
  CHROME_SHA256="$CHROME_SHA256_DEFAULT"
fi
CHROME_ZIP="$WORK/chrome-headless-shell-win64.zip"
download "$CHROME_ZIP_URL" "$CHROME_ZIP"
if [ -n "$CHROME_SHA256" ]; then
  echo "${CHROME_SHA256}  $CHROME_ZIP" | sha256sum -c -
else
  echo "[windows] WARNING: no checksum available for chrome-headless-shell ${CHROME_VERSION}; skipping verification"
fi

# ------------------------------------------------------------------------------
# 2. Stage app sources (repo subset, mirrors the AppImage build)
# ------------------------------------------------------------------------------
echo "[windows] staging app sources..."
cp "$REPO_ROOT/package.json" "$REPO_ROOT/package-lock.json" "$STAGE/"
mkdir -p "$STAGE/server/ingest" "$STAGE/server/web" "$STAGE/server/scorer" \
  "$STAGE/server/tailor" "$STAGE/extension" "$STAGE/site"
cp "$REPO_ROOT/server/ingest/package.json" "$STAGE/server/ingest/"
cp -r "$REPO_ROOT/server/ingest/src" "$STAGE/server/ingest/src"
cp "$REPO_ROOT/server/scorer/pyproject.toml" "$STAGE/server/scorer/"
cp -r "$REPO_ROOT/server/scorer/src" "$STAGE/server/scorer/src"
cp "$REPO_ROOT/server/tailor/pyproject.toml" "$STAGE/server/tailor/"
cp "$REPO_ROOT/server/tailor/README.md" "$STAGE/server/tailor/"
cp -r "$REPO_ROOT/server/tailor/src" "$STAGE/server/tailor/src"
cp "$REPO_ROOT/server/web/package.json" "$STAGE/server/web/"
cp "$REPO_ROOT/extension/package.json" "$STAGE/extension/"
cp "$REPO_ROOT/site/package.json" "$STAGE/site/"
cp -r "$REPO_ROOT/server/web/src" "$REPO_ROOT/server/web/index.html" \
  "$REPO_ROOT/server/web/vite.config.ts" "$REPO_ROOT/server/web/tsconfig.json" \
  "$STAGE/server/web/"
[ -d "$REPO_ROOT/server/web/public" ] && cp -r "$REPO_ROOT/server/web/public" "$STAGE/server/web/public"

# ------------------------------------------------------------------------------
# 3. Build the web SPA
# ------------------------------------------------------------------------------
if [ "${SKIP_WEB_BUILD:-0}" = "1" ] && [ -d "$REPO_ROOT/server/web/dist" ]; then
  echo "[windows] SKIP_WEB_BUILD=1, reusing existing server/web/dist"
  WEB_DIST="$REPO_ROOT/server/web/dist"
else
  echo "[windows] installing web build dependencies..."
  (cd "$STAGE" && npm ci --workspace=server/web --no-audit --no-fund)
  echo "[windows] building web SPA..."
  (cd "$STAGE" && VITE_API_URL="" npm --workspace=server/web run build)
  WEB_DIST="$STAGE/server/web/dist"
fi
[ -f "$WEB_DIST/index.html" ] || { echo "[windows] ERROR: web build produced no index.html" >&2; exit 1; }

# ------------------------------------------------------------------------------
# 4. Install ingest dependencies (better-sqlite3 prebuilds ship in the tarball)
# ------------------------------------------------------------------------------
echo "[windows] installing ingest production dependencies..."
(cd "$STAGE" && npm ci --omit=dev --workspace=server/ingest --no-audit --no-fund)
[ -f "$STAGE/node_modules/better-sqlite3/prebuilds/win32-x64.node" ] \
  || { echo "[windows] ERROR: better-sqlite3 win32 prebuild missing" >&2; exit 1; }

# ------------------------------------------------------------------------------
# 5. Install PDF toolchain (folio-export + puppeteer + themes, no Chromium)
# ------------------------------------------------------------------------------
echo "[windows] installing PDF toolchain..."
mkdir -p "$STAGE/node-tools"
cat > "$STAGE/node-tools/package.json" <<'EOF'
{
  "name": "jobfoundry-node-tools",
  "version": "0.1.0",
  "private": true,
  "description": "Bundled PDF toolchain for the JobFoundry Windows package (folio-export + themes).",
  "license": "AGPL-3.0-only",
  "dependencies": {
    "jsonresume-theme-folio": "^1.3.1",
    "jsonresume-theme-stackoverflow": "*",
    "puppeteer": "^24.0.0"
  }
}
EOF
(cd "$STAGE/node-tools" && \
  PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm install --omit=dev --no-audit --no-fund)
[ -x "$STAGE/node-tools/node_modules/.bin/folio-export" ] \
  || { echo "[windows] ERROR: folio-export binary missing after install" >&2; exit 1; }

# ------------------------------------------------------------------------------
# 6. Assemble runtime payload
# ------------------------------------------------------------------------------
echo "[windows] laying out payload..."

unzip -q "$WORK/$NODE_ZIP" -d "$WORK"
mv "$WORK/node-v${NODE_VERSION}-win-x64" "$PAYLOAD/usr/lib/node"
file "$PAYLOAD/usr/lib/node/node.exe" | grep -qi "PE32" \
  || { echo "[windows] ERROR: node.exe is not a Windows PE binary" >&2; exit 1; }

tar -xzf "$WORK/$PY_TGZ" -C "$WORK"
mv "$WORK/python" "$PAYLOAD/usr/lib/python"
[ -x "$PAYLOAD/usr/lib/python/python.exe" ] \
  || { echo "[windows] ERROR: python.exe missing in standalone bundle" >&2; exit 1; }

unzip -q "$CHROME_ZIP" -d "$WORK/chrome"
mkdir -p "$PAYLOAD/usr/lib/chrome-headless-shell"
mv "$WORK/chrome/chrome-headless-shell-windows-x64/"* "$PAYLOAD/usr/lib/chrome-headless-shell/"
file "$PAYLOAD/usr/lib/chrome-headless-shell/chrome-headless-shell.exe" | grep -qi "PE32" \
  || { echo "[windows] ERROR: chrome-headless-shell.exe is not a Windows PE binary" >&2; exit 1; }

# ------------------------------------------------------------------------------
# 7. Cross-install Python dependencies into the Windows site-packages
# ------------------------------------------------------------------------------
echo "[windows] cross-installing Python dependencies (win_amd64 wheels)..."
SITE_PACKAGES="$PAYLOAD/usr/lib/python/Lib/site-packages"
# The two lockfiles pin a few shared packages at slightly different versions
# (scorer-requirements.txt vs tailor-requirements.txt). The AppImage installs
# them sequentially with pip (last-wins); replicate that exactly here instead
# of resolving both files as one graph. --no-deps installs the already-pinned
# wheels verbatim, with no resolution stage (which would report a conflict).
"$UV_BIN" pip install \
  --python-platform windows \
  --python-version "$PYTHON_SERIES" \
  --only-binary=:all: \
  --no-deps \
  --no-cache \
  --target "$SITE_PACKAGES" \
  -r "$REPO_ROOT/packaging/python/scorer-requirements.txt"
"$UV_BIN" pip install \
  --python-platform windows \
  --python-version "$PYTHON_SERIES" \
  --only-binary=:all: \
  --no-deps \
  --no-cache \
  --target "$SITE_PACKAGES" \
  -r "$REPO_ROOT/packaging/python/tailor-requirements.txt"
echo "[windows] installing resume-ops-api package (pure Python, direct copy)..."
cp -r "$STAGE/server/tailor/src/resume_ops_api" "$SITE_PACKAGES/resume_ops_api"
find "$PAYLOAD/usr/lib/python" -name "__pycache__" -type d -prune -exec rm -rf {} + 2>/dev/null || true

# ------------------------------------------------------------------------------
# 8. Lay out app files inside the payload
# ------------------------------------------------------------------------------
echo "[windows] laying out app files..."
APP_SHARE="$PAYLOAD/usr/share/jobfoundry"
mkdir -p "$APP_SHARE/server/ingest" "$APP_SHARE/server/scorer" "$APP_SHARE/web" "$APP_SHARE/windows"
cp -r "$STAGE/server/ingest/src" "$APP_SHARE/server/ingest/src"
cp "$STAGE/server/ingest/package.json" "$APP_SHARE/server/ingest/"
cp -r "$STAGE/server/scorer/src" "$APP_SHARE/server/scorer/src"
cp -r "$WEB_DIST" "$APP_SHARE/web/dist"
cp -r "$STAGE/node_modules" "$APP_SHARE/node_modules"
cp -r "$STAGE/node-tools" "$APP_SHARE/node-tools"
cp "$SCRIPT_DIR/launcher.mjs" "$APP_SHARE/windows/launcher.mjs"
cp "$SCRIPT_DIR/jobfoundry.ps1" "$APP_SHARE/windows/jobfoundry.ps1"

# ------------------------------------------------------------------------------
# 9. Build the shim (JobFoundry.exe) and MSIX assets with the bundled Go
# ------------------------------------------------------------------------------
echo "[windows] building JobFoundry.exe shim..."
(cd "$SCRIPT_DIR" && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
  "$GO_BIN" build -trimpath -ldflags "-s -w" -o "$PAYLOAD/JobFoundry.exe" ./launcher-src)
file "$PAYLOAD/JobFoundry.exe" | grep -qi "PE32" \
  || { echo "[windows] ERROR: JobFoundry.exe is not a Windows PE binary" >&2; exit 1; }

echo "[windows] building jobfoundry.exe control-CLI shim..."
(cd "$SCRIPT_DIR" && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
  "$GO_BIN" build -trimpath -ldflags "-s -w" -o "$PAYLOAD/jobfoundry.exe" ./jobfoundry-cli-src)
file "$PAYLOAD/jobfoundry.exe" | grep -qi "PE32" \
  || { echo "[windows] ERROR: jobfoundry.exe is not a Windows PE binary" >&2; exit 1; }

echo "[windows] generating MSIX assets..."
mkdir -p "$PAYLOAD/assets"
(cd "$SCRIPT_DIR" && "$GO_BIN" run ./genicons \
  -in "$REPO_ROOT/extension/public/icons/icon-512.png" \
  -out "$PAYLOAD/assets")

# ------------------------------------------------------------------------------
# 10. Render the AppxManifest.xml (publisher matches the self-signed cert)
# ------------------------------------------------------------------------------
echo "[windows] rendering AppxManifest.xml..."
sed -e "s|__PUBLISHER__|CN=JobFoundry|" \
    -e "s|__VERSION__|${APP_VERSION}|" \
    "$SCRIPT_DIR/appxmanifest.xml" > "$PAYLOAD/AppxManifest.xml"
echo "-- AppxManifest identity --"
sed -n 's/.*<Identity /<Identity /p' "$PAYLOAD/AppxManifest.xml"

echo ""
echo "[windows] done."
du -sh "$PAYLOAD" | sed 's/^/[windows] payload size: /'
find "$PAYLOAD" -maxdepth 2 -type f | sort | sed 's/^/[windows]   /' | head -20
echo "[windows] pack with makeappx on a Windows runner: $MSIX_NAME"