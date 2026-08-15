---
date: 2026-08-14
repo: Rhythm
branch: self-improvement-engine-foundation
base: 9d8c4443f076756cec919e182222fdb45c39abcc
status: in-progress
tags: [plan, rhythm, self-improvement, safety]
---

# Rhythm Self-Improvement Engine Foundation — Atomic Implementation Plan

## Goal

Convert Rhythm's current autonomous suggestion loop into a safe, observable foundation that can generate hypotheses without silently removing capabilities or treating proxy checks as proof of user improvement.

This branch implements the foundation required before broader autonomy:

1. Contain unsafe scope mutation and legacy rollback.
2. Normalize successful/denied MCP telemetry and fail closed when telemetry is unavailable.
3. Exclude internal learner sessions from skill harvesting.
4. Replace lexical retry-loop detection with behavioral attempt evidence.
5. Add an immutable run-outcome and feedback ledger.
6. Add explicit optimizer shadow mode and lifecycle reconciliation.
7. Add proposal evidence/experiment contracts that cannot promote a candidate on a single replay, usage count, or LLM score.

External executable adoption, secret access, broad scope expansion, and production auto-promotion remain human-gated and are deliberately not enabled by this branch.

## Architecture

Reuse the existing Rhythm seams rather than creating a parallel optimizer:

```text
agent_sessions / messages / tool telemetry
  -> deterministic eligibility + identity normalization
  -> run outcome + append-only feedback evidence
  -> existing audit/generator services
  -> immutable proposal evidence contract
  -> shadow candidate / experiment record
  -> human approval for risky changes
  -> compare-and-set apply / inverse revert
  -> verified | inconclusive | regressed outcome
```

The LLM may diagnose and draft. Deterministic services decide whether evidence exists, a target is current, telemetry is available, and an experiment met its gate.

## Campaign invariants

- Base every worker on commit `9d8c4443f076756cec919e182222fdb45c39abcc` plus this plan commit.
- Never modify the dirty primary checkout at `/Users/ajhochhalter/Documents/Rhythm`.
- Every worker gets an isolated Git worktree and branch.
- Strict TDD: write one failing test, run it, implement only enough to pass, rerun.
- No production DB writes. Migrations run only against disposable/test DBs and the dev sandbox's copied DB.
- Do not start an api_server manually. Use `tools/dev/sandbox.sh` only.
- Do not merge to `main`. Merge worker commits only into `self-improvement-engine-foundation`.
- Do not push or open a PR until the integrated branch passes review and live sandbox verification.
- Run GitNexus impact before editing and `detect_changes --base main` before each merge-ready commit.
- Independently review every worker diff; a worker never approves its own code.

## Verified pre-implementation risk

GitNexus upstream impact on the base branch:

- `detectTightenGaps`: HIGH, 5 impacted symbols.
- `classifyProposalRisk`: HIGH, 26 impacted symbols.
- `measureProposal`: HIGH, 10 impacted symbols.
- `resolveExercisedTools`: LOW.
- `applyProposal`: LOW.
- `revertProposal`: LOW.
- `queueSkillExtraction`: LOW.
- `extractWorkflowFailureSignals`: LOW.
- `runOrgOptimizer`: LOW.

Live-audit evidence that this plan must preserve in tests:

- 46 active scope-removal proposals were evaluated; 29 removed servers with completed pre-measurement use.
- 25 had completed use in the current 30-day window, but 11 had already been reintroduced; 14 were both recently used and still absent.
- 69 active scope proposals exist. Replaying the old whole-field snapshots would clobber unrelated changes for 57; 42 would regrant servers, 27 would remove currently granted servers, and 8 would destroy per-tool narrowing.
- Successful calls such as `pco-services_get_plans` and `gitnexus_query` were compared against server IDs `pco-services` and `gitnexus`, causing the functional guard to pass incorrectly.
- 11 harvested drafts came from system sessions: 8 scheduled and 3 self-improvement.

---

# Dependency graph

```text
Plan commit
  ├─ W1 Scope containment + safe rollback
  ├─ W2 Canonical/fail-closed telemetry
  └─ W3 Learning eligibility + behavioral retry evidence
       ↓ merge + integrated checks
  ├─ W4 Immutable outcome/feedback ledger
  └─ W5 Shadow policy + lifecycle reconciler
       ↓ merge + integrated checks
  └─ W6 Proposal evidence + experiment contracts
       ↓
  W7 Live sandbox behavior gate + docs + independent final review
```

W1–W3 are parallel. W4–W5 are parallel after W1–W3 merge. W6 starts only after W4–W5 merge because it consumes the outcome ledger and policy contract. W7 runs only on the integrated branch.

---

# Work package W1 — Scope containment and safe rollback

**Branch:** `self-improvement/scope-lifecycle-safety`

**Owned production files:**

- `apps/api_server/src/services/org_risk_classifier.ts`
- `apps/api_server/src/services/org_proposal_apply.ts`
- `apps/api_server/src/controllers/org_proposals_controller.ts`

**Owned tests:**

- `apps/api_server/src/__tests__/org_risk_classifier.test.ts`
- `apps/api_server/src/__tests__/org_proposal_apply.test.ts`
- `apps/api_server/src/__tests__/org_proposals_routes.test.ts`

**Commit:** `fix(optimizer): contain scope mutations and make rollback conflict-safe`

## Atomic steps

1. Run GitNexus impact for `classifyProposalRisk`, `applyProposal`, and `revertProposal`; record results in the worker summary.
2. RED: add classifier assertions that `tighten-scope` and `prune-scope` are high risk, while existing safe text-only kinds retain their current classification.
3. Run only `org_risk_classifier.test.ts`; verify the two new assertions fail for the expected low-risk result.
4. GREEN: remove `tighten-scope` and `prune-scope` from the low-risk set and list them explicitly as high risk.
5. Rerun the classifier test; verify green.
6. RED: add apply tests proving high-risk scope proposals cannot enter the auto-apply path even when their stored row says `risk='low'`.
7. Run the apply test; verify the expected refusal failure.
8. GREEN: make no extra behavior beyond the existing classifier recheck; adjust only if the test exposes a bypass.
9. RED: add a legacy active-scope route test whose `before_snapshot_json` is the old `{allowedMcpsJson: prior}` form. Assert `POST /:id/revert` returns conflict and the config is byte-for-byte unchanged.
10. Run the route test; verify it fails because the current controller allows the revert.
11. Define a versioned scope snapshot (`scope-delta-v2`) containing target ID, field, removed entries with prior values, exact applied value, and target hash/version material needed for compare-and-set.
12. RED: add an apply test proving new scope changes write the V2 snapshot before mutation.
13. GREEN: update scope apply to write V2 snapshots only.
14. RED: add a revert test proving a V2 snapshot reverts only when the current field equals the expected post-apply value.
15. RED: add a second revert test where an unrelated later scope change occurred; assert no write and no `reverted` status transition.
16. GREEN: implement compare-and-set verification and an entry-level inverse operation. Never replay a legacy whole-field snapshot.
17. RED: add array-shape and tools-map-shape inverse tests, including per-tool narrowing preservation.
18. GREEN: implement the smallest shape-aware inverse needed for those tests.
19. Update controller error text so unsafe legacy/conflicted reverts explain that operator reconciliation is required.
20. Run the three owned test files.
21. Run API TypeScript build.
22. Run GitNexus `detect_changes --base main`; confirm only expected proposal/risk/controller flows changed.
23. Commit only W1-owned files.

## W1 acceptance

- No scope removal can auto-apply.
- Legacy active scope rows cannot be reverted through the API.
- New scope snapshots are versioned.
- Revert is compare-and-set and inverse-only.
- A concurrent/newer scope edit causes a conflict, not a clobber.

---

# Work package W2 — Canonical and fail-closed capability telemetry

**Branch:** `self-improvement/capability-telemetry`

**Owned production files:**

- `apps/api_server/src/services/mcp_scope_name.ts`
- `apps/api_server/src/services/org_exercised_tools_resolver.ts`
- `apps/api_server/src/services/org_audit_service.ts`
- `apps/api_server/src/services/org_proposal_measure.ts`

**Owned tests:**

- `apps/api_server/src/services/__tests__/org_exercised_tools_resolver.test.ts`
- `apps/api_server/src/services/__tests__/org_audit_service.test.ts`
- `apps/api_server/src/__tests__/org_optimizer_scope_false_positives.test.ts`
- existing scope-measure tests adjacent to `org_proposal_measure.ts`

**Commit:** `fix(optimizer): canonicalize scope telemetry and fail closed`

## Atomic steps

1. Run GitNexus impact for `resolveExercisedTools`, `detectTightenGaps`, and `measureProposal`.
2. RED: add canonicalization fixtures:
   - `pco-services_get_plans` resolves to server `pco-services`.
   - `gitnexus_query` resolves to `gitnexus`.
   - exact server IDs still resolve exactly.
   - longest matching server wins when names share prefixes.
   - unknown/ambiguous names stay unresolved.
3. Run the resolver tests; verify failures reflect full-tool/server namespace mismatch.
4. GREEN: extend `mcp_scope_name.ts` with one pure known-catalog resolver shared by successful and denied telemetry paths.
5. RED: change resolver tests to require a discriminated result that distinguishes `available + empty` from `unavailable`.
6. Add fixtures for Postgres/local-table unavailability and thrown DB reads; assert `unavailable`, never an empty-success result.
7. GREEN: return a structured telemetry result containing availability, raw callable names, and canonical server IDs. Keep a narrow compatibility wrapper only if an existing caller needs it.
8. RED: add `detectTightenGaps` tests showing successful canonical use blocks a gap just as a canonical denied attempt does.
9. RED: add a test showing unavailable telemetry emits no tighten gap.
10. GREEN: pass canonical successful-use pairs into scope detection and skip the judgement when telemetry is unavailable.
11. RED: add a scope-measure test where removed `gitnexus` has successful `gitnexus_*` use; assert revert.
12. RED: add a scope-measure test where telemetry is unavailable; assert `inconclusive/skipped`, never keep.
13. GREEN: update scope measurement to compare canonical server IDs and fail closed on unavailable telemetry.
14. Update comments that currently describe empty-set fail-open behavior as intentional.
15. Run all W2-owned tests.
16. Run API TypeScript build.
17. Run GitNexus `detect_changes --base main` and commit only W2-owned files.

## W2 acceptance

- Detection and measurement compare the same canonical capability identity.
- Successful usage blocks removal.
- Denied attempts use the same canonical identity.
- Telemetry failure is distinguishable from genuine zero use and never authorizes a keep/removal.

---

# Work package W3 — Learning eligibility and behavioral retry evidence

**Branch:** `self-improvement/learning-signals`

**Owned production files:**

- Create `apps/api_server/src/services/learning_session_eligibility.ts`
- `apps/api_server/src/services/skill_extractor.ts`
- `apps/api_server/src/services/harvested_skill_evaluator.ts` only if usage scoring needs the shared predicate
- `apps/api_server/src/services/workflow_failure_signal_extractor.ts`

**Owned tests:**

- Create `apps/api_server/src/services/__tests__/learning_session_eligibility.test.ts`
- `apps/api_server/src/__tests__/skill_extractor.test.ts`
- `apps/api_server/src/__tests__/harvested_skill_evaluator.test.ts`
- `apps/api_server/src/__tests__/workflow_failure_signal_extractor.test.ts`

**Commit:** `fix(optimizer): exclude recursive learning and require behavioral retries`

## Atomic steps

1. Run GitNexus impact for `queueSkillExtraction`, `distillFromSession`, and `extractWorkflowFailureSignals`.
2. RED: specify a pure eligibility matrix for skill harvesting:
   - user chat session: eligible.
   - `isSystem=1`: excluded.
   - `category=self_improvement`: excluded.
   - `category=scheduled`: excluded from harvesting.
   - curator roles such as `skill-extract`, org optimizer, and measurement roles: excluded.
   - missing session: excluded/fail closed.
3. GREEN: implement the pure predicate with a machine-readable reason code.
4. RED: prove `queueSkillExtraction` checks eligibility before round counting, lifetime guard consumption, cooldown consumption, or LLM dispatch.
5. GREEN: inject/query the session repository and return early for ineligible sessions.
6. RED: prove direct `distillFromSession` calls independently enforce the same eligibility predicate.
7. GREEN: add the defense-in-depth check.
8. If harvested-skill usage scoring includes internal sessions, add RED/GREEN tests and reuse the same predicate there; do not create a second filter.
9. RED: add retry fixtures from the audit where successful prose discusses retry policy/resume behavior; assert no retry-loop signal.
10. RED: add actual repeated failed tool-attempt fixtures using persisted message-part state/call identity; assert a retry signal only when a failed/timeout operation is materially repeated.
11. RED: add recovery fixtures distinguishing recovered retry from unresolved loop.
12. GREEN: replace lexical phrase counts as the primary detector with structured tool-attempt traces. Lexical text may annotate evidence but can never create the signal.
13. If current parts lack sufficient state/call identity, fail closed by suppressing the signal rather than falling back to prose.
14. Run all W3-owned tests.
15. Run API TypeScript build.
16. Run GitNexus `detect_changes --base main` and commit only W3-owned files.

## W3 acceptance

- Internal/self-improvement/scheduled curator sessions cannot recursively generate harvested skills.
- Existing 11 system-sourced drafts are not deleted or mutated by code; they remain for a separate operator review.
- Product prose containing “retry” cannot create a retry-loop proposal.
- Retry evidence is based on actual failed/repeated operations and records recovery state.

---

# Integration gate after W1–W3

1. Independently review each commit against this plan.
2. Reject drive-by changes or file ownership violations.
3. Merge W2, then W1, then W3 into the integration branch.
4. Resolve any genuine conflict with a neutral reconciler using both worker intent summaries.
5. Run targeted tests from all three packages.
6. Run `npm run build` in `apps/api_server`.
7. Run the complete API Vitest suite with a generous timeout.
8. Record baseline failures separately; only new failures block.

---

# Work package W4 — Immutable outcome and feedback ledger

**Branch:** `self-improvement/outcome-ledger`

**Owned production files:**

- `apps/api_server/src/database/migrations.ts`
- `apps/api_server/src/database/postgres_bootstrap.ts`
- Create `apps/api_server/src/models/agent_run_outcome.ts`
- Create `apps/api_server/src/repositories/agent_run_outcomes_repository.ts`
- Create `apps/api_server/src/services/run_outcome_service.ts`
- Create `apps/api_server/src/routes/run_outcome_routes.ts`
- route registration file(s) discovered by the worker
- minimal terminal-session hooks in `agent_runner.ts` and `opencode_stream_bridge.ts`

**Owned tests:**

- Create repository/service/route tests adjacent to existing API conventions.
- Extend `migrations_self_heal.test.ts` and Postgres parity tests.

**Commit:** `feat(optimizer): add immutable outcomes and append-only feedback`

## Atomic steps

1. Impact-analyze terminal session persistence hooks and route registration.
2. RED: migration tests require:
   - exactly one mutable-finalized outcome row per root run, guarded by a unique root session ID;
   - append-only feedback events with source and confidence;
   - exact links to session/root session, scheduled occurrence, proposal/experiment variant, profile/config revision, and attribution JSON;
   - separate objective, explicit-user, and inferred evidence fields.
3. GREEN: add additive SQLite and Postgres schema. No destructive migration and no production backfill.
4. RED/GREEN: repository supports idempotent finalization and append-only feedback insertion; explicit feedback is never overwritten by inferred feedback.
5. RED/GREEN: deterministic finalizer maps terminal status plus objective artifact/error/approval evidence to `success | partial | failure | inconclusive`.
6. RED/GREEN: feedback API accepts `success | partial | failure` plus optional reason and actor; validates ownership/auth using existing route conventions.
7. RED/GREEN: terminal hooks create/finalize one ledger record without blocking the user turn. Duplicate terminal events remain idempotent.
8. Record exact invoked tool/skill revisions only when attributable; store unknown explicitly rather than inventing attribution.
9. Ensure prompts, tool arguments/outputs, credentials, and secret-like values are not copied into the ledger.
10. Run migration, repository, route, and hook tests; run build; run GitNexus detect-changes; commit.

## W4 acceptance

- One terminal outcome per root run.
- Append-only contradictory feedback is retained.
- Explicit user verdict cannot be replaced by inference.
- Exact revisions are attributed when known and marked unknown otherwise.
- No raw prompts/tool payloads/secrets enter the new tables.

---

# Work package W5 — Shadow policy and lifecycle reconciliation

**Branch:** `self-improvement/shadow-mode-reconciler`

**Owned production files:**

- Create `apps/api_server/src/services/org_optimizer_policy.ts`
- `apps/api_server/src/services/org_optimizer_run_service.ts`
- Create `apps/api_server/src/services/org_proposal_reconciler.ts`
- Create a default-dry-run operator script under `apps/api_server/scripts/`
- minimal repository helpers in `agent_org_proposals_repository.ts`

**Owned tests:**

- optimizer run tests adjacent to `org_optimizer_run_service.ts`
- Create reconciler tests under `apps/api_server/src/services/__tests__/`

**Commit:** `feat(optimizer): default to shadow mode and reconcile stale lifecycle rows`

## Atomic steps

1. Impact-analyze `runOrgOptimizer` and proposal repository state transitions.
2. RED: policy parser defaults to `shadow`, accepts only `off | shadow | human_only | auto`, and rejects invalid values to the safest mode.
3. GREEN: implement pure policy parser and expose kill switches per change family.
4. RED: optimizer shadow run still audits/generates/ranks proposals but calls no apply, measure, revert, install, or target writer.
5. GREEN: gate the mutation/sweep phases while preserving result counters that identify shadow candidates.
6. RED: reconciler classifies active scope rows as effective, reintroduced/drifted, unsafe legacy rollback, conflicted, or unverifiable.
7. GREEN: implement read-only reconciliation against current config and versioned snapshots.
8. RED: operator script prints stable JSON and mutates nothing without `--apply`.
9. GREEN: default to dry-run. `--apply` may only retire/supersede stale metadata; it must never restore/remove permissions automatically.
10. RED/GREEN: measuring rows gain retry/deadline accounting or a deterministic inconclusive classification rather than indefinite silent retry.
11. Run owned tests, build, detect changes, and commit.

## W5 acceptance

- Default optimizer mode is shadow.
- Shadow mode has zero mutation side effects.
- Reconciler reports the 69 legacy rows safely without changing config.
- Dry-run is the default and permission restoration/removal is never automated.
- Stuck measuring work becomes inspectable/inconclusive instead of eternal.

---

# Work package W6 — Proposal evidence and experiment contracts

**Branch:** `self-improvement/experiment-contracts`

**Starts from:** integrated W1–W5 branch.

**Owned production files:**

- Create `apps/api_server/src/models/proposal_evidence_bundle.ts`
- Create `apps/api_server/src/services/proposal_evidence_validator.ts`
- Create `apps/api_server/src/models/agent_org_experiment.ts`
- Create `apps/api_server/src/repositories/agent_org_experiments_repository.ts`
- Create `apps/api_server/src/services/org_proposal_experiment_service.ts`
- `apps/api_server/src/services/org_proposal_measure.ts`
- additive migration/bootstrap changes

**Commit:** `feat(optimizer): require evidence bundles and controlled experiment gates`

## Atomic steps

1. Impact-analyze `measureProposal` on the post-W1–W5 integration branch.
2. RED/GREEN: define a versioned evidence bundle requiring source event/session IDs, counter-evidence search, target ref/hash, expected outcome, primary metric, guardrails, experiment adapter, rollback rule, generator version, and confidence calibration version.
3. RED/GREEN: validator rejects missing target hash, missing outcome metric, missing source evidence, absent counter-evidence search, or unsupported adapter.
4. RED/GREEN: add additive experiment table/repository with immutable baseline/candidate specs, deterministic assignment key, predeclared stopping rule, maximum exposure, results, and `promote | inconclusive | regress` decision.
5. RED/GREEN: experiment service records paired baseline/candidate outcomes from W4's ledger and refuses promotion without both cohorts.
6. RED/GREEN: no adapter can promote on one replay, one usage count, a shorter allowlist, output length, disappearance of a regex, or one LLM score.
7. Change current body/rerun measures into diagnostic/shadow evidence only; they may mark `inconclusive` but cannot set verified improvement.
8. Preserve human-approved apply/revert, but separate deployment status from outcome status.
9. Run migration/repository/service/measurement tests, full build, detect changes, and commit.

## W6 acceptance

- Every promotable candidate has reproducible evidence and a predeclared experiment.
- Baseline and candidate are both represented.
- Incomplete evidence becomes inconclusive.
- LLM scores and proxy reruns cannot establish verified improvement.
- Deployment state and outcome state are distinct.

---

# Work package W7 — Integrated live behavior and documentation gate

**Runs only on:** `self-improvement-engine-foundation`

## Atomic steps

1. Add one env-gated live E2E suite that drives real API behavior in the isolated sandbox and copied SQLite DB.
2. Prove shadow optimizer generation creates proposals without changing target config, installing tools, or changing proposal target state.
3. Seed a legacy scope proposal **in `status='active'`** and prove the revert endpoint fails closed without changing config. The status matters: from any other status the controller rejects at its status guard first, returning the same 409 for an unrelated reason, so a test seeded elsewhere passes without ever reaching the snapshot guard this step is about.
4. Seed a V2 scope snapshot, introduce a concurrent config edit, and prove revert refuses without clobbering the edit. "Conflict" is three distinct shipped outcomes, and the test must say which it expects: `unsafe-legacy-scope` (409, refused by the snapshot guard) and `conflict` (409, CAS lost to the concurrent edit) both mean nothing happened, while `reconciliation-required` means the transaction may have committed and a human must inspect the pair. The third is the state an operator most needs to see and must never be folded into the other two.
5. Ingest successful `gitnexus_*`/`pco-services_*` tool events and prove canonical usage blocks “unused” classification. `detectTightenGaps` also requires `MIN_TIGHTEN_ACTIVITY_COUNT` (10) sessions and `MIN_TIGHTEN_OBSERVATION_DAYS` (7) days of profile age, so a fixture created through the API moments earlier generates no gap at all — nothing to block, and the assertion passes with canonicalization doing nothing. Back-date `agent_configs.created_at` and pair the case with a control profile that DOES yield a removal proposal.
6. Simulate telemetry unavailability and prove no removal/keep decision is authorized.
7. Complete a user session and prove exactly one terminal outcome plus append-only feedback events.
8. Prove a self-improvement/system session cannot trigger skill extraction.
9. Prove retry-policy prose does not create a retry-loop proposal, and that a genuinely repeated failed operation does. There is no proposal kind named `retry-loop`: the workflow-signal generator maps the signal category `retry-loop` to a `create-recipe` proposal titled `Recipe: reduce retry loops (<profile>)` (`workflow_signal_generator.ts`). A test matching on the kind name finds nothing and passes forever.
10. Run `npm run build`.
11. Run targeted suites serially.
12. Run full API Vitest suite.
13. Run GitNexus `detect_changes --base main`.
14. Run static security scan on added lines.
15. Dispatch independent spec-compliance and code-quality reviewers.
16. Fix valid blockers in isolated corrective worktree(s), recommit, and rerun all affected gates.
17. Start the sandbox only through `tools/dev/sandbox.sh up --foreground` with unique ports and directory.
18. Run the live E2E suite, capture exact output, and always run scoped `down` cleanup plus listener assertions.
19. Write `docs/ai/runs/2026-08-14-self-improvement-engine-foundation.md` with files, commands, outputs, limitations, and manual review items.
20. Write a durable decision record for shadow-by-default and CAS/inverse scope rollback.
21. Update `docs/ai/project-state.md` only after all checks reflect actual state.
22. Commit documentation separately.

---

# Plan amendments

Recorded rather than applied silently, so the plan and the code cannot drift.

**2026-08-15 — W7 acceptance wording (editorial, no scope change).** Steps 3, 4,
5 and 9 named behaviour in product language that the shipped code expresses
differently or gates more tightly. Three of the four were vacuous-pass hazards:
a test written to the original words would have gone green with the assertion
never engaging. The steps now name the exact status, outcome, threshold and
proposal shape. No acceptance criterion was added, removed or relaxed.

**2026-08-15 — three ambiguities reconciled during W4/W5 contract derivation.**
Each was resolved from this plan's own architecture, campaign invariants and
final acceptance gates; the reasoning lives in the slice contracts under
`plan_interpretations`.

1. *Shadow mode versus the W1 recovery sweep.* W1 corrective-6 added a bounded
   recovery sweep whose only production caller is `runOrgOptimizer`. Shadow is
   the default mode, so gating the sweep phases naively would make that repair
   path dead code the moment W5 lands. Two acceptance statements had to hold at
   once — "shadow has zero mutation side effects" and "lifecycle drift is
   reportable with a default-dry-run reconciler". Resolution: in shadow the
   sweep runs report-only, writing nothing; it acts in `human_only` and `auto`,
   where an operator has opted in.
2. *W5 step 10's "retry/deadline accounting **or** a deterministic inconclusive
   classification".* Persisted accounting needs new columns, and every schema
   file is W4-owned, so building it in W5 would break the parallelism this
   plan's dependency graph requires. Take the disjunction: implement the
   classification branch from columns that already exist.
3. *W4 step 2's "exactly one **mutable**-finalized outcome row" in a package
   titled "Immutable outcome and feedback ledger".* Read as: mutable until
   finalized, immutable after. Now pinned by its own criterion so the reading is
   testable rather than assumed.

---

# Final acceptance gates

- [ ] Primary checkout remains untouched.
- [ ] All worker commits are present on one integration branch.
- [ ] No merge to main.
- [ ] Scope prune/tighten cannot auto-apply.
- [ ] Legacy scope rollback cannot clobber current permissions.
- [ ] New scope rollback uses compare-and-set and inverse semantics.
- [ ] Canonical server identity is shared by successful and denied telemetry.
- [ ] Telemetry failure fails closed.
- [ ] Internal learner sessions cannot recursively harvest skills.
- [ ] Retry prose cannot create behavioral retry signals.
- [ ] One immutable terminal outcome exists per root run.
- [ ] Explicit and inferred feedback remain distinct and append-only.
- [ ] Optimizer defaults to shadow and shadow has zero target mutation.
- [ ] Lifecycle drift is reportable with a default-dry-run reconciler.
- [ ] A proposal cannot become verified from one replay, usage count, regex disappearance, allowlist shrink, or LLM score.
- [ ] Targeted tests, full API tests, TypeScript build, GitNexus detect-changes, independent review, and isolated live behavior all pass—or remaining blockers are reported exactly.

## Deferred by design

These depend on this foundation and remain separate follow-up branches:

- Sandbox installation/vetting of external executable tools.
- Requester-only canary enablement and uninstall compensation.
- Desktop feedback controls beyond the API contract.
- Statistical promotion for high-volume repeatable task families.
- Any automatic broad-scope, secret-bearing, destructive, or external-code mutation.
