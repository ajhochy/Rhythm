# FOLLOW-UP: auto-inject relevant memory into agent prompts (memory's missing feedback half)

## Origin
After the Odysseus skill-library port (P1–P4), **skills** are a closed loop: captured →
stored → automatically injected into future prompts → learned-from-failure → curated.
**Memory** (`agent_memory`) only has the capture half: the daily "Memory Consolidation"
scheduled task distills facts/preferences from recent sessions and stores them, but they
are NEVER injected into prompts — an agent only sees a memory if it actively calls the
`rhythm_search_memory` MCP tool. This issue gives memory the same automatic
retrieval+injection feedback that P3-1/P3-2 gave skills, so relevant facts surface into
every turn without the agent having to ask.

Odysseus does exactly this (`routes/chat_helpers.py` injects a memory block gated by a
`memory_enabled` pref, alongside the skills block) — this is porting that half.

## Goal
Relevant stored memories (facts/preferences) are scored against the incoming prompt and
injected as a transient "Known context" preface, mirroring the skill injection pattern —
never persisted to the profile/.md, gated by a toggle, and **owner-scoped**.

## Key difference from skills (must handle): memory is per-user
`agent_memory` carries `owner_user_id` (skills are shared instance-wide). Retrieval MUST
filter to the run's owner so user A's facts never leak into user B's prompt. The owner
context has to be threaded to the injection point:
- Scheduled tasks: `agent_scheduled_tasks.created_by_user_id` / the run's owner.
- Interactive sessions / AgentRunner: determine the owning user (or treat null-owner =
  instance-global memory only). **This threading is the main unknown — resolve it first.**

## Likely files
- `apps/api_server/src/repositories/agent_memory_repository.ts` (already has FTS5 search)
- NEW `apps/api_server/src/services/memory_retrieval.ts` (or extend `agentMemoryService.ts`) — `getRelevantMemories(query, ownerUserId, topN)`
- `apps/api_server/src/services/skill_retrieval.ts` (mirror `buildSkillsPreface` → `buildMemoryPreface`; or a shared preface util)
- `apps/api_server/src/services/agent_runner.ts` + `apps/api_server/src/services/ws_gateway.ts` (inject preface at send time — same sites as P3-2 skill injection)
- `apps/api_server/src/config/env.ts` (toggle)

## Acceptance criteria
- [ ] **Retrieval:** `getRelevantMemories(query, ownerUserId, topN=5)` returns the top memories for the query, **scoped to `ownerUserId`** (plus null-owner/global rows if that concept is kept). Reuse the existing `agent_memory` FTS5 search, OR mirror the P3-1 Jaccard scorer — pick one and document why (FTS5 is already present; Jaccard keeps parity with skills).
- [ ] **Owner threading:** the run's owning user is resolved and passed to retrieval at both injection sites. If owner can't be determined, fail safe = inject nothing (never cross-user leak). Document the resolution.
- [ ] **Injection:** build a transient "## Known context (facts & preferences)" preface and prepend it at send time in AgentRunner + ws_gateway, alongside (not replacing) the skills preface. **Never persist** to profile `systemPrompt` or opencode `.md` (assert via the same `writeAgentProfileFile`-not-called test used in P3-2).
- [ ] **Toggle:** instance-wide `AGENT_MEMORY_INJECTION_ENABLED` (default ON), live-read like `isSkillInjectionEnabled()`. Off → no retrieval, no preface, prompt unchanged.
- [ ] **Coexists with on-demand recall:** the `rhythm_search_memory` MCP tool stays — injection is additive, not a replacement.
- [ ] **Tests (vitest):** enabled → matching memory in forwarded prompt; owner B's memory NOT injected for owner A's run (the critical cross-user-leak test); toggle off → no preface; transient (profile/.md unchanged); empty store → no preface, no error.
- [ ] tsc 0; vitest green (baseline at time of work); no regression.

## Dependencies
- P3-2 (skill injection) — reuse its preface-injection sites + the transient/never-persist test pattern. (Both prefaces should compose cleanly at the same send point.)
- Existing `agent_memory` table + `AgentMemoryRepository` + Memory Consolidation task (already present).

## Out of scope
- A "teacher-escalation" equivalent for memory (skills-only concept).
- A memory curation/draft UI (memory is auto-consolidated; revisit only if needed).
- Changing the daily Memory Consolidation capture task (capture half already works).
- Making memory shared/instance-wide (it stays owner-scoped — that's intentional).
