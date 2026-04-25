#!/usr/bin/env bash
set -euo pipefail

MODE="unsigned"
APP_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --signed)
      MODE="signed"
      shift
      ;;
    --unsigned)
      MODE="unsigned"
      shift
      ;;
    *)
      APP_PATH="$1"
      shift
      ;;
  esac
done

APP_PATH="${APP_PATH:-apps/desktop_flutter/build/macos/Build/Products/Release/Rhythm.app}"

if [[ ! -d "${APP_PATH}" ]]; then
  echo "Missing macOS app bundle: ${APP_PATH}" >&2
  exit 1
fi

APP_BINARY="${APP_PATH}/Contents/Frameworks/App.framework/Versions/A/App"
INFO_PLIST="${APP_PATH}/Contents/Info.plist"
RUNNER_BINARY="${APP_PATH}/Contents/MacOS/Rhythm"

if [[ ! -f "${APP_BINARY}" ]]; then
  echo "Missing Flutter App.framework binary: ${APP_BINARY}" >&2
  exit 1
fi

if [[ ! -f "${RUNNER_BINARY}" ]]; then
  echo "Missing macOS runner binary: ${RUNNER_BINARY}" >&2
  exit 1
fi

APP_STRINGS="$(mktemp -t rhythm-desktop-oauth-strings)"
ENTITLEMENTS_XML="$(mktemp -t rhythm-desktop-entitlements)"
trap 'rm -f "${APP_STRINGS}" "${ENTITLEMENTS_XML}"' EXIT

strings "${APP_BINARY}" > "${APP_STRINGS}"

require_string() {
  local needle="$1"
  if ! grep -Fq "${needle}" "${APP_STRINGS}"; then
    echo "Desktop OAuth verification failed: missing '${needle}' in App.framework." >&2
    exit 1
  fi
}

reject_string() {
  local needle="$1"
  if grep -Fq "${needle}" "${APP_STRINGS}"; then
    echo "Desktop OAuth verification failed: found stale OAuth marker '${needle}' in App.framework." >&2
    exit 1
  fi
}

require_string "/auth/google/desktop-exchange"
require_string "code_challenge"
require_string "code_challenge_method"
require_string "accounts.google.com"

reject_string "org.openid.appauth"
reject_string "AppAuth"
reject_string "GoogleSignIn"
reject_string "google_sign_in"
reject_string "GIDSignIn"
reject_string "client_secret"

if plutil -p "${INFO_PLIST}" | grep -Eq "GIDClient|GIDSignIn|GoogleSignIn|org.openid.appauth"; then
  echo "Desktop OAuth verification failed: Info.plist still contains native Google/AppAuth configuration." >&2
  exit 1
fi

print_diagnostics() {
  local bundle_id
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${INFO_PLIST}" 2>/dev/null || echo '<missing>')"
  echo "Desktop OAuth verification mode: ${MODE}"
  echo "Bundle identifier: ${bundle_id}"
  echo "Runner binary: ${RUNNER_BINARY}"
  echo "Embedded Flutter binary: ${APP_BINARY}"
}

require_codesign_detail() {
  local needle="$1"
  if ! codesign -dvvv "${APP_PATH}" 2>&1 | grep -Fq "${needle}"; then
    echo "Desktop OAuth verification failed: expected codesign detail '${needle}'." >&2
    exit 1
  fi
}

require_entitlement_key() {
  local needle="$1"
  if ! grep -Fq "<key>${needle}</key>" "${ENTITLEMENTS_XML}"; then
    echo "Desktop OAuth verification failed: missing entitlement '${needle}'." >&2
    exit 1
  fi
}

reject_entitlement_key() {
  local needle="$1"
  if grep -Fq "<key>${needle}</key>" "${ENTITLEMENTS_XML}"; then
    echo "Desktop OAuth verification failed: unexpected entitlement '${needle}' present." >&2
    exit 1
  fi
}

print_diagnostics

if [[ "${MODE}" == "signed" ]]; then
  if ! codesign --display --entitlements - --xml "${APP_PATH}" > "${ENTITLEMENTS_XML}" 2>/dev/null; then
    echo "Desktop OAuth verification failed: could not read signed entitlements." >&2
    exit 1
  fi

  require_codesign_detail "Authority="
  require_codesign_detail "TeamIdentifier="
  require_codesign_detail "Runtime Version="

  require_entitlement_key "com.apple.security.network.client"
  require_entitlement_key "com.apple.security.network.server"
  reject_entitlement_key "keychain-access-groups"
  reject_entitlement_key "com.apple.security.keychain-access-groups"
fi

echo "Desktop OAuth build verification passed."
