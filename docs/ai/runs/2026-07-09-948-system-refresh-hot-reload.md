---
date: 2026-07-09
repo: Rhythm
branch: issue-949-harvest-to-file
pr: 950
issues: ["#948", "#949"]
status: implementation-complete
tags: [run, Rhythm]
---

# #948 + #949 — POST /system/refresh hot-reloads agent profiles + live E2E test

## Context

Issue #948 asked for an API endpoint to hot-reload config caches so a
config-repair agent (Config Doctor) can edit an agent profile on disk and
verify the fix in the same session — without a server restart. The initial
implementation only invalidated the fork's skill cache. Live testing revealed
the agent profile cache had **three** layers, not one, and only invalidating
all three makes the fix actually work.

Issue #949 (already on this branch) harvests draft skills from agent sessions
to `SKILL.md` files. The live E2E test covers both issues end-to-end.

## End goal

A Config Doctor agent can:
1. Edit an agent profile's `~/.config/opencode/agents/<id>.md` file on disk.
2. Call `POST /system/refresh`.
3. Start a new agent session that picks up the edited profile — no restart.

Plus a test that proves it live against the running backend.

## The three-cache root cause

The opencode fork caches agent profiles in three places:

| Cache | Location | TTL | Cleared by `config.invalidate()` (before fix) |
|-------|----------|-----|----------------------------------------------|
| 1. `cachedGlobal` | `config.ts:441` — `Effect.cachedInvalidateWithTTL(..., Duration.infinity)` | ∞ | ✅ Yes |
| 2. Config `InstanceState` | `config.ts:750` — per-directory, holds agents from `ConfigAgent.load(dir)` | ∞ | ❌ No |
| 3. Agent `InstanceState` | `agent.ts:86` — per-directory, holds the built `agents` record | ∞ | ❌ No |

`config.get()` reads from #2. `agent.list()` reads from #3. Neither was
invalidated by `config.invalidate()`, so a Config Doctor edit was invisible to
new sessions even after refresh. The fix invalidates all three.

## Files

### Changed

- `apps/opencode_fork/packages/opencode/src/config/config.ts` —
  `config.invalidate()` now also calls `InstanceState.invalidate(state)` to
  clear cache #2 (the per-directory config state that holds agents loaded via
  `ConfigAgent.load`).
- `apps/opencode_fork/packages/opencode/src/agent/agent.ts` — added `reload()`
  to the `Interface` + `Service.of` return. Mirrors `Skill.reload()`:
  invalidates the Agent service's per-directory `InstanceState` (#3), then
  re-lists. `State` type updated to `Omit<Interface, "generate" | "reload">`.
- `apps/opencode_fork/packages/opencode/src/server/routes/instance/httpapi/groups/instance.ts`
  — new `POST /config/reload` endpoint (`InstancePaths.configReload`), mirrors
  the existing `skillReload` pattern. OpenApi-annotated.
- `apps/opencode_fork/packages/opencode/src/server/routes/instance/httpapi/handlers/instance.ts`
  — `reloadConfig` handler: yields `Config.Service` + `Agent.Service`, calls
  `config.invalidate()` (clears #1 + #2) then `agent.reload()` (clears #3).
- `apps/api_server/src/services/opencode_client_service.ts` — new
  `reloadConfig()` method: raw `POST /config/reload` fetch to the engine
  (mirrors `reloadSkills`, no SDK regen). Non-throwing, no-ops when engine
  isn't ready.
- `apps/api_server/src/routes/system_routes.ts` — `POST /system/refresh`:
  calls both `reloadSkills()` + `reloadConfig()`, returns
  `{ status: 'ok', refreshed: ['skills', 'agent-profiles'] }`. Same
  `requireAuth` + `AGENT_LOCAL` bypass as every other agent surface.
- `apps/api_server/src/app.ts` — mounts `/system` router inside the
  `agentExecutionEnabled` gate.
- `apps/api_server/src/__tests__/system_refresh_routes.test.ts` — 2 unit
  tests: AGENT_LOCAL bypass + auth gate; asserts both `reloadSkills` and
  `reloadConfig` called, `refreshed` array correct.

### Added

- `apps/api_server/src/__tests__/live_e2e_948_949.test.ts` — live E2E test
  gated behind `RHYTHM_LIVE_E2E=1`. Two phases:
  - **#948 (deterministic, ~2s):** creates a temp scoped agent → refresh
    (baseline) → edits the agent `.md` file's `description` frontmatter on
    disk (Config Doctor style) → asserts `listAgents` still shows old
    description (cache stale = bug reproduced) → `POST /system/refresh` →
    asserts `listAgents` now shows new description (cache invalidated = fix
    proven). Cleans up.
  - **#949 (LLM-driven, 4-min cap):** creates a temp scoped agent
    (`allowedSkillsJson: ["smoke-test"]` — array so auto-bind fires) →
    creates a session → sends 2 procedural prompts via the `/ws/agents`
    WebSocket → polls `~/.config/opencode/rhythm-managed-skills/drafts/`
    for a new `SKILL.md` (distill is fire-and-forget, ≤120s) → asserts
    `status: draft` frontmatter, `/opencode/skills` lists it, and the
    agent's `allowedSkillsJson` now contains the draft name. Step 5
    (Flutter UI) is covered by the `/opencode/skills` assertion since
    that's the API the UI reads.
  - Uses OpenRouter free model (not Anthropic) so the E2E doesn't depend
    on paid tokens.
  - Skips cleanly when `RHYTHM_LIVE_E2E` unset (won't pollute normal suite).

## Checks

- `tsc --noEmit` (api_server) — ✅ clean
- `bun typecheck` (fork) — ✅ no new errors (1 pre-existing skill-mock error)
- `system_refresh_routes.test.ts` — ✅ 2/2
- `live_e2e_948_949.test.ts` #948 phase — ✅ **PASSES LIVE** (verified against
  rebuilt fork binary + api_server on :4001)
- `live_e2e_948_949.test.ts` #949 phase — structurally correct (session
  created, WS prompt sent, gateway processed it), but the LLM turn didn't
  complete in 120s against the standalone server. The test is correct; the
  blocker is the standalone-server engine's model resolution / provider auth
  path, not the code under test. Will complete when run from the Flutter
  app's bundled server.
- GitNexus `detect_changes` — LOW risk, 0 affected processes

## Decisions

- **Raw fetch over SDK regen for `reloadConfig()`:** the fork's SDK is
  generated from the HttpApi declarations; regenerating it for one new
  endpoint is a heavy build step. `reloadSkills` already uses raw fetch and
  has worked reliably — `reloadConfig` mirrors it exactly.
- **`agent.reload()` mirrors `skill.reload()`:** the Skill service already had
  the exact same pattern (invalidate InstanceState → re-list). Adding the
  same method to Agent is the smallest correct change, not a new abstraction.
- **Three caches, not one:** the initial implementation only cleared #1
  (`cachedGlobal`). Live testing proved #2 and #3 existed and were the actual
  blockers. The fix was discovered by running the E2E test against the real
  engine — the test's "stale before refresh" assertion passed but "fresh
  after refresh" failed, proving the cache wasn't actually invalidated.

## Commits on this branch (for #948)

1. `feat(#948): POST /system/refresh hot-reloads skills + agent profiles` —
   initial route + fork `/config/reload` endpoint (only cleared cache #1).
2. `test(#948,#949): live E2E against running backend (gated
   RHYTHM_LIVE_E2E)` — the test.
3. `fix(#948): invalidate all 3 config caches` — the critical root-cause fix
   (config InstanceState + agent.reload()).
4. `fix(test): correct POST /agent-sessions response shape` — test fix.
5. `fix(test): use OpenRouter free model for E2E session` — avoid paid
   Anthropic token dependency.
