# skill-unify2-03 — Proposal queue + re-target the self-improvement loop at engine skills

## Context
Epic: run self-improvement on ALL engine skills. Decision:
`docs/ai/decisions/2026-06-28-unify-skill-source-and-self-improvement.md`.

Today `skill_extractor.ts` distills candidates and `skill_refiner.ts` judges them, but
both operate over the **DB rows** (`agent_skills`) and either create a new draft or
`reviseInPlace` a DB row. The user wants the loop to improve **every engine skill** —
handwritten, imported, external, managed. This issue re-targets the loop at the live
engine skill set and changes its output from a direct DB/file write to a
**`status='proposed'` sidecar row** (the review queue). NOTHING touches a SKILL.md
here — application happens only after human review (issue 04).

Prior art (current-plan `## Prior Art`): self-improving-skill agents emit evidence-gated
proposals, never silent in-place edits; the human gate is the safety mechanism.

## Acceptance criteria
- The extractor/refiner find their revision target among **live engine skills**
  (resolved via the unified read / `findByName`), not only DB rows. Matching uses the
  existing same-skill logic (exact `name` match OR relevance ≥ threshold).
- When the loop decides a skill should improve, it writes a sidecar row with:
  `status='proposed'`, `proposed_for_name` = target engine skill `name`,
  `base_version` = the target's current version, `origin_location` = the target's
  `location`, `is_external` = 1 iff the target is NOT in the managed dir, plus the
  candidate `body`, `confidence`, `source`, and a trigger/evidence reference (e.g. the
  session id) recorded in `source`/`description`.
- The loop **never writes a SKILL.md** and never calls `reviseInPlace`/`materialize`
  in this path — it only enqueues a proposal. (Application is issue 04.)
- Both a **managed** target and an **external** target produce a proposal row;
  `is_external` distinguishes them so issue 04 can choose revise-in-place vs
  fork-to-managed.
- Existing guards preserved: fire-and-forget, never-throws, `isTestEnv`-guarded (zero
  LLM calls / zero writes under `VITEST`), Postgres no-op where the current services
  no-op, cold-start throttle (#746).
- `buildSkillsPreface` stays an inert hint; it may now read the unified set but its
  output is still never persisted and never gates capability.
- Duplicate-proposal guard: if an open `'proposed'` row already exists for the same
  `proposed_for_name` + `base_version`, do not enqueue a second identical one.

## Likely files
- `apps/api_server/src/services/skill_extractor.ts`
- `apps/api_server/src/services/skill_refiner.ts`
- `apps/api_server/src/services/skill_retrieval.ts` (target resolution over live set)
- `apps/api_server/src/repositories/agent_skills_repository.ts` (enqueueProposal,
  listOpenProposals, findOpenProposal)

## Dependencies / order
After 01 (schema) + 02 (unified read for target resolution).

## Safety notes
- This issue must NOT write any SKILL.md or call the materializer. The only output is
  a `proposed` DB row. (The danger of corrupting handwritten/external files is
  eliminated by deferring all file writes to the reviewed apply path.)
- Keep the `isTestEnv` double-guard: no real LLM/judge calls under tests.

## Required tests
- vitest (injected judge + injected repo): a "better" verdict on a managed target →
  a `proposed` row created (NOT applied, no file write); on an external target →
  `proposed` row with `is_external=1`.
- vitest: under `VITEST`, zero LLM calls and zero writes.
- vitest: duplicate proposal for same name+base_version is not re-enqueued.
- vitest: judge throws / "equal" / "worse" → no proposal, no throw.

## Open question that changes this issue
If the user enables **auto-apply for managed-only high-confidence revisions** (Known
Ambiguity), add a branch here that, for `is_external=0` AND confidence ≥ threshold,
marks the proposal auto-approvable (still routed through issue 04's apply path).
Default: human-gate-always.
