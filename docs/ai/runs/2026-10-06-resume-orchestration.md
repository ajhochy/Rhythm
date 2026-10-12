---
date: 2026-10-06
repo: Rhythm
branch: integration/2026-10-06-resume
pr: (draft, see project-state)
issues: []
status: in-progress
tags: [run, Rhythm]
---

# Resume after the 2026-10-06 12:50 UTC pause (orchestrator: Claude Fable 5.1)

Planners: Opus (4 read-only plans). Writers/testers: Sonnet. Fable composed, reviewed, merged.
Note: the dispatch tooling offered `claude-opus-5` / `claude-sonnet-5`; 5.5 variants were not selectable.

## Reconciled lineage (verified with git, not from the handoff)
- GitHub mega head 18705742 (PR #1598, CI green) → 34 local-only commits → 6e339972 (running app) → 5b81e7b9 (approval-resume + router repair, packaged, never installed) → 65fe0338 (5b81 + accepted C2 provider, native overlay, G2 helper; 364/364 affected tests).
- 65fe0338 lived only in a Codex scratch clone; fetched into the main repo. Dirty clones snapshotted as `wip/*` branches (G2/C2 Terra partial 610caa25, native Electron host 7f127917, mobile canonical backend 13d7a4ab).
- The paused Terra G2 partial (17 production files, 0 tests) regresses 29 accepted tests; treated as a draft to repair (S2), not merged as-is.
- Instrument fixes: main-checkout node_modules carries a stale vendored opencode SDK (false `"configured"` type errors); worktrees link their own vendor copy. Lineage commit 6ec07b61 tracked `apps/mobile/node_modules` as a symlink into a Codex dir; untracked here.
- Prior Codex builder thread is still alive and performed a user-requested relaunch of the exact installed build at 13:30 UTC (pids 22666/22685/22753, source 6e339972). Not re-engaged; runtime untouched.

## Files / slices merged on the integration branch
- Server packets: calendar dev-context + final-exposure, chat settings wire v1 (3 import lines re-anchored), mobile Research gateway (11 ops, owner/path binding). Settings-scope fixture moved under `src/__tests__/fixtures/`.
- Router calibration instrument: malformed probabilities become failed rows (mutation-proven); `RHYTHM_DECISION_ROUTER_FILE` isolated in vitest setup (10 host-only failures → 1 unrelated fixture deferral in update_allowlist_ranking).
- Fork guard (S3): corrupt-record semantics restored; 4 workflow-lane tests; `test/server/httpapi-rhythm-provider-guard.test.ts` added to fork CI.
- Mobile proxy (A3): persisted thinking budget / Fast forwarded to the engine for ordinary phone prompts (previously never sent).
- Desktop web (S6): coordinator card issues `purpose:'workflow'` only with explicit acknowledgement + `workflowCheck{kind:'selected_reference_summary_v1',sourceId,expectedVersion}`; Enter-key bypass caught and closed.
- CI: new `web_unit_ci.yml` (apps/web node unit tests never ran in CI; 2 pre-existing failures excluded and named); mobile CI now runs jest (5 pre-existing failing suites excluded and named) and the 1173 tools-service node test.
- Mobile packets U,R,Rt,S,A,B composed (jest 525/525 in the CI script); transition test proves per-surface model/reasoning/Fast isolation (mutation-proven).
- Native Dayflow: 12 accepted files + staging (`stage-native-dayflow.mjs`: manifest verify, copy, 3× rpath delete + ad-hoc reseal, inventory) + signing (helper signed with hardened runtime, team id, NO entitlements) + post-sign verifier.

## Checks
- api_server tsc clean at every merge; web tsc clean; mcp tsc clean.
- Native candidate packaged (92.6 s) and signed sign-only (29.3 s) from 8c49d17b; `codesign --verify --deep --strict` OK; helper `com.rhythm.desktop.dayflow-helper` team 56Q69NYP9H runtime flag, no entitlements; dylib 15 exports; rpaths normalized; spctl "Unnotarized Developer ID" (same as the running candidate).
- Launch smoke on isolated profile `/Users/ajhochhalter/rdfqa1`: boots, live listeners untouched, route `#/tools/dayflow` reached, `rhythmShell.dayflowView.getStatus` → `unavailable` because the fresh profile is signed out (trusted-sender gate). Native attach NOT proven; needs AJ sign-in on that profile.
- Dayflow bounded sequence (sandbox 4097-4100, synthetic model, real API+engine at 65fe0338): all 5 steps PASS on run 5 after three checker-only fixes (summary wording per `plan.ts:13`; two observation-file read races; idle/stability snapshot before step 5 with a failure diff dump). In-harness mutation is blocked by the harness's reviewed-source pin ("Changed reviewed source"); discrimination evidenced by run 1's failure on the other wording and the offline re-evaluation of archived tool output.

## Notes / open
- G2 S2 (admission repair) in flight; S4/S5/S7 (callback anchor, capacity, checked result, next ordinal, reconciliation, capabilities, cross-project statement) follow; S8 bounded live check after.
- Routing comparison and Research B captures in flight (see follow-up entries).
- Electron `npm test` has 105 pre-existing failures at the parent commit in this symlinked environment (401/105 before any slice); the native slices' 42 tests pass.

## Addendum 14:30Z — desktop installed, TestFlight admitted
- Integrated candidate built from f29523d0 (package 58 s, sign-only 18 s; receipts `~/Documents/Codex/2026-10-06/fable-integrated-desktop-build/`). Normal profile quit via osascript and relaunched on it at 14:22:38Z (receipt `relaunch-receipt.json`); pids 91820/91895/91951; engine `0.0.0-rhythm-f29523d0…`; sign-in, settings, data preserved; relay uplink re-established; mobile gateway 200.
- Native Dayflow attached on the normal profile: `rhythmShell.dayflowView.getStatus()` → `{state:'ready'}`, addon/resources mapped from the candidate bundle, store created under the `RHYTHM_NATIVE_DAYFLOW_DATA_ROOT` override, original onboarding renders inside the Dayflow tool (`normal-dayflow-native-window.png`). Timeline and the 16-screen matrix wait on AJ completing onboarding.
- CI fixes landed: MCP role-graph classification for the two coordinator tools (status = trusted read; start-goal = server-signed goal write), web unit CI installs mobile deps, fork SDK regenerated for the four Rhythm managed-session routes (openapi 137→141 ops) with mobile classifications (intentionally-omitted), fingerprint/count pins and the generated gateway operations file; Postgres `agent_sessions` parity (5 columns) proven red→green on a local postgres:16.
- TestFlight: readiness OK (free plan, 25 builds remaining, $0), preflight exit 0, bundle check OK, one production build admitted with auto-submit; EAS assigned buildNumber 21 (1.0.9).
- Cleanup: 12 merged worktrees removed, 13 merged branches deleted (after `merge-base --is-ancestor` checks). Left in place: `scratch-mobile-base`, `slice-mobile-packets` (ignored node_modules copies only; removal command was permission-denied), `slice-g2-s5`, `slice-mobile-e2e` (active).
- Mobile CI at f29523d0: 2 Playwright e2e failures (issue-1172-c10 deep links, issue-1173-c3 Research lifecycle) under repair; 73 passed.
