# P3-2: Inject matched skills into prompt preface + enable toggle

## Goal

Build a transient "Available skills" preface from `getRelevantSkills` matches (P3-1) and prepend it to the system prompt at send time in `agent_runner.ts` and `ws_gateway.ts`. NEVER persist to the profile `systemPrompt` or opencode agent `.md` files. Gate on a `skills_enabled` toggle (default ON, instance-wide per OQ-6). Increment `uses` count on injected skills.

## Context

Phase 3 closes the self-improvement loop by injecting relevant skills into the prompt preface. The injection is transient (computed per prompt, not saved), so agent prompts remain stable while the skill library evolves. A configurable toggle allows disabling skill injection if needed.

**OQ-6 (unresolved):** Is `skills_enabled` an instance-wide setting or per-user/session? Default to instance-wide (matches shared model), default ON. Flag if per-user is desired (would reintroduce scoping the constraints forbid).

## Likely files

- `apps/api_server/src/services/agent_runner.ts` (preface injection near line 290–309 where `effectiveSystemPrompt` is built, and line 404 where `opencodeClient.prompt` is called)
- `apps/api_server/src/services/ws_gateway.ts` (`handleSessionInput` turn forwarding, ~line 573–583)
- `skills_enabled` toggle source (env var, `agent_settings` table row, or app config)

## Acceptance Criteria

- [ ] **Toggle configuration:**
  - `skills_enabled` is instance-wide (not per-user)
  - Default value is `true` (skills enabled by default)
  - Can be toggled ON/OFF via environment variable, settings table, or hardcoded config
  - Reviewer confirms scope (OQ-6)

- [ ] **Preface builder:** Build a transient string like:
  ```
  Available skills:
  - [Skill Title]: [description/when_to_use]. Confidence: [confidence]
  - [Skill Title]: ...
  ```
  - Only include published skills OR draft skills with confidence ≥0.6 (fail-closed; P3-1 already filters, re-check here)
  - Include top-N matches from `getRelevantSkills(userQuery)` where `userQuery` is derived from the incoming prompt/message

- [ ] **AgentRunner injection:**
  - In `agent_runner.ts` where `effectiveSystemPrompt` is built (~line 290–309), after the base system prompt is set:
    - If `skills_enabled` is true, call `getRelevantSkills(systemPrompt)` to find relevant skills
    - Prepend the preface to the `effectiveSystemPrompt` string
    - Never mutate the stored `config.systemPrompt` or write to opencode `.md` files
    - Increment `uses` on each injected skill via `skillsRepository.incrementUses(skillId)`
  - Forward the augmented prompt to `opencodeClient.prompt(...)` (line 404)

- [ ] **WS gateway injection:**
  - In `ws_gateway.ts` where turns forward prompts (~line 573–583):
    - Apply the same injection logic as AgentRunner
    - Skills are matched against the incoming user message or session context
    - Increment `uses` on injected skills
    - Never persist the preface to session memory or profile `.md`

- [ ] **Persistence safeguard:** vitest asserts that:
  - Profile `systemPrompt` is never mutated (read once, never written)
  - Opencode agent `.md` files are never written
  - Injection only affects the in-memory `effectiveSystemPrompt` variable sent to the LLM
  - After a prompt is forwarded, the stored session/profile reflects the original prompt, not the injected one

- [ ] **Increment uses:** Each injected skill's `uses` counter is incremented by 1. vitest asserts `skillsRepository.incrementUses(skillId)` is called for each injected skill.

- [ ] **Toggle OFF behavior:** With `skills_enabled=false`:
  - No call to `getRelevantSkills`
  - No preface prepended
  - No `uses` increment
  - Prompt sent unmodified

- [ ] **vitest:** Cover:
  - Skills enabled (default) → preface prepended, uses incremented
  - Skills disabled → no preface, no uses change
  - Matched skills appear in forwarded prompt
  - Stored profile/`.md` not mutated
  - Multiple skills injected → all `uses` counters incremented

- [ ] **tsc + vitest:** `tsc --noEmit && npx vitest run` passes; no regression.

## Dependencies

- **P3-1:** `getRelevantSkills` retrieval scorer must exist.
- **P2-2:** Extractor wiring must be in place so sessions accumulate messages for future retrieval.

## Out of Scope

- Semantic query derivation (use the incoming prompt text as-is for skill matching).
- Per-session/user skill filtering (all skills are shared).
- Persisting the preface to memory or profile (transient only).
