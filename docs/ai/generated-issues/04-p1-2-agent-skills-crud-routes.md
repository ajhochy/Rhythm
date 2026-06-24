# P1-2: agent_skills CRUD routes + opencode exposure

## Goal

Expose the `agent_skills` table via HTTP REST routes so the agent layer and Flutter can read/write skills. Implement `GET/POST /agent-skills` and `GET/PATCH/DELETE /agent-skills/:id`. Register routes in `app.ts`. Ensure empty DB returns `[]` (not 500).

## Context

The CRUD routes are the interface between Rhythm's skill store and the agent/UI layers. Phase 3 will call these to retrieve skills for injection; Phase 4 Flutter will call them to demote/delete/publish draft skills.

## Likely files

- NEW `apps/api_server/src/routes/agentSkillsRoutes.ts`
- NEW `apps/api_server/src/controllers/agentSkillsController.ts`
- `apps/api_server/src/app.ts` (register router)

## Acceptance Criteria

- [ ] **Routes implemented:**
  - `GET /agent-skills` → list all skills (or filter by status/source if needed), empty DB returns `[]`
  - `POST /agent-skills` → create skill, returns created `AgentSkill`
  - `GET /agent-skills/:id` → fetch skill by id, 404 if not found
  - `PATCH /agent-skills/:id` → update skill fields, returns updated `AgentSkill`
  - `DELETE /agent-skills/:id` → soft or hard delete, returns `{ success: true }` or 204
- [ ] **Registration:** All routes registered in `app.ts` with prefix `/agent-skills`.
- [ ] **Empty DB:** vitest confirms `GET /agent-skills` returns `[]` on empty DB (not a 500 error).
- [ ] **Validation:** Request bodies validate `title`, `confidence`, `status` (must be 'draft' or 'published'), etc.; 400 on invalid input.
- [ ] **Integration test:** vitest (`createApp().listen(0)` with `server.maxRequestsPerSocket = 1` per testing-guide) covers:
  - List empty → `[]`
  - Create skill → 201 with returned skill
  - Get skill → 200
  - Patch skill → 200 with updated skill
  - Delete skill → 204 or `{ success: true }`
  - Get non-existent skill → 404
- [ ] **Schema-drift gate:** Test asserts `GET /agent-skills` does not 500 on an empty SQLite DB (part of dual-DB validation).
- [ ] **tsc + vitest:** `tsc --noEmit && npx vitest run` passes; no regression.

## Dependencies

- **P1-1:** `agent_skills` table, repository, and model must exist.

## Out of Scope

- Complex filtering/search logic (simple list for now; P3-1 will add scoring/retrieval).
- Authentication/authorization per user (routes assume `AGENT_LOCAL` auth posture, local-only :4001).
- Pagination (initial phase can list all).
