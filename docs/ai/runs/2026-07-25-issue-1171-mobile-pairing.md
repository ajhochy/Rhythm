---
date: 2026-07-25
repo: Rhythm
branch: codex/mobile-1171-pairing-ui
pr: null
issues: [1171]
status: review-pending
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #1171 — desktop-to-iPhone pairing

## Files changed

- Added a shell-free Tailscale Serve diagnostic/configuration service and
  authenticated mobile-access routes.
- Added the desktop Flutter Mobile Access dialog, minimal one-time QR,
  replacement/revocation controls, and actionable diagnostic states.
- Added the iOS pairing route, paired-host provider/store, Keychain-only device
  token handling, compatibility gate, independent Paired Mac settings card, and
  all required connection states.
- Added API, Flutter, mobile, executable contract, and live sandbox tests.

## Checks run

- `node tests/contract/issue-1171.mjs` — pass.
- `cd apps/api_server && npm run build` — pass.
- `cd apps/api_server && npx vitest run src/services/__tests__/tailscale_serve_service.test.ts`
  — 6/6 pass.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1
  RHYTHM_LIVE_URL=http://127.0.0.1:41171
  RHYTHM_LIVE_DB_PATH=/tmp/rhythm-issue1171-sandbox-0725/rhythm.db
  RHYTHM_SANDBOX_API_PORT=41171
  RHYTHM_LIVE_SERVER_LOG=/tmp/rhythm-issue1171-sandbox-0725/api_server.log
  npx vitest run src/__tests__/issue_1171_mobile_access_live.test.ts` — 1/1
  pass against freshly built api_server + fork engine. It observed unauthenticated
  rejection, diagnostic state, compatibility preflight, exact two-field QR
  payload, one-time exchange, hashed-at-rest code, device health, and revocation.
- `cd apps/mobile && npm run test:app-config && npm run test:paired-host &&
  npm run typecheck && npm run lint` — pass; paired-host suite 11/11.
- `cd apps/mobile && RHYTHM_REPO=/Users/ajhochhalter/Documents/Rhythm
  npm run verify:foundation` — pass, including 22 account tests, 5 OAuth tests,
  11 pairing tests, persistence/fake-server/#1167 suites, and Playwright 15/15.
- `cd apps/desktop_flutter && dart format . --set-exit-if-changed` — pass.
- `cd apps/desktop_flutter && flutter analyze --no-fatal-infos` — exit 0 with
  273 pre-existing infos.
- `cd apps/desktop_flutter && flutter test
  test/features/agents/mobile_access_dialog_test.dart` — 8/8 pass.
- `cd apps/desktop_flutter && flutter test` — 997/997 pass.
- `cd apps/desktop_flutter && flutter build macos --debug` — pass.
- `codesign --verify --deep --strict --verbose=2
  apps/desktop_flutter/build/macos/Build/Products/Debug/Rhythm.app` — valid
  Apple Development signature, identifier `org.visaliacrc.rhythm`.
- `xcodebuild -workspace ios/RhythmAgents.xcworkspace -scheme RhythmAgents
  -configuration Release -sdk iphonesimulator
  -destination 'platform=iOS Simulator,id=C862B1B9-3AFF-4806-BE1C-B4FBDEE4833F'
  -derivedDataPath /tmp/rhythm-issue1171-derived-data
  CODE_SIGNING_ALLOWED=NO build` — pass; Expo Camera, Network, and SecureStore
  linked in the native product.
- The Release iOS simulator app installed and launched. Deep links to
  `rhythmagents:///pair` and `rhythmagents:///settings` rendered the Pair a Mac
  gate and independent Paired Mac card without blank/crashed surfaces.
  Screenshots: `/tmp/rhythm-issue1171-pair.png` and
  `/tmp/rhythm-issue1171-settings.png`.

## Notes

- The raw `npm run verify:foundation` from this reviewed base stops before tests
  because this base's vendored OpenAPI input computes fingerprint
  `4d4e...`, while its checked-in mobile manifest and the current coordinator
  source use the accepted #1166–#1169 fingerprint `fd0aae...`. Pointing the
  gate at the coordinator's identical reviewed protocol source makes every
  foundation test pass. No protocol fingerprint was weakened or regenerated.
- The full API suite ran twice. The issue #1171 tests passed, while unchanged
  issue #723 code deterministically failed `addMcp` under Vitest because its
  `new Function(... import ...)` path has no VM dynamic-import callback.
  A load-sensitive telemetry `<20ms` assertion also failed in one aggregate
  run and passed in isolation. Final aggregate counts were 3244 passed,
  2 failed, 64 skipped; neither failing file or symbol differs from base.
- The first Xcode MCP build transport closed during a long native build and
  the simulator attempted an unavailable iOS 18.6 data migration. Direct
  `xcodebuild` against the booted iOS 18.3 simulator then passed. Regenerable
  partial DerivedData and fork dependency caches were removed after disk
  pressure; no source or user data was removed.
- Desktop product launch was intentionally not used because the shipping app
  hardcodes/spawns protected port 4001. Its UI contract was exercised through
  eight widget tests, and the real macOS product was built and signature
  verified.
- Independent security/accessibility review is intentionally performed against
  the immutable commit by the coordinator after this branch is committed.
