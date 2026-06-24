# P3 — Importer profile hygiene for 18 AI-Workflow agents

**Labels:** `feature`, `api-server`, `agent-profiles`, `p3`
**Depends on:** none (independent — run in parallel with P0)

## Context / Background

`agent_profile_sync.ts` `syncOpencodeAgentProfiles` inserts rows with `sortOrder: 100` and backfills `systemPrompt`/`model` from the opencode registry entry (`agent.prompt` / `agent.model`, lines ~88–124). It never sets `allowed_mcps_json` or `allowed_skills_json`. Agents that arrive from the registry without a model string fall through to `ROUTE_FALLBACKS_BY_AGENT` in `agent_model_resolver.ts` (~45–98) and run entirely unscoped.

These rows are **sync targets** — any direct DB edit is clobbered on re-sync. The fix must live in the importer.

Three specific problems to fix in `syncOpencodeAgentProfiles`:
1. **Model mapping:** when `agent.model` is absent, derive a concrete `(modelProvider, modelId)` from the agent's tier (Tier 1/2/3 mentions in prompt/metadata → map to `anthropic/claude-opus-4-7`, `anthropic/claude-sonnet-4-6`, `anthropic/claude-haiku-4-5` respectively). If no tier is detectable, fall through to the existing catalog (acceptable — same as today; just make it intentional and logged).
2. **MCP/skill allowlist defaults:** set non-null `allowed_mcps_json` and `allowed_skills_json` on insert (reasonable default: `'["rhythm"]'` for `allowed_mcps_json`, `null` for `allowed_skills_json` meaning all skills eligible). Expose these as constants so they are easy to update.
3. **Dev front-door de-dup:** exactly one of the dev front-door agents (`workflow-orchestrator`, `superpowers`, `plan`) should be `sessionSelectable = true`. Default: `workflow-orchestrator` (the documented global entry point in CLAUDE.md). Others set `sessionSelectable = false` by the importer on every sync pass so they are not presented as independent entrypoints.

The implementing agent must locate the canonical tier→model mapping source. If the opencode registry agent definitions carry a tier label, use that. If not, propose a small mapping constant in `agent_profile_sync.ts` and flag it for reviewer confirmation.

## Likely Files

- `apps/api_server/src/services/agent_profile_sync.ts` — `syncOpencodeAgentProfiles`: insert block (~112–124); refresh block (~96–110); `parseModel` helper (~35–44). **Primary write target.**
- `apps/api_server/src/services/agent_model_resolver.ts` — `ROUTE_FALLBACKS_BY_AGENT` (~45–98); tier-label constants if present. Read-only unless a new tier-mapping constant is added here.
- `apps/api_server/src/routes/` (agent-configs routes file) — `GET /agent-configs` endpoint; read-only to verify response shape for acceptance test.
- `apps/api_server/src/__tests__/agent_profile_sync_hygiene.test.ts` — **new file**.

## Acceptance Criteria

- [ ] After `syncOpencodeAgentProfiles` runs over a fixture registry (injected — no live opencode process needed), every inserted row with `sortOrder: 100` has a non-null `modelProvider` and `modelId` (either from `agent.model` directly, or from the tier-mapping constant).
- [ ] Every inserted row has non-null `allowed_mcps_json` (minimum default `'["rhythm"]'`).
- [ ] Exactly one of `workflow-orchestrator`, `superpowers`, and `plan` has `sessionSelectable = true`; the others have `sessionSelectable = false`.
- [ ] `GET /agent-configs` response reflects the above (verify via the existing `agent_configs.test.ts` or a new assertion therein — `GET /agent-configs` already exists).
- [ ] Re-syncing (calling `syncOpencodeAgentProfiles` a second time) does not revert user-edited `label` or user-set `modelProvider`/`modelId` on existing rows (the existing "preserve user edits" logic at ~96–110 must stay intact).
- [ ] The tier→model mapping is either sourced from the registry agent definition (documented) or lives in a named constant in the importer (not an anonymous inline literal) with a comment explaining the default.
- [ ] `tsc --noEmit` passes with zero errors.
- [ ] `npx vitest run` passes.

## Required Tests

New `src/__tests__/agent_profile_sync_hygiene.test.ts`:
```
describe('syncOpencodeAgentProfiles hygiene (P3)', () => {
  it('inserted rows carry non-null modelProvider + modelId')
  it('inserted rows carry non-null allowed_mcps_json')
  it('exactly one dev front-door is sessionSelectable=true after sync')
  it('re-sync preserves user-edited label on existing row')
})
```
Use a fixture registry array (hardcoded in the test) injected via the function's injectable-dep pattern. No live opencode process needed.

## Dependencies

None. Can land before, after, or in parallel with P0. Does not depend on P1a.

## Safety Notes

- The sync function must never overwrite a user-edited `label` — the existing preserve-on-update logic at ~96–110 must remain intact.
- `allowed_skills_json` default is `null` (all skills eligible) not `'[]'` — `null` means "no restriction"; `'[]'` could be read as "no skills allowed". Document this in a code comment.
- No new database columns added in this issue (the columns already exist in `agent_configs` as of the feature/agent-scheduler branch).
- No Flutter changes.
