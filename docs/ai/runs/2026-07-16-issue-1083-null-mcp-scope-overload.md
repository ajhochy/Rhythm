---
date: 2026-07-16
repo: Rhythm
branch: (orchestrator-owned)
pr: (pending)
issues: [1083]
status: implemented-pending-verification
tags: [run, rhythm]
---

# Issue #1083 — allowed_mcps_json NULL overload

## Files changed
- `apps/api_server/src/services/agent_profile_sync.ts`
- `apps/api_server/src/__tests__/agent_profile_sync_hygiene.test.ts` (pre-existing stray test work reused, not edited in this run)
- `docs/ai/runs/2026-07-16-issue-1083-null-mcp-scope-overload.md`

## Checks run
- `MEMORY_VAULT_SUBDIR=memory npx vitest run src/__tests__/agent_profile_sync_hygiene.test.ts src/services/__tests__/agent_profile_sync.test.ts`
  - Result: 2 files passed, 38 tests passed, duration 1.90s.
- `npx tsc -p tsconfig.json --noEmit`
  - Result: exit 0.

## Notes
- Smallest fix: stop re-sync from backfilling `allowedMcpsJson` / `allowedSkillsJson` on existing rows. Insert-time defaults stay in the `repo.insert(...)` path only.
- Preserved semantics: `NULL` still means unrestricted at runtime, `[]` still means deny-all, and existing explicit lists still survive re-sync unchanged.
- Reused the stray `agent_profile_sync_hygiene.test.ts` coverage because it matched the issue and passed as-is; replaced the stale 2026-07-15 stray run note with this dated note.
- GitNexus impact for `syncOpencodeAgentProfiles`: LOW risk, 4 upstream callers (`syncOpencode`, `listAgents`, `importAgentConfigBundle`, indirect `import`), 0 affected processes.
