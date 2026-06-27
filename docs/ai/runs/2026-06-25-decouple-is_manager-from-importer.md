---
date: 2026-06-25
repo: Rhythm
branch: fix/decouple-ismanager-importer
pr: pending
issues: []
status: complete
tags: [run, rhythm, api_server, agent-profiles]
---

# Run: decouple is_manager from the OpenCode agent importer

## Files changed

| File | Change |
|------|--------|
| `apps/api_server/src/services/agent_profile_sync.ts` | Added "is_manager NOT set by importer" comment block; added inline comment on INSERT path; added comment on UPDATE patch |
| `apps/api_server/src/__tests__/agent_profile_sync_hygiene.test.ts` | Added 4 new tests under "is_manager decoupling" section |
| `docs/ai/project-state.md` | Updated current focus |
| `docs/ai/decisions/2026-06-25-decouple-is_manager-from-importer.md` | New decision log |

## Checks

| Check | Result |
|-------|--------|
| `tsc -p tsconfig.json` (build) | PASS |
| `vitest run` | PASS — 139 files, 1182 tests |
| GitNexus impact (upstream syncOpencodeAgentProfiles) | LOW — 2 direct callers |
| GitNexus detect_changes | LOW — 2 symbols touched, 0 affected processes |

## Notes

- The committed codebase (HEAD `92fc307`) already did NOT write `is_manager` in the
  importer. The fix adds explicit comments and enforcement tests so this invariant
  cannot be accidentally broken by future changes (specifically the manager-delegation
  work on `feature/agent-scheduler`).
- GitNexus blast radius: only `AgentConfigsController.syncOpencode` and
  `AgentSessionsController.listAgents` call `syncOpencodeAgentProfiles`; no execution
  flows were affected.
- Worktree used: `/Users/ajhochhalter/Documents/Rhythm-wt-decouple-ismanager`
  (branched from `92fc307 feat(api): carry prod trigger scope and model`).
