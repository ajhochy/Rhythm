---
date: 2026-07-02
repo: Rhythm
branch: mega-844-model-routing
pr: null
issues: [844]
status: done
tags: [run, Rhythm]
---

# #844 (tokens-04) — Tiered model routing

## Files

- `apps/api_server/src/services/agent_model_resolver.ts` — added the tiered
  routing policy layer: `ModelTier`, `TASK_KIND_TIER_POLICY`,
  `resolveModelTier`, `classifyRouteTier`, `NEAR_BUDGET_REMAINING_THRESHOLD`,
  `resolveTieredModel`, `logDecision`. Purely additive — no existing export's
  behavior changed.
- `apps/api_server/src/services/usage_budget_service.ts` — untouched (only
  consumed via its existing `getUsageBudget()` export).
- `apps/api_server/src/services/agent_profile_scope.ts` — added
  `ProfileScope.modelTierHint` (additive field; `model` resolution unchanged).
- `apps/api_server/src/services/agent_runner.ts` — added `AgentRunOptions.taskKind`
  (opt-in); when supplied, layers `resolveTieredModel()` on top of the existing
  `modelOverride > profile model > default` precedence in `_runOnce`.
- `apps/api_server/src/repositories/agent_configs_repository.ts` — added
  `modelTierHint` field (model/input/row/insert/update).
- `apps/api_server/src/controllers/agent_configs_controller.ts` — validated
  and wired `modelTierHint` on create/patch.
- `apps/api_server/src/database/migrations.ts` — additive SQLite-only
  migration at the very end of `runMigrations`: `agent_configs.model_tier_hint
  TEXT`, clearly delimited with a `#844` banner comment.
- Tests: `apps/api_server/src/__tests__/issue_844_contract.test.ts` (AC-mapped,
  8 tests), `apps/api_server/src/services/agent_model_resolver.test.ts` (9
  tests), `apps/api_server/src/services/usage_budget_service.test.ts` (2
  tests, first-ever coverage for this service), `apps/api_server/src/services/model_routing.test.ts`
  (4 tests). Updated 2 pre-existing test files
  (`p2_systemprompt_ocagent.test.ts`, `skill_injection_runner.test.ts`) to add
  the new required `ProfileScope.modelTierHint` field to their literal mocks.
- `docs/ai/contracts/issue-844.json` — acceptance contract, 4 criteria, all
  automated (no manual/not_tested entries).

## Tier policy shape

- `ModelTier = 'cheap' | 'standard' | 'frontier'`.
- `TASK_KIND_TIER_POLICY`: triage/formatting/extraction/summarization →
  cheap; planning/judgment → frontier; unrecognized/absent task kind →
  standard (default).
- `classifyRouteTier(route)` buckets a concrete `ModelRoute` into a tier by
  loose model-id substring match (opus/pro/gpt-5.3-codex → frontier;
  haiku/mini/flash/qwen → cheap; else → standard) — verified every currently
  configured route in `ROUTE_FALLBACKS_BY_AGENT` classifies into exactly one
  tier (`agent_model_resolver.test.ts`).
- Profile-level `model_tier_hint` (SQLite `agent_configs` column) is the
  `explicitTierHint` fed into `resolveModelTier()`.

## Override precedence

1. `modelOverride` (explicit caller-supplied `{providerID, modelID}`) —
   ALWAYS wins. Never downgraded for budget. `overrideApplied: true`,
   `downgradedForBudget: false` unconditionally.
2. `explicitTierHint` (profile's `model_tier_hint`) — wins over the task-kind
   default.
3. `taskKind` → `TASK_KIND_TIER_POLICY` default.
4. Fallback: `standard` tier.

Budget downgrade only applies AFTER step 1: once a target tier is picked (via
2/3/4), if the chosen route's provider is near its usage budget (per
`usage_budget_service.getUsageBudget()`, threshold
`NEAR_BUDGET_REMAINING_THRESHOLD` = 0.15 remaining, env-overridable via
`AGENT_MODEL_ROUTING_NEAR_BUDGET_FRACTION`), the resolver steps down one tier
and sets `downgradedForBudget: true` with a `reason` string explaining why.
Falsification (below) confirms an explicit override cannot be downgraded.

`agent_runner.ts` wiring is fully opt-in: `AgentRunOptions.taskKind` is a new
optional field. Every existing caller (that doesn't pass it) sees byte-for-byte
unchanged model resolution — `resolveTieredModel()` is never invoked.

## Postgres parity decision + evidence

`agent_configs` exists in BOTH SQLite (`migrations.ts`) and Postgres
(`postgres_bootstrap.ts`), but several existing profile-scoping columns
(`is_manager`, `system_prompt`, `allowed_mcps_json`, `allowed_skills_json`)
are SQLite-only — verified by grep: zero matches for those column names in
`postgres_bootstrap.ts`. Root cause: `AgentConfigsRepository` reads via
`getDb()` (better-sqlite3 API), which `throws` when `DB_CLIENT=postgres` (see
`database/db.ts`). This means agent-profile lookups
(`resolveRunModel`/`resolveProfileScope`/the new `resolveModelTier`) only ever
run against SQLite — the local agent server on :4001, never production
Postgres. `model_tier_hint` follows the exact same established pattern:
SQLite-only, added at the very end of `runMigrations` with a `#844` banner
comment, deliberately NOT added to `postgres_bootstrap.ts`. Verified with
`grep -c model_tier_hint postgres_bootstrap.ts` → 0.

## Contract path

`docs/ai/contracts/issue-844.json` — 4 criteria (issue-844-c1..c4), all mode
`unit`, all `not_tested: []`.

## Checks / evidence

- `npx vitest run agent_model_resolver usage_budget model_routing` → 3 files,
  14 tests, all pass (no test file previously existed for `usage_budget` —
  added `usage_budget_service.test.ts`; `model_routing` did not correspond to
  an existing filename — added `model_routing.test.ts`).
- `npx vitest run issue_844_contract` → 8/8 pass (all AC-mapped).
- `./node_modules/.bin/tsc --noEmit` → clean, zero errors.
- `npx vitest run` (full suite) → 186 files / 1585 tests, all pass, 0
  regressions vs the `codex/mega-2026-07-02` base (before this change: same
  suite passed at the base commit — confirmed by running full suite
  immediately after the base checkout before any edits).

## Falsification

Temporarily disabled the `modelOverride` bypass in `resolveTieredModel`
(`if (false && opts.modelOverride)`), reran `issue_844_contract` →
issue-844-c4 ("an explicit modelOverride bypasses tier policy AND budget
downgrade") failed as expected: the decision fell through to the task-kind
policy (`triage` → cheap → `claude-haiku-4-5`) instead of honoring the
override (`claude-opus-4-7`). Reverted; reran full targeted + full suite →
all green again. This confirms the c4 test is load-bearing, not a false
green.

## Deviations from the issue's likely-files list

- `agent_configs_controller.ts` was NOT explicitly named in "Likely files" but
  was touched to expose `modelTierHint` on the create/patch API surface —
  without this the new column would be unreachable from any client. Scoped
  strictly to the one new field; no other controller behavior changed.
- `agent_profile_scope.ts` was not explicitly named but was the natural seam
  to surface `modelTierHint` from a profile row to `agent_runner.ts` (it
  already owns `model`/`systemPrompt`/`ocAgent` in the same pattern).
- Two pre-existing test files needed a one-line addition
  (`modelTierHint: null,`) to their literal `ProfileScope` mocks to keep
  `tsc --noEmit` clean — no behavioral test assertions changed.

## Risks

- `classifyRouteTier`'s substring matching is a heuristic, not an exact
  catalog lookup — a future model id that doesn't contain 'opus'/'haiku'/
  'mini'/'flash'/'pro'/'qwen' falls through to 'standard' by default. This
  mirrors the existing codebase's general posture (loose model-id matching is
  already used elsewhere, e.g. `usage_budget_service`'s probe model), but is
  worth revisiting if a new frontier-tier model with a non-obvious id is added
  to `ROUTE_FALLBACKS_BY_AGENT`.
- `agent_runner.ts`'s tiered-routing call is wrapped in try/catch and falls
  back to the pre-existing precedence on any failure — by design, so a
  routing-policy bug can never block a run, but it also means a persistent
  failure in `resolveTieredModel` would silently degrade back to "no tiering"
  without a loud alarm beyond the `logger.warn` line. Acceptable for a
  cost-optimization feature (fail-open is correct here) but should feed into
  the #819 org audit as a "tiering active vs disabled" signal if adopted more
  broadly.
- No caller in the current codebase yet passes `taskKind` into
  `AgentRunOptions` — this issue wires the POLICY and the plumbing, but
  actually classifying real call sites (e.g. secretary triage, scheduler
  planning runs) by task kind is left to follow-up work / the #819 org audit
  to inform which task kinds matter most in practice.
