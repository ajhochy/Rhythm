---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [2010]
status: partial
tags: [run, Rhythm]
---

# React/Electron Google desktop sign-in

## Flutter parity

| Flutter desktop source | React/Electron implementation | Match |
|---|---|---|
| `DesktopGoogleOAuthClient` avoids `google_sign_in` and creates an authorization-code PKCE flow. | `google-oauth-core.mjs` implements Web Crypto PKCE; no Google sign-in SDK was added. | Matched. |
| Generates 64 random bytes for the verifier and hashes it with SHA-256 to an unpadded base64url challenge. | `generatePkcePair` uses `crypto.getRandomValues(64)` and `subtle.digest('SHA-256', …)`, then removes padding. | Matched. |
| Binds `InternetAddress.loopbackIPv4` on port `0`; callback is `http://127.0.0.1:<port>/callback`. | `desktop-google-oauth.mjs` binds `node:http` to `127.0.0.1`, port `0`, and derives the identical callback URI. | Matched. |
| Authorization endpoint is `https://accounts.google.com/o/oauth2/v2/auth` with the ten ordered parameters from the source. | `buildGoogleAuthorizationUrl` uses the same endpoint and insertion order, including `S256`, offline access, consent, and granted scopes. | Matched. |
| Scopes are `openid`, `email`, `profile`, Calendar readonly, in that order. | `GOOGLE_DESKTOP_SCOPES` contains the same four ordered values. | Matched. |
| `launchUrl(..., LaunchMode.externalApplication)` opens the system browser. | Electron main passes the exact generated URL to `shell.openExternal`; the renderer cannot supply or open an arbitrary URL. | Matched. |
| Callback writes a close-window page, then rejects `error`, state mismatch, or missing/empty code in that order. | Main-process listener writes the same success/failure copy and `validateGoogleCallback` uses the same rejection order. Error text is HTML-escaped before display. | Matched, with output escaping only. |
| POSTs `{code, codeVerifier, redirectUri}` to `https://api.vcrcapps.com/auth/google/desktop-exchange`; expects 200 and `{sessionToken,user}`. | Main-process exchange uses the same hosted API default, route, JSON keys, 200 requirement, and response shape. | Matched. |
| Callback wait times out after five minutes and the server closes in `finally`. | Default timeout is `300000` ms; `runDesktopGoogleOAuth` closes the server in `finally` after success, rejection, open failure, or timeout. | Matched. |
| `GOOGLE_DESKTOP_CLIENT_ID` is a Dart compile-time define. | `package-mac.mjs` generates the packaged main-process `build-config.mjs` from the same `GOOGLE_DESKTOP_CLIENT_ID` build environment value. Source config is intentionally empty. | Matched. |
| `AuthSessionStore` supplies `Authorization: Bearer <sessionToken>` after login. | The renderer receives `{sessionToken,user}` through one frozen IPC capability and composes the existing live gateway with that token at runtime. | Matched for the requested runtime bearer. |
| Flutter persists the token in Keychain and restores it on later app launches. | This unit keeps the returned token in renderer runtime memory; no persistence surface was requested or introduced. A later app launch is signed out unless the TEST-ONLY override is present. | Deliberate difference: persistence was outside the stated build/test contract. |

## Signed-out and test-only behavior

- Explicit live mode without a bearer renders `Sign in to Rhythm` and `Continue with Google`; no
  `GatewayProvider`, `FixtureProvider`, navigation, sessions, or application data mounts.
- `window.rhythmShell.auth.signInWithGoogle()` is the only new renderer capability. It takes no URL,
  token, client ID, or arbitrary IPC input.
- `VITE_RHYTHM_LIVE_TOKEN` and the existing preload `RHYTHM_LIVE_TOKEN` remain supported solely as
  the existing TEST-ONLY automation override. The source comment labels that path explicitly.
- The returned production token is held in memory, used to compose task/session bearer headers, and
  is never logged or written by the build.

## RED captured before implementation

Command:

```bash
cd apps/web
npx playwright test --config tests/post-m1-auth-playwright.config.ts --list
```

Verbatim output (exit 1):

```text
Error: Cannot find module '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/src/google-oauth-core.mjs' imported from /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/web/tests/post-m1-auth-oauth.redspec.ts
Listing tests:
Total: 0 tests in 0 files
```

Playwright execution was prohibited, so assertion-level RED could not be observed in this unit.

## Files

- `apps/electron/src/google-oauth-core.mjs` and `.d.mts`
- `apps/electron/src/desktop-google-oauth.mjs` and `.d.mts`
- `apps/electron/src/build-config.mjs`
- `apps/electron/src/main.mjs`, `preload.cjs`, `policy.mjs`
- `apps/electron/scripts/package-mac.mjs`
- `apps/electron/test/google-oauth.test.mjs`, `electron-shell.test.mjs`,
  `electron-unsigned-package.test.mjs`
- `apps/web/src/gateway/auth.tsx`, `apps/web/src/main.tsx`
- `apps/web/tests/post-m1-auth-oauth.redspec.ts`
- `apps/web/tests/post-m1-auth-session.redspec.ts`
- `apps/web/tests/post-m1-auth-playwright.config.ts`
- `docs/ai/contracts/issue-2010.json`
- `docs/ai/project-state.md`
- This run note.

Covered file touched: `apps/web/src/main.tsx`. Its manifest hash is
`c1b7b8aec413b8322accacd97421bd662f2562c83046e39604eefc246e4de103`; current hash is
`8b3f10f6682751cc5f921d670efec3035ac7b22751bde49c77a80e2e9f539887`. Per instruction,
`apps/web/SHA256SUMS` and `apps/web/PROVENANCE.md` were not edited.

## Checks

- PASS — `npm --prefix apps/web run typecheck`
- PASS — `npm --prefix apps/electron run typecheck`
- PASS — `node --test apps/electron/test/google-oauth.test.mjs` (5/5; exercises criteria c1–c8)
- PASS — `npm --prefix apps/web run build` (1,631 modules; bundle-size warning only)
- PASS — `node --check` on Electron main, OAuth core/host, and package script
- PASS — every Playwright config collected with `--list`; auth config collected 9 tests in 2 files
- PASS — production source/web-dist scan found no client-secret, private-key, literal bearer, or
  concrete Google client-ID pattern. The package script only writes the public build-time client ID.
- PARTIAL — GitNexus `detect_changes --scope compare --base-ref main` reported MEDIUM risk from 15
  pre-existing tracked files (API/docs); it does not include the untracked web/electron trees.
- NOT RUN — Playwright execution, screenshot, Electron source/package smoke, `package:mac`, and real
  Google consent, all explicitly prohibited for this unit.

Branch/SHA checked: `codex/react-electron-live-suite` at
`9d8c4443f076756cec919e182222fdb45c39abcc` with uncommitted work.

## Orchestrator commands

Use the same already-provisioned public client ID that Flutter release builds receive; do not paste
or commit it into source.

```bash
cd /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/web
npm run typecheck
npm run build
npx playwright test --config tests/post-m1-auth-playwright.config.ts

cd /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron
npm run typecheck
node --test test/google-oauth.test.mjs
GOOGLE_DESKTOP_CLIENT_ID="$GOOGLE_DESKTOP_CLIENT_ID" npm run package:mac
node --test test/electron-shell.test.mjs
node --test test/electron-unsigned-package.test.mjs
```

Then manually launch the packaged app under the orchestrator-owned GUI path, confirm the signed-out
screen, complete one real Google consent with the existing desktop client, verify the system browser
returns the user to Rhythm with live data, and inspect the packaged tree for secret/private-key/bearer
patterns. Do not run the real-consent step in automation or record the returned token.
