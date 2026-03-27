#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/desktop_flutter/build/macos/Build/Products/Release"
DIST_DIR="${ROOT_DIR}/apps/desktop_flutter/dist"
ENTITLEMENTS_PATH="${ROOT_DIR}/apps/desktop_flutter/macos/Runner/Release.entitlements"

APP_PATH="$(find "${APP_DIR}" -maxdepth 1 -name '*.app' -print -quit)"
DMG_PATH="$(find "${DIST_DIR}" -maxdepth 1 -name '*.dmg' -print -quit)"

required_vars=(
  APPLE_CERTIFICATE_BASE64
  APPLE_CERTIFICATE_PASSWORD
  APPLE_SIGNING_IDENTITY
  APPLE_ID
  APPLE_APP_SPECIFIC_PASSWORD
  APPLE_TEAM_ID
)

for name in "${required_vars[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Skipping codesign/notarization because ${name} is not set."
    exit 0
  fi
done

if [[ -z "${APP_PATH}" || -z "${DMG_PATH}" ]]; then
  echo "Missing app bundle or DMG for signing." >&2
  exit 1
fi

KEYCHAIN_NAME="build-signing.keychain-db"
KEYCHAIN_PASSWORD="$(uuidgen)"
CERT_PATH="$(mktemp -t rhythm-cert).p12"

cleanup() {
  rm -f "${CERT_PATH}"
  security delete-keychain "${KEYCHAIN_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "${APPLE_CERTIFICATE_BASE64}" | base64 --decode > "${CERT_PATH}"

security create-keychain -p "${KEYCHAIN_PASSWORD}" "${KEYCHAIN_NAME}"
security set-keychain-settings -lut 21600 "${KEYCHAIN_NAME}"
security unlock-keychain -p "${KEYCHAIN_PASSWORD}" "${KEYCHAIN_NAME}"
security import "${CERT_PATH}" \
  -k "${KEYCHAIN_NAME}" \
  -P "${APPLE_CERTIFICATE_PASSWORD}" \
  -T /usr/bin/codesign \
  -T /usr/bin/security \
  -T /usr/bin/productbuild
security list-keychain -d user -s "${KEYCHAIN_NAME}" login.keychain-db
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "${KEYCHAIN_PASSWORD}" \
  "${KEYCHAIN_NAME}"

EXPECTED_IDENTITY="$(printf '%s' "${APPLE_SIGNING_IDENTITY}" | tr -d '\r\n')"
IDENTITIES_OUTPUT="$(security find-identity -v -p codesigning "${KEYCHAIN_NAME}")"

IDENTITY_SHA="$(printf '%s\n' "${IDENTITIES_OUTPUT}" | grep -F "${EXPECTED_IDENTITY}" | awk 'NR==1 { print $2 }')"

if [[ -z "${IDENTITY_SHA}" ]]; then
  IDENTITY_SHA="$(printf '%s\n' "${IDENTITIES_OUTPUT}" | awk '$2 ~ /^[0-9A-F]+$/ { print $2; exit }')"
fi

if [[ -z "${IDENTITY_SHA}" ]]; then
  echo "Unable to resolve a signing identity from the imported certificate." >&2
  printf '%s\n' "${IDENTITIES_OUTPUT}" || true
  exit 1
fi

# Sign nested frameworks and binaries from the inside out with Hardened Runtime.
# codesign --deep does NOT propagate --options runtime to nested items, so we
# must sign each one explicitly before signing the top-level bundle.
while IFS= read -r -d '' item; do
  codesign --force --options runtime --timestamp \
    --sign "${IDENTITY_SHA}" \
    "${item}"
done < <(find "${APP_PATH}/Contents/Frameworks" \
  \( -name "*.framework" -o -name "*.dylib" -o -name "*.so" \) \
  -print0 | sort -rz)

codesign --force --options runtime --timestamp \
  --entitlements "${ENTITLEMENTS_PATH}" \
  --sign "${IDENTITY_SHA}" \
  "${APP_PATH}"

codesign --force --sign "${IDENTITY_SHA}" "${DMG_PATH}"

NOTARY_OUTPUT="$(mktemp -t rhythm-notary-output)"
NOTARY_LOG="$(mktemp -t rhythm-notary-log)"

xcrun notarytool submit "${DMG_PATH}" \
  --apple-id "${APPLE_ID}" \
  --password "${APPLE_APP_SPECIFIC_PASSWORD}" \
  --team-id "${APPLE_TEAM_ID}" \
  --wait \
  > "${NOTARY_OUTPUT}"

SUBMISSION_ID="$(awk '/^[[:space:]]+id:/ { print $2; exit }' "${NOTARY_OUTPUT}")"
NOTARY_STATUS="$(awk '/^[[:space:]]+status:/ { print $2; exit }' "${NOTARY_OUTPUT}")"

cat "${NOTARY_OUTPUT}"

if [[ "${NOTARY_STATUS}" == "Invalid" && -n "${SUBMISSION_ID}" ]]; then
  echo "Fetching Apple notarization log for submission ${SUBMISSION_ID}..."
  xcrun notarytool log "${SUBMISSION_ID}" \
    --apple-id "${APPLE_ID}" \
    --password "${APPLE_APP_SPECIFIC_PASSWORD}" \
    --team-id "${APPLE_TEAM_ID}" \
    > "${NOTARY_LOG}" || true
  cat "${NOTARY_LOG}" || true
  exit 1
fi

xcrun stapler staple "${APP_PATH}"
xcrun stapler staple "${DMG_PATH}"

echo "Signed and notarized ${APP_PATH} and ${DMG_PATH}"
