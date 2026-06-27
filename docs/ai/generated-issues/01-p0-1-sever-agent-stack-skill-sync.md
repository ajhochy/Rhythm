# P0-1: Sever agent-stack → opencode skill sync write

## Goal

Stop `ai-workflow sync-globals` (agent-stack) from writing opencode agents/skills so Rhythm owns the namespace. Add a Rhythm-side ownership marker or guard to ensure the opencode-agents directory is no longer overwritten by the sync. Document the seam.

## Context

Currently, the agent-stack `sync-globals` step writes opencode agents to `~/.config/opencode/agents/`. This prevents Rhythm from owning and evolving its skill library. Phase 0 must sever this dependency so that Rhythm becomes the authoritative source for opencode agent skills after a one-time seed import (P0-2).

**Scope decision (OQ-2):** Per repo memory "Postgres/SQLite schema drift," this may involve an out-of-tree change to the agent-stack repo (`~/Documents/agent-stack`). Decide: edit the agent-stack `sync-globals` script directly, OR add a Rhythm-side guard/ownership marker in `opencode_agent_writer.ts` that makes Rhythm the owner and prevents overwrites. Confirm scope boundary with reviewer.

## Likely files

- `~/Documents/agent-stack` sync script (out-of-tree — confirm scope)  
  OR  
- `apps/api_server/src/services/opencode_agent_writer.ts` (Rhythm-side guard)
- `docs/ai/decisions/2026-06-24-rhythm-owns-skills.md` (NEW decision log)

## Acceptance Criteria

- [ ] **Seam documented:** A decision file (`docs/ai/decisions/2026-06-24-rhythm-owns-skills.md`) explains the ownership boundary and which repo owns the change.
- [ ] **Sync sever confirmed:** Manual test confirms `ai-workflow sync-globals` no longer overwrites `~/.config/opencode/agents/`. If a Rhythm-side guard is added, vitest confirms it blocks overwrites under the `opencode_agent_writer.ts` codepath.
- [ ] **No regression:** If any guard is added to `opencode_agent_writer.ts`, existing tests still pass (`tsc --noEmit && npx vitest run` → baseline 966+ passing).

## Dependencies

None. This is a prerequisite Phase 0 task.

## Out of Scope

- Rebuilding or refactoring the agent-stack repo beyond a simple switch or marker.
- Changing agent prompts or profiles themselves.
