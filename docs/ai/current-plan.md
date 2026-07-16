# Current Plan — Epic #1116: Self-Improvement Engine (mega-PR)

**Epic:** #1116 (tracking — closes when children close)
**Date:** 2026-07-16
**Branch:** `workflow/skill-discovery-cost-2026-07-16`
**Scope:** 14 issues across harvest cost, external discovery, org skill library, session hygiene, and fork SDK regen. One mega-PR, integrated from disjoint-ownership worktree clusters (see the dispatch plan handed to the orchestrator).

## Intent + Constraints

1. **Goal (one sentence):** Shift Rhythm's skill acquisition from *written* (expensive per-turn transcript distillation that bloats the library) to *found* (discovered from registries, quality-gated, human-approved), make the whole loop cheap and Postgres-real, distribute approved skills through an org library, and stop background self-improvement sessions from leaking into the user's chat list.
2. **In scope:** the 14 children of #1116. **Not in scope:** deleting the harvest loop (keep as gated fallback), auto-applying discovered skills/MCPs without human approval, OCU-27 (#1068, typed-SDK adoption — this PR keeps the existing raw-fetch shims), skill-schema/behavioral-measure redesign, copying dev gap data into prod.
3. **Hard constraints (AGENTS.md):** feature branch → draft PR → human smoke; no auto-merge; additive changes preferred; **Postgres/SQLite drift** — every new table/column needs a `postgres_bootstrap.ts` ALTER/backfill or prod 500s; fork edits (`apps/opencode_fork`) require a fork rebuild + ad-hoc re-sign and have no CI here; `dart format` + `flutter analyze --no-fatal-infos` before any Flutter commit; behavioral-verification gate before "done".
4. **Design tensions:** cost reduction vs. capture completeness (#1109/#1110 muzzle the loop without losing novel skills); parallel worktree throughput vs. shared server-file contention (`migrations.ts`, `postgres_bootstrap.ts`, `org_proposal_appliers_wiring.ts` are touched by more than one cluster — resolved by wave ordering); prod-real discovery vs. SQLite-only CI (#1113 needs a Postgres verification path).
5. **Cheapest proof of the idea:** #1109 + #1110 alone (harvest gating + cheap tier) cut ~90% of the measured cost and can ship first; the found-first half (#1111→#1114) and the org library (#1053→#1056) build on that.

## Clarification interview

Skipped — this is a **consolidation of already-decomposed, concretely-specified issues** (each child carries its own acceptance criteria; #1109–#1114 were authored in `docs/ai/generated-issues/` on this branch, the OCU issues carry milestone-level ACs). No new feature ambiguity to resolve. Open decisions that *do* need the user are collected under **Known Ambiguities / Open Questions** below rather than guessed.

## Prior art

No prior-art swarm run: every issue is an internal refactor of an existing, well-understood Rhythm subsystem (skill_extractor, org_optimizer, external_discovery, agent_capability_gaps, org_proposal appliers, the Flutter agents controller, the vendored opencode fork). No new dependency, third-party API, or novel pattern is introduced. The one "new pattern" — the org skill index — is dictated by the fork's existing `skill/discovery.ts` parser (verified: `index.json` → entries `{ name, files: string[] }`, each must include `SKILL.md`), not a free design choice. The #1115 timeout fix reuses the already-proven #1039/#1040 undici override pattern.

## Current-state verdict (all 14 verified against `main` on 2026-07-16)

**Every issue is NOT STARTED on main.** Grep + gitnexus confirm no partial implementation exists for any of them. There are **zero verify-only issues** — all require implementation. Details per issue below.

---

# HALF A — Muzzle the written loop (Cluster A, ship first)

## #1109 — Cost-001: Gate skill-harvest frequency
- **Summary:** Stop transcript-harvest firing every assistant turn; add per-session guard + cooldown, move cheap dedup rungs before the LLM call, move `evaluateHarvestedDrafts` off the per-turn hot path.
- **Current state:** *Implement.* Only the pre-existing 90s cold-start throttle (`CURATOR_COLD_WINDOW_MS`, `skill_extractor.ts:70`) exists. No per-session guard, no cooldown. `evaluateHarvestedDrafts` still called per turn at `opencode_stream_bridge.ts:1018` **and** `agent_runner.ts:1085`. Dedup rungs still run after `llmCall` (`:530`).
- **Files:** `apps/api_server/src/services/skill_extractor.ts`, `opencode_stream_bridge.ts` (`:1009`, `:1018`), `agent_runner.ts` (`:1079`, `:1085`), `harvested_skill_evaluator.ts` (`:445`). NEW in-memory per-session harvest marker (Map keyed by sessionId).
- **Impact:** `queueSkillExtraction` upstream = LOW (2 direct callers).
- **Acceptance:**
  - A given `sessionId` triggers at most one `queueSkillExtraction` LLM call per lifetime; guard checked *before* any model call.
  - A cooldown constant (default ≥5 min, documented) blocks rapid re-fire.
  - Draft-on-disk / round-count / title dedup rungs that don't need the distilled output run before `llmCall`; a match short-circuits with no session launched.
  - `evaluateHarvestedDrafts` removed from both per-turn call sites; invoked from a periodic/idle sweep.
  - A novel qualifying session (≥2 rounds, no match) still yields exactly one draft on its first eligible turn.
  - Zero LLM/DB side effects under `VITEST`/`NODE_ENV==='test'`.
- **e2e behavior test:** Build + spawn api_server (`AGENT_LOCAL=true PORT=4001 DB_PATH=$TMP/e2e.db`, smoke-launch.sh pattern). Drive one session through two assistant turns via the real prompt/WS path, then `GET http://localhost:4001/agent-sessions?scope=self_improvement` → assert **at most one** `skill-extract` session attributable to that source session (baseline today: multiple). Repeat within the cooldown window → assert no new harvest session. Drive a distinct novel session → assert exactly one draft appears. (Loop-internal, so verification is via the `self_improvement` session category surface + temp-DB row counts, gated behind `RHYTHM_LIVE_E2E=1`.)

## #1110 — Cost-002: Shrink & cheapen each harvest call
- **Summary:** Route distill/score/judge/rewrite to a cheap model tier and strip the `build`-agent baseline (deny-all skills + skip prefaces) for `category:'self_improvement'` runs.
- **Current state:** *Implement.* `allowedSkillsJson` / `allowedMcpsJson` override infra exists on `run()`, but there is **no** `category === 'self_improvement'` branch that passes `'[]'` or skips prefaces; `buildSkillsPreface` (`agent_runner.ts:667`) + `buildMemoryPreface` (`:699`) run unconditionally. No cheap-tier override for these calls; scorer still loops every fallback model (`skill_refiner.ts:269`).
- **Files:** `agent_runner.ts` (skill-allowlist path `:777-791`, prefaces `:664-711`, `taskKind` `:209`, `resolveRunModel` `:339-344`), `skill_extractor.ts` (`defaultLlmCall` `:310-325`, model override `:518-522`), `skill_refiner.ts` (judge `:154`, scorer loop `:269-271`, rewriter `:376`).
- **Impact:** `agent_runner.ts:run` upstream = LOW (3 direct callers); the change is an additive `self_improvement` branch.
- **Acceptance:**
  - Self-improvement `run()` calls pass `allowedSkillsJson:'[]'` → injected system prompt has no ~104-skill block (`session/system.ts:91`).
  - `buildSkillsPreface` + `buildMemoryPreface` skipped when `category==='self_improvement'`.
  - Distill/score/judge/rewrite use a documented cheap-tier `modelOverride` (or `taskKind`), not the extracting session's frontier model.
  - Scorer fan-out capped (single cheap model default, or documented small N).
  - `tokens_json.total` on a `skill-extract` session drops substantially from the ~54.6k baseline (before/after in PR); output still a valid distilled skill.
  - Runs still appear as `category:'self_improvement'` sessions.
- **e2e behavior test:** Same spawn. Drive a qualifying harvest session; read the resulting `self_improvement` session record (temp DB / session-detail endpoint) → assert `tokens_json.total` << baseline and the distilled skill JSON is valid. Assert the recorded model is the cheap tier. Inspect the run's captured system prompt (test hook) → no skills block. `RHYTHM_LIVE_E2E=1`.
- **Sequencing:** After #1109 (both write `skill_extractor.ts` + `agent_runner.ts`).

---

# HALF B — Promote the found loop to primary (Cluster A, sequential after A1/A2)

## #1111 — Discovery-003: Un-break the external-discovery crons
- **Summary:** Re-enable disabled discovery tasks, fix the errored daily `Org Self-Optimizer`, de-duplicate `Org External Discovery` / `v2`, reconcile the stale "skipped here" comments.
- **Current state:** *Implement.* Seeder (`org_optimizer_seed.ts`) creates `Org Self-Optimizer` (`:291`) + `Org External Discovery` (`:339`), but the enable/dedup/error-fix logic is absent; stale comments remain (`org_optimizer_run_service.ts:28-33`, `mcp_server/.../orgOptimizer.ts:28`).
- **Files:** `org_optimizer_seed.ts` (`seedOrgOptimizerTask:240`, daily `:314-326`, weekly `:363-376`), `server.ts` (seed call `:289`), `org_optimizer_run_service.ts` (`:28-33`, `:333-351`), `apps/mcp_server/src/tools/orgOptimizer.ts` (`:28`).
- **Impact:** `seedOrgOptimizerTask` upstream = LOW (boot-only, 0 upstream callers).
- **Acceptance:**
  - After boot, exactly one enabled weekly discovery task (stale duplicate removed/disabled).
  - `Org Self-Optimizer` daily re-enabled; its last-run error root cause fixed + regression-guarded (if environmental/Postgres, note the #1113 dependency and gate).
  - Re-running the seed is idempotent and does not clobber a user-enabled row.
  - Stale "external discovery skipped here" comments corrected to match inline-every-pass behavior.
- **e2e behavior test:** Spawn api_server (SQLite temp DB) → boot runs the seed. Query scheduled tasks (`mcp_server` list tool or the scheduled-tasks route) → assert exactly one enabled weekly discovery task + the daily optimizer enabled. Re-invoke the seed → assert no duplicates and the enabled flags unchanged.
- **Note:** On Postgres the seed early-returns until #1113 — so this only takes effect locally until 005 lands. Do not block #1111 on #1113.

## #1113 — Discovery-005: Fix Postgres inertness (discovery/gaps run in prod)
- **Summary:** Give the capability-gap → discovery pipeline real Postgres backing; remove the throwaway in-memory gaps DB and the Postgres seed early-return.
- **Current state:** *Implement.* In-memory `:memory:` fallback live at `agent_capability_gaps_repository.ts:86` (comment `:103`); seed early-returns under Postgres (`org_optimizer_seed.ts:249-251`, `if (env.dbClient === 'postgres') return result;`).
- **Files:** `agent_capability_gaps_repository.ts` (in-memory fallback `:99-105`, all query methods → Postgres parity), `org_optimizer_seed.ts` (`:249-251`), `database/migrations.ts` (add `agent_capability_gaps`), `database/postgres_bootstrap.ts` (ALTER/backfill), `org_proposal_*` (verify proposal/measure Postgres parity).
- **Impact:** `AgentCapabilityGapsRepository` upstream = **MEDIUM** — 6 direct callers, 36 total, participates in the `distillFromSession` flow. **Warn: this is the highest-blast-radius symbol in the epic.** The change is additive (implement the query methods for both engines) but all 6 callers must keep working on SQLite *and* Postgres.
- **Acceptance:**
  - `agent_capability_gaps` exists in the Postgres schema (migration + bootstrap); `insertIfAbsentAsync` / `listOpenAsync` / `resolveByDedupKeyAsync` all work durably on Postgres — no in-memory fallback in prod.
  - Optimizer/discovery tasks seed on Postgres (remove/correctly gate the early-return); if any part stays SQLite-only, document why + the prod substitute.
  - Proposal/measure tables confirmed to persist on Postgres (spot-check applier + measure columns).
  - SQLite behavior unchanged (guard by engine detection, never by disabling one side).
- **e2e behavior test:** SQLite side via the normal suite. **Postgres side (the real proof):** spin api_server with `DB_CLIENT=postgres` against a disposable Postgres (docker/local), boot → assert the discovery tasks seeded and the `agent_capability_gaps` table exists; `POST` a gap through the harvest path (or a direct repo call), then `listOpenAsync` reads it back and `resolveByDedupKeyAsync` closes it. **CI is SQLite-only → this Postgres check is a documented manual/pre-merge step** (see Open Questions).
- **Sequencing:** After #1111 (both write `org_optimizer_seed.ts`); gates prod behavior of #1112/#1114.

## #1112 — Discovery-004: Make discovery capability-gap-driven, not timer-only
- **Summary:** When a gap is recorded, schedule a debounced discovery pass for it (don't wait a week); give discovery a dedicated proposal budget; drain the 152-open-gap backlog rate-limited.
- **Current state:** *Implement.* Structure is gap-driven (`external_discovery_search.ts:269-270` filters `kind==='capability-gap'`) but only *invoked* from the cron pass, last, under the shared cap (`org_optimizer_run_service.ts:340`). No gap-triggered scheduler, no dedicated budget, no backlog drain.
- **Files:** `agent_capability_gaps_repository.ts` (`insertIfAbsentAsync`, `listOpenAsync`, `resolveByDedupKeyAsync:185-191`), `skill_extractor.ts` (gap-write branch `:631-646`), `org_optimizer_run_service.ts` (Stage B `:333-351`, cap `:340`, `runOrgOptimizer:202`), `generators/external_discovery_search.ts` (`:268-270`). NEW debounced discovery scheduler.
- **Impact:** `runOrgOptimizer` upstream = LOW (1 caller); shares the MEDIUM gaps repo with #1113.
- **Acceptance:**
  - Inserting a new open gap schedules a discovery pass (or debounced batch); debounce window is a documented constant.
  - Discovery gets a dedicated proposal budget (or runs before the shared cap is exhausted).
  - A bounded, rate-limited backfill drains the existing open-gap backlog over successive passes (respects #1110 cheap-tier posture).
  - Adopt+keep resolves the gap (`resolveByDedupKeyAsync`); revert leaves it open.
  - A gap burst coalesces into bounded work, not one session per gap.
- **e2e behavior test:** Spawn (SQLite temp DB). Insert a capability gap (harvest path or direct) → assert a debounced discovery pass is scheduled within the window (scheduled-task row / discovery-run record). Insert a burst → assert a single coalesced pass. Simulate adopt→keep on a discovered skill → `GET` the gap → resolved; simulate revert → still open. `RHYTHM_LIVE_E2E=1`.
- **Sequencing:** After #1113 (prod), reuses #1110 cheap tier.

## #1114 — Discovery-006: Discover & adopt MCP servers to fill gaps
- **Summary:** Let a gap be filled by an MCP server (not only a skills.sh skill); judge MCP candidates alongside skills, route wins through the same proposal → approval → install flow.
- **Current state:** *Implement.* `searchMcpCandidates` exists (`external_discovery_search.ts:293`) but returns `[]` unless `RHYTHM_MCP_REGISTRY_SEARCH_URL` is set (`:294`); the external-adoption applier + `installCuratedMcp`/`ensureCuratedMcps` exist but MCP discovery is off by default and under-wired.
- **Files:** `generators/external_discovery_search.ts` (`searchMcpCandidates:293-295`, `candidateBeatsDraft:239-261`), `generators/external_discovery_generator.ts` (`buildChangeJson:172-184`, gap-grounding gate `:229-238`), `org_proposal_appliers_wiring.ts` (`installCuratedMcp:130-137`), `apps/mcp_server/src/tools/orgOptimizer.ts`.
- **Impact:** `registerExternalAdoptionApplier` upstream = LOW (1 caller). Shares `org_proposal_appliers_wiring.ts` with #1056 (append-only `registerProposalApplier` — inbound adopt vs outbound publish; distinct kinds).
- **Acceptance:**
  - `searchMcpCandidates` returns real registry candidates for a gap (via `RHYTHM_MCP_REGISTRY_SEARCH_URL` and/or the `mcp-registry` connector); documented source for dev vs prod.
  - Per-gap fix-kind choice: shortlists best of {skill, MCP} using the "strictly beats the would-be draft" judge; ungrounded/"trending" candidates stay forbidden.
  - MCP metadata passes the same `scanContextContent` injection pre-vet before proposal.
  - An MCP win → an `external-adoption` proposal queued `proposed`, never auto-applied; on approval installs via `ensureCuratedMcps`, reversibly wired to the needing agent, **scoped per-agent** (secretary-MCP-scope lesson).
  - Gap resolves on successful install+wire (or documents why MCP is `measurable:false` and how resolution is confirmed).
- **e2e behavior test:** Spawn with `RHYTHM_MCP_REGISTRY_SEARCH_URL` pointed at a stub registry returning one candidate. Insert a gap → run discovery → `GET /agent-org-proposals` → assert an `external-adoption` MCP proposal in `proposed` (never auto-applied). Feed a candidate with injection-y metadata → assert dropped. Approve the proposal → assert `ensureCuratedMcps` installed it scoped (not globally enabled). `RHYTHM_LIVE_E2E=1`.
- **Sequencing:** Last in Cluster A (after #1113 prod + #1112 gap-trigger).

---

# Org skill library (Cluster B — server; Wave 2)

## #1053 — OCU-12: Org skill index endpoint on production API
- **Summary:** Host the org's shared skill library on the prod API in the engine-compatible `skills.urls` format (`index.json` + file serving); writes authed, reads public.
- **Current state:** *Implement.* `org_skills_routes.ts` / `org_skills_repository.ts` do not exist; no `org-skills` route in `app.ts`.
- **Files (new/edit):** NEW `routes/org_skills_routes.ts`, `repositories/org_skills_repository.ts`; edit `database/migrations.ts` + `database/postgres_bootstrap.ts` (new `org_skills` table — **shared seam with #1113**), `app.ts`. Reference (read-only) `apps/opencode_fork/packages/opencode/src/skill/discovery.ts`.
- **Impact:** new table + routes; LOW-MED. Postgres-drift rule applies.
- **Acceptance:**
  - `GET /org-skills/index.json` validates against the fork discovery parser (entries `{name, files:[...]}`, each includes `SKILL.md`); `published=false` skills excluded.
  - `GET /org-skills/files/<skill>/<path>` serves file bodies.
  - `POST/PUT/DELETE /org-skills/:name` reject unauthenticated requests (existing JWT middleware).
  - Works on SQLite (tests) and Postgres (bootstrap verified). Reads are unauthenticated by design — document "org skills must contain no secrets" in the route file.
- **e2e behavior test:** Spawn. `POST /org-skills/foo` unauth → 401; with JWT → 201. `GET /org-skills/index.json` → JSON whose shape a fork-side fixture (or the discovery parser) accepts; a `published:false` skill is absent. `GET /org-skills/files/foo/SKILL.md` → the body. Feed the index through the fork's `skill/discovery.ts` shape in a fixture test.

## #1054 — OCU-13: Wire engine skills.urls to the org index
- **Summary:** Point the managed `~/.config/opencode/opencode.json` `skills.urls` at `<prodBase>/org-skills/index.json`, preserving user entries; reload skills; tolerate offline.
- **Current state:** *Implement.* No `ensureOrgSkillIndex` / `skills.urls` anywhere in api_server. `reloadSkills` + `listSkills` **already exist** (raw-fetch shims in `opencode_client_service.ts`) — so this needs **no** #1067 SDK regen.
- **Files:** `services/opencode_client_service.ts`, `services/opencode_plugin_config.ts` (or sibling managed-config module), `server.ts` (**shared seam with #1111** seed call site — coordinate).
- **Impact:** managed-config write; LOW.
- **Acceptance:**
  - After engine start with prod reachable, `GET /skill` on the engine lists org skills alongside local ones.
  - User-added `skills.urls` entries survive; do not touch `skills.paths`.
  - Prod unreachable → engine starts normally, warning logged.
  - Changing the server URL updates the entry; `reloadSkills` called after set.
- **e2e behavior test:** Spawn with a reachable stub prod serving `/org-skills/index.json` (one skill). After init, read the managed `opencode.json` → `skills.urls` contains the index URL + any pre-seeded user entry. `GET http://localhost:4001/opencode/skills` (or engine `GET /skill`) → the org skill appears. Restart with prod unreachable → server still binds :4001, warning in log.
- **Sequencing:** After #1053.

## #1056 — OCU-15: Publish pipeline — promote approved skills to the org library
- **Summary:** A `publish-skill-to-org` proposal kind/applier that POSTs an approved local skill to the prod `/org-skills` endpoint through the existing human-gated Review Queue; unpublish via DELETE.
- **Current state:** *Implement.* No `publish-skill-to-org` applier/kind anywhere.
- **Files:** `services/org_proposal_apply_service.ts`, `services/org_proposal_appliers_wiring.ts` (**shared seam with #1114** — append a distinct kind), `services/skill_apply.ts` (reuse managed-skill-body read), `routes/org_proposals_routes.ts` (listing metadata if the new kind needs it).
- **Impact:** new applier on the existing `ProposalApplier` registry; LOW-MED (writes to prod on approve).
- **Acceptance:**
  - Approving a publish proposal → the skill appears in prod `index.json` (and on a second machine's engine after refresh).
  - Rejection publishes nothing; unpublish (DELETE) removes it from the index.
  - Prod-down failure → the proposal is marked `failed`, retryable.
  - No auto-publish — org-visible artifacts stay human-gated.
- **e2e behavior test:** Spawn with a stub prod capturing `/org-skills` writes. Create a publish proposal for a managed skill → approve via the proposals route → assert a `POST /org-skills/<name>` hit the stub and the skill is in the stub's `index.json`. Reject a second → no write. Approve an unpublish → `DELETE` fired. Point the applier at an unreachable prod → proposal ends `failed`.
- **Sequencing:** After #1053 (needs the endpoint). Disjoint from #1054 → #1054 ∥ #1056 in parallel once #1053 lands.

---

# Skills UI (Cluster C — Flutter; Wave 1-buildable)

## #1055 — OCU-14: Skills UI source badges + read-only org skills
- **Summary:** Show each skill's source (Org / Local), hide edit/delete on non-managed, keep org skills selectable in profile allowlists, add a "refresh org skills" action.
- **Current state:** *Implement.* `agent_skills_view.dart` exists; no source badges / affordance gating. Backend `opencode_skills_routes.ts` exists but does not yet surface a `source` field.
- **Files:** `lib/features/agent_skills/views/agent_skills_view.dart`, `lib/features/agents/data/opencode_skills_data_source.dart`, `lib/features/agents/views/_agent_profile_sheet.dart`, `apps/api_server/src/routes/opencode_skills_routes.ts` (add `source: managed|org|external`). **None of these files are touched by Cluster A or B** (B does not touch `opencode_skills_routes.ts`).
- **Impact:** Flutter + one server route field; LOW.
- **Acceptance:**
  - Org skills render with a badge and no edit/delete; local managed unchanged.
  - An org skill is selectable in a profile allowlist and enforcement works.
  - The refresh action pulls newly published org skills without restart (calls backend `reloadSkills`).
  - `flutter analyze --no-fatal-infos` clean; `dart format` clean.
- **e2e behavior test:** `flutter analyze` + a widget test that pumps the **real mounted** skills surface with a mixed-source fixture (managed + org) → asserts badges render and edit/delete are hidden for org rows (agents-inspector-orphan lesson: pump the mounted surface, not an isolated widget). Backend: a route test asserting the `source` field on the listing.
- **Cross-dependency:** The *live* "org skills actually appear and are badged" smoke needs #1054's wiring (Wave 2). #1055 owns the `source` field contract itself, so it can be **built and unit-verified in Wave 1**; the combined live smoke runs after integration. (See Open Questions for build-now vs defer.)

---

# Session hygiene (Cluster E — Flutter; Wave 1)

## #1090 — Background sessions leak into "chats", disappear on refresh
- **Summary:** Background/scheduled/self_improvement sessions must never enter the Chats category — not on live WS insert, not optimistically, not on refresh.
- **Current state:** *Implement.* **Root cause found (Flutter-only).** Full load queries the server with `?scope=` which filters `is_system=0` server-side (`agent_sessions_repository.ts:141-142`). But the live WS path upserts into the visible `_sessions` list **with no scope check**: `SessionCreatedMessage` (`agents_controller.dart:2658-2660`) and `SessionUpdatedMessage` (`:2786`, `_upsertById(_sessions, s)`). The WS payload already carries `isSystem` + `category` (`ws_gateway.ts:114` broadcasts the full `AgentSession`), so no server change is needed.
- **Files:** `lib/features/agents/controllers/agents_controller.dart` (the two `_onWsMessage` branches; add one shared `_belongsToScope(session, scope)` predicate mirroring the server rule: chats = `!isSystem && category=='chat'`; scheduled = `category=='scheduled'`; self_improvement = `category=='self_improvement'`). **Disjoint from #1055** (different Flutter file).
- **Impact:** LOW; single shared predicate applied in both incremental branches.
- **Acceptance:**
  - Background/scheduled sessions never enter Chats during live create/update.
  - A refresh does not change whether a session belongs to Chats (identical classification).
  - Normal interactive chats still appear immediately.
  - Background/scheduled sessions remain visible in their intended surface.
  - The classification rule lives in one shared place used by both full-load and incremental paths.
- **e2e behavior test:** `flutter analyze` + a controller/widget test: set scope=chats, feed a `SessionCreatedMessage` (and a `SessionUpdatedMessage`) carrying `isSystem:true, category:'self_improvement'` via `handleWsMessageForTest` → assert it is **absent** from `sessions`; feed an interactive `category:'chat'` session → present. Then reload from a fixture list and assert the visible set is identical before/after (no refresh-only divergence). Optional live: start a scheduled session while the list API is observed pre/post refresh.

---

# Fork SDK regen (Cluster D — opencode_fork; independent)

## #1067 — OCU-26: Regenerate openapi.json + SDK (skill.reload, config.reload, allowlist PATCH body)
- **Summary:** Regenerate the fork's checked-in OpenAPI spec + JS SDK so the Rhythm fork endpoints (`/skill/reload`, `/config/reload`) and the `session.update` allowlist/permission fields are typed.
- **Current state:** *Implement.* Confirmed: `openapi.json` = **131** ops, no `/skill/reload` or `/config/reload`; the endpoints exist in fork server source (`.../groups/instance.ts:54-55`) but not in the SDK. **Blocks nothing in this PR set** — api_server already consumes these via raw-fetch shims (`listSkills`/`reloadSkills`); typed adoption is OCU-27 (#1068, out of scope).
- **Files:** `apps/opencode_fork/packages/docs/openapi.json`, `apps/opencode_fork/packages/sdk/js/src/gen/`, `.../src/v2/gen/`, generation config/scripts. **Fully disjoint** (vendored subtree, not in api_server build).
- **Impact:** regen-only, no behavior change; LOW logically, MED operationally (fork build + ad-hoc re-sign; no fork CI here).
- **Acceptance:**
  - `openapi.json` contains 133 operations incl. `skill.reload` + `config.reload`.
  - Generated SDK exposes typed methods for them; `session.update` input carries `mcpAllowlist`/`skillAllowlist` (nullable) — diff in PR.
  - Fork build + `bun test` green; binary rebuild verified (ad-hoc re-sign, no rc=137).
- **e2e behavior test:** `cd apps/opencode_fork/packages/opencode && bun run typecheck && bun test test/session/ src/session/` (325+ pass). Assert op count/operationIds in a fork spec-assertion test if one has a home, else PR-body evidence. Rebuild `bun run build --single` and confirm the binary runs.

---

# org-optimizer reliability (Cluster F — mcp_server + controller; Wave 2)

## #1115 — org-optimizer `fetch failed`: synchronous run overruns undici 300s timeout
- **Summary:** `rhythm_run_org_optimizer` dies with `TypeError: fetch failed` on any pass >5 min because the run is a synchronous HTTP request inheriting undici's default 300s `headersTimeout`; discovery passes measured at 200–600s.
- **Current state:** *Implement.* Confirmed still broken: `org_optimizer_run_controller.ts:37-38` holds the request open (`const result = await runOrgOptimizer(options); res.json(result);`); `mcp_server/api_client.ts` `apiPost` sets no `signal`/dispatcher; no global undici override in `mcp_server`.
- **Files (stopgap, recommended):** `apps/mcp_server/src/api_client.ts` (raise the POST timeout / undici dispatcher, 600s+), `apps/mcp_server/src/tools/orgOptimizer.ts` (**shared seam with Cluster A** — F takes the timeout line, A takes the comment/surface), `org_optimizer_run_controller.ts` (matching server keep-alive). **Fire-and-return alternative** (runId + status endpoint) additionally touches `org_optimizer_run_service.ts` — heavier; see Open Questions.
- **Impact:** `runOrgOptimizer` upstream = LOW (1 caller). Stopgap mirrors the proven #1039/#1040 override.
- **Acceptance:**
  - A >5-min optimizer pass (with external discovery) returns a usable result/`runId` through the tool without `fetch failed`.
  - Stopgap: the POST timeout is explicitly set well above the longest observed pass (600s+) on client and server. Fire-and-return: the tool returns a `runId` promptly + status is retrievable.
  - Regression test asserts the optimizer POST does not use the 300s default.
  - `tsc --noEmit && npx vitest run` pass in `apps/api_server` and `apps/mcp_server`.
- **e2e behavior test:** Unit/contract: assert `apiPost` for `/agent-org-optimizer/run` carries an explicit timeout > 300s (or that the run route returns a `runId` without blocking). Live: spawn api_server, `POST /agent-org-optimizer/run` for a pass simulated/known to exceed 300s → assert it completes without socket teardown. `RHYTHM_LIVE_E2E=1`.
- **Sequencing:** Wave 2 (shares `orgOptimizer.ts` with Cluster A). Disjoint from Cluster B.

---

## Issue table

| Order | Issue | Title | Cluster | Current state | Likely files | Tests / e2e | Depends on |
|---|---|---|---|---|---|---|---|
| A1 | #1109 | Gate harvest frequency | A | Implement | skill_extractor, opencode_stream_bridge, agent_runner, harvested_skill_evaluator | live: ≤1 harvest/session via `?scope=self_improvement` | — |
| A2 | #1110 | Cheapen each harvest call | A | Implement | agent_runner, skill_extractor, skill_refiner | live: token drop + no skills block | A1 |
| A3 | #1111 | Un-break discovery crons | A | Implement | org_optimizer_seed, org_optimizer_run_service, mcp_server/orgOptimizer | boot seeds 1 enabled task, idempotent | A2 |
| A4 | #1113 | Postgres parity | A | Implement (MED risk) | agent_capability_gaps_repository, org_optimizer_seed, migrations, postgres_bootstrap | Postgres: gap write→read→resolve (manual/pre-merge) | A3 |
| A5 | #1112 | Gap-driven discovery | A | Implement | agent_capability_gaps_repository, org_optimizer_run_service, external_discovery_search, skill_extractor | live: gap→debounced pass; adopt resolves | A4, A2 |
| A6 | #1114 | MCP-server discovery | A | Implement | external_discovery_search/generator, org_proposal_appliers_wiring, mcp_server/orgOptimizer | live: MCP proposal `proposed`, scoped install | A4, A5 |
| B1 | #1053 | Org skill index endpoint | B | Implement | NEW org_skills_routes/repository, migrations, postgres_bootstrap, app.ts | curl: index shape, auth on writes, unpublished excluded | — (Wave 2 vs A) |
| B2 | #1054 | Wire skills.urls | B | Implement | opencode_client_service, opencode_plugin_config, server.ts | live: engine GET /skill lists org skills | B1 |
| B3 | #1056 | Publish → org library | B | Implement | org_proposal_apply_service, org_proposal_appliers_wiring, skill_apply, org_proposals_routes | applier: approve→POST prod, reject→noop | B1 |
| C1 | #1055 | Skills UI source badges | C | Implement | agent_skills_view, opencode_skills_data_source, _agent_profile_sheet, opencode_skills_routes | flutter analyze + mixed-source widget test | (live needs B2) |
| D1 | #1067 | Fork SDK regen | D | Implement | opencode_fork openapi.json + sdk gen | bun typecheck+test; op count 133 | — |
| E1 | #1090 | Session leak into chats | E | Implement | agents_controller.dart | flutter analyze + WS-insert scope test | — |
| F1 | #1115 | org-optimizer timeout | F | Implement | mcp_server/api_client + orgOptimizer, run_controller | timeout>300s assert; live >5min pass | (Wave 2 vs A) |

## Known Ambiguities / Open Questions (need user decision before dispatch)

1. **#1113 Postgres verification (blocking-ish):** CI is SQLite-only. Is a live disposable-Postgres check in scope for the mega-PR, or is SQLite-green + code-review of the `postgres_bootstrap.ts` ALTER sufficient with a documented manual pre-merge Postgres step? (Prior 500s came from missing bootstrap backfills.)
2. **#1115 fix shape:** stopgap (raise undici timeout to 600s+, mirrors #1039/#1040 — ponytail-preferred, ~2 files) vs. proper fire-and-return (runId + status endpoint, ~4 files incl. run_service). Recommend stopgap unless the user wants the async contract now.
3. **#1055 timing:** build in Wave 1 (owns its `source` contract, fixture-verified) with the live org-badge smoke deferred to post-#1054, or hold #1055 in Wave 2 next to Cluster B? Recommend Wave 1 build + post-integration smoke.
4. **#1114 MCP registry source:** which backing registry? The `mcp-registry` connector is auth-gated (OAuth) and may be unreachable from a headless server pass — so `RHYTHM_MCP_REGISTRY_SEARCH_URL` (a plain HTTP registry) is the likely dev/prod source. Confirm the URL/source for each env.
5. **#1053 unauthenticated reads:** org-skills `index.json`/files are public by design (the engine fetches them; org skills must carry no secrets). Confirm this is acceptable on the prod API surface.
6. **#1067 inclusion:** it is inert until OCU-27 (#1068) adopts the typed SDK (out of scope), and only ships on a fork-binary rebuild. Include now for epic completeness, or defer to whenever #1068 is scheduled?

## Validation (all clusters)

Per-issue e2e above. Global gates: `apps/api_server` `node_modules/.bin/tsc --noEmit && npx vitest run`; `apps/mcp_server` `tsc --noEmit && npx vitest run` (#1114/#1115); Flutter `flutter analyze --no-fatal-infos` + `dart format . --set-exit-if-changed` + `flutter test` (#1055/#1090); fork `bun run typecheck && bun test` (#1067). Live behavioral runs gated behind `RHYTHM_LIVE_E2E=1` against an isolated temp DB on a spare port (never `:4001`'s real data), using the `smoke-launch.sh` spawn recipe (`AGENT_LOCAL=true PORT=<spare> DB_PATH=<temp>`). Final combined manual smoke after integration.
