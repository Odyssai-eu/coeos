#!/usr/bin/env bash
# build-nemo.sh — signed + notarized release build of Nemo (macOS, Apple Silicon).
#
# Version rules (~/.claude/skills/build): marketing version from VERSION (manual bump),
# build counter .build-number auto-incremented on EVERY run, both injected into the
# bundle (CFBundleShortVersionString = VERSION, CFBundleVersion = counter), and the
# script ends with "OK -> <dmg> vX.Y.Z (build N)".
#
# Signing: Developer ID "Dupont Sophie (U2YXX868N2)" — never ad-hoc for a distributed
# app. Notarization: App Store Connect API key in ~/.appstoreconnect/ (AuthKey_<ID>.p8 +
# ids). Nothing here is read from, or written to, the repository.
#
# Usage: scripts/build-nemo.sh [dev|beta|prod]     (default prod)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANNEL="${1:-prod}"
case "$CHANNEL" in dev|beta|prod) ;; *) echo "channel must be dev|beta|prod" >&2; exit 2;; esac

VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
[ -n "$VERSION" ] || { echo "VERSION is empty" >&2; exit 2; }
BUILD=$(( $(tr -d '[:space:]' < "$ROOT/.build-number" 2>/dev/null || echo 0) + 1 ))
echo "$BUILD" > "$ROOT/.build-number"

# Keep package.json's version equal to VERSION (electron-builder reads it).
cd "$ROOT/packages/desktop"
/usr/bin/python3 - "$VERSION" <<'PY'
import json, sys, pathlib
p = pathlib.Path("package.json"); d = json.loads(p.read_text())
if d.get("version") != sys.argv[1]:
    d["version"] = sys.argv[1]; p.write_text(json.dumps(d, indent=2) + "\n"); print("package.json version ->", sys.argv[1])
PY

KEY_DIR="$HOME/.appstoreconnect"
KEY_FILE="$(ls "$KEY_DIR"/AuthKey_*.p8 2>/dev/null | head -1 || true)"
[ -n "$KEY_FILE" ] || { echo "no App Store Connect key in $KEY_DIR — cannot notarize" >&2; exit 3; }
export OPENCODE_CHANNEL="$CHANNEL"
export NEMO_BUILD_NUMBER="$BUILD"
export APPLE_API_KEY="$KEY_FILE"
export APPLE_API_KEY_ID="$(basename "$KEY_FILE" .p8 | sed 's/^AuthKey_//')"
export APPLE_API_ISSUER="$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$KEY_DIR/ids" | head -1)"
export CSC_NAME="Dupont Sophie (U2YXX868N2)"
[ -n "$APPLE_API_ISSUER" ] || { echo "issuer UUID not found in $KEY_DIR/ids" >&2; exit 3; }

echo "[build-nemo] channel=$CHANNEL version=$VERSION build=$BUILD"
bun run prebuild && bun run build && bun run package

case "$CHANNEL" in dev) APP="dist/mac-arm64/Nemo Dev.app";; beta) APP="dist/mac-arm64/Nemo Beta.app";; prod) APP="dist/mac-arm64/Nemo.app";; esac
DMG="dist/nemo-mac-arm64.dmg"
[ -d "$APP" ] && [ -f "$DMG" ] || { echo "artefacts missing: $APP / $DMG" >&2; exit 4; }
SV="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist")"
BV="$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$APP/Contents/Info.plist")"
[ "$SV" = "$VERSION" ] && [ "$BV" = "$BUILD" ] || { echo "bundle version mismatch: $SV/$BV vs $VERSION/$BUILD" >&2; exit 4; }
spctl -a -vv "$APP" 2>&1 | grep -q "Notarized Developer ID" || { echo "spctl: not notarized" >&2; spctl -a -vv "$APP"; exit 5; }
xcrun stapler validate "$APP" >/dev/null 2>&1 || { echo "stapler: ticket not stapled" >&2; exit 5; }
echo "OK -> $ROOT/packages/desktop/$DMG v$VERSION (build $BUILD)"
