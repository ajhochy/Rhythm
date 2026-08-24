---
date: 2026-08-18
repo: Rhythm
branch: agent-stack/si-causal-runtime-v2-codex
pr: none
issues: [1448]
status: pass
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# C5 — automatic evidence construction

Contract phase C5 of `docs/ai/contracts/issue-causal-runtime-v2.json`, tracked under
#1448's umbrella. Scope/results recorded in `docs/ai/contracts/issue-c5.json`.

## Investigation findings (before implementation)

- `ProposalEvidenceBundle` / `PROPOSAL_EVIDENCE_BUNDLE_VERSION` ('proposal-evidence-v1')
  already existed (W6, extended C3) in `models/proposal_evidence_bundle.ts`, with a
  fail-closed validator in `services/proposal_evidence_validator.ts`. Neither had a
  "v2"/builder concept — every bundle in the codebase (production route + ~50 test
  fixtures) is hand-typed by an operator via `declareExperiment`.
- No proposal generator (`services/generators/*.ts`) imports or constructs anything
  evidence-bundle-shaped today — confirmed by grep before writing the C5-2 proof test.
  Generators only ever write `AgentOrgProposalInput` (no `evidenceBundle` field exists
  on that type at all), so requirement 2 ("generators may not fabricate...") was
  already structurally true; C5 adds a regression-guard test, not new refusal code.
- No "behavioral fact" model existed, but `AgentRunOutcome` (W4,
  `models/agent_run_outcome.ts`) already IS the normalized, immutable, safe-aggregate-
  only ledger row requirement 1 describes: a stable id, source session identity,
  `profileId`/`configRevision`, and only closed enum/count evidence fields (never raw
  content) by construction. This is why requirement 1 is satisfied as a VIEW
  (`behavioral_fact.ts`), not a new table — the contract's own wording explicitly
  allows "record/view."
- `org_proposal_experiment_service.ts` already has the EXACT target-identity
  primitives requirement 3 needs (`toProfileTargetRef`, `buildProfileRevisionFingerprint`)
  — both module-private, used by `findEligibleExperiment`'s own target-hash equality
  check. Exporting them (no body change) was the only way for the new evidence
  builder to produce a `target.hash` provably identical to what that eligibility
  check will later recompute, rather than risking two independent hash
  implementations drifting apart.
- `experiment_treatment_adapter.ts`'s `validateStrictRefineConfigChange` (C2) already
  parses a proposal's `change_json` into the exact `{agentConfigId, field, value}`
  patch shape the builder needs — reused directly rather than re-parsing.
- `AgentRunOutcomesRepository` had `listByExperimentAsync` (cohort-labelled rows for
  ONE experiment) but nothing to read a profile's whole prior fact history
  independent of any experiment — the exact gap a NEW proposal (no experiment yet)
  needs filled. Added `listByProfileAsync`, mirroring `listByExperimentAsync`'s exact
  dual-engine style.
- The operator declaration route (`OrgProposalsController.declareExperiment`) already
  called `validateEvidenceBundle(body.evidenceBundle)` unconditionally — requirement
  5's "same validation" is satisfied by routing a builder-produced bundle through
  that SAME call, not a parallel path.

## Design decisions (see `docs/ai/contracts/issue-c5.json` → `judgment_calls` for the full text)

1. **Requirement 1 is a VIEW over the existing W4 ledger, not a new table** — reuse,
   not rebuild. `factFamily`/`detectorVersion` are closed/fixed constants (one
   detector exists today).
2. **The evidence builder supports `refine-config` (system-prompt-v1) only** —
   matches the parent contract's own global invariant that this is the only
   shippable treatment family; every other kind is refused by name.
3. **Qualifying facts = prior error/failure outcomes for the target profile;
   counter-evidence = prior success outcomes for the same profile** — a full,
   uncapped ledger scan (self-improvement fact volumes are small), so successful
   coverage is always exactly 1; the only way coverage is incomplete is the scan
   failing to run at all, which fails the whole build closed.
4. **"Typed counter-evidence search" is a new closed `CounterEvidenceSearchMethod`
   registry** (today: `same-profile-ledger-scan`) plus a required `coverage` field —
   both REQUIRED only on the new `proposal-evidence-v2` version, so every existing
   v1 fixture in the repo keeps validating unchanged.
5. **`toProfileTargetRef`/`buildProfileRevisionFingerprint` were exported, not
   duplicated** — a pure visibility change, zero behavior change, verified by the
   full pre-existing C0-C4 regression suite for that file staying green.
6. **`declareExperiment` gained exactly one fallback branch**: build evidence only
   when `evidenceBundle` is omitted entirely; an explicit operator bundle is
   byte-for-byte unchanged from before this phase.

## Commits

1. **`4f6f9a13`** — `feat(optimizer): normalized behavioral fact view over the run-outcome ledger`
   `models/behavioral_fact.ts` (new), `repositories/agent_run_outcomes_repository.ts`
   (`listByProfileAsync`). Focused tests: `models/__tests__/behavioral_fact.test.ts`
   (8 tests, new) + `repositories/__tests__/agent_run_outcomes_repository.test.ts`
   (+2 tests) — 21/21 pass. Covers C5 requirement 1.
2. **`42a91bc6`** — `feat(optimizer): deterministic proposal-evidence-v2 builder`
   `models/proposal_evidence_bundle.ts` (`PROPOSAL_EVIDENCE_BUNDLE_V2_VERSION`,
   `CounterEvidenceSearchMethod` registry), `services/proposal_evidence_validator.ts`
   (v1/v2 dual acceptance + v2-only coverage/method checks),
   `services/org_proposal_experiment_service.ts` (exported `toProfileTargetRef` /
   `buildProfileRevisionFingerprint`), `services/proposal_evidence_builder.ts` (new).
   Focused tests: `services/__tests__/proposal_evidence_validator.test.ts` (+6 tests)
   + `services/__tests__/proposal_evidence_builder.test.ts` (9 tests, new) — 45/45
   pass. Covers C5 requirements 2, 3, 4.
3. **`78f3a986`** — `feat(optimizer): wire the evidence builder into the operator declare route`
   `controllers/org_proposals_controller.ts` (`declareExperiment` fallback branch).
   Focused tests: `__tests__/c5_evidence_builder_route_wiring.test.ts` (3 tests, new)
   — 3/3 pass. Covers C5 requirement 5.

## Checks

Per-commit (`cd apps/api_server && export PATH=/opt/homebrew/opt/node@22/bin:$PATH`):

- `node_modules/.bin/tsc --noEmit` → clean after every commit.
- `npm run build` → PASS after every commit.
- `git diff --check` → clean before every commit.

Final combined run — the phase's own `test_command` (see `issue-c5.json`):

```
npx vitest run \
  src/models/__tests__/behavioral_fact.test.ts \
  src/repositories/__tests__/agent_run_outcomes_repository.test.ts \
  src/models/__tests__/proposal_evidence_bundle.test.ts \
  src/services/__tests__/proposal_evidence_validator.test.ts \
  src/services/__tests__/proposal_evidence_builder.test.ts \
  src/__tests__/c5_evidence_builder_route_wiring.test.ts
```
→ **6 files, 78 tests, all pass.**

Wider regression run (adds every C0-C4 file this phase touched or is adjacent to —
`org_proposal_experiment_service`/`_collecting`, `experiment_cohort_wiring_contract`,
`c2_a_reserved_treatment_dispatch`, `issue_1450`/`1451_contract`,
`c2_d_s4_ws_reserved_treatment_dispatch`, `org_proposal_appliers_wiring`,
`org_proposal_apply`, `org_proposal_measure`, `agent_org_proposals`,
`org_proposals_routes`): **18 files, 383 tests, all pass.**

Per this campaign's explicit gate policy, the FULL `apps/api_server` suite was
**not** run — deferred to the end of the whole C2-D→C6 sequence.

## Deviations / residual risk

- Every judgment call above is a genuine, narrow scope decision covered by a real,
  currently-green test (see `docs/ai/contracts/issue-c5.json` → `judgment_calls`).
  All 5 of C5's `required_behavior` items map to passing criteria.
- Two failure-mode branches (a forced `listByProfileAsync` read-failure injection,
  and the defensive "unknown metric" check) are real, reachable code but not
  independently unit-tested with a forced-failure fixture this phase — recorded in
  `issue-c5.json`'s `not_tested` list rather than silently left unstated.
- GitNexus `impact`/`context` returned "not found" for `buildProfileRevisionFingerprint`,
  `toProfileTargetRef`, and `declareExperiment` this phase (stale index for this
  worktree/branch) — proceeded on manual grep-based impact analysis instead (every
  call site read before editing) per AGENTS.md's documented fallback when the tool
  cannot resolve a symbol; flagging again for the parent's final review pass, same
  posture as C3/C4's run notes.
- Did not start C6 scope (versioned calibration + operator/release surface). C5's 5
  required_behavior items are all done and gate-clean; stopping here per the
  dispatch's explicit "do NOT start C6 scope" instruction.
