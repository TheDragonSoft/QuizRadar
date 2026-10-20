#!/usr/bin/env bash
set -euo pipefail

VER="${1:-3.3.0}"
ARCH="${2:-amd64}"
STAGE_DIR="dist/deb-staging"
OUTPUT_DEB="dist/QuizRadar-v${VER}-linux-${ARCH}.deb"

echo "Building Debian package: ${OUTPUT_DEB}"

rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}/DEBIAN"
mkdir -p "${STAGE_DIR}/usr/bin"
mkdir -p "${STAGE_DIR}/usr/lib/quizradar/static"
mkdir -p "${STAGE_DIR}/usr/lib/quizradar/data"
mkdir -p "${STAGE_DIR}/usr/share/applications"
mkdir -p "${STAGE_DIR}/usr/share/icons/hicolor/scalable/apps"

# Copy binary & assets
cp target/release/quizradar "${STAGE_DIR}/usr/lib/quizradar/quizradar-bin"
chmod 755 "${STAGE_DIR}/usr/lib/quizradar/quizradar-bin"
cp -r static/* "${STAGE_DIR}/usr/lib/quizradar/static/"
cp data/schedule.template.json "${STAGE_DIR}/usr/lib/quizradar/data/"
cp data/schedule.template.json "${STAGE_DIR}/usr/lib/quizradar/data/schedule.json"

# User wrapper launcher
cat > "${STAGE_DIR}/usr/bin/quizradar" << 'LAUNCHER'
#!/bin/sh
APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/quizradar"
mkdir -p "$APP_DIR/data"
if [ ! -f "$APP_DIR/data/schedule.json" ]; then
    cp /usr/lib/quizradar/data/schedule.json "$APP_DIR/data/schedule.json" 2>/dev/null || true
fi
if [ ! -d "$APP_DIR/static" ]; then
    ln -s /usr/lib/quizradar/static "$APP_DIR/static" 2>/dev/null || cp -r /usr/lib/quizradar/static "$APP_DIR/static"
fi
cd "$APP_DIR"
exec /usr/lib/quizradar/quizradar-bin "$@"
LAUNCHER
chmod 755 "${STAGE_DIR}/usr/bin/quizradar"

# Desktop entry
cat > "${STAGE_DIR}/usr/share/applications/quizradar.desktop" << 'DESKTOP'
[Desktop Entry]
Name=QuizRadar
Comment=Academic Dashboard & Multi-Source Exam Calendar
Exec=/usr/bin/quizradar
Icon=quizradar
Terminal=false
Type=Application
Categories=Education;Office;Utility;
Keywords=quiz;exam;calendar;moodle;teams;academic;
DESKTOP

# Icon
cp static/icon.svg "${STAGE_DIR}/usr/share/icons/hicolor/scalable/apps/quizradar.svg"

# Control file
cat > "${STAGE_DIR}/DEBIAN/control" << CONTROL
Package: quizradar
Version: ${VER}
Section: utils
Priority: optional
Architecture: ${ARCH}
Maintainer: TheDragonSoft <https://github.com/TheDragonSoft/QuizRadar>
Homepage: https://github.com/TheDragonSoft/QuizRadar
Description: Academic Dashboard & Multi-Source Exam Calendar
 QuizRadar automatically detects quizzes, midterms, lab assessments, and
 deadlines across Gmail, Microsoft Teams, Moodle, and Google Classroom,
 syncing them into a unified local weekly calendar and mobile app.
CONTROL

dpkg-deb --build "${STAGE_DIR}" "${OUTPUT_DEB}"
rm -rf "${STAGE_DIR}"

echo "Successfully built ${OUTPUT_DEB}"
