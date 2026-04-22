#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-apps/desktop_flutter/build/macos/Build/Products/Release/Rhythm.app}"

if [[ ! -d "${APP_PATH}" ]]; then
  echo "Missing macOS app bundle: ${APP_PATH}" >&2
  exit 1
fi

APP_BINARY="${APP_PATH}/Contents/Frameworks/App.framework/Versions/A/App"
INFO_PLIST="${APP_PATH}/Contents/Info.plist"

if [[ ! -f "${APP_BINARY}" ]]; then
  echo "Missing Flutter App.framework binary: ${APP_BINARY}" >&2
  exit 1
fi

APP_STRINGS="$(mktemp -t rhythm-desktop-oauth-strings)"
trap 'rm -f "${APP_STRINGS}"' EXIT

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

echo "Desktop OAuth build verification passed."
