# Current Plan — Rhythm-native self-improving skill library (Odysseus port)

**Date:** 2026-06-24
**Branch:** stack on `feature/agent-scheduler` (PR #734) — do NOT branch off `main` (main is ~540 commits behind and lacks the Agent Profile foundation this depends on). Manual merge only.
**Status:** PLANNED — ready for issue-writer → acceptance-contract → coding-agent. Scope policy: plan AND implement all 5 phases (0–4) this run; file follow-up issues for out-of-scope discoveries, never silently expand.

---

## User request (one sentence)

Port Odysseus's self-improvement model into Rhythm's opencode agent layer: a Rhythm-native, SHARED (instance-wide, not per-user) self-improving skill library that replaces the agent-stack→opencode skill sync — Rhythm owns and evolves the skills; agent PROMPTS stay stable while the skill library is the evolving layer.

## Goal

A shared (instance-wide) skill store on the local SQLite agent DB that (1) is seeded once from the current agent-stack skills, then owned and grown by Rhythm; (2) a background extractor distills DRAFT skills from non-trivial agent runs; (3) relevance retrieval injects top-N matched skills into the agent prompt preface; (4) teacher-escalation captures a DRAFT skill on weaker-model failure. Mirrors Odysseus `skill_extractor.py` / `skills.py` / `chat_helpers.py` while reusing Rhythm's existing scaffolding (AgentRunner, ws_gateway, agent_memory FTS pattern, scheduled-task seeding, dual-DB).

## Intent + Constraints

1. **What the user is accomplishing:** Rhythm becomes the source of truth for opencode agent skills and improves them at runtime; agent-stack is divorced from opencode and used only as a one-time seed. The skill library is the evolving layer; agent prompts are stable.
2. **In scope:** Phase 0 divorce + seed; Phase 1 shared skills store (table + repository + CRUD routes + opencode exposure); Phase 2 background extractor; Phase 3 retrieval + prompt-preface injection + enable toggle; Phase 4 teacher-escalation (draft skill on failure + Flutter badge/demote/delete).
3. **Out of scope (NON-GOALS):** Memory Consolidation (facts/preferences) — already exists as `agentMemoryService` + `agent_memory` table + the scheduled "Memory Consolidation" task; do NOT rebuild it. Per-user/owner scoping of skill rows (skills are SHARED instance-wide). Changing agent prompts/profiles themselves. Launching the app via osascript/Computer Use.
4. **Hard constraints:**
   - **Dual-DB:** every schema change lands in BOTH `apps/api_server/src/database/migrations.ts` (SQLite) AND `apps/api_server/src/database/postgres_bootstrap.ts` (Postgres) with matching columns (per repo memory "Postgres/SQLite schema drift").
   - **Shared, not owner-scoped:** skill rows carry NO `owner_user_id`. (Contrast Odysseus owner-scoped + `agent_memory.owner_user_id`.)
   - **Test-env guard:** any service that writes files OR runs background LLM jobs must be guarded against the test env (`VITEST==='true' || NODE_ENV==='test'`) — mirror `opencode_agent_writer.ts::isTestEnv()` (lines 53–54). A prior bug let vitest pollute `~/.config/opencode/agents`; the extractor must never run, and Phase 0 import must never write, under test.
   - **Non-blocking extraction:** background distill must never block the user-facing turn (fire-and-forget after the turn completes; failures swallowed + logged).
   - **Conservative gating:** confidence ≥ 0.6, dedup by title, draft vs published; one-offs/failures/Q&A → null (no skill).
   - **Verification:** `cd apps/api_server && npx tsc --noEmit && npx vitest run` (baseline 966 passing); `cd apps/desktop_flutter && dart format . --set-exit-if-changed && flutter analyze --no-fatal-infos && flutter test`. Verify via HTTP + tsc + vitest only — never launch the app.
   - Feature branch + PR; never auto-merge.
5. **Design tensions:** "Rhythm owns skills" vs. "don't lose the agent-stack seed" → resolved by Phase 0 importing the seed ONCE into the store and then severing the opencode sync write. "Inject skills into prompt" vs. "agent prompts stay stable" → resolved by injecting a transient "Available skills" PREFACE at prompt time (Phase 3), never mutating the profile `systemPrompt` or the opencode `.md` files.
6. **Cheapest version that proves the idea:** Phases 1+2+3 (store + extractor + injection) form the self-improving loop end-to-end. Phase 0 (divorce/seed) is prerequisite housekeeping; Phase 4 (teacher-escalation) is the quality multiplier layered on top.

## Security / safety constraints (must be reflected in issues)

- Extractor + Phase 0 import are **test-env guarded** — zero filesystem/LLM side effects under vitest.
- Background extraction is **fire-and-forget**; an extractor failure must never surface to or block the user turn.
- Injected skill preface is **transient** (built per-prompt); never persisted into profile `systemPrompt` or opencode agent `.md` files.
- Draft skills from teacher-escalation are **confidence-gated** before injection (fail-closed) and **flagged in the UI** for human demote/delete.
- No new owner scoping; skills are shared — but CRUD routes still run behind the existing `AGENT_LOCAL` auth posture (local-only :4001).

## Clarification interview

Skipped — alignment was collected up front and supplied as the align-gate outputs (branch_strategy: stack on `feature/agent-scheduler`; scope_policy: plan AND implement all 5 phases, file follow-ups for out-of-scope; alignment_summary reproduced under Goal). Acceptance criteria below are derived from the Odysseus reference + Rhythm's existing patterns.

## Prior Art

Verified in `/Users/ajhochhalter/Documents/odysseus`:
- `services/memory/skill_extractor.py` — background LLM distillation after runs with ≥2 rounds OR ≥2 tool calls; extracts `{title, problem, solution, steps[], tags[], confidence}` from last ~12 msgs (media stripped); confidence ≥0.6, dedup by title; conservative null for one-offs/failures/Q&A.
- `services/memory/skills.py::get_relevant_skills(query)` — Jaccard token overlap + whole-token tag match + description substring hit + confidence/usage multipliers; threshold 0.3, top 5; published + draft eligible, drafts confidence-gated.
- `routes/chat_helpers.py` — matched skills injected as an "Available skills" prompt preface, gated by `skills_enabled` pref, skipped for incognito/casual turns.
- Teacher-escalation — weaker-model failure → stronger model's approach captured as DRAFT (`source=teacher-escalation`), auto-injected next time (confidence-gated), UI badge to demote/delete.
- `memory_extractor.py` (facts/preferences) — Rhythm equivalent already exists ("Memory Consolidation"); explicitly out of scope.

## Key investigation findings (grounding)

- **Entity template:** `agent_memory` (FTS5 + `AgentMemoryRepository`, `migrations.ts:1242–1254`) and `agent_scheduled_tasks` (`migrations.ts:1210–1235`) are the closest templates for the new `agent_skills` table + repository. Skills want FTS-style matching like `agent_memory`, but Odysseus scoring (Jaccard + tag + substring + multipliers) is richer than FTS — implement scoring in the repository/service layer over loaded rows (Phase 3), keeping the table simple. NO `owner_user_id` column (shared).
- **Dual-DB seam:** SQLite block in `migrations.ts::runMigrations`; Postgres mirror in `postgres_bootstrap.ts::runPostgresBootstrap`. Repo memory "Postgres/SQLite schema drift" + the existing B1 cookbook issue confirm the exact pattern (and the empty-DB-returns-`[]` regression test).
- **Test-env guard pattern:** `opencode_agent_writer.ts` lines 53–54 (`isTestEnv()`), 71 and 147 (early returns). Reuse verbatim for the extractor and the Phase 0 importer.
- **Extractor hook points:** (a) `agent_runner.ts` — after `run()` completes (it already records the session in `agent_sessions`, resolves model, and has the session id); the runner builds `effectiveSystemPrompt` from `config.systemPrompt` (lines 290–309). (b) `ws_gateway.ts` — the `session.input` turn path (`handleSessionInput`, ~line 207; `promptAsync`/`prompt` forwarding ~line 573–583). Both must count rounds-or-tools (≥2) over the session's `agent_session_messages` before queuing a distill.
- **Prompt-preface injection point (Phase 3):** the system prompt is assembled in `agent_runner.ts` (`effectiveSystemPrompt`, lines 290–309) and forwarded via `opencodeClient.prompt(...)` (line 404); ws turns forward via `promptAsync` (line 573–583). Injection augments the system/preface string at send time — it does NOT persist to the profile or opencode `.md`.
- **Skill source today:** `~/.config/opencode/agents/` disk files seeded one-time from agent-stack; `opencode_agent_writer.ts` projects profiles → opencode `.md`. The agent-stack `sync-globals` step currently also writes opencode agents; Phase 0 severs that write and re-homes the skills into the new store. `~/.claude/skills` + `~/.config/opencode/agents` are the seed sources.
- **Capture data already present:** `agent_sessions` + `agent_session_messages` (role/text/created_at, index on `(session_id, created_at)`, `migrations.ts:758–784`) give the extractor its conversation window (last ~12 msgs).
- **Scheduled-task seeding pattern:** `agentMemoryService.seedScheduledTask`-style guard (`alreadySeeded` by name, line 55) is the template if Phase 2 ever runs extraction as a scheduled sweep rather than per-turn (default is per-turn fire-and-forget; a scheduled batch variant is a flagged follow-up, not in scope).

---

## Phase breakdown

- **Phase 0 — Divorce + seed.** Stop `ai-workflow sync-globals` (agent-stack) from writing opencode agents/skills; one-time import the current agent-stack skills (`~/.config/opencode/agents` + `~/.claude/skills`) into the new store as `status='published', source='agent-stack-seed'`. Idempotent (skip already-imported by title), test-env guarded. Rhythm owns them after.
- **Phase 1 — Shared skills store.** `agent_skills` table on the LOCAL SQLite agent DB (both DBs per dual-DB rule); `AgentSkillsRepository` + CRUD routes; expose to opencode (a `skill` lookup the agent layer can read + the surface Phase 3 injects). NO owner scoping.
- **Phase 2 — Extractor.** After `AgentRunner.run()` AND after interactive WS turns that hit ≥2 rounds-or-tools, background-distill a DRAFT skill (mirror Odysseus prompt + schema, ≥0.6 confidence gate, dedup by title). Non-blocking, test-env guarded.
- **Phase 3 — Retrieval + injection.** Rhythm `getRelevantSkills(query)` equivalent (Jaccard + tag + substring + multipliers, threshold 0.3, top-N); inject matched skills into the prompt preface in `agent_runner.ts` + `ws_gateway.ts`; respect a `skills_enabled` toggle (default on); drafts confidence-gated.
- **Phase 4 — Teacher-escalation.** On run failure/low-confidence, escalate model tier, capture the stronger model's approach as a DRAFT skill (`source='teacher-escalation'`), confidence-gated injection; Flutter UI surfaces draft skills with a badge + demote (→ delete) / publish actions.

Order rationale: Phase 0 frees the namespace and seeds data; Phase 1 is the store everything else reads/writes; Phase 2 fills it; Phase 3 closes the loop (read → inject); Phase 4 is the quality layer on top. 1→2→3 are strictly sequential; 0 is independent prerequisite; 4 depends on 1+3.

---

## Validation plan

**Per api_server issue:**
```bash
cd apps/api_server && npx tsc --noEmit && npx vitest run
```
Baseline 966 passing must not regress. New routes/services get `src/__tests__/*.ts` spinning up `createApp().listen(0)` with `server.maxRequestsPerSocket = 1` (per testing-guide undici-flake guidance), covering happy path + empty/unauthorized boundary. Opencode engine mocked at module level (testing-guide pattern).

**Per Flutter issue:**
```bash
cd apps/desktop_flutter && dart format . --set-exit-if-changed && flutter analyze --no-fatal-infos && flutter test
```
Phase 4 UI gets a REAL-SURFACE widget test pumping the mounted skills surface (per repo memory "Agents inspector was orphaned" — pump the mounted surface, not an isolated widget) asserting a draft badge renders and demote/delete fire.

**Schema-drift gate (Phase 1 + any new column):** confirm `agent_skills` is created in BOTH `migrations.ts` and `postgres_bootstrap.ts` with matching columns; a vitest asserts `GET /agent-skills` returns `[]` (not 500) on an empty DB.

**Test-env-guard gate (Phase 0 + Phase 2):** a vitest asserts that with `VITEST==='true'` the importer/extractor performs ZERO writes (no DB row inserted, no LLM call, no file written) — proving the pollution guard.

**Non-blocking gate (Phase 2):** a vitest asserts the turn-completion path returns/resolves without awaiting the distill (e.g. distill is queued, not awaited; an injected throwing distill does not reject the turn).

**Manual smoke (pre-merge):** verify via HTTP only — `POST/GET /agent-skills` round-trips; run an agent turn with ≥2 tools and confirm (after the turn) a draft skill row appears; confirm a second similar turn injects the skill into the prompt preface (log assertion); confirm a draft skill shows the badge in Flutter and demote/delete works. Do NOT launch via osascript/Computer Use. Follow with `failure-postmortem`.

---

## Known Ambiguities / Open questions (flagged for reviewer — testability gaps)

- **OQ-1 (Phase 0 seed write target):** "import the current agent-stack skills" — the exact on-disk shape under `~/.config/opencode/agents` vs `~/.claude/skills` (frontmatter fields → store columns mapping) is unverified. Issue P0-2 must read a real sample and pin the field mapping (title/when_to_use/description/tags); flag to reviewer if a field has no column. Acceptance "all agent-stack skills imported" is only testable once the source count is pinned — issue must assert imported_count == discovered_count.
- **OQ-2 (Phase 0 sync sever mechanism):** stopping `sync-globals` from writing opencode agents lives in agent-stack (`~/Documents/agent-stack`, a DIFFERENT repo) not Rhythm. Per repo memory, agent-stack skills are edited there then `ai-workflow sync-globals`. Decide: does Phase 0 edit agent-stack (out-of-tree change, separate PR) or add a Rhythm-side guard/ownership marker that makes the opencode-agents dir Rhythm-owned? Reviewer must confirm scope boundary — flagged because it may cross repos (out-of-scope → follow-up issue if so).
- **OQ-3 (rounds-or-tools counting source):** "≥2 rounds OR ≥2 tool calls" — whether tool-call count is derivable from `agent_session_messages` rows alone or needs the SDK message parts (tool parts) is unverified. Issue P2-1 must specify the exact signal; if message rows lack tool-part granularity, fall back to round count (≥2 assistant turns) and flag the degraded signal.
- **OQ-4 (extractor LLM + model):** which model/provider distills the skill (a fixed cheap tier? the session's model? a configured extractor model like Memory Consolidation's prompt?) is unspecified. Default to reusing AgentRunner's model-resolution cascade with a cheap-tier preference; flag for reviewer to confirm cost posture.
- **OQ-5 (teacher-escalation trigger definition):** "weaker-model failure / low-confidence" needs a concrete, testable trigger (run status='error'? no-progress fast-fail? a confidence score the SDK does not emit?). Issue P4-1 must define the trigger as an observable signal (e.g. `AgentRunner` run status='error' OR no-progress timeout) — a "low-confidence" trigger with no emitted score is NOT testable and must be dropped or redefined.
- **OQ-6 (`skills_enabled` toggle home):** whether the enable toggle is an instance-wide setting (a new `agent_settings` row / env) or per-session is unspecified. Default to instance-wide (matches shared model), default ON; flag if per-user is desired (would reintroduce scoping the constraints forbid).

---

## Issue table

| Order | Title | Goal | Likely files | Tests / evaluation | Dependencies |
|-------|-------|------|--------------|--------------------|--------------|
| P0-1 | Sever agent-stack → opencode skill sync write | Stop `sync-globals` (agent-stack) from writing opencode agents/skills so Rhythm owns the namespace; add a Rhythm-side ownership marker / guard so the opencode-agents dir is no longer overwritten by the sync. Document the seam. (If the change must land in the agent-stack repo, scope a follow-up per OQ-2.) | `~/Documents/agent-stack` sync script (out-of-tree — confirm scope) OR Rhythm-side guard in `apps/api_server/src/services/opencode_agent_writer.ts`; `docs/ai/decisions/2026-06-24-rhythm-owns-skills.md` (NEW) | Manual: confirm `sync-globals` no longer overwrites opencode agents; vitest if a Rhythm-side guard is added | — |
| P0-2 | One-time seed import of agent-stack skills into the store | Idempotent importer reads `~/.config/opencode/agents` + `~/.claude/skills`, maps each to an `agent_skills` row (`status='published'`, `source='agent-stack-seed'`), skips already-imported by title. Test-env guarded (zero writes under VITEST). Pin the frontmatter→column mapping (OQ-1). | NEW `apps/api_server/src/services/skill_seed_importer.ts`; `apps/api_server/src/server.ts` or boot path (invoke once on startup, guarded) | tsc; vitest: import maps sample skills → rows; re-run is idempotent (no dup by title); `VITEST` → zero writes; `imported_count == discovered_count` | P1-1 |
| P1-1 | `agent_skills` table (both DBs) + repository | Create `agent_skills` (`id`, `title`, `when_to_use`/`description`, `steps_json`, `tags_json`, `confidence REAL`, `status` [draft\|published], `source`, `uses INTEGER DEFAULT 0`, `created_at`, `updated_at`) in BOTH `migrations.ts` (SQLite) and `postgres_bootstrap.ts` (Postgres). NO `owner_user_id`. `AgentSkillsRepository` with type-safe CRUD + `incrementUses`. | `apps/api_server/src/database/migrations.ts`; `apps/api_server/src/database/postgres_bootstrap.ts`; NEW `apps/api_server/src/repositories/agent_skills_repository.ts`; NEW `apps/api_server/src/models/agent_skill.ts` | tsc; vitest: CRUD happy path; identical columns in both DDLs; dedup-by-title helper | — |
| P1-2 | `agent_skills` CRUD routes + opencode exposure | `GET/POST /agent-skills`, `GET/PATCH/DELETE /agent-skills/:id`; register in `app.ts`. Expose a typed read the agent layer uses (lookup by relevance in P3). Empty DB → `[]` not 500. | NEW `apps/api_server/src/routes/agentSkillsRoutes.ts`; NEW `apps/api_server/src/controllers/agentSkillsController.ts`; `apps/api_server/src/app.ts` | tsc; vitest (`createApp().listen(0)`, `maxRequestsPerSocket=1`): list-empty `[]`, create, get, patch, delete, 404; schema-drift gate (empty-DB not 500) | P1-1 |
| P2-1 | Background skill extractor service | Distill a DRAFT skill from the last ~12 msgs (media stripped) of a session that hit ≥2 rounds-or-tools; mirror Odysseus prompt → `{title, problem, solution, steps[], tags[], confidence}`; gate confidence ≥0.6; dedup by title; conservative null for one-offs/failures/Q&A. Test-env guarded; fire-and-forget. | NEW `apps/api_server/src/services/skill_extractor.ts`; reuse `agent_session_messages` read; uses `AgentSkillsRepository` (P1-1) | tsc; vitest: ≥2-tools convo → draft created; one-off → null; confidence<0.6 → skipped; dup title → skipped; `VITEST` → zero LLM/DB writes | P1-1 |
| P2-2 | Wire extractor into AgentRunner + WS turn (non-blocking) | After `AgentRunner.run()` completes and after `ws_gateway` `session.input` turns, count rounds-or-tools and queue the extractor without awaiting it (never blocks the turn; failures swallowed+logged). | `apps/api_server/src/services/agent_runner.ts` (post-run hook); `apps/api_server/src/services/ws_gateway.ts` (`handleSessionInput` completion) | tsc; vitest: turn resolves without awaiting distill; injected throwing distill does NOT reject the turn; extractor called only when ≥2 rounds-or-tools | P2-1 |
| P3-1 | `getRelevantSkills` retrieval scorer | Score stored skills vs an incoming message: Jaccard token overlap + whole-token tag match + description substring hit + confidence/usage multipliers; threshold 0.3, top-N (default 5); published + draft eligible, drafts must clear the confidence gate (fail-closed). | `apps/api_server/src/repositories/agent_skills_repository.ts` (or NEW `skill_retrieval.ts`) | tsc; vitest: known query matches expected skill above 0.3; below-threshold excluded; low-confidence draft excluded; top-N cap honored | P1-1 |
| P3-2 | Inject matched skills into prompt preface + enable toggle | Build a transient "Available skills" preface from P3-1 matches and prepend to the system/preface string at send time in `agent_runner.ts` and `ws_gateway.ts`; NEVER persist to profile `systemPrompt` or opencode `.md`. Gate on a `skills_enabled` toggle (default ON, instance-wide per OQ-6); `incrementUses` on injected skills. | `apps/api_server/src/services/agent_runner.ts` (preface near line 290–309/404); `apps/api_server/src/services/ws_gateway.ts` (~573–583); enable-toggle source (env or `agent_settings`) | tsc; vitest: matched skills appear in forwarded prompt; toggle OFF → no preface; injection does not mutate stored profile/`.md`; `uses` incremented | P3-1, P2-2 |
| P4-1 | Teacher-escalation → draft skill capture | On an observable failure signal (run status='error' / no-progress fast-fail — see OQ-5), escalate model tier, re-run, and on success capture the stronger model's approach as a DRAFT skill (`source='teacher-escalation'`). Confidence-gated before later injection. | `apps/api_server/src/services/agent_runner.ts` (failure path + escalation); `skill_extractor.ts` (capture variant); `AgentSkillsRepository` | tsc; vitest: error-trigger → escalation runs → draft with `source='teacher-escalation'`; non-failure → no escalation; draft confidence-gated for injection | P2-1, P3-1 |
| P4-2 | Flutter skills surface: draft badge + demote/delete | Flutter `agent_skills` feature (view/controller/repository/data/model) listing skills with a DRAFT badge (esp. `source='teacher-escalation'`); demote (→ delete) and publish actions calling P1-2 routes; register controller in `main.dart`; reachable from a TOOLS-style nav row. | NEW `apps/desktop_flutter/lib/features/agent_skills/**`; `apps/desktop_flutter/lib/main.dart` (provider); nav row in `lib/features/agents/views/_agents_nav_column.dart` | dart format; flutter analyze; flutter test incl. REAL-SURFACE test: draft badge renders, demote/delete + publish fire against the data source | P1-2, P4-1 |

---

## Next in chain

Hand off to `issue-writer` to convert this table into issue files under `docs/ai/generated-issues/` (P0-1 … P4-2; do not create remote issues until the user confirms). Then `acceptance-contract` per issue (resolve OQ-1…OQ-6 into testable criteria before coding) → `coding-agent` → `verification-gate` → `project-state-updater`.
