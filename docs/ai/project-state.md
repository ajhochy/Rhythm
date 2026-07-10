# Project State

## Current focus

**Org-optimizer approval loop + skill-content-shadow retirement — built,
integrated, and live-verified on `codex/optimizer-shadow-epic`.** Draft PR
opened this run (2026-07-09); NOT merged. See
`docs/ai/runs/2026-07-09-optimizer-shadow-epic.md`.

The org-optimizer now closes end-to-end: the LLM diagnosis brain **generates**
`refine-config` / `refine-scope` / `workflow-prompt-fix` (+ `grant-delegation`)
proposals (additive to #956's deterministic `broaden-scope`/`create-recipe`
lanes), a human **approves**, an applier makes the **real** change, a
**behavioral re-run or LLM-judge** decides keep/revert, and a reverted diagnosis
re-enters with attempt-aware context. `refine-skill` (#976, human-gated) and
`system_prompt` (gap #1) ride the same machinery.

## Branch / PR

- `main` @ e043f6c59 (unchanged this run).
- **OPEN draft PR — `codex/optimizer-shadow-epic`** (off `main`): closes
  **#977, #971, #976** and adds gap #1 (system_prompt). Built by 6 parallel
  worktree agents across 3 waves + an orchestrator patch fix, `tsc` clean on the
  merge, **live-verified against the real fork engine** (see run log). Awaiting
  AJ sign-off + a real-app relaunch smoke. **Do not merge without sign-off.**
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

1. **AJ: review the draft PR** (`codex/optimizer-shadow-epic`, now CI-green) +
   relaunch the real Rhythm app for a behavior smoke, then merge (manual).
2. Then start **#981** (`refine-task`).
3. Optional deeper live obs: force the `issue-5` re-attempt cycle + let a
   config/scope behavioral verdict settle on a longer run.
