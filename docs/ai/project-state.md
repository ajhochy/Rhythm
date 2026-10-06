# Project state

## Current focus

Resume of the 2026-10-06 pause on one integration branch: `integration/2026-10-06-resume` → draft PR https://github.com/ajhochy/Rhythm/pull/1604 (orchestrator run log: `docs/ai/runs/2026-10-06-resume-orchestration.md`, ownership map `2026-10-06-resume-ownership-map.md`). Supersedes the mega #1598 section below for day-to-day state; #1598 remains the parent lineage.

## Active branch / PR

`integration/2026-10-06-resume` (draft PR #1604 against `main`). Carries the Oct 1–6 local lineage (6e339972 → 5b81e7b9 → 65fe0338) plus: native Dayflow packaging/signing/verifier, accepted calendar + chat-settings-wire + Research-gateway packets, router calibration instrument fix, fork guard repair, mobile packets U/R/Rt/S/A/B + proxy thinking/Fast forwarding + transition test + jest in mobile CI, desktop workflow issuance + web unit CI, G2 S2/S4/S7 (admission repair, callback anchor/membership/capacity/usage, capability item), regenerated fork SDK + mobile contract pins, Postgres `agent_sessions` parity.

## Installed / running

AJ's normal profile was relaunched 2026-10-06 14:22Z on the integrated candidate built from f29523d0 (`~/Documents/Rhythm-pr-worktrees/integration-20261006/apps/electron/dist/Rhythm.app`, sign-only, not notarized; receipts under `~/Documents/Codex/2026-10-06/fable-integrated-desktop-build/`). Native Dayflow attached and rendering (onboarding first; needs AJ to complete it for the Timeline and the 16-screen matrix). Launch env adds `RHYTHM_NATIVE_DAYFLOW_DATA_ROOT=~/Library/Application Support/Rhythm Electron/native-dayflow` (profile path too long for the socket).

## In progress

- G2 S5 (checked result, next ordinal, reconciliation, status text, S4/S7 wiring) on `slice/g2-s5-checked-result`.
- TestFlight 1.0.9 (21) EAS production build with auto-submit (receipts under `~/Documents/Codex/2026-10-06/fable-testflight-build/`).
- CI on PR #1604 (Server CI / Mobile CI / Desktop CI for f29523d0 pending at time of writing).

## Risks / known issues

- G2 live loop (goal → real worker → result → next step in the normal app) is source-ready with tests, not live-proven; S8 bounded live check not run.
- Research B screen captures: fixture pairing bootstrap fails (artifact issue), no PNGs.
- Phone build without the Mac update degrades chat settings to "older API unavailable"; the Mac is updated, keep it that way.
- Routing: Kev vs Qwen3-4B comparison done (`docs/ai/runs/2026-10-06-routing-comparison-kev-vs-qwen3-4b.md`), not an On-qualification; router stays Shadow.
- Pre-existing test reds excluded by name in CI workflows (web: 2; mobile: 5 suites); electron `npm test` 105 env failures in symlinked setups.

## Test status

api_server tsc clean at every merge; affected coordinator/workflow set 614/614 (S4) then 25/25 (S7); mobile jest CI script 525/525; web unit 69/69; fork 149/149; Dayflow bounded sequence 5/5 (run 5); live-Postgres bootstrap 11/11 locally after the parity fix.

## Next step

Merge S5 when green, push, let CI settle, AJ smoke-tests PR #1604 (desktop already running the candidate), complete Dayflow onboarding, install TestFlight 1.0.9 (21) when it is available.

