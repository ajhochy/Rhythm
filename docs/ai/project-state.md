# Project State

## Current focus

**2026-06-24 — P1-1 agent_skills table verified; feature/agent-scheduler awaiting manual smoke**

**P1-1 Complete (verified):**
- `agent_skills` table (SQLite + Postgres) with 12-column schema (id, title, when_to_use, description, steps_json, tags_json, confidence, status, source, uses, created_at, updated_at)
- `AgentSkillsRepository` with full CRUD: create, getById, list, update, remove, incrementUses, findByTitle (case-insensitive)
- All 20 contract tests passing; 997/997 total tests passing
- Commit: e6056fc163273d120f0ce1c4f4d84d0de8eb4b48

**Branch `feature/agent-scheduler`:** All planned backend + Flutter work items are headless-verified:

- **Phase A** — Odysseus-style nav column shell (`_agents_nav_column.dart`)
- **Phase B** — Rich session row extraction (`_session_list_body.dart`); nav column wired
- **C1** — api_server `POST /agent-sessions` accepts optional `mcpRole` with path-traversal guard
- **B1** — `agent_cookbook` table (SQLite + Postgres) + CRUD routes + repository/controller
- **C2** — `email-assistant.mcp.json` role file + `GET /integrations/gmail-signals` endpoint
- **D1** — `graphic-designer.mcp.json` role file + `agent_designs` table + CRUD routes
- **B2** — Flutter Cookbook feature (view/controller/repository/data source) + nav row
- **C3** — Flutter Email feature + nav row
- **D2** — Flutter Gallery feature + nav row
- **Nav overflow fix** — nav column middle region now scrolls as one area; header/footer pinned
- **#738** — `AgentRunner` service: `run()` with concurrency cap, timeout, promptAsync+poll loop
- **#739** — Scheduler local path: AGENT_LOCAL=true routes due tasks through AgentRunner (no double-trigger)
- **#740 backend** — `POST /agent-cookbook/:id/run` compiles prompt + calls AgentRunner
- **#740 Flutter** — Run button added to Cookbook view
- **Scheduled task edit** — `_ScheduleFormSheet` now supports create + edit; Edit button added to detail sheet
- **AGENT_LOCAL auth bypass** — all agent-local routers gate `requireAuth` behind `if (!env.agentLocal)`, fixing local 401s
- **#738-fix** — `AgentRunner.run()` now resolves a model (3-step cascade) and passes it to `promptAsync`; records session in `agent_sessions`; scheduler passes `agentKind`/`scheduledTaskId`/`sessionName`; boot resets stale 'running' sessions to 'error'
- **Model picker + fast-fail** — Agent profile sheet gains a Model dropdown (reuses `AgentModelsDataSource`/`CatalogModelEntry`); `AgentRunner` adds no-progress fast-fail (default 20s grace window, env `AGENT_RUN_NOPROGRESS_MS`); schedule form shows "Model is set on the profile" helper text
- **Launch button fix** — Email "Launch email assistant" + Gallery "Launch designer" now call `selectSession` + `setComposerDraft` after creating the session; show SnackBar on error; 6 new widget tests added

Visual smoke (`flutter run -d macos`) is required before merging scheduler branch.

---

## Active branch / PR

- **Branch:** `feature/agent-scheduler` (local HEAD `4b30cf5`; all changes uncommitted)
- **PR:** [#734](https://github.com/ajhochy/Rhythm/pull/734) — open
- **Base:** `main`

---

## In progress

**P1-1 agent_skills:** Complete and verified (commit e6056fc).

**feature/agent-scheduler branch:** Waiting on:
1. Commit all pending changes (~11 files: api_server agent_runner.ts + test files, AgentConfig model, Flutter model-picker + schedule form, agent_email_view, agent_gallery_view, both test files).
2. User manual smoke (`flutter run -d macos`) — confirm nav column, Cookbook/Email/Gallery views open, Email/Gallery launch buttons navigate to CHATS with the new session selected and composer prefilled, Edit button on scheduled task detail sheet, form pre-fill, profile sheet Model picker, and that a scheduled task fires + produces a session row in CHATS.
3. PR merge after smoke passes.

---

## Risks / known issues

- **Visual gap:** `flutter run` was forbidden during all coding sessions. Run manual smoke before merging.
- **Bundled api_server — MCP_ROLES_DIR:** In the Flutter `.app` bundle the api_server is embedded under `$resourcesDir/api_server/` without the full repo tree. The default `MCP_ROLES_DIR` path won't resolve `.mcp-roles/`. Operators must set `MCP_ROLES_DIR` env var for role-scoped sessions to work in production.
- **SDK tool-gating limitation (C1):** The OpenCode SDK `session.create` has no per-session tool allowlist parameter. The C1 init-time gate stores the allowlist on the `agent_sessions` row; full enforcement requires the WS gateway to honour it (future work).
- **AgentRunner polling latency:** Up to 500 ms added to result detection vs. SSE (by design — see `docs/ai/decisions/2026-06-23-agent-runner-polling-vs-sse.md`).
- **`notification` outputTarget is a TODO stub** in `agent_runner.ts` — no notification endpoint shape finalized yet.
- **No-progress loop poll interval:** The fast-fail loop uses a fixed 500ms poll interval. If `AGENT_RUN_NOPROGRESS_MS` < 500ms the loop exits after one sleep without calling `listMessages`. Minimum meaningful value is ~600ms. The default 20s and the test-override 100–200ms both behave correctly (loop exits at deadline, not before).
- **issue_653_contract.test.ts flaky:** one port-binding race observed on a single run; passed on all subsequent runs. Pre-existing, unrelated to this work.

---

## Test status

| Suite | Status |
|-------|--------|
| `dart format .` | PASS — 0 changed (last verified 2026-06-23) |
| `flutter analyze --no-fatal-infos` | PASS — 0 errors, 0 warnings (last verified 2026-06-23) |
| `flutter test` (full) | **645 PASS, 0 FAIL** (+6 new launch-button widget tests, last verified 2026-06-23) |
| `api_server tsc --noEmit` | PASS — 0 errors (last verified 2026-06-24) |
| `api_server npm test` | **997/997 PASS** (last verified 2026-06-24; +20 P1-1 agent_skills contract tests; all verification gates passed) |

---

## Next step

1. **Commit pending changes** — all ~11 modified/new files on feature/agent-scheduler branch (see "In progress" above).
2. **Manual smoke** — `flutter run -d macos`:
   - Confirm nav column header/footer pinned, middle scrolls, all TOOLS rows reachable.
   - Confirm Cookbook/Email/Gallery views open.
   - **Tap "Launch email assistant"** — confirm CHATS opens with new session selected + composer prefilled with email opener text.
   - **Tap "Launch designer"** — confirm CHATS opens with new session selected + composer prefilled with designer opener text.
   - Confirm Edit button appears in scheduled task detail sheet; form pre-fills correctly.
   - Confirm Save calls PATCH (not POST).
   - **Open an agent profile sheet** — confirm a Model dropdown appears, populated with catalog models; select one, save, confirm it persists.
   - **Check schedule form** — confirm "Model is set on the profile" helper text appears under the Agent Profile dropdown.
   - **Trigger a scheduled task** — confirm a session row appears in CHATS list (verifies #738-fix end-to-end).
3. **Merge PR #734** after smoke passes.

---

## Recent coding-agent runs

### 2026-06-24 — P3-2 inject matched skills into prompt preface + enable toggle
- Files modified:
  - `apps/api_server/src/config/env.ts` — added `agentSkillsEnabled` config (env var `AGENT_SKILLS_ENABLED`, default ON; only literal `'false'`/`'0'` disable). Instance-wide, NOT per-user (OQ-6). Documented inline. NOTE: the live gate in callers uses `isSkillInjectionEnabled()` (re-reads process.env per call) rather than this module-load-cached value, so the toggle is testable without a process restart; `env.agentSkillsEnabled` remains as the documented config surface.
  - `apps/api_server/src/services/skill_retrieval.ts` — added `isSkillInjectionEnabled()` (live env read), `buildSkillsPreface(query, opts?)` → `{ text, skillIds }`, plus `SkillsPreface`/`BuildSkillsPrefaceOptions` types. Toggle off OR no matches → `{ text:'', skillIds:[] }`. Builds `## Available skills (retrieved)` with `- <title>: <whenToUse||description> (confidence <conf2dp>)` lines. `getRelevant` injectable (defaults to `getRelevantSkills`).
  - `apps/api_server/src/services/agent_runner.ts` — import `buildSkillsPreface`/`isSkillInjectionEnabled` + `AgentSkillsRepository`. After the systemPrompt block, if enabled, compute preface from the run's `prompt` and set a TRANSIENT local `effectivePrompt = preface + '\n\n' + prompt` (in-memory only; original `prompt` still persisted to the message store unchanged). `opencodeClient.prompt(...)` now sends `effectivePrompt`. On the SUCCESS path only (after queueSkillExtraction), `incrementUses(id)` for each injected skill id, wrapped in try/catch (non-fatal). Toggle off → no retrieval, no preface, prompt unchanged, no uses bump.
  - `apps/api_server/src/services/ws_gateway.ts` — same import; in `handleInputFrame`, just before `promptFn(...)`, if enabled, prepend preface to the forwarded user text. No system seam exists in the WS prompt body (sdkOpts carries only reasoning/fastMode/agent/permission), so per the issue the preface is prepended to BOTH `forwardData` (the `data` string) AND the leading text part of `forwardParts` (the SDK prefers parts when present). uses incremented after a successful enqueue (non-fatal). Transient — nothing persisted.
  - `apps/api_server/src/__tests__/skill_injection.test.ts` (NEW) — buildSkillsPreface: enabled+matches → titles + ids + `confidence 0.80`; toggle OFF → empty + getRelevant NOT called; no matches → empty; whenToUse-vs-description fallback; real-DB transient safeguard (row uses/title/description unchanged + `writeAgentProfileFile` spy NOT called).
  - `apps/api_server/src/__tests__/skill_injection_runner.test.ts` (NEW) — opencode_engine mocked, seeded DB: enabled → forwarded prompt (captured via mockPrompt) CONTAINS preface + original prompt; disabled → forwarded prompt === original (no preface) + uses stays 0; uses incremented by exactly 1; multiple skills → all incremented.
- Checks run:
  - `npx tsc --noEmit` — PASS (exit 0)
  - `npx vitest run skill_injection` — 9/9 PASS (2 files)
  - `npx vitest run` (full) — **1057/1057 PASS** (baseline 1048 + 9 new), 0 failures, single clean run (no flake)
- Decisions made: OQ-6 — toggle is instance-wide via `AGENT_SKILLS_ENABLED` (default ON). Callers gate on the LIVE `isSkillInjectionEnabled()` helper, not the module-cached `env.agentSkillsEnabled`, so the flag can flip per-call/in-tests without a restart. WS path has no system-prompt seam → preface prepended to the forwarded user text (both `data` and the leading text part) per the issue's documented fallback; injection done in `ws_gateway.ts handleInputFrame` (not the stream bridge) because that is where the outbound prompt is assembled. Transient guarantee: preface lives only in a local var passed to `prompt`/`promptAsync`; the persisted message-store row stores the ORIGINAL prompt; never touches config.systemPrompt or opencode_agent_writer (proven by spy).
- Deviations from spec: none material. WS injection done (not flagged as follow-up). The AgentRunner gate uses `isSkillInjectionEnabled()` instead of reading `env.agentSkillsEnabled` directly (functionally identical default-ON behavior; chosen for live-toggle testability).
- Concerns: WS preface is prepended to the user message text (no system channel available), so it is visible in the turn payload — acceptable per issue but means a long skill library could add tokens to every interactive turn (mitigated by topN=5 cap + 0.3 threshold). incrementUses fires per injected skill on every successful run/turn, so a frequently-matched skill's `uses` climbs quickly (this is the intended self-improvement signal). The real opencode/model path is never exercised in CI (engine mocked); injection wiring is proven by spies + forwarded-prompt capture.

### 2026-06-24 — P3-1 getRelevantSkills retrieval scorer
- Files modified:
  - `apps/api_server/src/services/skill_retrieval.ts` (NEW) — pure relevance scorer mirroring Odysseus `get_relevant_skills`. Exports `getRelevantSkills(query, topN=5, repo?)`, `scoreSkill(query, skill)`, `isEligible(skill)`. Loads all skills via `AgentSkillsRepository.list()`; empty store / empty-or-whitespace query → []. Eligibility: published always; draft only if `confidence >= 0.6` (fail-closed on null/NaN/unparseable). Score (Odysseus order): jaccard over (title+description+whenToUse+tags+steps) tokens → tag boost `score=max(score,0.3)*1.3` when any tag's tokens are a whole-token subset of query → description substring `score=max(score,0.6)` when raw lowercased query ∈ description → `*= 1+(confidence??0.5)*0.1` → `*=1.05` if uses>0. Keep score>=0.3, sort desc, slice topN. Does NOT mutate uses (P3-2). `repo` is an injectable default param for testability.
  - `apps/api_server/src/__tests__/skill_retrieval.test.ts` (NEW) — 16 tests over in-memory migrated DB + real repo. Covers: title/desc match ranked first; no-overlap excluded (<0.3); draft@0.4 high-overlap EXCLUDED (fail-closed); draft@0.7 included; published@low-conf still eligible; tag 'api' boost; usage tiebreak (0 vs 12 → higher first); topN cap (default<=5 returns 5; topN=3 returns 3); empty store → []; empty/whitespace query → []. Plus unit specs for `isEligible` (NaN/undefined draft fails closed, archived excluded) and `scoreSkill` (description-substring floor, ~5% usage multiplier).
- Checks run:
  - `npx tsc --noEmit` — PASS (exit 0)
  - `npx vitest run skill_retrieval.test.ts` — 16/16 PASS
  - `npx vitest run` (full) — **1048/1048 PASS** (baseline 1032 + 16 new), 0 failures, single clean run (no flake)
- Decisions made: Tokenizer mirrors Odysseus `_tokenize` (lowercase, split on whitespace, strip edge punctuation `.,!?";:()[]`, drop tokens length<=1, dedupe to Set) rather than the issue's literal "split on non-alphanumeric" — the reference is authoritative and keeps interior hyphens/underscores intact (e.g. "weekly-report" stays one token). Documented inline. `getRelevantSkills` takes an optional injected `repo` so tests pass a seeded in-memory repo without a global DB.
- Deviations from spec: tokenizer split rule follows the Odysseus reference, not the issue's "non-alphanumeric" wording (see Decisions). No injection wiring (P3-2), no uses mutation (P3-2).
- Concerns: No FTS — linear scan over `repo.list()` rows; fine at <100 skills, FLAGGED as future perf work if the library grows. Other statuses (e.g. 'active' used by some repo tests, 'archived') are excluded by eligibility — only 'published'/'draft' are retrieved, matching Odysseus.

### 2026-06-24 — P2-2 wire skill extractor into AgentRunner + WS turn (fire-and-forget)
- Files modified:
  - `apps/api_server/src/services/skill_extractor.ts` — added `queueSkillExtraction(sessionId, distill = distillFromSession)` + `DistillFn` type + `MIN_ROUNDS=2`. Counts `role='output'` rows (wrapped in try/catch → never throws); < 2 rounds returns immediately (no LLM); >= 2 fires `distill(sessionId)` WITHOUT await, `.then(skill && logger.info('drafted '+title)).catch(logger.error('failed: '+e))`, logs `[skill-extract] queued for <id>`. Extra try/catch guards a synchronously-throwing distill.
  - `apps/api_server/src/services/agent_runner.ts` — import `queueSkillExtraction`; call it on the SUCCESS path only, immediately before the `status:'done'` return (guarded by `if (rhythmSessionId)`), no await. Not called on concurrency-reject / timeout / no-response / catch (error) paths. Return value + timing unchanged.
  - `apps/api_server/src/services/opencode_stream_bridge.ts` — import `queueSkillExtraction`; call it inside the `session.idle` handler's success branch (`if (localSessionId && idleSessionStatus !== 'error')` → `if (text && text.length > 0)`), after the assistant turn is persisted + `transcript.append` broadcast + buffers cleared. This is the interactive/WS turn-completion point (see Deviations). No await.
  - `apps/api_server/src/__tests__/skill_extractor_wiring.test.ts` (NEW) — 6 unit tests on `queueSkillExtraction` with injected `distill`: non-blocking (returns < 50ms while a 100ms distill is still pending), distill rejection swallowed, distill sync-throw swallowed, calls distill at 2 rounds, skips at 1 round, never throws when the round-count query throws (closed DB handle). Does NOT mock the module.
  - `apps/api_server/src/__tests__/skill_extractor_wiring_runner.test.ts` (NEW) — 2 tests: AgentRunner success path calls `queueSkillExtraction` once with the recorded rhythm session id and the run still resolves `done`; timeout/error path never calls it. vi.mock's skill_extractor (spy on queueSkillExtraction) + opencode_engine; split into its own file so the module mock doesn't shadow the real fn used by the unit file.
- Checks run:
  - `npx tsc --noEmit` — PASS (exit 0)
  - `npx vitest run` (full) — **1032/1032 PASS** (baseline 1024 + 8 new), 0 failures, no flake (single run)
  - `npx vitest run skill_extractor_wiring` — 8/8 PASS (2 files)
- Decisions made: The WS hook was placed in `opencode_stream_bridge.ts` `session.idle` (not `ws_gateway.ts` `handleInputFrame`) because the interactive path uses `promptAsync` (fire-and-forget) and the assistant turn is persisted asynchronously by the stream bridge's idle handler — that handler is the only point in the WS path where "assistant output persisted + success (non-error)" both hold and the rhythm `localSessionId` is in scope. Hooking `handleInputFrame` (which returns right after enqueue) would fire before persistence and before round count is meaningful. Kept `queueSkillExtraction` injectable (`distill` param) so the unit tests observe calls without mocking the module or hitting a model.
- Deviations from spec: Issue named `ws_gateway.ts` (session.input path, ~line 207/573-583) for the WS hook; implemented in `opencode_stream_bridge.ts` session.idle instead — same logical WS turn, but the actual persisted-and-successful point (see Decisions). All hard constraints honored: fire-and-forget, success+>=2 rounds only, no change to run() shape/timing or WS turn behavior.
- Concerns: distillFromSession remains test-inert (VITEST/Postgres no-op), so the real LLM/DB path is exercised only at runtime — the wiring is proven by the spy/injected-distill tests, not an end-to-end distill. The stream-bridge idle hook fires on EVERY successful interactive turn boundary; the >= 2 rounds gate + MIN_CONFIDENCE 0.6 + dedup-by-title inside distillFromSession are the only backstops against drafting from chatty 2-turn sessions.

### 2026-06-24 — P2-1 background skill extractor service
- Files modified:
  - `apps/api_server/src/services/skill_extractor.ts` (NEW) — `distillFromSession(sessionId, opts?)`. Mirrors Odysseus `skill_extractor.py`: builds the same distill system prompt, tolerant JSON-object extraction (`extractJsonObject` w/ balanced-brace `matchingBrace`, code-fence + prose stripping, multi-object ambiguity → null), MIN_CONFIDENCE 0.6, CONTEXT_WINDOW 12, dedup via `repo.findByTitle`. `isTestEnv()` mirrored VERBATIM from `opencode_agent_writer.ts`; also no-ops under Postgres. Maps to `AgentSkillInput`: description←problem+solution, steps_json←steps[], tags_json←tags[], status='draft', source='auto-extract'. NEVER throws (wrapped). LLM call is injectable (`LlmCall` type param); default impl lazily imports opencode_engine + `resolveRunModel()` and runs one synchronous `prompt()` against a throwaway session.
  - `apps/api_server/src/__tests__/skill_extractor.test.ts` (NEW) — 7 tests with injected fake llmCall (no model/network): ≥2 rounds+valid high-conf JSON → draft inserted (status/source/steps/tags round-trip); 1 round → null + llmCall never called; confidence 0.4 → skipped; dup title → skipped; bare `'null'` → null no-insert; garbage prose → null no-insert; and the KEY VITEST-guard test — default real llmCall + ≥2 rounds seeded → null + ZERO rows (isTestEnv short-circuit). Injected-logic suite lifts the VITEST/NODE_ENV guard in beforeEach (restored in afterEach) so real branch logic runs while the injected llmCall guarantees no model is hit.
- Checks run:
  - `npx tsc --noEmit` — PASS (exit 0) [fixed initial `logger.debug` → `logger.info`; logger has no debug level]
  - `npx vitest run` (full) — **1024/1024 PASS** (baseline 1017 + 7 new), 0 failures
  - `npx vitest run skill_extractor.test.ts` — 7/7 PASS
- Decisions made: OQ-3 — `agent_session_messages` base schema is role+text only (role ∈ input/output/system), no structured tool-call parts, so "non-trivial" = ROUND COUNT (number of `role='output'` rows in the recent window) >= 2. Tool-call granularity is NOT available → signal degraded to round-count-only (acceptable per issue, FLAGGED). OQ-4 — default LLM call reuses `resolveRunModel()` with no agentConfigId so the cheap background distill rides the MRU/default model tier; no vendor model id hardcoded beyond what resolveRunModel returns.
- Deviations from spec: none. (Not wired into AgentRunner/WS — that is P2-2, intentionally out of scope.)
- Concerns: Default real llmCall path (create throwaway opencode session + one-shot prompt) is exercised only at runtime, never in CI (isTestEnv short-circuit by design); only the injectable-logic path is unit-tested. Round-count signal cannot distinguish a genuinely complex run from a chatty 2-turn Q&A — the MIN_CONFIDENCE 0.6 gate + null-for-non-reusable prompt are the only quality backstops.

### 2026-06-24 — P0-2 one-time seed import of agent-stack skills
- Files modified:
  - `apps/api_server/src/services/skill_seed_importer.ts` (NEW) — discovers skills from `~/.config/opencode/agents/*.md` and `~/.claude/skills/<name>/SKILL.md`, parses YAML frontmatter (minimal line-parser, no yaml dep), maps to `AgentSkillInput`, dedups by case-insensitive title, inserts via `AgentSkillsRepository`. `isTestEnv()` guard mirrored VERBATIM from `opencode_agent_writer.ts`; also no-ops under Postgres. Idempotent via `repo.findByTitle`. Exports pure helpers (`parseFrontmatter`, `frontmatterToSkillInput`, `dedupByTitle`) and `SEED_SOURCE = 'agent-stack-seed'`.
  - `apps/api_server/src/server.ts` — boot invocation after `seedConsolidationTask()`. Guarded: `skillsRepo.list().some(s => s.source === SEED_SOURCE)` zero-count check so it never re-imports; wrapped in try/catch + `logger.warn` (non-fatal). The `isTestEnv()` guard inside the importer keeps it inert under test.
  - `apps/api_server/src/__tests__/skill_seed_importer.test.ts` (NEW) — 6 tests: (1) KEY test — under VITEST, `seedAgentStackSkills()` returns `{discovered:0,imported:0,skipped:0}` and `repo.list()` stays empty (zero fs/db writes); (2-4) pure frontmatter→input mapping (name/description, filename fallback, tags CSV/inline-list, nested keys ignored); (5-6) pure dedup + repo idempotency.
- Checks run:
  - `npx tsc --noEmit` — PASS (exit 0)
  - `npx vitest run` (full) — **1017/1017 PASS** (baseline 1011 + 6 new), 0 failures
  - `npx vitest run skill_seed_importer.test.ts` — 6/6 PASS (key zero-writes guard confirmed)
- Decisions made: OQ-1 resolved by reading real samples — both sources use `---`-delimited YAML frontmatter with `name`+`description`; neither carries `tags` or `when_to_use` in practice (handled defensively). Mapping: title←name (fallback filename), description←description, whenToUse←when_to_use|whenToUse else description, tags←tags else null, steps←null (prose skills, never fabricated), status←'published', source←'agent-stack-seed', confidence←1.0. Used a minimal frontmatter line-parser (no yaml dependency). Top-level-only key parsing so opencode `permission:`/`options:` nested blocks are ignored.
- Deviations from spec: none.
- Concerns: **No column for the markdown body** — the skill's full procedure prose has nowhere clean to land (schema has `description` + `steps_json` only; steps_json is JSON array, not prose). Per spec we store frontmatter `description` and do NOT fabricate steps or invent a column. The full body is not persisted. FLAGGED as follow-up: if retrieval needs the procedure text, add a `body`/`content` TEXT column in a future migration. Boot seeding is local-SQLite-only and untested in CI (test env short-circuits by design), so the live discovery/insert path is exercised only at runtime — the pure parse/map/dedup logic is unit-tested.

### 2026-06-24 — P1-2 agent_skills CRUD routes + exposure
- Files modified:
  - `apps/api_server/src/controllers/agentSkillsController.ts` (NEW) — list/getOne/create/patch/remove over `AgentSkillsRepository`. Mirrors `agent_configs_controller.ts` conventions (AppError, `next(err)`, `validateBody`). Validation: title required non-empty string (400 via `validateBody(body, true)`); status must be `'draft'|'published'` if present (400); confidence must be a number 0..1 if present (400). 404 via `AppError.notFound('AgentSkill')` when id missing.
  - `apps/api_server/src/routes/agentSkillsRoutes.ts` (NEW) — GET '/', POST '/', GET '/:id', PATCH '/:id', DELETE '/:id'. Includes `if (!env.agentLocal) router.use(requireAuth)` posture, matching `agent_configs_routes.ts`.
  - `apps/api_server/src/app.ts` — imported `agentSkillsRouter`, mounted at `/agent-skills` immediately after the `/agent-configs` mount.
  - `apps/api_server/src/__tests__/agent_skills_routes.test.ts` (NEW) — 13 integration tests (createApp().listen(0), maxRequestsPerSocket=1, in-memory DB via setDb): GET empty → [] + 200; GET/:id round-trip; GET missing → 404; POST valid → 201; POST minimal (title only) defaults; POST missing/empty title → 400; POST bad status → 400; POST confidence out of range → 400; PATCH → 200; PATCH unknown → 404; PATCH bad status → 400; DELETE → 204; DELETE unknown → 404.
- Checks run:
  - `npx tsc --noEmit` — PASS (exit 0)
  - `npx vitest run` (full) — first run 1010/1011 with one `UND_ERR_SOCKET` flake in `issue_677_contract.test.ts` (known socket-recycle flake, unrelated); re-run **1011/1011 PASS** (baseline 997 + 13 new route tests + 1 prior delta).
- Decisions made: DELETE returns **204 No Content** (hard delete via `repo.remove`), matching `agent_configs` DELETE semantics. Used authHeaders in tests (mirroring agent_configs test) so the suite passes regardless of `env.agentLocal`.
- Deviations from spec: none. No owner scoping, no retrieval/scoring, no pagination (all per spec).
- Concerns: none. Empty-table GET returns [] not 500 (schema-drift gate satisfied).

### 2026-06-24 — P1-1 agent_skills table (both DBs) + repository
- Files modified:
  - `apps/api_server/src/models/agent_skill.ts` (NEW) — `AgentSkill` + `AgentSkillInput`. Exposes parsed `steps`/`tags` (optional) AND raw `stepsJson`/`tagsJson` (required) to satisfy both the issue intent (arrays) and the acceptance-contract literal (raw JSON strings).
  - `apps/api_server/src/repositories/agent_skills_repository.ts` (NEW) — sync better-sqlite3 repo; create/getById/list/update/remove/incrementUses/findByTitle (case-insensitive via COLLATE NOCASE); rowToModel JSON-parses steps_json/tags_json. Takes an optional `db` in the constructor, falling back to `getDb()` and then an isolated in-memory migrated DB if no global DB is initialized (test-friendly).
  - `apps/api_server/src/database/migrations.ts` — added SQLite `CREATE TABLE IF NOT EXISTS agent_skills` + `idx_agent_skills_title`, placed after agent_memory block.
  - `apps/api_server/src/database/postgres_bootstrap.ts` — added Postgres `CREATE TABLE IF NOT EXISTS agent_skills` + index (identical columns), placed before agent_configs ALTER block.
  - `apps/api_server/src/__tests__/agent_skills_repository.test.ts` (NEW) — 12 repo tests (round-trip, empty list, update, remove, incrementUses, findByTitle dedup).
  - `apps/api_server/src/__tests__/issue_p1_1_agent_skills.test.ts` — pre-existing contract file; added missing `beforeEach` that initializes the global DB via `setDb(runMigrations(:memory:))` and removed an unused `Pool` import. The contract tests instantiated the repo with no DB wired up and threw "Database not initialized"; this is a test-setup fix, not a stub of the system under test.
- Checks run:
  - `npx tsc --noEmit` — PASS (exit 0)
  - `npx vitest run` (full) — PASS, **997/997** (baseline 966 + 31 new contract/repo tests)
- Decisions made: Model carries both `steps`/`tags` (parsed) and `stepsJson`/`tagsJson` (raw) because the acceptance-contract test references `stepsJson`/`tagsJson` while the issue text specifies array fields. Made the parsed array fields optional so the contract literal (which omits them) typechecks.
- Deviations from spec: Issue model named only `steps`/`tags`; added `stepsJson`/`tagsJson` to satisfy the contract test. No owner scoping, no seeding, no routes (as specified).
- Concerns: Postgres schema not exercised by tests (SQLite-only test env — known schema-drift caveat); columns were mirrored by hand and confirmed identical to the SQLite list.

---

**Run history:** one file per run under `docs/ai/runs/` (surfaced as `ai-runs/`); prior log in `runs/_migrated-2026-06-18.md`. Snapshot overwritten in place.
