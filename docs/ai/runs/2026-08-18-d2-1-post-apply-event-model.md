---
date: 2026-08-18
repo: Rhythm
branch: agent-stack/si-d2-post-apply-lifecycle
pr: none
issues: [1431]
status: pass
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# D2.1 (#1431) — post-apply event model and repository

First issue of the D2 post-apply monitor/repair/revert lifecycle series
(`docs/ai/contracts/issue-1431.json`). Worktree branched off
`self-improvement-engine-foundation` at `0b5e7237`, which already carries
causal-runtime-v2 C0–C4 (guardrail registry from C3, CAS apply/revert from
C4 — both of D2's stated dependencies).

## Investigation findings (before implementation)

- No prior D2/post-apply/guardrail-monitor/auto-repair/auto-revert files
  existed anywhere in the repo — clean slate for all 5 issues.
- `models/guardrail_registry.ts` (C3) is the closed, executable guardrail
  registry D2.2 must reuse (`evaluateGuardrails`, `terminal-error-rate` /
  `treatment-integrity-failure-rate`) — confirmed present and unchanged.
- The existing "CAS revert" mechanism is `revertProposal` in
  `services/org_proposal_apply.ts`, which restores a proposal's own
  `before_snapshot_json` (e.g. `{agentConfigId, field, priorValue}` for
  refine-config — the LITERAL prior field value, including raw system-prompt
  text when `field==='system_prompt'`). This is pre-existing, established
  behavior for the `agent_org_proposals` table and out of scope to change.
  Critically, this means PostApplyEvent's OWN `pre_change_snapshot_json`
  column must NOT simply copy `proposal.beforeSnapshotJson` verbatim, or it
  would duplicate raw prompt bytes into a second table — directly violating
  this issue's own "no raw prompts/secrets/tool payloads" criterion. Resolved
  by defining `preChangeSnapshotJson` as an opaque, caller-supplied CAS
  pointer (revision/fingerprint, not the raw value) and doc-pointing future
  callers (D2.2/D2.5) at the existing `buildProfileRevisionFingerprint`
  hashing precedent (org_proposal_experiment_service.ts) instead of building
  a second hasher.
- `run_outcome_service.ts` already exports `redactSecrets` (a shape-matching
  secret redactor used on the run-outcome ledger's one free-text column) —
  reused directly rather than writing a second redactor.
- `skill_schema_parity.test.ts` already has a generic per-table SQLite vs.
  Postgres column-set parity loop (`TABLES` array) — adding the new table
  name to that array gives real, enforced dual-engine parity for free,
  matching this issue's own required acceptance criterion, without a new
  bespoke parity test file.
- `agent_org_proposal_retirements` was the simplest precedent for a small
  proposal-adjacent sidecar table with NO DB-level state-machine trigger
  (unlike the enrollment/treatment-receipt tables, which enforce their state
  machine in SQL) — followed that simpler precedent since D2.1 does not yet
  define any cross-field ordering invariant needing DB enforcement.

## Design decisions (see `docs/ai/contracts/issue-1431.json` → `judgment_calls`)

1. `preChangeSnapshotJson` is an opaque caller-supplied string in this phase
   (D2.1 is model + repository + migration only; the live apply-boundary
   wiring that actually populates it is D2.5).
2. Secret redaction happens INSIDE the repository (`redactSecrets` reused
   from `run_outcome_service.ts`) on both `pre_change_snapshot_json` and
   `alert_payload_json`, not left to future callers to remember.
3. No DB-level state-machine trigger — repository-level `updateStatusAsync`
   only, matching the `agent_org_proposal_retirements` precedent.
4. `repairProposalIdsJson` update replaces the whole array and truncates to
   the first `MAX_REPAIR_ATTEMPTS` (3) entries — defensive backstop; the real
   D2.3 3-strike loop is expected to stop at 3 itself.
5. `proposal_id` carries a real FK to `agent_org_proposals(id)` (every event
   is created after a real apply); `profile_id` carries no FK, matching the
   treatment-receipt table's existing precedent of not FK-ing profile_id.

## Files changed

- `apps/api_server/src/models/post_apply_event.ts` (new) — `PostApplyEvent`,
  closed enums (`PostApplyChangeType`, `GuardrailStatus`,
  `PostApplyRevertStatus`), `MAX_REPAIR_ATTEMPTS`, `parseRepairProposalIds`.
- `apps/api_server/src/repositories/post_apply_events_repository.ts` (new) —
  `PostApplyEventsRepository`: `createAsync` (idempotent per proposal id),
  `findByProposalIdAsync`, `findByIdAsync`, `updateStatusAsync`.
- `apps/api_server/src/database/migrations.ts` — additive
  `agent_org_post_apply_events` table + index.
- `apps/api_server/src/database/postgres_bootstrap.ts` — Postgres twin of the
  same table + index.
- `apps/api_server/src/__tests__/skill_schema_parity.test.ts` — added
  `agent_org_post_apply_events` to the `TABLES` parity loop.
- `apps/api_server/src/models/__tests__/post_apply_event.test.ts` (new).
- `apps/api_server/src/repositories/__tests__/post_apply_events_repository.test.ts` (new).
- `docs/ai/contracts/issue-1431.json` (new).

## Checks

RED confirmed before implementation (`Cannot find module '../post_apply_event'` /
`'../post_apply_events_repository'`; parity test failed with `expected 0 to
be greater than 0` for the new table name):

```
cd apps/api_server
npx vitest run src/models/__tests__/post_apply_event.test.ts \
  src/repositories/__tests__/post_apply_events_repository.test.ts \
  src/__tests__/skill_schema_parity.test.ts
```

GREEN after implementation — same command:

```
Test Files  3 passed (3)
     Tests  37 passed (37)
```

- `node_modules/.bin/tsc --noEmit` → clean.
- `npm run build` → PASS (tsc + postbuild copy).
- `git diff --check` → clean.
- Per this worktree's explicit gate policy: focused tests + build + tsc +
  `git diff --check` only — the full `apps/api_server` suite is deferred to
  a later integration checkpoint, not run per-issue.

## Deviations / residual risk

- None. All 7 contract criteria map to passing tests; no criterion marked
  manual/waived.
- D2.1 intentionally does NOT wire `PostApplyEventsRepository.createAsync`
  into any real apply path yet — that is explicitly D2.5's scope. This
  repository is inert (unreferenced by production code) until D2.2–D2.5 land.
