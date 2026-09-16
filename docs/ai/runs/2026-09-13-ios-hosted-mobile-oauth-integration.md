---
date: 2026-09-13
repo: Rhythm
branch: feature/ios-end-to-end
pr: null
issues: [ios-hosted-mobile-oauth]
status: ready_for_verification
tags: [run, Rhythm]
---

# iOS hosted mobile OAuth integration

## Files

- Acceptance contract: `docs/ai/contracts/ios-hosted-mobile-oauth.json`
- Acceptance test: `apps/mobile/tests/contract/ios-hosted-mobile-oauth.test.mjs`
- Mechanically imported the full eight-file source OAuth diff from `rhythm-ios-oauth` at `0bc46a5ece1a937c484c0054493c75b0299eafef`; all source/target SHA-256 pairs matched immediately after copy.
- Added `hosted-mobile-oauth.ts`, replaced the unused direct native Google helper, changed the existing session-store exchange to exact hosted redeem, and removed native client/redirect configuration from app config and release gates.
- Updated only OAuth/account/release tests needed by the changed contract. Existing relay/chat implementation was not changed in this stage.

## Checks

- **Expected failing contract (before implementation):** `cd apps/mobile && node --test tests/contract/ios-hosted-mobile-oauth.test.mjs`
  - Result: exit 1; 9 tests, 2 passed, 7 failed.
  - Failure mechanism: hosted helper was absent, provider still called native-client OAuth, and release preflight still required native client/redirect variables.
- **GitNexus pre-edit impact:** `AuthController` LOW (1 direct, 13 total); `googleCallback` LOW (0); `GoogleOAuthService` LOW (3 direct, 24 total); `verifyMobileIdToken` LOW (1 direct, 2 total); `RhythmAccountProvider` LOW (1 direct); `startGoogleMobileOAuth` LOW (1 direct); `RhythmSessionStore` MEDIUM (7 direct, 40 total); `signIn` LOW (0). No HIGH/CRITICAL result and no affected process was reported for this stage.
- **API build/focused security:** `npm run build && npx vitest run src/__tests__/ios_hosted_oauth_backend.test.ts src/__tests__/google_mobile_oauth_security.test.ts src/__tests__/google_step_up_scopes.test.ts` — PASS 40/40.
- **API full suite:** `npm test` — PASS 6,092; skipped 233; 653 files passed, 125 skipped. The OAuth source run had previously recorded one unrelated `workflow_failure_signal_extractor.test.ts:764` failure; its exact isolated test passed 63/63 in this run, so the prior result is classified as intermittent baseline and no unrelated product patch was made.
- **Mobile static gate:** `npm run test:ci:static` — PASS; lint exits 0 with three pre-existing warnings. `npm run typecheck` — PASS.
- **Mobile Jest:** `npm test -- --runInBand` — PASS 112/112 across 30 suites.
- **Focused mobile:** hosted OAuth, Rhythm account (25 scenarios), app config, transport clients, account sign-in Jest, issue-1175 security, and the hosted mobile acceptance contract all PASS. Final contract: 9/9 test entries green; C9 remains explicitly manual/UNVERIFIED.
- **Sandbox guards:** `sandbox_guard_test.sh` PASS 18/18; `sandbox_dual_role_test.sh` PASS 5/5.
- **Canonical dual-role sandbox:** only `tools/dev/sandbox.sh` was used with sanitized read-only fixture `/private/tmp/rhythm-ios-bootstrap-fixture-20260912-2249`, API `:4398`, engine `:4397`, gateway `:4399`, relay `:4400`, fake Google `:4401`, and sandbox `/private/tmp/rhythm-ios-hosted-oauth-integration`.
  - Canonical relay bootstrap live test PASS 1/1.
  - Hosted begin → fake-Google callback → deep link → redeem → replay-denial live test PASS 1/1.
  - `down` removed the sandbox; all five ports are free. Sandbox-generated fork lock drift was replaced byte-for-byte from the clean source baseline (`b67a631d...`).
- **Release verification:** authenticated `release-preflight-ios.mjs` PASS with production origin, E2E unset, and both native Google variables absent. `verify-production-bundle.mjs` PASS after recognizing only the already-approved inert Expo Router and generated SDK localhost defaults while requiring the embedded production origin and explicit SDK client base URL.
- **Signed iOS 26.5 simulator build:** Xcode 26.5 (`17F42`), iPhone 17 Pro iOS 26.5 destination, Release configuration, E2E unset, no native Google variables. Clean Expo prebuild removed the stale native Google URL scheme; CocoaPods required `LANG/LC_ALL=en_US.UTF-8`. Final `xcodebuild` PASS.
  - Artifact: `apps/mobile/ios/build/Build/Products/Release-iphonesimulator/RhythmAgents.app` (58,876 KiB), ad-hoc `Sign to Run Locally`, `codesign --verify --deep --strict` PASS.
  - Hermes bundle SHA-256: `edb84fe58a5ae80763464700648c5db09c5a05985a6bcefe5b69a0b7f1f86e43`.
  - Executable SHA-256: `7106928ffb90d66522cff224d7e0880250c8e51d4a33dfa21db97e6b11fb0992`.
  - Info.plist registers `rhythmagents` and contains no `com.googleusercontent.apps.*` scheme; artifact scan found no native Google OAuth client ID.
- **Final scope:** `git diff --check` PASS. GitNexus `detect_changes(scope=all)` reports MEDIUM for the pre-existing integrated candidate: 154 indexed changed symbols, 55 files, four existing pairing/gateway processes. No new HIGH/CRITICAL finding.

## Notes

- Post-verification reconciliation (`6ac19d1b`): hosted API candidate
  `9c027b52` is deployed, and manager-observed real hosted Google OAuth
  completed and returned the app to Chats. Actual environment connection, chat
  read, and one designated send remain `not_tested`.
- Manager installed the refreshed artifact over the existing iOS 26.5 app.
  Installed `main.jsbundle` parity passed for SHA-256 `8ba5de77…`; candidate
  executable SHA-256 is `baaf79cc…`. Although the Simulator data-container path
  changed, the app reopened authenticated to Chats without another login,
  demonstrating that the Google session persisted in SecureStore.
- The relay candidate was rolled back after Mac reconnect was not confirmed.
  Current state is the old relay reporting `macOnline`; matching desktop
  installation and a relay update remain required. No desktop lifecycle
  operation is authorized in this reconciliation.
- Source worktree verified at `rhythm-ios-oauth` on `feature/ios-hosted-oauth`; target verified at `rhythm-ios-integration` on `feature/ios-end-to-end`.
- The implementation run authorized no production, Google, Cloudflare, Synology, or live chat operation; the later manager evidence recorded above is reconciliation only.
- Mobile route sequence: `RhythmAccountProvider` → local 256-bit verifier/state + S256 challenge → ASWebAuthenticationSession `GET https://api.vcrcapps.com/auth/google/mobile-begin` → existing web Google OAuth/callback → exact `rhythmagents://oauth/callback?code=<opaque>&state=<same>` → strict callback validation → one `POST /auth/google/mobile-redeem` with exactly `{code,codeVerifier}` → validate `{sessionToken,user}` → existing SecureStore persistence.
- Cancellation restores the provider's prior signed-in state; sign-out/account switch and a newer login operation invalidate stale completion. HTTP 409/replay/expiry is surfaced as “Start a fresh login”; the non-idempotent redeem is never retried.
- Deployed configuration: hosted API candidate `9c027b52` runs these routes and broker in the single hosted API process; retain the working web Google client ID/secret and exact HTTPS callback `https://api.vcrcapps.com/auth/google/callback`; keep Cloudflare forwarding begin/callback/redeem to that same process and preserve authorized/preprovisioned user policy. No schema or database rollout is required.
- Accepted later by manager evidence: real hosted Google login returned the app to Chats, the refreshed artifact was installed with bundle parity, and the authenticated session persisted. Still not accepted: matching desktop installation, relay candidate/reconnect, environment discovery, chat read, and the designated real chat send.
