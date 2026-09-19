<!-- Current local repair: 2026-09-19 -->
> Signed local repair now starts API/engine and opens the authenticated workspace; user accepted local behavior. Fresh Electron checks: 177 passed, typecheck passed; focused OAuth API: 5 passed. Fresh mega-branch package c92c7544 is open as Rhythm Mega.app with Hermes Ready and dashboard loaded; 22 package checks passed, one live check skipped. Pending approvals/decisions load notices remain. Full campaign and approval-flow qualification remain open. See [startup repair](runs/2026-09-19-electron-runtime-startup-repair.md). Repairs pushed to draft PR #1544.

# Rhythm — Project State

## Recent coding-agent runs

### 2026-09-19 — restore original desktop Google login
- Files modified: Electron OAuth client/core/tests and sign-in copy; API auth routes/controller, Google token persistence and tests; auth-session restore. See [run record](runs/2026-09-19-desktop-login-revert.md).
- Checks run: Electron 174 passed; focused API 5 passed; Electron/web typecheck and API build passed; `ai-workflow checks --level issue` passed.
- Decisions made: remove the unrequested login-only protocol and restore the pre-`aa07b491` desktop login behavior without changing Messages or Automations.
- Deviations from spec: none.
- Concerns: old deployed exchange can replace existing Google integration tokens; installed Electron remains blocked by the native signer. A local source launch persisted a hosted session; subsequent read-only hosted check found Calendar and Gmail connected, no reauthorization needed, with the same seven scopes as before.

## Focus and branches

Acceptance follow-up for draft [PR #1544](https://github.com/ajhochy/Rhythm/pull/1544), branch `mega/2026-09-18-mobile-electron-hermes`, and draft [fork PR #17](https://github.com/ajhochy/hermes-rhythm-plugin/pull/17), branch `mega/2026-09-18-rhythm-plugin-finish`. Neither is merged or deployed. Final implementation source `70bcf2c9` is verified; qualification-only signing is separate from publication. Later commits record evidence only.

## Current evidence

- Public desktop OAuth configuration and authorized test bearer found; bearer used only in process memory. Flutter-owned API 4001/engine 4096 are healthy and preserved.
- Global campaign-prefix absence verified in all six hosted collections (HTTP 200, zero matches); Google Calendar/Gmail both connected, needsReauth false. An M3 attempt exposed a legacy integration overwrite and was stopped; existing grants were restored and verified. New API/client login-only capability prevents a repeat. Production still has the older API.
- Hermes fixed native candidate mounts and rejects unsupported login before browser launch. Running backend Rescan removes removed plugin registrations and route; final disk-list cleanup also passed in the same running candidate. Installed Hermes remains open and unchanged.
- Hosted browser: **7 passed /22 failed /5 skipped**, primarily disallowed browser origin. Native attach harness selects 12 tests but remains unrun at native auth boundary. Atomic paused Automation API roundtrip passed and cleaned up. Messages safely skipped on deployed API; new creator-scoped cleanup passed real isolated API/engine sandbox 1/1.
- Web **460 passed /47 skipped**, Electron slices **155 passed /4 skipped**, Electron **176/176**, mobile **32 suites/133 tests**, all required typecheck/build/lint/contract gates passed (3 existing mobile warnings).
- Final-source Server CI **6185 passed /253 skipped /0 failed**, Postgres bootstrap/build/API smoke/safety smoke passed. Fork CI passed generated SDK currency. Mobile CI passed: 70 passed/1 skipped/1 flaky, known issue #1174 retry. Earlier local API PTY timeout and fork M10 timing failures remain recorded. Focused OAuth **9/9**, login-only sandbox **1/1**; fork scoped **296/296**, packaging **62/62**, loader/settings **19/19**.
- Final-source ARM and Intel qualification signed/notarized and passed packaged smoke. Both downloaded bundles pass local codesign/Gatekeeper/stapler, source identity and all 10 icon artwork hashes. Installed signed Finder/Get Info pass; exact signed app safely rejects undeployed login before browser. Both qualification jobs succeeded and skipped release publication.

## Blocking acceptance

Nine authenticated native brief steps remain blocked by encrypted Keychain persistence and the final client's required undeployed login-only endpoint. M3 hosted reads, actual ACP deny/allow/read-back, unsent draft and nonempty zero-write trace remain open. Signed installed Finder/Get Info now pass. Dock control timed out and held Command-Tab could not be inspected; both surfaces and their complete normal/Retina visual matrix remain open. Physical #1510 audio, matched comfort acceptance, TestFlight/device and deployed image/off-LAN checks remain open. The signed iOS development build reached EAS but could not schedule: no suitable internal-distribution credentials. Paired iPhone was locked; relay health became macOnline true but does not prove the phone path. Bundled Hermes release remains NO-GO.

## Evidence

[Final-source qualification](runs/2026-09-19-final-source-qualification.md), [follow-up and decisions](runs/2026-09-19-mega-acceptance-followup.md), [hosted writes](runs/2026-09-19-hosted-write-gaps.md), [release/device gates](runs/2026-09-19-device-release-preflight.md), [native table](../../.proof/mega-2026-09-18/VISUAL-SMOKE.md). Current PR and qualification workflow checks supersede historical September 18 counts. Preserve installed apps/services, existing profiles/auth, and unrelated fork deletions.
