---
date: 2026-10-11
repo: rhythm
branch: codex/rhythm-deliverables-completion-20261010
pr: none
issues: []
status: d1-happy-path-demonstrated
tags: [run, rhythm]
---

# D1 Coordinator coding workflow — full happy path demonstrated live

Live API/DB (AJ authorized), fixed api_server source build on :4001, engine :4096.
Approvals were clicked by the agent under AJ's explicit go-ahead for these bounded
selectTasks test cards — **no human approval was demonstrated by these runs.**

## Run 12 (card 4e767f3c, operation coding-execution:4109d073…)
proposal → signed approve → consume → one manager → one worker → scoped edit of
src/selectTasks.ts → worker callback accepted (manager woke) → manager finished →
server-owned result delivered to the original root chat (message 169358):
Control completed · Execution completed · Verification passed, 7/7 checks by the
protected Docker evaluator on an immutable capture; separate harness also 7/7.
Duplicate start in the same chat answered "already reserved". Chat resolves, no hold.

## Defects fixed this stretch (each guard A/B-fails on the old code)
- `cecbd5f6` reconcileWakingClaims parked an unprepared coding callback forever
  (null callback id proves nothing was sent) → released for retry.
- `cecbd5f6` completion wakes used the profile model only; now session model first,
  same as an ordinary turn (root pinned to openai kept waking on signed-out anthropic).
- `614850ff` worker→manager callback never got the coordinator callback marker, so
  promptAsync refused every one silently (run 11: worker done in 61s, run cancelled
  at 600s). Marker issued for the grant-validated worker callback; refusal logged.
- `69685e61` Dayflow: qualification fixture built a second guard enrollment;
  now uses the server's single enrollment via one evidence factory. sol_http test
  resolves hoisted tsx.

## Checks
- coordinator/coding/delegation/dayflow/qualification suites: all pass except none
  (Dayflow composition + sol_http were pre-existing failures, now fixed).
- tsc --noEmit clean.

## Notes
- A completed run's grant is never revoked (correct); the old installed 0.18.69
  app still freezes on worker rows, so test worker rows were removed after the run.
- Old Oct-7 ordinary completion ea15a33d on the root keeps being rejected by the
  engine on wake — AJ's history, not this run; not investigated.
- Decide endpoint still accepts decisions on expired cards (open).
