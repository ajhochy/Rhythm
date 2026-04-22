# Google OAuth Consolidation Plan

**Branch:** `fix/google-signin-keychain-v2` → PR #242
**Goal:** Replace the `google_sign_in` SDK (which fails on signed macOS Developer-ID builds due to the Data Protection Keychain / `keychain-access-groups` entitlement problem) with a manual OAuth 2.0 + PKCE loopback flow driven by the existing server-side Google OAuth service. This both fixes the keychain bug and unifies the two OAuth flows the app currently uses (login vs. Gmail/Calendar access).

## Background

- The macOS app has been broken for 10+ releases with `GoogleSignInException: providerConfigurationError (keychain error)`.
- Root cause: GoogleSignIn 9.x forces `kSecUseDataProtectionKeychain = YES`, which on macOS requires either `keychain-access-groups` or `com.apple.application-identifier` entitlement. Both are restricted — adding `keychain-access-groups` without an embedded provisioning profile causes AMFI to reject the binary at launch ("The application can't be opened"). Without it, every keychain write fails.
- Developer ID distribution cannot embed an iOS-style provisioning profile, so we cannot use the SDK's keychain code path reliably.
- The server already has a full OAuth 2.0 authorization-code flow (`google_oauth_service.ts`) for Gmail/Calendar. We extend it to also issue a Rhythm session token, and drive it from Flutter with PKCE + a localhost loopback redirect — no SDK, no keychain, no entitlement.

## Atomic steps

Each step is one commit to PR #242. Check the box once the commit lands.

- [x] **Step 1** — Add this tracking doc
- [x] **Step 2** — Server: add `POST /auth/google/desktop-exchange` endpoint (PKCE, no client secret, uses `GOOGLE_DESKTOP_CLIENT_ID`, exchanges code for tokens, mints Rhythm session, upserts integration account based on granted scopes)
- [x] **Step 3** — Server: unit tests for the new endpoint (happy path + invalid code + PKCE mismatch)
- [x] **Step 4** — Flutter: add `DesktopGoogleOAuthClient` (PKCE verifier/challenge, spins up loopback HTTP server on ephemeral port, launches authorize URL via `url_launcher`, captures code from redirect, posts to server, returns session token)
- [x] **Step 5** — Flutter: swap `auth_session_service.dart` to call `DesktopGoogleOAuthClient` instead of `GoogleSignIn.instance.authenticate()`
- [x] **Step 6** — Flutter: `dart format` + `flutter analyze --no-fatal-infos` + `flutter test` pass
- [x] **Step 7** — Docs: Google Cloud Console setup (add `http://127.0.0.1` loopback redirect to Desktop OAuth client) + PR test plan → see [`google-oauth-desktop-setup.md`](./google-oauth-desktop-setup.md)

## Completed cleanup (moved up due to native plugin interference)

- `google_sign_in` removed from `pubspec.yaml` — the native plugin was still registering at app launch, calling `SecKeychainAddCallback`, and surfacing `GoogleSignInException(providerConfigurationError, keychain error)` even without any Dart code calling it
- `GIDClientID` and `CFBundleURLSchemes` removed from `Info.plist`
- `Inject Google client ID into Info.plist` CI step removed from `desktop_release.yml`
- Release/Debug entitlements remain minimal (no `keychain-access-groups`)

## Handoff notes for the next agent

- Current branch: `fix/google-signin-keychain-v2`. PR #242.
- Entitlements are currently reverted to minimal (no keychain). App launches but Google Sign-In still fails — this is expected until steps 2–5 land.
- Server env already has `GOOGLE_DESKTOP_CLIENT_ID` wired in `desktop_release.yml`. No client secret exists for the Desktop client (PKCE only — do not look for one).
- Existing `google_oauth_service.ts` uses `env.googleClientId` + `env.googleClientSecret` (Web client). The new endpoint must use the **Desktop** client id with no secret — keep it separate; do not refactor the Web-client flow.
- Scopes to request from the desktop flow: `openid email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.metadata` (same superset the server integration uses today — unifies both flows).
- Commit message convention: `step N: <short description>`. Update the checkbox above in the same commit.
