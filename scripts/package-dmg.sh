#!/usr/bin/env bash
set -euo pipefail

VER="${1:-3.1.0}"
ARCH="${2:-arm64}"
STAGE_DIR="dist/dmg-staging"
OUTPUT_DMG="dist/QuizRadar-v${VER}-macos-${ARCH}.dmg"
APP_BUNDLE="${STAGE_DIR}/QuizRadar.app"

echo "Building macOS DMG: ${OUTPUT_DMG}"

rm -rf "${STAGE_DIR}"
mkdir -p "${APP_BUNDLE}/Contents/MacOS"
mkdir -p "${APP_BUNDLE}/Contents/Resources/static"
mkdir -p "${APP_BUNDLE}/Contents/Resources/data"

# Copy binary & assets
cp target/release/quizradar "${APP_BUNDLE}/Contents/MacOS/quizradar-bin"
chmod 755 "${APP_BUNDLE}/Contents/MacOS/quizradar-bin"
cp -r static/* "${APP_BUNDLE}/Contents/Resources/static/"
cp data/schedule.json "${APP_BUNDLE}/Contents/Resources/data/"

# Launcher script
cat > "${APP_BUNDLE}/Contents/MacOS/quizradar" << 'LAUNCHER'
#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$HOME/Library/Application Support/QuizRadar"
mkdir -p "$APP_DIR/data"
if [ ! -f "$APP_DIR/data/schedule.json" ]; then
    cp "$DIR/../Resources/data/schedule.json" "$APP_DIR/data/schedule.json" 2>/dev/null || true
fi
if [ ! -d "$APP_DIR/static" ]; then
    ln -s "$DIR/../Resources/static" "$APP_DIR/static" 2>/dev/null || cp -r "$DIR/../Resources/static" "$APP_DIR/static"
fi
cd "$APP_DIR"
exec "$DIR/quizradar-bin" "$@"
LAUNCHER
chmod 755 "${APP_BUNDLE}/Contents/MacOS/quizradar"

# Info.plist
cat > "${APP_BUNDLE}/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>quizradar</string>
    <key>CFBundleIdentifier</key>
    <string>com.thedragonsoft.quizradar</string>
    <key>CFBundleName</key>
    <string>QuizRadar</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${VER}</string>
    <key>CFBundleVersion</key>
    <string>${VER}</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST

# Generate AppIcon.icns from assets/icon.png
ICONSET="AppIcon.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
sips -z 16 16     assets/icon.png --out "$ICONSET/icon_16x16.png"
sips -z 32 32     assets/icon.png --out "$ICONSET/icon_16x16@2x.png"
sips -z 32 32     assets/icon.png --out "$ICONSET/icon_32x32.png"
sips -z 64 64     assets/icon.png --out "$ICONSET/icon_32x32@2x.png"
sips -z 128 128   assets/icon.png --out "$ICONSET/icon_128x128.png"
sips -z 256 256   assets/icon.png --out "$ICONSET/icon_128x128@2x.png"
sips -z 256 256   assets/icon.png --out "$ICONSET/icon_256x256.png"
sips -z 512 512   assets/icon.png --out "$ICONSET/icon_256x256@2x.png"
sips -z 512 512   assets/icon.png --out "$ICONSET/icon_512x512.png"
iconutil -c icns "$ICONSET" -o "${APP_BUNDLE}/Contents/Resources/AppIcon.icns"
rm -rf "$ICONSET"

# Add Applications symlink in the DMG root
ln -s /Applications "${STAGE_DIR}/Applications"

# Create compressed DMG disk image using native hdiutil
hdiutil create \
  -volname "QuizRadar" \
  -srcfolder "${STAGE_DIR}" \
  -ov \
  -format UDZO \
  "${OUTPUT_DMG}"

rm -rf "${STAGE_DIR}"

echo "Successfully built ${OUTPUT_DMG}"
