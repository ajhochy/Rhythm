# P2-1: Background skill extractor service

## Goal

Distill a DRAFT skill from the last ~12 messages of a session that hit ≥2 rounds-or-tools. Mirror Odysseus's skill extraction prompt and schema: `{title, problem, solution, steps[], tags[], confidence}`. Gate confidence ≥0.6, dedup by title, return null for one-offs/failures/Q&A. Test-env guarded (zero LLM/DB writes under VITEST). Fire-and-forget (non-blocking).

## Context

Phase 2 implements the core self-improvement loop: background LLM distillation of skills from rich agent sessions. After each qualifying session, the extractor reads the conversation history, prompts an LLM to identify a reusable skill, and if confidence ≥0.6 stores a DRAFT row. This is wired into AgentRunner (P2-2) as a non-blocking background task.

**OQ-3 (unresolved):** "≥2 rounds OR ≥2 tool calls" — whether tool-call count is derivable from `agent_session_messages` rows alone or needs SDK message parts (tool parts) is unverified. Issue author must specify the exact signal. If message rows lack tool-part granularity, fall back to round count (≥2 assistant turns) and flag the degraded signal.

**OQ-4 (unresolved):** Which model distills the skill? Default to reusing AgentRunner's model-resolution cascade with a cheap-tier preference; flag for reviewer to confirm cost posture.

## Likely files

- NEW `apps/api_server/src/services/skill_extractor.ts`
- `apps/api_server/src/repositories/agent_skills_repository.ts` (already exists from P1-1)
- Agent session message read via existing data layer

## Acceptance Criteria

- [ ] **Extractor service:** `SkillExtractor` class with method:
  - `async distillFromSession(sessionId: string, model?: string): Promise<AgentSkill | null>`
  - Reads `agent_session_messages` for `sessionId` (last ~12 msgs, media stripped)
  - Counts rounds (assistant turns) or tool calls per OQ-3 specification
  - Returns null if < 2 rounds/tools (one-off conversation)
  - Calls LLM with Odysseus-style prompt (include expected JSON output schema)
  - Parses `{title, problem, solution, steps[], tags[], confidence}` from response
  - Returns null if confidence < 0.6 (gating)
  - Returns null for Q&A-only (no solution/problem detected)
  - Dedup: checks `findByTitle` before inserting; skips if title already exists
  - On success, inserts `AgentSkill` with `status='draft'`, `source='auto-extract'`
  - On error (LLM failure, parse error), logs and returns null (never throws)
- [ ] **Test-env guard:** Mirrors `opencode_agent_writer.ts::isTestEnv()` (lines 53–54). With `VITEST==='true'` or `NODE_ENV==='test'`:
  - No LLM call is made (mock or skip)
  - No DB writes occur
  - Method returns null
- [ ] **vitest:** Cover cases:
  - Session with ≥2 rounds/tools → extracts and inserts DRAFT skill
  - Session with 1 round → returns null (one-off)
  - Confidence < 0.6 → skipped, not inserted
  - Skill title already exists → skipped, not inserted
  - LLM error/parse error → logged, returns null without throwing
  - `VITEST==='true'` → zero DB/LLM side effects
- [ ] **Rounds/tools signal:** Issue author documents the exact derivation of "≥2 rounds-or-tools" from `agent_session_messages` schema. If degraded to round-count only, flag in acceptance.
- [ ] **Model selection:** Issue author documents which model tier is used for extraction; reviewer confirms cost posture (e.g., cheap Haiku, or reuse session model?).
- [ ] **tsc + vitest:** `tsc --noEmit && npx vitest run` passes.

## Dependencies

- **P1-1:** `agent_skills` table and `AgentSkillsRepository` must exist.

## Out of Scope

- Per-user skill ownership (all extracted skills are shared).
- Scheduled batch extraction (default is per-turn; batch variant is a flagged follow-up).
- Changing the extraction prompt or schema from Odysseus reference.
