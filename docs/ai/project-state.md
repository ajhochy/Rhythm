# Project State

## Current focus

**Non-mobile issue wave (2026-07-10) — 6 live-backend-verified fixes on
`workflow/run-2026-07-10-nonmobile-issues`, PR open for AJ review.** See
`docs/ai/runs/2026-07-10-nonmobile-issues-wave.md`. Every fix verified by a real
backend probe (standalone server + real fork engine), not just tsc/unit:

- **#1002** (linchpin): headless/scheduled agent runs failed ("model produced no
  output") because `agent_runner` prompted the directory-scoped engine with an
  undefined cwd. Fixed → scheduled run reaches `idle` with real output; 46 stuck
  `starting` sessions recovered on boot. Unblocks scheduled tasks + optimizer measure.
- **#1000** scheduler save 500 (boolean bind), **#1004** tighten-scope over-prune
  (count only executed sessions; 30→18 removals), **#1003** un-approvable
  grant-delegation (log-only routing + actionable refusal), **#1001** E2E
  test-agent leak (isolation guard + 7 leaked profiles cleaned), **#999** empty
  tool-transcripts (structured messages endpoint).

**Closed with evidence this run:** #971, #976, #977, #961, #962 (all LIVE-CONFIRMED
on main via PR #982 — see run log).

**#981** `refine-task` kind — built (worktree subagent), merged, live-verified
(approve → real `agent_scheduled_tasks` row changed → measure dispatched).
**Deferred, untouched:** #983–#988 (Plan A), #989–#997 (Plan B).

Prior: org-optimizer approval loop + skill-content-shadow retirement merged via
**PR #982** — see `docs/ai/runs/2026-07-09-optimizer-shadow-epic.md`.

## Branch / PR

- **OPEN (this run):** `workflow/run-2026-07-10-nonmobile-issues` — fixes
  #1002/#1000/#1004/#1003/#1001/#999 (+#981 pending). Full api_server suite
  **2616 passed / 0 failed**; tsc clean. Do NOT merge — awaiting AJ manual smoke
  of #999 (Session History transcripts) + #1000 (cron toggle).
- **MERGED (PR #982, AJ sign-off, 2026-07-10):** org-optimizer approval loop +
  skill-content-shadow retirement — closes **#977, #971, #976** and adds gap
  #1 (system_prompt). Built by 6 parallel worktree agents across 3 waves + an
  orchestrator patch fix, `tsc` clean, **live-verified against the real fork
  engine** (see `docs/ai/runs/2026-07-09-optimizer-shadow-epic.md`), CI green
  (server-checks) after a stale-test reconciliation (see
  `docs/ai/runs/2026-07-10-ministry-seed-test-ci-fix.md`). Merged **without**
  the documented real-app manual smoke — AJ elected to merge on CI-green
  alone; a real click-through of the org-optimizer flow is still worth doing.
- **MERGED (PR #980):** docs/project-state-post-979 (project-state snapshot
  after PR #979).
- **MERGED (PR #979, AJ sign-off, 2026-07-09):** Phase B/D ids + quality wave —
  **#945, #960, #951, #954, #970, #943**. Built by 5 parallel Codex worktree
  runs, orchestrator-reviewed, behaviorally gated, integrated (full suite
  **2626/0** + tsc + flutter analyze clean), CI green. See
  `docs/ai/runs/2026-07-09-phaseBD-ids-quality-wave.md`.
  - #943 (Session History screen) shipped **without a visual smoke** — the UI
    was merged on sign-off; a real click-through is still worth doing.
- **#961** data remediation already **applied to the real config/DB** this run
  (approval-gated, backed up to `~/Library/Application Support/Rhythm/backups-961-*`).
- **#981 filed** — `refine-task` kind (gap #2: scheduled-task definitions). Not started.

## Risks / known issues

1. **DB `body` column kept as vestigial** (#977 conservative): live readers
   (`priorBodyOf`, CRUD `GET /agent-skills`, manual rollback) still fall back to
   it; the DB→file *projection* is removed but the column isn't nulled. Fine.
2. **`webhook-wiring` applier** registered but not exercised live (no webhook-gap
   signal in probe data). Pre-existing (#829); low risk.
3. **`issue-5` attempt-suffix re-diagnosis** logic-verified only; revert fired but
   the full re-attempt cycle wasn't force-observed. Behavioral config/scope
   re-run verdict is slow — confirmed launching, not always settling in-window.
4. **Diagnosis LLM omits structured patches** — mitigated by the deterministic
   `derive*PatchFromProse` fallback for model + add/remove scope; genuinely
   ambiguous fixes (set-rewrites, `ocAgent`, full-prompt rewrites) still degrade
   to prose-only / human-manual (correct). `system_prompt` has no derive fallback.
5. **Org-optimizer cron stays OFF** until this + safety review land (unchanged).

## Test status

- `tsc --noEmit` clean on the merged epic (api_server). No unit tests added this
  run (acceptance = live probing, per directive). Live E2E pass recorded in the
  run log (all kinds the user asked about: config/scope/skill-body/system-prompt/
  recipe + diagnosis-generated apply + measure/revert).
- **`server-checks` CI is now green on PR #982** (2026-07-09/10 follow-up): the
  suite's `ministry_recipes_seed.test.ts` was stale against #977's
  files-as-source-of-truth change (asserted DB `agent_skills` rows that #977
  stopped creating). Test reconciled to read the materialized SKILL.md file
  instead; no production code changed. Full vitest: 297 files / 2616 tests
  passed, 23 skipped. See `docs/ai/runs/2026-07-10-ministry-seed-test-ci-fix.md`.

## Next step

1. **Start #981** (`refine-task` kind, gap #2: scheduled-task definitions).
2. Optional: real-app manual smoke of the just-merged org-optimizer approval
   loop (#982) — merged on CI-green without this step; a real click-through is
   still worth doing.
3. Optional deeper live obs: force the `issue-5` re-attempt cycle + let a
   config/scope behavioral verdict settle on a longer run.
4. Optional: visual smoke of the shipped #943 Session History screen (still
   outstanding from PR #979).
- **#952** closed (Codex "hang" was ChatGPT quota exhaustion, not a bug —
  confirmed live 2026-07-09: `gpt-5.6-terra` completes, unsupported models return
  clean error frames, no hang).
