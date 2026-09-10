#!/usr/bin/env bash
# ==============================================================================
# JobFoundry - AppImage builder (Linux x86_64, no container required)
#
# Assembles a portable AppImage bundling:
#   - Node.js 22 (portable tarball from nodejs.org)
#   - Python 3.12 (via uv's python-build-standalone distribution)
#   - chrome-headless-shell (chrome-for-testing, ~50 MB instead of ~300 MB
#     full Chromium) for Puppeteer PDF rendering
#   - App code: ingest API, scorer + tailor Python services, prebuilt web SPA
#   - folio-export + puppeteer + resume themes (npm, no bundled Chromium)
#
# NOTE: the Gatepass LLM proxy is intentionally NOT bundled. The AppImage
# talks to the configured LLM provider directly (set OPENROUTER_API_KEY or
# equivalent in ~/.local/share/jobfoundry/.env).
#
# Usage:
#   packaging/appimage/build-appimage.sh
#
# Env overrides:
#   NODE_MAJOR=22  PYTHON_SERIES=3.12  APP_VERSION=0.1.0
#   BUILD_DIR=<workdir>  OUTPUT_DIR=<artifact dir>  SKIP_WEB_BUILD=1
#
# Requirements on the build host: curl, tar, unzip, xz, patchelf-free
# (we use LD_LIBRARY_PATH instead), python3 (JSON parsing), npm deps via
# the downloaded Node. Runs on ubuntu-22.04 for a broad glibc baseline.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

NODE_MAJOR="${NODE_MAJOR:-22}"
PYTHON_SERIES="${PYTHON_SERIES:-3.12}"
APP_VERSION="${APP_VERSION:-${GITHUB_REF_NAME:-}}"
APP_VERSION="${APP_VERSION#v}"
if [ -z "$APP_VERSION" ]; then
  APP_VERSION="$(python3 -c "import json; print(json.load(open('$REPO_ROOT/package.json'))['version'])")"
fi

BUILD_DIR="${BUILD_DIR:-$REPO_ROOT/build/appimage}"
OUTPUT_DIR="${OUTPUT_DIR:-$BUILD_DIR/output}"
WORK="$BUILD_DIR/work"
STAGE="$BUILD_DIR/stage"
APPDIR="$BUILD_DIR/JobFoundry.AppDir"

ARCH="x86_64"
APPIMAGE_NAME="JobFoundry-${APP_VERSION}-${ARCH}.AppImage"

echo "[appimage] JobFoundry $APP_VERSION ($ARCH)"
echo "[appimage] work: $BUILD_DIR"
rm -rf "$WORK" "$STAGE" "$APPDIR"
mkdir -p "$WORK" "$STAGE" "$OUTPUT_DIR" \
  "$APPDIR/usr/lib" "$APPDIR/usr/bin" "$APPDIR/usr/share"

# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------
download() {
  local url="$1" dest="$2"
  echo "[appimage] fetching $(basename "$dest")..."
  curl -fsSL --retry 3 --retry-delay 5 -o "$dest" "$url"
}

pyjson() {
  # usage: curl ... | pyjson '<python expr on data>'
  python3 -c "import json,sys; data = json.load(sys.stdin); $1"
}

# ------------------------------------------------------------------------------
# 1. Resolve + download runtimes
# ------------------------------------------------------------------------------

# --- Node.js: latest NODE_MAJOR.x from nodejs.org (SHA-verified) ---
NODE_VERSION="$(curl -fsSL --retry 5 --retry-delay 10 https://nodejs.org/dist/index.json \
  | pyjson "print([r['version'] for r in data if r['version'].startswith('v$NODE_MAJOR.')][0])")"
NODE_VERSION="${NODE_VERSION#v}"
echo "[appimage] node: $NODE_VERSION"
NODE_TGZ="node-v${NODE_VERSION}-linux-x64.tar.xz"
download "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TGZ}" "$WORK/$NODE_TGZ"
download "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" "$WORK/SHASUMS256.txt"
(cd "$WORK" && grep "  $NODE_TGZ\$" SHASUMS256.txt | sha256sum -c -)

# --- Python: latest PYTHON_SERIES.x via uv (hash-verified by uv itself) ---
# uv fetches python-build-standalone under the hood but resolves versions and
# verifies hashes from its own release metadata, so no GitHub API calls here.
UV_TGZ="$WORK/uv.tar.gz"
download "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz" \
  "$UV_TGZ"
tar -xzf "$UV_TGZ" -C "$WORK"
UV_BIN="$WORK/uv-x86_64-unknown-linux-gnu/uv"
export UV_PYTHON_INSTALL_DIR="$WORK/uvpython"
"$UV_BIN" python install "$PYTHON_SERIES"
UV_PY_HOME="$(find "$WORK/uvpython" -maxdepth 1 -type d -name "cpython-${PYTHON_SERIES}*-linux-x86_64-gnu" | sort -V | tail -1)"
[ -d "$UV_PY_HOME" ] || { echo "[appimage] ERROR: uv python install produced no interpreter" >&2; exit 1; }
echo "[appimage] python: $(basename "$UV_PY_HOME")"

# --- chrome-headless-shell: stable channel from chrome-for-testing ---
CHROME_VERSION="$(curl -fsSL --retry 5 --retry-delay 10 https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json \
  | pyjson "print(data['channels']['Stable']['version'])")"
echo "[appimage] chrome-headless-shell: $CHROME_VERSION"
CHROME_ZIP="chrome-headless-shell-linux64.zip"
download "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/${CHROME_ZIP}" "$WORK/$CHROME_ZIP"

# ------------------------------------------------------------------------------
# 2. Extract runtimes into the AppDir layout
# ------------------------------------------------------------------------------
echo "[appimage] extracting runtimes..."
tar -xJf "$WORK/$NODE_TGZ" -C "$WORK"
mv "$WORK/node-v${NODE_VERSION}-linux-x64" "$APPDIR/usr/lib/node"
file "$APPDIR/usr/lib/node/bin/node" | grep -q "x86-64" \
  || { echo "[appimage] ERROR: node binary is not x86-64" >&2; exit 1; }

mkdir -p "$APPDIR/usr/lib/python"
cp -r "$UV_PY_HOME"/. "$APPDIR/usr/lib/python/"
# uv installs bin/python3.<minor>; expose the generic name the launcher expects.
UV_PY_FULL="$(basename "$(echo "$APPDIR"/usr/lib/python/bin/python3.*)")"
ln -sfn "$UV_PY_FULL" "$APPDIR/usr/lib/python/bin/python3"
PYTHON_BIN="$APPDIR/usr/lib/python/bin/python3"
"$PYTHON_BIN" --version

mkdir -p "$APPDIR/usr/lib/chrome-headless-shell"
unzip -q -o "$WORK/$CHROME_ZIP" -d "$WORK/chrome"
mv "$WORK/chrome/chrome-headless-shell-linux64/chrome-headless-shell" \
  "$APPDIR/usr/lib/chrome-headless-shell/"
"$APPDIR/usr/lib/chrome-headless-shell/chrome-headless-shell" --version

export PATH="$APPDIR/usr/lib/node/bin:$PATH"
node --version
npm --version

# ------------------------------------------------------------------------------
# 3. Stage app sources (repo subset)
# ------------------------------------------------------------------------------
echo "[appimage] staging app sources..."
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
# Workspace package manifests only (sources not needed) so npm can resolve
# the workspace graph for scoped installs below.
cp "$REPO_ROOT/server/web/package.json" "$STAGE/server/web/"
cp "$REPO_ROOT/extension/package.json" "$STAGE/extension/"
cp "$REPO_ROOT/site/package.json" "$STAGE/site/"
cp -r "$REPO_ROOT/server/web/src" "$REPO_ROOT/server/web/index.html" \
  "$REPO_ROOT/server/web/vite.config.ts" "$REPO_ROOT/server/web/tsconfig.json" \
  "$STAGE/server/web/"
[ -d "$REPO_ROOT/server/web/public" ] && cp -r "$REPO_ROOT/server/web/public" "$STAGE/server/web/public"

# ------------------------------------------------------------------------------
# 4. Build the web SPA
# ------------------------------------------------------------------------------
if [ "${SKIP_WEB_BUILD:-0}" = "1" ] && [ -d "$REPO_ROOT/server/web/dist" ]; then
  echo "[appimage] SKIP_WEB_BUILD=1, reusing existing server/web/dist"
  WEB_DIST="$REPO_ROOT/server/web/dist"
else
  echo "[appimage] installing web build dependencies..."
  (cd "$STAGE" && npm ci --workspace=server/web --no-audit --no-fund)
  echo "[appimage] building web SPA..."
  (cd "$STAGE" && VITE_API_URL="" npm --workspace=server/web run build)
  WEB_DIST="$STAGE/server/web/dist"
fi
[ -f "$WEB_DIST/index.html" ] || { echo "[appimage] ERROR: web build produced no index.html" >&2; exit 1; }

# ------------------------------------------------------------------------------
# 5. Install ingest production dependencies (scoped to the workspace)
# ------------------------------------------------------------------------------
echo "[appimage] installing ingest production dependencies..."
(cd "$STAGE" && npm ci --omit=dev --workspace=server/ingest --no-audit --no-fund)
[ -d "$STAGE/node_modules/better-sqlite3" ] \
  || { echo "[appimage] ERROR: better-sqlite3 missing after install" >&2; exit 1; }

# ------------------------------------------------------------------------------
# 6. Install PDF toolchain (folio-export + puppeteer + themes, no Chromium)
# ------------------------------------------------------------------------------
echo "[appimage] installing PDF toolchain..."
mkdir -p "$STAGE/node-tools"
cat > "$STAGE/node-tools/package.json" <<'EOF'
{
  "name": "jobfoundry-node-tools",
  "version": "0.1.0",
  "private": true,
  "description": "Bundled PDF toolchain for the JobFoundry AppImage (folio-export + themes).",
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
  || { echo "[appimage] ERROR: folio-export binary missing after install" >&2; exit 1; }

# ------------------------------------------------------------------------------
# 7. Install Python services into the standalone Python
# ------------------------------------------------------------------------------
echo "[appimage] installing Python dependencies..."
# --break-system-packages is correct here: the target is our isolated bundle
# prefix, not a system Python.
"$PYTHON_BIN" -m ensurepip --upgrade >/dev/null
"$PYTHON_BIN" -m pip install --disable-pip-version-check --no-cache-dir --no-compile \
  --break-system-packages \
  -r "$REPO_ROOT/packaging/python/scorer-requirements.txt"
"$PYTHON_BIN" -m pip install --disable-pip-version-check --no-cache-dir --no-compile \
  --break-system-packages \
  -r "$REPO_ROOT/packaging/python/tailor-requirements.txt"
echo "[appimage] installing resume-ops-api package..."
"$PYTHON_BIN" -m pip install --disable-pip-version-check --no-cache-dir --no-compile \
  --break-system-packages \
  --no-deps "$STAGE/server/tailor"
"$PYTHON_BIN" -c "import resume_ops_api, fastapi, litellm; print('[appimage] python imports OK')"
# Drop bytecode caches to keep the image lean.
find "$APPDIR/usr/lib/python" -name "__pycache__" -type d -prune -exec rm -rf {} + 2>/dev/null || true

# ------------------------------------------------------------------------------
# 8. Lay out app files inside the AppDir
# ------------------------------------------------------------------------------
echo "[appimage] laying out app files..."
APP_SHARE="$APPDIR/usr/share/jobfoundry"
mkdir -p "$APP_SHARE/server" "$APP_SHARE/web"
cp -r "$STAGE/server/ingest/src" "$STAGE/server/ingest/package.json" "$APP_SHARE/server/ingest-tmp"
mkdir -p "$APP_SHARE/server/ingest"
mv "$APP_SHARE/server/ingest-tmp/src" "$APP_SHARE/server/ingest/src"
mv "$APP_SHARE/server/ingest-tmp/package.json" "$APP_SHARE/server/ingest/package.json"
rmdir "$APP_SHARE/server/ingest-tmp"
cp -r "$STAGE/server/scorer/src" "$APP_SHARE/server/scorer"
cp -r "$WEB_DIST" "$APP_SHARE/web/dist"
cp -r "$STAGE/node_modules" "$APP_SHARE/node_modules"
cp -r "$STAGE/node-tools" "$APP_SHARE/node-tools"

# ------------------------------------------------------------------------------
# 9. Bundle shared-library dependencies of chrome-headless-shell
# ------------------------------------------------------------------------------
echo "[appimage] bundling chrome-headless-shell shared libraries..."
LIB_DIR="$APPDIR/usr/lib/chrome-headless-shell/lib"
mkdir -p "$LIB_DIR"
ldd "$APPDIR/usr/lib/chrome-headless-shell/chrome-headless-shell" \
  | awk '/=> \// {print $3}' | sort -u | while read -r lib; do
  base="$(basename "$lib")"
  case "$base" in
    libc.so*|libm.so*|libpthread.so*|libdl.so*|librt.so*|libnsl.so*|libresolv.so*|libutil.so*|ld-linux*|libgcc_s.so*)
      continue ;;
  esac
  cp -n "$lib" "$LIB_DIR/" 2>/dev/null || echo "[appimage] WARN: could not bundle $lib"
done
ls "$LIB_DIR" | wc -l | xargs echo "[appimage] bundled system libs:"

# ------------------------------------------------------------------------------
# 10. Bundle fonts for PDF rendering
# ------------------------------------------------------------------------------
echo "[appimage] bundling fonts..."
if (command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null) || [ "$(id -u)" = "0" ]; then
  _sudo=""
  [ "$(id -u)" = "0" ] || _sudo="sudo"
  (cd "$WORK" && $_sudo apt-get update -qq && $_sudo apt-get download -qq fonts-liberation)
  mkdir -p "$APPDIR/usr/share/fonts"
  dpkg-deb -x "$WORK"/fonts-liberation*.deb "$WORK/fontpkg"
  cp -r "$WORK/fontpkg/usr/share/fonts/"* "$APPDIR/usr/share/fonts/"
  echo "[appimage] fonts bundled."
else
  echo "[appimage] WARN: no root access, skipping font bundling (PDFs may miss glyphs on minimal systems)"
fi

# ------------------------------------------------------------------------------
# 11. Install launcher, control CLI, desktop integration
# ------------------------------------------------------------------------------
echo "[appimage] installing launcher and desktop files..."
cp "$REPO_ROOT/packaging/launcher.sh" "$APPDIR/usr/bin/jobfoundry-launcher"
cp "$REPO_ROOT/packaging/jobfoundry-ctl.sh" "$APPDIR/usr/bin/jobfoundry-ctl"
chmod +x "$APPDIR/usr/bin/jobfoundry-launcher" "$APPDIR/usr/bin/jobfoundry-ctl"

cp "$SCRIPT_DIR/AppRun" "$APPDIR/AppRun"
chmod +x "$APPDIR/AppRun"
cp "$SCRIPT_DIR/jobfoundry.desktop" "$APPDIR/jobfoundry.desktop"
ln -sfn ../../AppRun "$APPDIR/usr/bin/jobfoundry"

ICON_SRC="$REPO_ROOT/extension/public/icons/icon-512.png"
cp "$ICON_SRC" "$APPDIR/jobfoundry.png"
ln -sfn jobfoundry.png "$APPDIR/.DirIcon"
mkdir -p "$APPDIR/usr/share/icons/hicolor/512x512/apps" \
         "$APPDIR/usr/share/icons/hicolor/128x128/apps"
cp "$ICON_SRC" "$APPDIR/usr/share/icons/hicolor/512x512/apps/jobfoundry.png"
cp "$REPO_ROOT/extension/public/icons/icon-128.png" \
  "$APPDIR/usr/share/icons/hicolor/128x128/apps/jobfoundry.png"

# ------------------------------------------------------------------------------
# 12. Run appimagetool
# ------------------------------------------------------------------------------
echo "[appimage] running appimagetool..."
APPIMAGETOOL="$WORK/appimagetool"
if [ ! -x "$APPIMAGETOOL" ]; then
  download "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage" \
    "$APPIMAGETOOL"
  chmod +x "$APPIMAGETOOL"
fi
export ARCH
export APPIMAGE_EXTRACT_AND_RUN=1
(cd "$BUILD_DIR" && "$APPIMAGETOOL" --no-appstream "$(basename "$APPDIR")" "$OUTPUT_DIR/$APPIMAGE_NAME")

echo ""
echo "[appimage] done."
du -sh "$APPDIR" | sed 's/^/[appimage] AppDir size: /'
ls -lh "$OUTPUT_DIR/$APPIMAGE_NAME"
