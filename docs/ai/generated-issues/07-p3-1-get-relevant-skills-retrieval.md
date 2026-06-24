# P3-1: getRelevantSkills retrieval scorer

## Goal

Implement `getRelevantSkills(query: string): Promise<AgentSkill[]>` that scores stored skills against an incoming message using Jaccard token overlap + whole-token tag match + description substring hit + confidence/usage multipliers. Return top-N (default 5) with threshold ≥0.3. Eligible skills: published always; draft only if confidence ≥0.6 (fail-closed).

## Context

Phase 3 closes the self-improvement loop: retrieval + injection. This issue implements the retrieval scorer that will be called by the prompt-preface builder (P3-2). The scorer combines multiple signals (tokens, tags, description substring, confidence/usage) to find the top-N relevant skills for a given user input.

## Likely files

- `apps/api_server/src/repositories/agent_skills_repository.ts` (add `getRelevantSkills` method)  
  OR  
- NEW `apps/api_server/src/services/skill_retrieval.ts` (dedicated retrieval service)

## Acceptance Criteria

- [ ] **Scorer method:** `getRelevantSkills(query: string, topN?: number): Promise<AgentSkill[]>`
  - Loads all skills from `agent_skills` table
  - Filters: published always; draft only if confidence ≥ 0.6
  - Tokenizes query (split on whitespace, lowercase, dedupe)
  - For each skill:
    - **Jaccard token overlap:** count overlapping tokens between query and (title + description), divide by union size
    - **Whole-token tag match:** count skills' tags that match entire tokens in query (case-insensitive)
    - **Description substring:** hit(1) or miss(0) if any query token is a substring of description
    - **Multipliers:** apply `confidence * usage_multiplier` (e.g., `confidence * (1 + uses/10)`) to increase score of frequently-used skills
    - **Combined score:** `(jaccard + tag_match + substring) * confidence_multiplier`, capped at 1.0 or normalized
  - Filter results where score ≥ 0.3
  - Sort by score descending, return top-N (default 5)

- [ ] **Published + draft gating:** Published skills always included in scoring. Draft skills only included if confidence ≥ 0.6; lower-confidence drafts are excluded (fail-closed).

- [ ] **vitest:** Cover:
  - Query that matches a known skill above 0.3 → returned and ranked
  - Query that produces score < 0.3 → excluded from results
  - Draft skill with confidence < 0.6 → excluded even if score > 0.3
  - Published skill → always included if score > 0.3
  - Top-N cap honored (max 5 returned unless topN param changed)
  - Empty DB → returns `[]`
  - Tag matching (e.g., skill tagged 'api' and query includes 'api' token)
  - Usage multiplier (skill with 10+ uses scores higher than unused skill with same confidence)

- [ ] **Performance note:** For now, all-skills-in-memory scoring is acceptable (expected <100 skills). If future expansion warrants, flag for FTS5 optimization (out of scope).

- [ ] **tsc + vitest:** `tsc --noEmit && npx vitest run` passes.

## Dependencies

- **P1-1:** `agent_skills` table and repository must exist.

## Out of Scope

- Semantic/embedding-based similarity (Jaccard + tag + substring is the Odysseus baseline).
- Storing/caching scores (compute per query).
- Per-user relevance weighting (all skills are shared, no user context).
