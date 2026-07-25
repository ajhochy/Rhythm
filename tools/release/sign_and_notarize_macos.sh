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

# Preprocess entitlements: expand $(AppIdentifierPrefix) to the actual team ID
# prefix. codesign does not expand Xcode build variables, so a literal
# $(AppIdentifierPrefix) in keychain-access-groups causes AMFI to reject the
# app at exec time on macOS Sequoia and later.
PROCESSED_ENTITLEMENTS="$(mktemp -t rhythm-entitlements).plist"
sed "s/\$(AppIdentifierPrefix)/${APPLE_TEAM_ID}./" "${ENTITLEMENTS_PATH}" > "${PROCESSED_ENTITLEMENTS}"

# The bundled opencode fork binary is an extensionless Mach-O produced by bun
# --compile. The find pattern below does NOT match it (no extension), so we must
# sign it explicitly BEFORE the broad nested-binary pass — and fail loudly if it
# is absent (it should always be present after the Bundle step in CI).
OPENCODE_BIN="${APP_PATH}/Contents/Resources/opencode_bin/opencode"
if [[ ! -f "${OPENCODE_BIN}" ]]; then
  echo "::error::Bundled opencode fork binary not found at ${OPENCODE_BIN} — aborting sign step." >&2
  exit 1
fi
# Sign the opencode binary with its OWN entitlements (NOT the app's). As a bun
# standalone it needs two Hardened Runtime relaxations the Flutter app does not:
#   - allow-jit + allow-unsigned-executable-memory: bun runs a JITting
#     JavaScriptCore. Adding ANY entitlement turns on JIT enforcement, so these
#     two MUST be present or the process is SIGTRAP-killed in dyld at launch
#     ("Server exited with code null"). Signing with NO entitlements launches but
#     then dlopen fails (below); signing with disable-library-validation ALONE
#     launch-crashes. Both sets are required together.
#   - disable-library-validation: opencode extracts an embedded FFI dylib to a
#     temp path and dlopen()s it (PTY backend); its Team ID differs from this
#     re-signed binary's, so library validation rejects it ("different Team IDs")
#     and Pty.create 500s ("Terminal connection failed").
# These live in opencode.entitlements so the main app keeps a strict runtime.
OPENCODE_ENTITLEMENTS_PATH="${ROOT_DIR}/apps/desktop_flutter/macos/Runner/opencode.entitlements"
if [[ ! -f "${OPENCODE_ENTITLEMENTS_PATH}" ]]; then
  echo "::error::opencode.entitlements not found at ${OPENCODE_ENTITLEMENTS_PATH} — aborting sign step." >&2
  exit 1
fi
codesign --force --options runtime --timestamp \
  --entitlements "${OPENCODE_ENTITLEMENTS_PATH}" \
  --sign "${IDENTITY_SHA}" \
  "${OPENCODE_BIN}"

# #1023 — The bundled Node runtime (Resources/node/bin/node) is also an
# extensionless Mach-O the find pattern below does NOT match, so sign it
# explicitly here too. Like opencode it is a JITing runtime and dlopen()s
# native .node addons (better_sqlite3, node-pty), so it needs the SAME two
# Hardened Runtime relaxations — allow-jit + allow-unsigned-executable-memory
# (V8 JIT dies with SIGTRAP at launch without them once any entitlement is
# present) and disable-library-validation. opencode.entitlements grants exactly
# that set, so we reuse it rather than duplicate a near-identical plist.
NODE_BIN="${APP_PATH}/Contents/Resources/node/bin/node"
if [[ ! -f "${NODE_BIN}" ]]; then
  echo "::error::Bundled Node runtime not found at ${NODE_BIN} — aborting sign step." >&2
  exit 1
fi
codesign --force --options runtime --timestamp \
  --entitlements "${OPENCODE_ENTITLEMENTS_PATH}" \
  --sign "${IDENTITY_SHA}" \
  "${NODE_BIN}"

# Sign nested frameworks and binaries from the inside out with Hardened Runtime.
# codesign --deep does NOT propagate --options runtime to nested items, so we
# must sign each one explicitly before signing the top-level bundle.
# This includes .node native addons (e.g. better_sqlite3.node, pty.node from
# node-pty) and plain Mach-O helper executables (e.g. node-pty's spawn-helper)
# bundled in Contents/Resources — Apple requires all native binaries to be
# signed with Hardened Runtime and a secure timestamp.
while IFS= read -r -d '' item; do
  codesign --force --options runtime --timestamp \
    --sign "${IDENTITY_SHA}" \
    "${item}"
done < <(find "${APP_PATH}/Contents" \
  \( -name "*.framework" -o -name "*.dylib" -o -name "*.so" -o -name "*.node" -o -name "spawn-helper" \) \
  -print0 | sort -rz)

codesign --force --options runtime --timestamp \
  --entitlements "${PROCESSED_ENTITLEMENTS}" \
  --sign "${IDENTITY_SHA}" \
  "${APP_PATH}"

# Recreate DMG from the now-signed app. package_macos.sh built it from the
# unsigned Xcode output; we must rebuild it so the archive contains the
# properly signed and hardened bundle before notarization.
APP_DISPLAY_NAME="$(basename "${APP_PATH}" .app)"
ZIP_PATH="${DMG_PATH%.dmg}.zip"
hdiutil create \
  -volname "${APP_DISPLAY_NAME}" \
  -srcfolder "${APP_PATH}" \
  -ov \
  -format UDZO \
  "${DMG_PATH}"

codesign --force --sign "${IDENTITY_SHA}" "${DMG_PATH}"

NOTARY_OUTPUT="$(mktemp -t rhythm-notary-output)"
NOTARY_LOG="$(mktemp -t rhythm-notary-log)"

xcrun notarytool submit "${DMG_PATH}" \
  --apple-id "${APPLE_ID}" \
  --password "${APPLE_APP_SPECIFIC_PASSWORD}" \
  --team-id "${APPLE_TEAM_ID}" \
  --wait \
  --timeout 30m \
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

# Recreate the ZIP *after* stapling so the embedded .app already carries the
# notarization ticket. xcrun stapler cannot staple a ZIP directly, but
# packaging the already-stapled .app means offline Gatekeeper verification
# works for users who download the ZIP instead of the DMG.
ditto -c -k --sequesterRsrc --keepParent "${APP_PATH}" "${ZIP_PATH}"

echo "Signed and notarized ${APP_PATH} and ${DMG_PATH}"
