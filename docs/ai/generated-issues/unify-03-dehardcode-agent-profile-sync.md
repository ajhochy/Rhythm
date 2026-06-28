# api_server: de-hardcode `agent_profile_sync` allowlist derivation

**Order:** 3 · **Depends on:** #2 (live `GET /skill` via client) · **Milestone:** Unify skills source of truth

## Why

`agent_profile_sync.ts:168-261` derives per-agent skill allowlists at import time from a
hand-kept `WORKFLOW_CHAIN_SKILLS` constant + `AGENT_SKILL_ALLOWLIST_MAP`. These names can
drift from what the fork actually discovers; a dead name silently scopes a profile to nothing
matchable (the #775 hazard). The third hardcoded skill-name source must be driven from — and
validated against — the live skill set.

## What

Keep the agent→skills **intent** mapping (it is product logic: the orchestrator routes to all
workflow-chain skills), but emit only names that exist in the live `GET /skill` set, and drop
names that no longer exist. Fetch the live set via `opencodeClient.listSkills()` (#2).

## Acceptance criteria

1. The emitted `allowed_skills_json` for any agent is a **subset of the live skill names**
   returned by `GET /skill` (no dead names persisted).
2. A skill present in the intent map but **absent** from the live set is dropped from the
   emitted allowlist (logged), rather than written through.
3. **Done-definition:** a `workflow-orchestrator` profile still gets its workflow-chain skills
   *that exist live*; the result round-trips through the #775 `skillAllowlist` and actually
   scopes a session.
4. **Fail-open preserved:** an agent with no intent-map entry and no name match still derives
   `null` (unrestricted), unchanged from today.
5. If the live set is unavailable (engine down), derivation falls back to today's behavior
   (no crash, no empty-allowlist lockout).

## Likely files

- `apps/api_server/src/services/agent_profile_sync.ts`
- `apps/api_server/src/services/agent_profile_scope.ts` (if the live-set fetch is shared)

## Required tests

- Vitest: orchestrator allowlist ⊆ live names; an injected renamed/removed skill is dropped;
  unknown agent stays fail-open (`null`); engine-unavailable path falls back without throwing.

## Data-safety / out-of-scope

- No change to the #775 enforcement path itself; this only fixes the **source** of the names.
- Do not widen a user-edited allowlist (the importer never narrows user edits — preserve that).

## Verification

- `ai-workflow checks --level issue` (api_server vitest).
