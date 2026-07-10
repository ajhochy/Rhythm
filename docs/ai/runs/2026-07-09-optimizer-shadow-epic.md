---
date: 2026-07-09
repo: Rhythm
branch: codex/optimizer-shadow-epic
pr: (draft — opened this run)
issues: [961, 977, 971, 976, 981]
status: verified-live-awaiting-signoff
tags: [run, rhythm]
---

# Org-optimizer approval loop + skill-content-shadow retirement (epic)

Parallel-worktree orchestration: Wave 1 (2 agents) → Wave 2 (3 agents) → Wave 3
(1 agent) + an orchestrator-authored patch fix + gap #1, all merged onto
`codex/optimizer-shadow-epic` and live-verified against the real fork engine.

## Streams delivered

- **#961 — data remediation (applied to REAL config/DB, approval-gated).**
  Backed up first (`~/Library/Application Support/Rhythm/backups-961-*`), then:
  re-wired 4 agents' skill allowlists (ffb consolidation, `patristic-bible-study:*`
  → `father-profile`/`study-passage`, config-doctor 123→93 junk-dropped),
  deleted 3 test/temp agents (#960), re-enabled the wrongly-disabled
  "AI Trend Research…" skill, removed the inert legacy `rhythm-managed-skills/`
  dir (+ quarantine). Verified on the real DB.
- **#977 — retire the DB→file skill-content shadow.** Deleted the boot backfill
  (`skill_metadata_backfill.ts`) + the publish/unpublish materializers
  (`skill_materializer.ts`) + decoupled the ministry seed. Kept the #792
  lifecycle sidecar. Conservative on the DB `body` column (vestigial readers
  remain; the load-bearing *projection* is gone). Live boot: zero
  backfill/materializer log lines.
- **#971 — org-optimizer approval loop (Option 2: reconstruct the LLM diagnosis
  brain, ADDITIVE to #956).** All 6 design-doc units:
  - Diagnosis brain reconstructed in `workflow_signal_generator.ts` +
    `org_diagnosis_types.ts` (ConfigPatch/ScopePatch/DiagnosisResult), producing
    `refine-config`/`refine-scope`/`workflow-prompt-fix`/`grant-delegation`
    alongside main's #956 deterministic lanes.
  - Direct-apply appliers + validators for `refine-config`/`refine-scope`
    (+ `workflow-prompt-fix` + `refine-skill` approve-path), snapshot→mutate→revert.
  - Behavioral measurement (replay the failing session under the patched config;
    keep if the failure signature is gone, else revert) + all-`measuring` sweep
    + fire-and-forget measure on approve.
  - Attempt-aware re-diagnosis on revert (`workflow-fix:<id>:<hash>:aN`, cap 3,
    prior-attempt context in the prompt).
  - **Patch-derivation fix (orchestrator):** the diagnosis LLM reliably omits the
    structured patch (states the fix in `concreteFix` prose only), which 400'd on
    approve. Added `deriveConfigPatchFromProse`/`deriveScopePatchFromProse` +
    firmer prompt so the loop actually closes.
- **#976 — human-gated refine-skill generator (Path B).** Surveys active skills;
  weak (postScore<61 / postScore≤baseline / confidence<0.6, #857 unobserved-guard;
  skips drafts) → HIGH-risk `refine-skill` proposal with a pre-drafted body.
- **#981 — filed** (gap #2: `refine-task` kind for scheduled-task definitions).
- **Gap #1 — system_prompt as a refine-config field** (agent role-text fixes now
  applyable) — merged.

## Checks

- `tsc --noEmit` clean on the fully-merged epic (all waves + gap #1 + patch fix).
- **Live E2E against the real fork engine** (isolated: DB copy + `RHYTHM_MANAGED_SKILLS_DIR`
  copy + agents-dir backup/restore; real config never mutated):
  - diagnosis GENERATES applyable proposals (post patch-fix) → approve a
    diagnosis-generated `refine-scope` → real `agent_configs` row changed
    (`study-passage` removed). ✅
  - `refine-config` (model), `refine-scope`, prose-only-refusal (400),
    `refine-skill` apply→measure(LLM-judge)→revert→restore. ✅
  - **system_prompt (gap #1)**: approve → `coding-agent.system_prompt` rewritten. ✅
  - **workflow-prompt-fix**: approve → skill body edited; diagnosis-generated ones
    produced + measured (one auto-reverted). ✅
  - **create-recipe**: approve → `agent_cookbook` row materialized. ✅
  - **#976 refine-skill generator**: emits a proposal live. ✅
  - No tests written (per directive — acceptance is live probing).

## Notes / residuals

- `webhook-wiring` applier registered but not exercised (no webhook-gap signal in
  the probe data). Pre-existing (#829); untouched here.
- `issue-5` attempt-suffix re-diagnosis: logic-verified + revert fired; full
  re-attempt cycle not force-observed.
- One `refine-config` behavioral re-run was still `measuring` at teardown (slow
  real agent turn — mechanism confirmed launching with correct role/model/empty-mcp).
- **Not merged.** Draft PR only; awaiting AJ sign-off + a real-app relaunch smoke.
- Follow-ups: #981 (refine-task), and observing the behavioral-verdict + issue-5
  re-attempt on a longer live run.

## Orchestration model (reusable)

Contract-first waves in isolated worktrees: Wave 1 built the shared type contract
+ the independent #977; Wave 2 built appliers/measure/generator against that
contract in parallel; Wave 3 added re-diagnosis. Orchestrator merged each wave onto
the epic, `tsc`-gated, and drove one sequential live-probe pass (single stateful
backend — verifications can't parallelize). Gotcha: agents' `git add -A` committed
`node_modules` symlinks — strip with `git rm --cached` before merge.
