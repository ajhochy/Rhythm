---
date: 2026-06-25
repo: Rhythm
branch: feature/agent-scheduler
pr: TBD
issues: []
status: verified-local
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Sync preserves user-owned overlay allowlist fields

## Files changed

- `apps/api_server/src/services/agent_profile_sync.ts` — UPDATE path of
  `syncOpencodeAgentProfiles`: `allowedDelegatesJson` moved from the
  unconditional patch into a backfill-when-null guard, matching
  `allowedMcpsJson` / `allowedSkillsJson` / `systemPrompt` / model fields.
- `apps/api_server/src/services/__tests__/agent_profile_sync.test.ts` — NEW.
  5 tests: all three overlay fields preserved on re-sync; model/prompt
  preserved; engine fields (ocAgent/sessionSelectable) still refresh while a
  user delegate override survives; new agent imports with ocAgent +
  sessionSelectable + default mcps; dev front-door secondary stays unselectable.
- `apps/api_server/src/__tests__/agent_profile_sync_hygiene.test.ts` — updated
  the P4-c6 `re-sync` test from the old overwrite contract to the new
  preservation contract.

## Checks run

- `npm run build` (tsc) → exit 0
- `npx vitest run` → **1189 passed / 1189** (141 files), exit 0
- New test confirmed RED before the fix: `expected null to be ["coding-agent"]`
- GitNexus impact (`syncOpencodeAgentProfiles`, upstream) → **LOW**, 2 callers
  (sync-opencode controller, listAgents controller), 0 flows affected
- Scope: working-tree diff limited to the single UPDATE hunk + its two tests

## Notes

- Repair loop fired once: the fix flipped a pre-existing hygiene test that
  asserted the old overwrite contract (re-sync regenerates manager delegates).
  failure-triage classified it in-scope (it tests the exact behavior changed)
  and the test was rewritten to assert preservation. No follow-up issue needed.
- `is_manager` write left untouched (separate PR owns its removal).
- Lint is a stub in api_server (`echo 'TODO: add eslint'`) — no linter to run.
- Decision: `docs/ai/decisions/2026-06-25-sync-preserve-overlay-fields.md`.
