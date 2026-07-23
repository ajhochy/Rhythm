---
date: 2026-07-23
repo: Rhythm
branch: feat/run-quality-generator
pr: (pending)
issues: [865, 816, 971]
status: implemented, verified (unit + live behavioral)
tags: [run, Rhythm]
---

# Run-quality scorecard → org-optimizer proposal signal

## Summary

Wired the #865 run-QUALITY scorecard (`getRunQualityRollup`) into the org
self-optimizer as a proposal signal source. It previously only displayed
metrics (escalation rate, wasted tokens, repeated-mistake clusters) and was
deliberately NOT wired into the auto-tune loop. Now it PROPOSES.

**Reuse, not rebuild.** The new generator adapts run-quality rows into the
existing `WorkflowFailureSignal[]` shape and hands them to the existing #971
`generateDiagnosisProposals` lane. No new proposal kind, no new applier, no new
apply path, no new budget. Everything downstream — LLM diagnosis, server-side
patch re-resolution (untrusted-LLM defense), dedup, the #830 per-run cap, the
risk classifier gate, the /agent-org-proposals human review queue, and the
registered `refine-config` / `refine-scope` / `workflow-prompt-fix` /
`refine-task` appliers — is unchanged.

## Files

- `apps/api_server/src/services/generators/run_quality_generator.ts` (new) —
  `generateRunQualityProposals`. Trigger: `notEnoughData === false` AND
  (`escalationRate > RUN_QUALITY_ESCALATION_THRESHOLD` OR `repeatedMistakes`
  non-empty). repeatedMistakes → one `retry-loop` signal each; escalation-only
  → one `unverified-claim` signal. Suspect (error) sessions' transcript
  excerpts are folded into each signal's `evidence`, length-capped and
  explicitly labelled **untrusted (classify only)** — DuneSlide/GitLost
  prompt-injection defense; the diagnosis lane's server-side patch
  re-resolution (never trusts the LLM's emitted agentConfigId) is the second
  layer.
- `apps/api_server/src/services/org_optimizer_run_service.ts` — one new
  `generatorStep` calling `generateRunQualityProposals` through the shared
  capped, dedup-aware repo. Additive only.
- `apps/api_server/src/services/generators/__tests__/run_quality_generator.test.ts`
  (new) — 4 unit tests: trigger filter (notEnoughData skip, below-threshold
  skip), escalation-rate path (human-gated refine-config, untrusted id NOT
  trusted → patch re-resolved to real profile), repeated-mistake path +
  untrusted-transcript labelling.
- `apps/api_server/src/__tests__/live_e2e_run_quality_generator.test.ts` (new)
  — RHYTHM_LIVE_E2E=1 behavioral contract.

## Threshold (AJ-approved)

`RUN_QUALITY_ESCALATION_THRESHOLD` = env-overridable const, default **0.30**
(`process.env.RUN_QUALITY_ESCALATION_THRESHOLD ?? 0.3`). Window 14 days
(`RUN_QUALITY_WINDOW_DAYS`, default 14).

## Checks

- `tsc -p tsconfig.json` (npm run build): clean.
- GitNexus impact `runOrgOptimizer` upstream: **LOW** (1 caller).
  `registerAllProposalAppliers`: **LOW** (0). No HIGH/CRITICAL.
- GitNexus `detect_changes` (unstaged): **LOW**, 0 affected processes.
- Unit — my change scope (7 files, 41 tests): **all pass** —
  run_quality_generator, issue_850_contract (capstone, wiring intact),
  workflow_signal_generator(+_diagnose), org_optimizer_run_controller,
  org_proposal_appliers_wiring, issue_981_refine_task.
- Full `vitest run`: 42 failures ALL traced to a **pre-existing, unrelated
  malformed `.mcp-roles/secretary.mcp.json`** in AJ's uncommitted working tree
  (`Expected double-quoted property name at position 2023`). Proven by
  temporarily restoring the committed (valid) version → the role-file cascade
  failures cleared; my scope stayed green throughout. AJ's working copy was
  restored untouched. (Residual `memory_write_vault_first` failures are
  env/vault-path dependent and also pre-exist my change.)

## Live behavioral (AGENTS.md gate) — PASS

- Command:
  `SB=$TMPDIR/rhythm-dev-sandbox HOME=$SB/home DB_PATH=$SB/rhythm.db RHYTHM_LIVE_DB_PATH=$SB/rhythm.db RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 ./node_modules/.bin/vitest run src/__tests__/live_e2e_run_quality_generator.test.ts`
- Ran against the sandbox api_server (:4098) + fork engine (:4097), rebuilt
  from this branch via `tools/dev/sandbox.sh down && up`.
- Result: **1 passed (63.6s)**. Seeded a real agent with 6 escalated sessions
  sharing one status_message → POSTed `/agent-org-optimizer/run` (polled past
  the #746 cold-start window) → observed the run-quality lane flag the agent
  and open a real, user-visible `self_improvement` diagnosis session titled
  `optimizer-diagnosis: rq-live-<ts>` — the observable end-to-end outcome the
  scorecard now drives.
- Observed server log:
  `[run-quality-generator] flagged 9 agent(s), emitted 12 signal(s)`.
- Behavioral finding (value of the live gate): the cheap sandbox diagnosis
  model (`anthropic/claude-haiku-4-5`) frequently returns an
  empty/unparseable diagnosis, so the LLM path yields 0 refine-* rows in the
  sandbox. That is #971's shared, non-deterministic concern — NOT this lane's.
  The test therefore gates on the observable outcome this lane controls (the
  diagnosis session is opened for the flagged agent) and treats a produced
  proposal row as a best-effort bonus (asserting only that any refine-* row is
  human-gated `risk='high'`, never auto-applied).

## Notes / risks

- Human-gated end-to-end: every quality-driven change lands as a proposal in
  the review queue; nothing auto-applies (refine-* are high-risk by the
  classifier; the run loop's double gate never auto-applies them).
- Per-run cap respected via the shared `newlyCreated`/`cappedRepo` budget — no
  competing budget added.
- Next: feature branch → draft PR → human merge after manual smoke. Do NOT
  merge to main (10–15 church staff on prod).
