# Rhythm — Project State

## Focus and branches

Acceptance follow-up for draft [PR #1544](https://github.com/ajhochy/Rhythm/pull/1544), branch `mega/2026-09-18-mobile-electron-hermes`, and draft [fork PR #17](https://github.com/ajhochy/hermes-rhythm-plugin/pull/17), branch `mega/2026-09-18-rhythm-plugin-finish`. Neither is merged or deployed. Qualification-only signing is prepared separately from publication.

## Current evidence

- Public desktop OAuth configuration and authorized test bearer found; bearer used only in process memory. Flutter-owned API4001/engine4096 are healthy and preserved.
- Global campaign-prefix absence verified in all six hosted collections (HTTP200, zero matches); Google Calendar/Gmail both connected, needsReauth false. An M3 attempt exposed a legacy integration overwrite and was stopped; existing grants were restored and verified. New API/client login-only capability prevents a repeat. Production still has the older API.
- Hermes fixed native candidate mounts and rejects unsupported login before browser launch. Running backend Rescan removes removed plugin registrations and route; final disk-list cleanup also passed in the same running candidate. Installed Hermes remains open and unchanged.
- Hosted browser: **7 passed /22 failed /5 skipped**, primarily disallowed browser origin. Native attach harness selects12 tests but remains unrun at native auth boundary. Atomic paused Automation API roundtrip passed and cleaned up. Messages safely skipped on deployed API; new creator-scoped cleanup passed real isolated API/engine sandbox1/1.
- Web **460 passed /47 skipped**, Electron slices **155 passed /4 skipped**, Electron **176/176**, mobile **32 suites/133 tests**, all required typecheck/build/lint/contract gates passed (3 existing mobile warnings).
- API full **6185 passed /251 skipped /1 timeout failure**; exact failed PTY file then **2/2**, recorded as flake. Focused OAuth **9/9** and real login-only capability/rejection sandbox **1/1**. Fork final scoped tests **296/296**, packaging **62/62**, loader/settings **19/19**; earlier M10 timing failures retained, thresholds unchanged.

## Blocking acceptance

Nine authenticated native brief steps remain blocked by encrypted Keychain persistence and the final client's required undeployed login-only endpoint. M3 hosted reads, actual ACP deny/allow/read-back, unsent draft and nonempty zero-write trace remain open. Finder/Get Info pass for the ad hoc candidate; signed/notarized installed Dock/Command-Tab remain separate. Physical #1510 audio, matched comfort acceptance, TestFlight/device and deployed image/off-LAN checks remain open. The signed iOS development build reached EAS but could not schedule: no suitable internal-distribution credentials. Paired iPhone was locked; relay health became macOnline true but does not prove the phone path. Bundled Hermes release remains NO-GO.

## Evidence

[Follow-up and decisions](runs/2026-09-19-mega-acceptance-followup.md), [hosted writes](runs/2026-09-19-hosted-write-gaps.md), [release/device gates](runs/2026-09-19-device-release-preflight.md), [native table](../../.proof/mega-2026-09-18/VISUAL-SMOKE.md). Current PR and qualification workflow checks supersede historical September18 counts. Preserve installed apps/services, existing profiles/auth, and unrelated fork deletions.
