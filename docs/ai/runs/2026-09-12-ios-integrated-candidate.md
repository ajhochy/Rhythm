---
date: 2026-09-12
repo: Rhythm
branch: feature/ios-end-to-end
pr: null
issues: [ios-account-connect-A1, ios-chat-integration, ios-mobile-ui, ios-secure-bootstrap-b1]
status: ready_for_verification
tags: [run, Rhythm]
---

# iOS integrated candidate

WAIVED: this request mechanically assembles already-implemented, already-contracted slices and verifies/builds their union without planned behavior changes; verification is the four existing executable contracts plus the required API/mobile/sandbox/native build gates, with final native/Cloudflare behavior left not_tested.

## Files

- Mechanically copied the complete tracked and untracked backend diff from
  `feature/ios-secure-bootstrap` at `0bc46a5e` into the target at the same base
  commit. Every copied backend file was byte-identical after transfer; the
  source worktree remained unchanged.
- Preserved the existing account/chat/UI mobile union. One integration-only
  test repair changed `apps/mobile/tests/issue-1175-adversarial-review.test.mjs`
  so its legacy QR-pairing source guard stops at the new authenticated
  `connectCloudDevice` method boundary instead of scanning that separate method.
- Verification repair changed the relay grant to canonical
  `{environmentId,hostId,deviceId,deviceToken,gatewayBaseUrl}` and extracted the
  mobile grant parser so the backend HTTP contract executes the real mobile
  parser. No response alias was retained; Device authentication is unchanged.
- Added React/Jest behavior coverage for A→B→A route identity, stale
  equal-length history, session-keyed concurrent drafts, and failed-send/newer
  typing preservation. Existing React tests cover refresh-error-with-data and
  restoring/signed-out/signing-in/error auth states.

## Checks

- Identity: target path/branch `rhythm-ios-integration` /
  `feature/ios-end-to-end`; source path/branch `rhythm-ios-backend` /
  `feature/ios-secure-bootstrap`; both `HEAD` and merge-base were `0bc46a5e`.
- `git diff --check` — PASS. Final `git diff --name-status` had no deletions;
  final tracked numstat was reviewed and matched the two source slices plus the
  one-line test repair.
- Workflow `check_pr_scope.sh` `classify_path` rules applied to the exact
  tracked+untracked working-tree list: backend 12, mobile currently classified
  as `other` 36, docs 10, tools 3.
- GitNexus pre-edit: LOW/MEDIUM only; `MobilePairingService` and
  `MobileDevicesRepository` were MEDIUM with 6 direct dependents each and no
  affected processes. Final `detect_changes(scope=all)`: MEDIUM, 110 indexed
  symbols, 42 indexed changed files, 4 affected processes (`Pair →
  PairedHostError` and three existing `createMobileGatewayRouter` diagnostic
  flows). No HIGH/CRITICAL result.
- Post-repair `detect_changes(scope=all)`: MEDIUM, 117 indexed symbols, 45
  indexed changed files, and the same four affected processes. The additional
  contract/parser/scanner repairs introduced no new affected process.
- API first build/focused attempt could not resolve local dependencies. Ran
  lockfile-consistent root `npm ci`; no manifest/lock diff remained.
- `npm run build` (`apps/api_server`) — PASS.
- Focused API bootstrap/relay compatibility — PASS: 57 passed, 1 env-gated
  skip across 10 files.
- `bash -n tools/dev/sandbox.sh tools/dev/sandbox_guard_test.sh
  tools/dev/sandbox_dual_role_test.sh` — PASS.
- `bash tools/dev/sandbox_guard_test.sh` — PASS: 18/18.
- `bash tools/dev/sandbox_dual_role_test.sh` — PASS: 5/5.
- First live sandbox launch failed closed before process start because fork
  dependencies lacked `@opentui/solid/preload`; cleanup removed the sandbox and
  left all four ports free. `bunx bun@1.3.13 install --no-save` restored the
  lock-declared fork dependencies.
- Managed retry used only `tools/dev/sandbox.sh` with
  `RHYTHM_SANDBOX_RELAY=1`, local API `4198`, engine `4197`, gateway `4199`,
  relay `4200`, and the read-only synthetic fixture. `up`/`status` passed;
  `RHYTHM_LIVE_E2E=1 ... ios_secure_bootstrap_live_e2e.test.ts` passed 1/1,
  observing relay discovery/connect, Device grant, health, and tunneled local
  `/projects`. `down` removed the sandbox; ports `4197`–`4200` were free and
  source hashes remained DB
  `7ff4dad70124923eee01ff0e1f96a5be528274d4bf2fddcdaa870534f47026ed`,
  config `7c816ae4512fcc8667fa479b3d3ddb49d6f9aaf9dacc9acf9b550b76705f1b22`.
  The fork build's temporary `bun.lock` resolution change was restored.
- Mobile dependencies were already lock-consistent (`npm ls --depth=0`); no
  mobile install ran.
- Mobile `npm run lint` — PASS with 3 unchanged warnings and 0 errors;
  `npm run typecheck` — PASS.
- Initial `npm run test:ci:static` exposed the legacy QR source-guard boundary
  failure described above. The focused security test then passed 7/7 and the
  complete static suite passed on rerun.
- Full Jest in-band — PASS: 29 suites, 110/110 tests.
- Fake server self-test, `contract:check`, and `test:contract` — PASS.
- Account focused contract — PASS: 8/8. Chat contract command — PASS: 15/15.
  UI source contract — PASS: 5/5. Focused UI Jest — PASS: 24/24.
- Repair verification: full mobile static gate PASS normally (3 unchanged
  warnings, 0 errors); full Jest PASS 30 suites / 112 tests. Focused API
  compatibility PASS 55 / 1 env-gated skip; API build PASS. Cross-stack
  bootstrap contract PASS 7/7. Sandbox guard PASS 18/18 and dual-role lifecycle
  PASS 5/5.
- Playwright web E2E — not run: `playwright.config.mjs` starts its own fake and
  static web servers outside the managed sandbox lifecycle. Native React/Jest,
  exact installed-artifact parity, and Simulator screenshots cover the
  predeployment native surface without claiming the browser gate or live flow.
- Xcode 26.5 (`17F42`) and the requested shutdown iPhone 16 Pro iOS 18.6 UDID
  `B14605E1-0E6B-450C-A728-065717738242` are available. The manager booted,
  installed, and launched the exact candidate on that iOS 18.6 device and iOS
  26.5 device `280561D9-A545-4801-BD7D-94A1D1EDC62D` for evidence capture.
- Latest signed Release simulator artifact:
  `apps/mobile/ios/build/Build/Products/Release-iphonesimulator/RhythmAgents.app`
  (58,876 KiB) passed `codesign --verify --deep --strict`; its `main.jsbundle`
  SHA-256 is `edb84fe58a5ae80763464700648c5db09c5a05985a6bcefe5b69a0b7f1f86e43`
  and executable SHA-256 is
  `7106928ffb90d66522cff224d7e0880250c8e51d4a33dfa21db97e6b11fb0992`.
  It uses the hosted mobile-login broker and requires no native Google client
  ID or redirect URI. Its Info.plist registers `rhythmagents`, contains no
  `com.googleusercontent.apps.*` scheme, and the artifact scan found no native
  Google OAuth client ID. Manager independently verified that the installed
  `main.jsbundle` and executable on iOS 26.5
  (`280561D9-A545-4801-BD7D-94A1D1EDC62D`) and iOS 18.6
  (`B14605E1-0E6B-450C-A728-065717738242`) exactly match these candidate hashes.
  Fresh screenshots from both booted Simulators show the same nonblank sign-in
  surface; this visual check does not establish Google, bootstrap, or chat
  behavior.
- Bundle provenance: `localhost:8081` is React Native `getDevServer`;
  `localhost:4096` is the generated
  `@opencode-ai/sdk` default client while app-owned `buildClient` always supplies
  an explicit production/paired base URL; `localhost:3000` is Expo Router's RSC
  missing-origin fallback. Production config now supplies the approved
  `https://api.vcrcapps.com` router origin, and the scanner rejects any unknown
  localhost provenance rather than globally waiving these strings. Development
  keeps its explicit local engine for manual pairing.
- Prior `invalid_client` observations belong to the superseded direct-native
  Google flow and do not establish acceptance for this hosted-broker artifact.
  No screenshot content or private identifiers are recorded.
- Production `/relay/mobile-environments` remains 404 because the candidate is
  undeployed. No deploy or production mutation was attempted.
- Manager canonical bootstrap re-verification used only
  `tools/dev/sandbox.sh` on engine `4397`, API `4398`, gateway `4399`, and relay
  `4400` — PASS: 1/1. It observed relay discovery/connect `gatewayBaseUrl`,
  Device authentication, and `/projects`; scoped down released all four ports
  and source fixture hashes remained unchanged. The sandbox-generated fork
  lock drift was restored byte-for-byte to `HEAD`.

## Notes

- No commit, push, deploy, production mutation, credential use, or additional
  Simulator interaction beyond evidence capture is authorized.
- Native UI beyond the observations above, actual successful
  Cloudflare/Synology bootstrap, Google OAuth completion,
  VoiceOver/contrast/keyboard, app performance, and final live chat open/send
  remain `not_tested` and mandatory. No success claim is inferred from opening
  Google UI.
- Required verification/deployment configuration: the hosted API retains its
  working Google web client ID/secret and exact HTTPS callback
  `https://api.vcrcapps.com/auth/google/callback`; Cloudflare routes
  `/auth/google/mobile-begin`, `/auth/google/callback`, and
  `/auth/google/mobile-redeem` to that same API process; approved hosted API
  origin `https://api.vcrcapps.com`; E2E mode and E2E server URL unset; no
  seeded account/device/pairing credential; deployed relay/API containing
  `/relay/mobile-environments`; durable enrolled
  `(host_id,user_id)` and matching Google subject/email identity binding. EAS
  authentication is required only if the release preflight itself must pass;
  no submit/deployment is authorized. Real Google, Cloudflare/Synology,
  VoiceOver/contrast/keyboard, performance, and live chat acceptance remain
  manager-owned and untested.
