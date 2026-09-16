# Rhythm — Project State

## Current focus

Electron replacement candidate has a **draft PR open with fully green CI**; AJ's manual smoke of the packaged app is the sole remaining gate. Flutter remains the shipping client — no cutover, pilot, or Phase6 activity has started.

## Active branch / PR

- Branch `feature/electron-flutter-retirement` → draft [PR #1495](https://github.com/ajhochy/Rhythm/pull/1495) (base `main`), HEAD `77dd2284` (2 docs-only commits on top of `0d564cd9`).
- CI is green on the current HEAD `77dd2284`: [Server CI success](https://github.com/ajhochy/Rhythm/actions/runs/35045672905), [Mobile CI success](https://github.com/ajhochy/Rhythm/actions/runs/35045672918). Along the way, the intermediate commit `6ebde76e` hit the pre-existing `workflow_failure_signal_extractor.test.ts:764` flake twice in a row (original + one `--failed` rerun) before clearing on the next push — confirmed unrelated to any code change (both docs-only commits' diffs touch only `docs/ai/*.md`). Treat that test as a known intermittent flake, not a gate.
- Do not merge. AJ's manual smoke of `apps/electron/dist/Rhythm.app` is the open gate.
- Prior six-stream handoffs (status not rechecked here): `fix/session-list-and-task-board` draft PR #1486; `fix/bridge-stream-reliability-repair` draft PR #1487; `fix/optimizer-scope-lane` draft PR #1488; `fix/optimizer-generator-lanes` draft PR #1489; `plan/recipes-1485` docs-only draft PR #1490.

## In progress

- AJ's manual smoke of the packaged Electron app is active/pending. Note: the desktop API on port 4001 was observed down on 2026-09-15 — that is unrelated to this candidate; if manual smoke needs the live-4001 path, Rhythm.app needs to be relaunched first (do not start 4001/4096 from this workflow).
- 44px hit-area repair for the SessionRail overflow button (`.session-overflow-button`, `.session-row-wrap.has-subagents`) landed in commit `856c8702`, with new E20 coverage (`subagent-overflow-hit-area`, `apps/web/tests/electron-e20-session-ordering.spec.ts`). The single BLOCKER from the read-only UI/accessibility review is resolved.
- Follow-up issue filed for a native directory picker (Browse is disabled under the live gateway today; see Next step).
- Phase6 pilot/cutover/30-day fallback: not started.
- AJ-owned review, manual smoke, and merge decisions for draft PRs #1486–#1489 remain outstanding.
- #1485 implementation has not started (S0/S1a/S1b/S2 can begin in parallel; see prior notes for full dependency chain).

## Risks / known issues

- Green CI + integrated automated PASS does not qualify manual smoke, signed dual-architecture packaging, provider/session behavior, assistive technology, native migration/rollback, or broader retirement readiness.
- Desktop API on port 4001 was down independently on 2026-09-15; not caused by this branch, not fixed by this workflow.
- Stale verifier sandbox listeners `5897/5898/5899` (PIDs `65058/65094`) and `7097/7098/7099` (PIDs `26681/26701`) are intentionally retained by others; do not touch.
- `apps/mcp_server/dist` is an untracked build artifact; `tools/dev/sandbox.sh up()` now builds it rather than pre-asserting its existence (fixed in `0d564cd9` after it broke 3 CI tests on a fresh checkout).
- `workflow_failure_signal_extractor.test.ts:764` is a pre-existing timing flake on loaded runners, unrelated to this branch (not touched, not fixed here; passed on the CI run).
- Generated screenshot churn/deletions and blocked/no-op worker notes remain out of intended commit scope.
- PR #1486 still needs subjective Electron/web vs. Flutter child-session visual-parity smoke.
- Optional validator cleanup (missing `find` MCP grant, a coding-agent contract-path variant) remains open.
- S4 (#1485) requires private `ajhochy/rhythm-workflow-e2e` on `main` with a required check before it can run.

## Test status

- Integrated automated gate: verifier `4253` PASS (2026-09-14); package built at `apps/electron/dist/Rhythm.app`.
- PR #1495 CI: green on current HEAD `77dd2284` (Server + Mobile). Intermediate commit `6ebde76e` flaked red twice on `workflow_failure_signal_extractor.test.ts` (not a regression — see Active branch/PR).
- GitNexus compare-main (as of the 2026-09-14 pass): 371 symbols / 254 files, zero affected indexed processes, LOW aggregate.
- E20 (`electron-e20-session-ordering.spec.ts`) now covers 44px targets for both `.subagent-disclosure` and the `.session-row-wrap.has-subagents` overflow button.
- PR #1486: automated API/web/Flutter/live gates pass; only subjective visual-parity smoke remains. PR #1487: 33/33 criteria, full API suite 5,999 passing. PR #1488: 8/8 criteria, live 10/10. PR #1489: 24/24 criteria, 165 focused tests, live 2/2.

## Next step

1. AJ: manual smoke of `apps/electron/dist/Rhythm.app` (relaunch Rhythm.app first if the live-4001 path is needed — 4001 was down standalone on 2026-09-15). Do not infer PASS or merge PR #1495 from CI/automated evidence alone.
2. Triage/action the filed follow-up issue: native directory picker for agent project selection (Browse), scoped to `apps/electron/src/main.mjs` + a narrow preload IPC method.
3. Retain prior handoffs: AJ smoke/review for #1486–#1489; #1485 implementation scheduling remains a separate follow-up.
