---
date: 2026-07-17
repo: Rhythm
branch: feat/1118-per-profile-reasoning-effort
pr: null
issues: [1118]
status: implemented, pending verification-gate
tags: [run, rhythm]
---

# #1118 — per-agent-profile reasoning effort / thinking budget

## Summary

Added a durable, nullable `reasoningEffort` field on `agent_configs` that
projects into the opencode agent-file frontmatter's `options.effort` key, so
non-interactive runs (scheduled tasks, delegated subagents) inherit a
profile-level reasoning-effort/thinking-budget preference on the Anthropic
OAuth path. UI dropdown skipped per issue's "optional/follow-up" note.

## Key finding (mechanism verification)

Grepped `apps/opencode_fork/packages/opencode/src/session/llm.ts:156`:
`agent.options` is merged **directly** into the final AI-SDK call options
(`mergeOptions(mergeOptions(mergeOptions(base, model.options), agent.options), variant)`),
at the same level where the engine's own `variants()` table
(`provider/transform.ts`, `@ai-sdk/anthropic` case, adaptive-effort models
opus-4-6/4-7, sonnet-4-6) places a selected variant's `effort` key. So setting
`agent.options.effort` directly (via frontmatter) reaches the outgoing
Anthropic request the same way a session-level variant pick would — no fork
change needed. `rhythm-anthropic-accounts/dist/transforms.js` only ever
*strips* `effort` for models with `disableEffort` (haiku); it never reads it
from `agent.options` — the issue body's "plugin reads/forwards effort" was an
approximation of "the request already contains it and the plugin's fetch
passes it through / strips it." Key name confirmed as **`effort`** (not
`reasoningEffort`) because that's the literal key the AI SDK / adaptive
`variants()` map produces for Anthropic.

## Postgres bootstrap decision

**Skipped, following explicit precedent** — #1088 (`schedulable`) and #1094
(`image_generation_enabled`) both added the SQLite column only, with a code
comment stating "local SQLite only ... no postgres_bootstrap backfill
needed" because the column solely feeds `opencode_agent_writer.ts`, which
early-returns under `env.dbClient === 'postgres'` (`writeAgentProfileFile`
line ~285, `deleteAgentProfileFile` line ~522) — this is the exact
"local-only opencode agent-file projection" AGENTS.md calls out as
legitimately no-op under Postgres. `reasoningEffort` is used by nothing
except that same writer, so it follows the same precedent. Documented inline
in the migration with the same rationale.

## Files changed

- `apps/api_server/src/database/migrations.ts` — additive nullable
  `agent_configs.reasoning_effort TEXT` column (SQLite only, `runOnce` marker
  for audit-trail parity).
- `apps/api_server/src/repositories/agent_configs_repository.ts` —
  `reasoningEffort?: string | null` on `AgentConfig`/`AgentConfigInput`,
  `reasoning_effort` on the row type, `rowToModel`, `insert()`, `update()`
  (explicit `null` clears the column, `undefined` leaves untouched — same
  convention as `modelTierHint`/`defaultAnthropicAccountId`). Optional (not
  required) on the type, mirroring `schedulable?`/`imageGenerationEnabled?`,
  so pre-existing hand-built `AgentConfig` test fixtures across the codebase
  did **not** need touching.
- `apps/api_server/src/controllers/agent_configs_controller.ts` —
  `validateBody` accepts a non-empty string or `null` (no enum restriction —
  effort tiers are provider-specific and free-form, matching
  `modelProvider`/`modelId`); `create()` and `patch()` map
  `body.reasoningEffort` the same null-clear way as `modelTierHint`.
- `apps/api_server/src/services/opencode_agent_writer.ts` —
  `if (config.reasoningEffort) options.effort = config.reasoningEffort;`
  appended to the existing `options` object build (same object that already
  carries `mcpAllowlist`/`skillAllowlist`), right before the
  `Object.keys(options).length > 0` frontmatter-write guard.
- Tests (all new, no existing test bodies modified):
  - `apps/api_server/src/repositories/agent_configs_repository.test.ts` —
    insert default-null, insert-with-value round-trip, patch + null-clear.
  - `apps/api_server/src/__tests__/agent_configs_routes.test.ts` — HTTP-level
    POST→PATCH→GET→PATCH(null) round-trip against a real ephemeral
    express+sqlite server (`startTestServer`); 400 on empty-string.
  - `apps/api_server/src/services/__tests__/opencode_agent_writer_projection.test.ts`
    — asserts the **actual written `.md` frontmatter** contains
    `options.effort` when set, omits the `options:` line entirely when null,
    and coexists with `options.mcpAllowlist` in one line when both are set.
    This satisfies AGENTS.md's "assert the observable outcome, not that a
    function was called" rule at the writer's boundary (reads the real file
    off disk, no mocking of the writer itself).

## Checks run

- `cd apps/api_server && npx tsc --noEmit` → clean, no errors.
- `npx vitest run src/repositories/agent_configs_repository.test.ts src/__tests__/agent_configs_routes.test.ts src/services/__tests__/opencode_agent_writer_projection.test.ts`
  → **97 passed** (8 new: 3 repo + 2 routes + 3 writer).
- `npx vitest run` (full api_server suite) → **3009 passed / 18 failed / 38
  skipped** (364 files, 6 failed files). The 18 failures are all in
  `src/__tests__/memory_write_vault_first.test.ts` — pre-existing
  vault-filesystem test-pollution failures already documented in
  `docs/ai/project-state.md` ("18 pre-existing memory_* unit failures ...
  present on main, unrelated to this PR"). Pass count is exactly the prior
  baseline (3001) + 8 new tests = 3009. Zero new failures.
- GitNexus `impact({target: "AgentConfigsRepository", direction: "upstream"})`
  → CRITICAL by fan-out count (widely-used class), but purely additive
  (optional field, additive column, no removed/changed signatures) — no
  behavioral risk. `impact()` also run on `runMigrations` (MEDIUM) and
  `writeAgentProfileFile` (MEDIUM) before editing, per AGENTS.md.
- GitNexus `detect_changes()` (unstaged) → 13 changed symbols across exactly
  the 7 touched files, 4 affected processes (all agent_configs
  create/patch/update flows + `seedOrgOptimizerTask`'s use of `repo.update`)
  — matches the intended blast radius exactly, nothing unexpected.
- No `.dart` files touched — Flutter UI intentionally skipped per dispatch
  (issue marks it optional/follow-up).
- Sandbox (`tools/dev/sandbox.sh`) **not invoked** — all verification used
  self-contained vitest (in-memory SQLite + ephemeral `startTestServer`
  instances on random ports), the same mechanism the existing ~3000-test
  suite already uses; nothing here touches a live/persistent process, port
  4001, or the production DB path, so it isn't "server-dependent" in the
  sense the sandbox protocol guards against.

## Notes / risks

- **Live LLM-turn behavioral test not run.** The issue's 3rd acceptance bullet
  ("a scheduled/delegated run of an agent with effort set produces the
  expected reasoning behavior on the Claude/anthropic OAuth path") is a live
  e2e concern; the orchestrator's dispatch explicitly scoped verification
  down to (a) PATCH/GET round-trip, (b) null-clear, (c) frontmatter emission
  — all three are covered. If a live confirmation is wanted later, it needs
  the fork engine rebuilt + sandbox (`RHYTHM_LIVE_E2E=1`) and a captured
  outgoing-request body assertion (`effort` survives to the Anthropic
  request) — flagging as a suggested follow-up, not done here.
- **`agent_config_export_import.ts` (profile export/import bundles) was NOT
  updated** — `reasoningEffort` will silently round-trip as absent through an
  export/import bundle today. Not in the dispatch's required scope and kept
  out to minimize the diff; flag as a small follow-up if bundle export/import
  fidelity for this field matters.
- No enum validation on `reasoningEffort` values (accepts any non-empty
  string) — deliberate: provider effort tiers vary (Anthropic:
  low/medium/high/xhigh/max; OpenAI: minimal/low/medium/high/none/xhigh) and
  the field is a pass-through, not Rhythm-interpreted. Matches
  `modelProvider`/`modelId`/`ocAgent`'s existing free-string convention.
- Haiku-model unaffected claim is by inspection only (transforms.js strips
  `effort`/`thinking.effort` unconditionally via `getModelOverride().disableEffort`
  regardless of source) — no Rhythm-side test needed since no Rhythm-side
  logic is involved in that strip.

## Next step

Hand off to `verification-gate`.
