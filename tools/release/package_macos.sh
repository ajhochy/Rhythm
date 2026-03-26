#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/desktop_flutter/build/macos/Build/Products/Release"
DIST_DIR="${ROOT_DIR}/apps/desktop_flutter/dist"
DISPLAY_NAME="Rhythm"

mkdir -p "${DIST_DIR}"
rm -f "${DIST_DIR}"/*.zip "${DIST_DIR}"/*.dmg

APP_PATH="$(find "${APP_DIR}" -maxdepth 1 -name '*.app' -print -quit)"
if [[ -z "${APP_PATH}" ]]; then
  echo "No macOS app bundle found in ${APP_DIR}" >&2
  exit 1
fi

ARCHIVE_BASENAME="${DISPLAY_NAME}-macOS"
ZIP_PATH="${DIST_DIR}/${ARCHIVE_BASENAME}.zip"
DMG_PATH="${DIST_DIR}/${ARCHIVE_BASENAME}.dmg"

ditto -c -k --sequesterRsrc --keepParent "${APP_PATH}" "${ZIP_PATH}"
hdiutil create \
  -volname "${DISPLAY_NAME}" \
  -srcfolder "${APP_PATH}" \
  -ov \
  -format UDZO \
  "${DMG_PATH}"

echo "Packaged ${ZIP_PATH}"
echo "Packaged ${DMG_PATH}"
