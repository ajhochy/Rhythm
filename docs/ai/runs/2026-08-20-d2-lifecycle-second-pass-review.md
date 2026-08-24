---
date: 2026-08-20
repo: Rhythm
branch: agent-stack/si-d2-post-apply-lifecycle
pr: 1454
issues: [1433, 1434, 1435]
status: fixes-implemented
tags: [run, Rhythm, review]
---

# D2 lifecycle second-pass independent review (Fable, Sonnet)

Independent adversarial re-review of the D2.3–D2.5 post-apply lifecycle
(#1433–#1435), verifying and superseding the first pass (GPT Fable,
2026-08-19, `docs/ai/runs/2026-08-19-d2-lifecycle-independent-review.md`).

## Files

Root-cause fixes (working tree, uncommitted):

- `apps/api_server/src/services/auto_repair_service.ts` — rewritten as a
  durable, evidence-gated state machine (one decision per sweep tick).
- `apps/api_server/src/services/auto_revert_service.ts` — chain-aware CAS
  anchor override for the revert restore.
- `apps/api_server/src/services/org_proposal_apply.ts` — `ConfigFieldSnapshot.expectedAppliedValue`,
  `compareAndSetConfigField`, `RevertConfigFieldOverride`, CAS in the
  `isConfigFieldSnapshot` revert branch.
- `apps/api_server/src/services/org_proposal_appliers_wiring.ts` — human
  refine-config apply now also records `expectedAppliedValue`.
- `apps/api_server/src/services/post_apply_lifecycle.ts` — sweep calls the
  repair state machine on every tick, not just once.
- `apps/api_server/src/services/post_apply_monitor.ts` — exported
  `DEFAULT_MIN_GUARDRAIL_SAMPLE_COUNT` for reuse.
- `apps/api_server/src/models/post_apply_event.ts`,
  `apps/api_server/src/repositories/post_apply_events_repository.ts` —
  additive `repairAttemptCount` / `repairRecheckAfter` durable fields.
- `apps/api_server/src/repositories/agent_configs_repository.ts` — generic
  `compareAndSetColumnsAtRevision` CAS primitive.
- `apps/api_server/src/repositories/agent_org_proposals_repository.ts` —
  public `findByDedupKeyAsync` (crash-resume lookup).
- `apps/api_server/src/database/migrations.ts`,
  `apps/api_server/src/database/postgres_bootstrap.ts` — additive schema for
  the two new event columns (both engines, parity-guard verified).
- Rewritten/added tests: `auto_repair_service.test.ts`,
  `auto_revert_service.test.ts`, `post_apply_lifecycle.integration.test.ts`,
  `post_apply_lifecycle_repair_live_e2e.test.ts` (new).
- Contract docs updated: `docs/ai/contracts/issue-1433.json` (superseded_note
  + new criteria c1b, c7–c11), `issue-1434.json` (superseded_note + new
  criteria c11–c13), `issue-1435.json` (superseded_note + new criterion c15).

First-pass changes reviewed and KEPT unchanged (verified correct, not
touched further): `allowedSkillsJson` repair refusal (now reusing the shared
`UNSAFE_WHOLE_FIELD_SCOPE_FIELDS` constant instead of a bespoke check),
profile projection restored after repair writes, `extractValidatedConfigPatch`
requiring a string `value`, and the monitoring-window-end evidence filter in
`post_apply_monitor.ts`.

## Disposition of every first-pass (GPT) finding

1. **CRITICAL — `REPAIR_RECHECK_EPSILON_MS=1` fabricated evidence.**
   CONFIRMED and FIXED. Replaced with a durable state machine gated on real
   `evaluateGuardrails` outcomes at/after a persisted `repairRecheckAfter`
   floor, using the SAME threshold (`DEFAULT_MIN_GUARDRAIL_SAMPLE_COUNT`) the
   pre-trip D2.2 monitor already uses. No evidence yet → `pending`, never a
   pass. See `auto_repair_service.ts` module doc comment.
2. **HIGH — no target-value/revision CAS on scalar repair/revert.**
   CONFIRMED and FIXED. Added `compareAndSetConfigField` (repository-backed
   generic CAS), used by both the repair write (`applyRepairAttempt`) and the
   revert restore (`revertProposal`'s `isConfigFieldSnapshot` branch). The
   human refine-config apply path also now records the CAS anchor so a later
   human `/revert` benefits too.
3. **HIGH — interrupted repair chain could stick/duplicate (in-memory repair
   IDs).** CONFIRMED and FIXED differently than framed: repair proposal ids
   are durable from the start (`AgentOrgProposalsRepository`), the real gap
   was crash-safety of the mutation+claim pair. Closed via an attempt-scoped
   dedup key (`post-apply-repair:<proposalId>:attempt:<n>`) with the
   pre-mutation snapshot persisted BEFORE any live write, so a resumed call
   never re-derives "prior value" from an already-mutated config and never
   double-mutates.
4. **HIGH — projection blocked/failed outcome ignored.** First pass already
   added `projectAgentProfileAfterWrite` after repair writes; verified this
   pass to be a real fix (falsified: disabling it broke a test assertion).
   Kept unchanged.
5. **HIGH — `defaultDiagnose` collapses provider/parse failure to null,
   consuming all 3 attempts.** CONFIRMED and FIXED: `null`/thrown/timed-out
   diagnose calls are `deferred` (no strike consumed) in the new state
   machine, matching this exact requirement.
6. **MEDIUM — invalid diagnoses consumed strikes without attempt records.**
   CONFIRMED and FIXED with a truthful accounting model: a genuine but
   non-actionable diagnosis DOES consume `repairAttemptCount` (a real
   strike — the diagnosis lane was genuinely tried and failed to produce a
   fix) but records NO proposal, and the alert trail is honest about the
   0-proposal/N-attempt mismatch rather than fabricating either number.
7. **MEDIUM — `revertProposal` marks reverted before independent
   verification.** Pre-existing behavior unchanged this pass — `revertProposal`
   itself performs the DB write and status transition atomically per-branch;
   `auto_revert_service.ts` layers an independent post-write field-value
   re-read on top (already present, unchanged). Not a new finding introduced
   by this pass's changes.
8. **MEDIUM — full-trail alert lacks target/change fingerprints.** Not
   addressed this pass — out of scope for the critical fixes; the alert
   already carries proposal ids, kind, and repair status list per D2.4's
   contract. Flagged as a possible follow-up, not implemented.
9. **MEDIUM — serial sweep has no per-event timeout.** CONFIRMED and FIXED:
   added `REPAIR_DIAGNOSIS_TIMEOUT_MS` (45s default, test-overridable via
   `diagnosisTimeoutMs`) via `Promise.race`; a hung diagnosis defers without
   blocking other events' sweep turns.

## Checks

- `tsc --noEmit`: pass (0 errors), both before and after every fix.
- Focused D2 suite (this pass): `auto_repair_service.test.ts` 15/15,
  `auto_revert_service.test.ts` 9/9,
  `post_apply_lifecycle.integration.test.ts` 8/8,
  `post_apply_monitor.test.ts`, `org_proposal_apply.test.ts` — all green
  together: **148/148**.
- Adjacent regression sweep (revertProposal/refineConfigApplier/CAS
  callers): `org_proposal_appliers_wiring.test.ts`,
  `w1_corrective_6_boundaries/revisions.test.ts`, `org_proposal_measure.test.ts`,
  `post_apply_events_repository.test.ts`, `post_apply_event.test.ts`,
  `skill_schema_parity.test.ts`, `org_settings_schema_parity.test.ts` — **145/145**.
  Plus `delegation_generator.test.ts`, `config_doctor_core_permissions_contract.test.ts`,
  `w1_corrective_4/5/6_lifecycle/contract.test.ts`,
  `issue_981/857/831/1082_*.test.ts` — **282/283** (1 pre-existing skip).
- Full API suite: **696 files / 5,711 tests — 5,523 passed, 181 skipped, 7
  failed.** The 7 failures were verified to reproduce IDENTICALLY with these
  changes `git stash`ed (checked 2 of the 7 directly:
  `delegation_caller_identity.test.ts`, `issue_1135_audit_lock_contract.test.ts`;
  the other 5 are in an unrelated subsystem — memory
  provenance/injection/index-rebuild) — pre-existing baseline noise, not a
  regression from this work.
- Falsification (each fix broken, confirmed red, restored):
  - Evidence gate disabled (`if (!sufficientEvidence && false)`) →
    2 tests failed red (`pending` incorrectly became `repaired`) → restored, green.
  - CAS override for the repair-chain revert disabled → integration test's
    "three failed repairs" scenario went red (`revert_failed` instead of
    `reverted`) → restored, green.
  - CAS check itself disabled (forced the legacy unconditional-write branch)
    → the "genuine concurrent edit is refused" unit test went red (silently
    reverted over the human's edit) → restored, green.
- `git diff --check`: clean. No dependency/lock file touched (no drift).
- Schema parity: `skill_schema_parity.test.ts` passes with the two new
  `agent_org_post_apply_events` columns present identically in both the
  SQLite migration and the Postgres bootstrap DDL.
- Sandbox live E2E: stood up an ISOLATED sandbox on ports 4297 (engine) /
  4298 (API) / 4299 (gateway) — the default 4097/4098/4099 were occupied by a
  concurrently running, unrelated worktree sandbox (confirmed via `lsof` +
  `ps`; never touched, per scope boundaries). New
  `post_apply_lifecycle_repair_live_e2e.test.ts` (env-gated,
  `RHYTHM_LIVE_E2E=1`) ran against the real fork engine + real 1-minute
  scheduler cron tick + a real LLM diagnosis call:
  - Seeded 5 real error `agent_run_outcomes` rows → guardrail tripped for
    real.
  - A real diagnosis call landed repair attempt 1 (a real proposal + a real
    `compareAndSetConfigField` write + `claimAppliedWithSnapshotAsync`).
  - **Critical assertion**: with zero real post-repair evidence, the event
    stayed `tripped` — same `repairRecheckAfter`, same repair-id list — across
    more than one real cron tick (~65s of real wall-clock wait). This is
    exactly the scenario the OLD design would have gotten wrong (instant
    fabricated pass).
  - Seeded 5 real clean outcomes after the recorded recheck floor → the event
    moved off that floor (ended at `guardrail_status='clear'`,
    `revert_status='not_needed'`, 1 repair recorded) within ~146s total.
  - Sandbox torn down cleanly afterward; ports confirmed free.

## Notes

- Contract docs (`docs/ai/contracts/issue-143{3,4,5}.json`) updated in place
  with `superseded_note` fields explaining what changed and why, plus new
  criteria for the second-pass fixes — not overwritten wholesale, so the
  first pass's now-invalid `judgment_calls` in issue-1433.json (which
  documented the epsilon hack as an accepted design trade-off) are explicitly
  marked superseded rather than silently deleted.
- Deliberately NOT touched: `org_proposal_reconciler.ts` (read-only, out of
  scope per mandate), create-agent/external-adoption/missing-skill
  enrollment (still excluded, per the PR's own stated safe-eligibility
  boundary), any security guard or test weakening.
- UNKNOWN / open: GitNexus impact analysis was not re-run this pass (the
  worktree index was already noted stale in both prior passes' reports); the
  alert payload's lack of target/change fingerprints (finding #8 above) is
  left as a documented, not-yet-implemented follow-up.
