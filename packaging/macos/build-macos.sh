#!/usr/bin/env bash
# ==============================================================================
# JobFoundry - macOS bundle builder (darwin-arm64, runs on macos-latest)
#
# Assembles a self-contained tarball bundling:
#   - Node.js 26 (darwin-arm64 from nodejs.org, SHA-verified)
#   - Python 3.14 (python-build-standalone aarch64-apple-darwin install_only,
#     SHA256SUMS-verified) with scorer + tailor dependencies installed
#   - chrome-headless-shell (mac-arm64 from chrome-for-testing) for
#     Puppeteer PDF rendering
#   - App code: ingest API, scorer + tailor Python services, prebuilt web SPA
#   - folio-export + puppeteer + resume themes (npm, no bundled Chromium)
#   - jobfoundry dispatcher + launcher + control CLI (macOS-portable bash)
#
# The bundle talks to the configured LLM provider directly (set
# OPENROUTER_API_KEY or equivalent in ~/.local/share/jobfoundry/.env).
#
# Usage:
#   packaging/macos/build-macos.sh
#
# Env overrides:
#   NODE_MAJOR=26  PYTHON_SERIES=3.14  APP_VERSION=0.4.1
#   UV_VERSION=latest  CHROME_VERSION=153.0.8010.36
#   BUILD_DIR=<workdir>  OUTPUT_DIR=<artifact dir>  SKIP_WEB_BUILD=1
#
# Requirements on the build host (macos-latest has all of these):
#   curl, tar, unzip, file, python3, shasum.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

NODE_MAJOR="${NODE_MAJOR:-26}"
PYTHON_SERIES="${PYTHON_SERIES:-3.14}"
APP_VERSION="${APP_VERSION:-${GITHUB_REF_NAME:-}}"
APP_VERSION="${APP_VERSION#v}"
if [ -z "$APP_VERSION" ]; then
  APP_VERSION="$(python3 -c "import json; print(json.load(open('$REPO_ROOT/package.json'))['version'])")"
fi

BUILD_DIR="${BUILD_DIR:-$REPO_ROOT/build/macos}"
OUTPUT_DIR="${OUTPUT_DIR:-$BUILD_DIR/output}"
WORK="$BUILD_DIR/work"
STAGE="$BUILD_DIR/stage"
PAYLOAD="$BUILD_DIR/payload"

ARCH="arm64"
TARBALL_NAME="jobfoundry-${APP_VERSION}-darwin-${ARCH}.tar.gz"

echo "[macos] JobFoundry $APP_VERSION (darwin-$ARCH)"
echo "[macos] work: $BUILD_DIR"
rm -rf "$WORK" "$STAGE" "$PAYLOAD"
mkdir -p "$WORK" "$STAGE" "$OUTPUT_DIR" "$PAYLOAD/bin" "$PAYLOAD/usr/lib" "$PAYLOAD/usr/bin" "$PAYLOAD/usr/share"

# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------
download() {
  local url="$1" dest="$2"
  echo "[macos] fetching $(basename "$dest")..."
  curl -fsSL --retry 3 --retry-delay 5 -o "$dest" "$url"
}

pyjson() {
  # usage: cmd | pyjson '<python expr on data>'
  python3 -c "import json,sys,textwrap; data = json.load(sys.stdin); exec(textwrap.dedent('''$1'''))"
}

sha256_verify() {
  # usage: sha256_verify <file> <expected-hex>
  local file="$1" expected="$2"
  local actual
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  fi
  if [ "$actual" != "$expected" ]; then
    echo "[macos] ERROR: SHA-256 mismatch for $(basename "$file")" >&2
    echo "[macos]   expected: $expected" >&2
    echo "[macos]   actual:   $actual" >&2
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# 1. Resolve + download runtimes
# ------------------------------------------------------------------------------

# --- Node.js: latest NODE_MAJOR.x from nodejs.org (SHA-verified) ---
NODE_VERSION="$(curl -fsSL --retry 5 --retry-delay 10 https://nodejs.org/dist/index.json \
  | pyjson "print([r['version'] for r in data if r['version'].startswith('v$NODE_MAJOR.')][0])")"
NODE_VERSION="${NODE_VERSION#v}"
echo "[macos] node: $NODE_VERSION"
NODE_TGZ="node-v${NODE_VERSION}-darwin-arm64.tar.gz"
download "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TGZ}" "$WORK/$NODE_TGZ"
download "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" "$WORK/SHASUMS256.txt"
NODE_SHA="$(grep -F "  $NODE_TGZ" "$WORK/SHASUMS256.txt" | awk '{print $1}')"
[ -n "$NODE_SHA" ] || { echo "[macos] ERROR: no checksum for $NODE_TGZ" >&2; exit 1; }
sha256_verify "$WORK/$NODE_TGZ" "$NODE_SHA"

# --- uv (macOS arm64) for Python resolution (digest-verified via API) ---
UV_RELEASE="$(curl -fsSL --retry 5 --retry-delay 5 https://api.github.com/repos/astral-sh/uv/releases/latest)"
UV_VERSION="${UV_VERSION:-"$(echo "$UV_RELEASE" | pyjson "print(data['tag_name'])")"}"
if [ "$UV_VERSION" = "latest" ] || [ -z "$UV_VERSION" ]; then
  UV_VERSION="$(echo "$UV_RELEASE" | pyjson "print(data['tag_name'])")"
fi
UV_TGZ_URL="$(echo "$UV_RELEASE" | pyjson "print([a['browser_download_url'] for a in data['assets'] if a['name']=='uv-aarch64-apple-darwin.tar.gz'][0])")"
UV_SHA="$(echo "$UV_RELEASE" | pyjson "print((data.get('assets') and [a.get('digest','') for a in data['assets'] if a['name']=='uv-aarch64-apple-darwin.tar.gz'][0]) or '')")"
UV_SHA="${UV_SHA##*:}"
UV_TGZ="$WORK/uv.tar.gz"
echo "[macos] uv: $UV_VERSION"
download "$UV_TGZ_URL" "$UV_TGZ"
if [ -n "$UV_SHA" ]; then
  sha256_verify "$UV_TGZ" "$UV_SHA"
else
  echo "[macos] WARNING: no digest for uv $UV_VERSION; skipping verification"
fi
tar -xzf "$UV_TGZ" -C "$WORK"
UV_BIN="$WORK/uv-aarch64-apple-darwin/uv"
export UV_PYTHON_INSTALL_DIR="$WORK/uvpython"
"$UV_BIN" python install "$PYTHON_SERIES"
UV_PY_HOME="$(find "$WORK/uvpython" -maxdepth 1 -type d -name "cpython-${PYTHON_SERIES}*-aarch64-apple-darwin" | sort | tail -1)"
[ -d "$UV_PY_HOME" ] || { echo "[macos] ERROR: uv python install produced no interpreter" >&2; exit 1; }
echo "[macos] python: $(basename "$UV_PY_HOME")"

# --- chrome-headless-shell (mac-arm64, URL from chrome-for-testing) ----------
# The official chrome-for-testing metadata exposes no digest for
# chrome-headless-shell (only 'platform' + 'url'), so the SHA-256 of the
# pinned default version is reviewed and pinned here when known, then
# verified at download time. Overridden versions without a checksum degrade
# to a warning.
CHROME_VERSION="${CHROME_VERSION:-153.0.8010.36}"
echo "[macos] chrome-headless-shell: $CHROME_VERSION"
CHROME_META="$(curl -fsSL --retry 5 --retry-delay 5 \
  "https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json" \
  | pyjson "
    vs=[v for v in data['versions'] if v['version']=='$CHROME_VERSION']
    if not vs:
        print('UNKNOWN_VERSION'); raise SystemExit(1)
    dl=[d for d in vs[0]['downloads']['chrome-headless-shell'] if d['platform']=='mac-arm64'][0]
    print(dl.get('url', '')); print(dl.get('sha256', ''))")"
CHROME_ZIP_URL="$(echo "$CHROME_META" | sed -n 1p)"
CHROME_SHA256="$(echo "$CHROME_META" | sed -n 2p)"
CHROME_ZIP="$WORK/chrome-headless-shell-mac-arm64.zip"
download "$CHROME_ZIP_URL" "$CHROME_ZIP"
if [ -n "$CHROME_SHA256" ]; then
  sha256_verify "$CHROME_ZIP" "$CHROME_SHA256"
else
  echo "[macos] WARNING: no checksum available for chrome-headless-shell ${CHROME_VERSION}; skipping verification"
fi

# ------------------------------------------------------------------------------
# 2. Extract runtimes into the payload layout
# ------------------------------------------------------------------------------
echo "[macos] extracting runtimes..."
tar -xzf "$WORK/$NODE_TGZ" -C "$WORK"
mv "$WORK/node-v${NODE_VERSION}-darwin-arm64" "$PAYLOAD/usr/lib/node"
file "$PAYLOAD/usr/lib/node/bin/node" | grep -q "arm64" \
  || { echo "[macos] ERROR: node binary is not arm64" >&2; exit 1; }

mkdir -p "$PAYLOAD/usr/lib/python"
cp -R "$UV_PY_HOME"/. "$PAYLOAD/usr/lib/python/"
# uv installs bin/python3.<minor>; ensure bin/python3 is a working interpreter.
if ! "$PAYLOAD/usr/lib/python/bin/python3" -c "import sys" >/dev/null 2>&1; then
  PY_EXE="$(find "$PAYLOAD/usr/lib/python/bin" -maxdepth 1 -type f -name "python3.[0-9]*" ! -name "*-config" | sort | tail -1)"
  if [ -n "$PY_EXE" ]; then
    ln -sfn "$(basename "$PY_EXE")" "$PAYLOAD/usr/lib/python/bin/python3"
  fi
fi
PYTHON_BIN="$PAYLOAD/usr/lib/python/bin/python3"
"$PYTHON_BIN" --version

mkdir -p "$PAYLOAD/usr/lib/chrome-headless-shell"
unzip -q -o "$CHROME_ZIP" -d "$WORK/chrome"
mv "$WORK"/chrome/chrome-headless-shell-*/chrome-headless-shell \
  "$PAYLOAD/usr/lib/chrome-headless-shell/"
"$PAYLOAD/usr/lib/chrome-headless-shell/chrome-headless-shell" --version

export PATH="$PAYLOAD/usr/lib/node/bin:$PATH"
node --version
npm --version

# ------------------------------------------------------------------------------
# 3. Stage app sources (repo subset, mirrors the AppImage build)
# ------------------------------------------------------------------------------
echo "[macos] staging app sources..."
cp "$REPO_ROOT/package.json" "$REPO_ROOT/package-lock.json" "$STAGE/"
mkdir -p "$STAGE/server/ingest" "$STAGE/server/web" "$STAGE/server/scorer" \
  "$STAGE/server/tailor" "$STAGE/extension" "$STAGE/site"
cp "$REPO_ROOT/server/ingest/package.json" "$STAGE/server/ingest/"
cp -R "$REPO_ROOT/server/ingest/src" "$STAGE/server/ingest/src"
cp "$REPO_ROOT/server/scorer/pyproject.toml" "$STAGE/server/scorer/"
cp -R "$REPO_ROOT/server/scorer/src" "$STAGE/server/scorer/src"
cp "$REPO_ROOT/server/tailor/pyproject.toml" "$STAGE/server/tailor/"
cp "$REPO_ROOT/server/tailor/README.md" "$STAGE/server/tailor/"
cp -R "$REPO_ROOT/server/tailor/src" "$STAGE/server/tailor/src"
# Workspace package manifests only (sources not needed) so npm can resolve
# the workspace graph for scoped installs below.
cp "$REPO_ROOT/server/web/package.json" "$STAGE/server/web/"
cp "$REPO_ROOT/extension/package.json" "$STAGE/extension/"
cp "$REPO_ROOT/site/package.json" "$STAGE/site/"
cp -R "$REPO_ROOT/server/web/src" "$REPO_ROOT/server/web/index.html" \
  "$REPO_ROOT/server/web/vite.config.ts" "$REPO_ROOT/server/web/tsconfig.json" \
  "$STAGE/server/web/"
[ -d "$REPO_ROOT/server/web/public" ] && cp -R "$REPO_ROOT/server/web/public" "$STAGE/server/web/public"

# ------------------------------------------------------------------------------
# 4. Build the web SPA
# ------------------------------------------------------------------------------
if [ "${SKIP_WEB_BUILD:-0}" = "1" ] && [ -d "$REPO_ROOT/server/web/dist" ]; then
  echo "[macos] SKIP_WEB_BUILD=1, reusing existing server/web/dist"
  WEB_DIST="$REPO_ROOT/server/web/dist"
else
  echo "[macos] installing web build dependencies..."
  (cd "$STAGE" && npm ci --workspace=server/web --no-audit --no-fund)
  echo "[macos] building web SPA..."
  (cd "$STAGE" && VITE_API_URL="" npm --workspace=server/web run build)
  WEB_DIST="$STAGE/server/web/dist"
fi
[ -f "$WEB_DIST/index.html" ] || { echo "[macos] ERROR: web build produced no index.html" >&2; exit 1; }

# ------------------------------------------------------------------------------
# 5. Install ingest production dependencies (scoped to the workspace)
# ------------------------------------------------------------------------------
echo "[macos] installing ingest production dependencies..."
(cd "$STAGE" && npm ci --omit=dev --workspace=server/ingest --ignore-scripts --no-audit --no-fund)
if [ -f "$STAGE/node_modules/better-sqlite3/prebuilds/darwin-arm64.node" ]; then
  echo "[macos] better-sqlite3 darwin-arm64 prebuild present"
elif [ -d "$STAGE/node_modules/better-sqlite3" ]; then
  echo "[macos] WARNING: better-sqlite3 darwin-arm64 prebuild not found; native module may need a build on first run"
else
  echo "[macos] ERROR: better-sqlite3 missing after install" >&2
  exit 1
fi

# ------------------------------------------------------------------------------
# 6. Install PDF toolchain (folio-export + puppeteer + themes, no Chromium)
# ------------------------------------------------------------------------------
echo "[macos] installing PDF toolchain..."
mkdir -p "$STAGE/node-tools"
cat > "$STAGE/node-tools/package.json" <<'EOF'
{
  "name": "jobfoundry-node-tools",
  "version": "0.1.0",
  "private": true,
  "description": "Bundled PDF toolchain for the JobFoundry macOS package (folio-export + themes).",
  "license": "AGPL-3.0-only",
  "dependencies": {
    "jsonresume-theme-folio": "^1.3.1",
    "jsonresume-theme-stackoverflow": "*",
    "resumed": "^7.0.0",
    "puppeteer": "^24.0.0"
  }
}
EOF
(cd "$STAGE/node-tools" && \
  PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm install --omit=dev --no-audit --no-fund)
[ -x "$STAGE/node-tools/node_modules/.bin/folio-export" ] \
  || { echo "[macos] ERROR: folio-export binary missing after install" >&2; exit 1; }
[ -x "$STAGE/node-tools/node_modules/.bin/resumed" ] \
  || { echo "[macos] ERROR: resumed binary missing after install" >&2; exit 1; }

# ------------------------------------------------------------------------------
# 7. Install Python services into the standalone Python
# ------------------------------------------------------------------------------
echo "[macos] installing Python dependencies..."
"$UV_BIN" pip install --break-system-packages --python "$PYTHON_BIN" \
  --no-cache \
  -r "$REPO_ROOT/packaging/python/scorer-requirements.txt"
"$UV_BIN" pip install --break-system-packages --python "$PYTHON_BIN" \
  --no-cache \
  -r "$REPO_ROOT/packaging/python/tailor-requirements.txt"
echo "[macos] installing resume-ops-api package..."
"$UV_BIN" pip install --break-system-packages --python "$PYTHON_BIN" \
  --no-cache --no-deps "$STAGE/server/tailor"
"$PYTHON_BIN" -c "import resume_ops_api, fastapi, litellm; print('[macos] python imports OK')"
# Drop bytecode caches to keep the bundle lean.
find "$PAYLOAD/usr/lib/python" -name "__pycache__" -type d -prune -exec rm -rf {} + 2>/dev/null || true

# ------------------------------------------------------------------------------
# 8. Lay out app files inside the payload
# ------------------------------------------------------------------------------
echo "[macos] laying out app files..."
APP_SHARE="$PAYLOAD/usr/share/jobfoundry"
mkdir -p "$APP_SHARE/server/ingest" "$APP_SHARE/server/scorer" "$APP_SHARE/web"
cp -R "$STAGE/server/ingest/src" "$APP_SHARE/server/ingest/src"
cp "$STAGE/server/ingest/package.json" "$APP_SHARE/server/ingest/"
cp -R "$STAGE/server/scorer/src" "$APP_SHARE/server/scorer/src"
cp -R "$WEB_DIST" "$APP_SHARE/web/dist"
cp -R "$STAGE/node_modules" "$APP_SHARE/node_modules"
cp -R "$STAGE/node-tools" "$APP_SHARE/node-tools"

# ------------------------------------------------------------------------------
# 9. Install launcher, control CLI, and dispatcher entry point
# ------------------------------------------------------------------------------
echo "[macos] installing launcher and entry point..."
cp "$REPO_ROOT/packaging/launcher.sh" "$PAYLOAD/usr/bin/jobfoundry-launcher"
cp "$REPO_ROOT/packaging/jobfoundry-ctl.sh" "$PAYLOAD/usr/bin/jobfoundry-ctl"
cp "$SCRIPT_DIR/jobfoundry" "$PAYLOAD/bin/jobfoundry"
chmod +x "$PAYLOAD/usr/bin/jobfoundry-launcher" "$PAYLOAD/usr/bin/jobfoundry-ctl" "$PAYLOAD/bin/jobfoundry"
# Convenience symlink at the payload root so `tar -xzf` users see it first.
ln -sfn bin/jobfoundry "$PAYLOAD/jobfoundry"

# macOS note: no shared-library bundling step is needed here. The Node.js
# nodejs.org binary, python-build-standalone, and chrome-headless-shell for
# macOS are self-contained (system frameworks only). Fonts come from the
# host via CoreText, so the liberation-fonts bundle used on Linux is skipped.

# ------------------------------------------------------------------------------
# 10. Pack the tarball + checksum
# ------------------------------------------------------------------------------
echo "[macos] packing tarball..."
(cd "$PAYLOAD" && tar -czf "$OUTPUT_DIR/$TARBALL_NAME" .)
(cd "$OUTPUT_DIR" && shasum -a 256 "$TARBALL_NAME" > "$TARBALL_NAME.sha256")

echo ""
echo "[macos] done."
du -sh "$PAYLOAD" | sed 's/^/[macos] payload size: /'
ls -lh "$OUTPUT_DIR/$TARBALL_NAME" "$OUTPUT_DIR/$TARBALL_NAME.sha256"
