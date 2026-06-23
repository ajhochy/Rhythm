# Current Plan — Odysseus-style Agents left panel

**Date:** 2026-06-23
**Branch:** stack on `feature/agent-scheduler` (do NOT branch off `main`). Manual merge only.
**Status:** ALL ITEMS COMPLETE (headless-verified 2026-06-23) — manual smoke pending before PR open.

---

## User request (one sentence)

Rebuild the LEFT PANEL of Rhythm's Flutter desktop Agents screen into a single Odysseus-style nav column that surfaces the already-built agent features (Sessions, Brain, Deep Research, Tasks, Webhooks, Profiles) plus net-new MCP-backed features (Cookbook, Email, Gallery) — reaching UI + functional parity with Odysseus's single-column sidebar.

## Goal

One coherent left nav column inside the Agents screen. Everything the agent features need is already built but scattered across a 64px projects rail, toolbar icons, and Settings tiles. Consolidate into one Odysseus-style column. The chat transcript pane and the right-rail inspector/context pane are FINE — do not touch them.

## Intent + Constraints

1. **What the user is accomplishing:** Visual + functional parity with Odysseus's left sidebar, laid out in the Rhythm 2.0 light theme. Features exist; they're just hard to find.
2. **In scope:** The left nav column only (header, New Session, Search, CHATS w/ project grouping, TOOLS group, footer); relocating 6 existing views into nav rows; folding the 64px projects rail into a "By Project" selector at the top of CHATS; 3 net-new features (Cookbook, Email, Gallery) each slotting into a TOOLS nav row.
3. **Out of scope (NON-GOALS):** Chat transcript pane redesign; inspector/context (right-rail `SessionSidePanel`) redesign; the main app sidebar (`navigation_sidebar.dart`, Agents = index 9 — unchanged); Compare; Library; Calendar; a standalone Models section; Email-as-IMAP/SMTP client (Email is MCP-only).
4. **Hard constraints:** Flutter Provider/ChangeNotifier layered pattern (view/controller/repository/data/model); Rhythm light theme tokens (sidebar `#F8F9FA`, border `#E5E7EB`, primary `#4F6AF5`, text `#111827`/`#6B7280`) — NOT Odysseus's dark CSS; api_server dual-DB (SQLite local migrations.ts + Postgres prod postgres_bootstrap.ts — both must be updated or prod 500s, per repo memory "Postgres/SQLite schema drift"); local agent server on :4001; new MCP tool access is gated ONLY by `.mcp-roles/*.mcp.json` init-time scoping, never a runtime dispatch check.
5. **Design tensions:** Parity-fast (ship the look) vs. don't-break-working-chat/inspector. Resolved by: Phase A is pure layout/relocation with zero backend change; new backends (B/C/D) are isolated additive features that slot into a nav row each.
6. **Cheapest version that proves the idea:** Phase A alone (single-column nav + relocate the 6 existing views + fold rail + search + footer). No new tables, no new MCP. This is the parity fix; everything else is a nav row that opens an existing or new panel.

## Security constraints (must be reflected in issues)

- **No per-request LLM base_url/endpoint_url override** (SF-2).
- **No shell/run_script action types** (SF-1/SF-5).
- **Result delivery is an enum, not a freeform MCP target** (SF-6).
- **Tool gating is init-time via `.mcp.json` role scoping**, never a runtime dispatch check.
- **Any user-supplied URL (webhooks) gets SSRF validation.**
- **Agentic Email/Gallery get ONLY their scoped MCP tools** via the role file (`disabledMcpServers: bash/computer/editor/filesystem`).

## Clarification interview

Skipped — explicit instruction that 3 rounds of alignment are complete and the spec is locked. Spec is reproduced verbatim under "Locked nav spec" below; acceptance criteria are derived from it.

## Prior Art

No external research swarm run — the prior art is in-repo and authoritative:
- `.mcp-roles/church-admin.mcp.json` is the exact shape to mirror for new role files (`mcpServers` + per-server `allowedTools` + `disabledMcpServers`).
- `agent_scheduled_tasks` (repository + controller + routes + both DB bootstraps) is the template entity for the new `agent_designs` and `agent_cookbook` tables.
- The 6 existing agent views already follow the layered pattern; relocation is wiring, not rebuild.

## Key investigation findings (grounding)

- **Current layout** (`lib/features/agents/views/agents_view.dart` `_buildWorkspace`, ~line 109): `Row[ ProjectsRail(64px) · _SessionListPanel(320px) · Expanded(_TranscriptPanel) · (inspector) ]`. The nav rebuild replaces the first two children with one column; transcript + inspector are untouched.
- **Toolbar icons to relocate** live in `_SessionListHeader` (~lines 776–801): `Icons.schedule` → `AgentSchedulesView`, `Icons.travel_explore` → `AgentResearchView`. These become TOOLS nav rows.
- **Settings tiles to remove/relocate** (`lib/features/settings/views/settings_view.dart` lines 1465–1517, `_OdysseusSection` / `_OdysseusNavTile`): push `AgentSchedulesView` (1487–1491), `AgentMemoryView` (1498–1502), `AgentWebhooksView` (1509–1513). Remove from Settings once surfaced in the Agents nav.
- **All 6 view constructors are `const X({super.key})`** and **all controllers are already registered** in `main.dart` MultiProvider (lines 391–407 for schedules/memory/research/webhooks; 337 projects; 366 configs). No new provider wiring needed for relocation.
- **Projects rail** (`_projects_rail.dart`, `ProjectsRail`, `railWidth = 64`): renders all-sessions pseudo-project, per-project icons, `+` add button, and a profiles section at the bottom. Selection via `AgentProjectsController.select(String? id)` / `selectedProjectId`. Profile sheet opened via `showAgentProfileSheet(context, {config})`.
- **MCP role scoping is currently scheduler-only.** `agent_scheduled_tasks.allowed_mcps_json` is honored by the scheduler path; `.mcp-roles/*.mcp.json` files are documentation/templates (per `.mcp-roles/README.md`). **Interactive `POST /agent-sessions` has NO role/mcpConfig param** (`controllers/agent_sessions_controller.ts` `create()` takes `{agentId, cwd, name, taskId}`). Therefore "launch a role-scoped agent" (Email/Gallery) requires a foundational change: add `mcpRole?` to the session create DTO, resolve `.mcp-roles/<role>.mcp.json` at create time, and pass its `mcpServers`/`allowedTools` to the SDK session. This is Issue C1 (a dependency for both Email and Gallery).
- **Curated MCP catalog** (`config/curated_mcp_servers.ts`): `CuratedMcpServer { id, name, type: 'local'|'remote', command?, url?, environment?, requiredEnv, tokenProvider?, tokenEnvKey? }`. Canva already present (`{ id:'canva', type:'remote', url:'https://mcp.canva.com/mcp', requiredEnv:[] }`). Gmail server must be added here.
- **Gmail signals already ingested:** `repositories/gmail_signals_repository.ts` → `listRecentAsync(ownerId, limit=12)` returns `GmailSignal { id, fromName, fromEmail, subject, snippet, receivedAt, isUnread, ... }`. **No HTTP endpoint exposes it yet** — the Email panel needs a new `GET /integrations/gmail-signals` (or similar) route.
- **Entity template** (`agent_scheduled_tasks`): repository `agent_scheduled_tasks_repository.ts`, controller `agentSchedulesController.ts`, routes `agentSchedulesRoutes.ts`, registered `app.use('/agent-schedules', …)` in `app.ts`; SQLite block in `migrations.ts` (`runMigrations`), Postgres mirror in `postgres_bootstrap.ts` (`runPostgresBootstrap`).

---

## Locked nav spec (single Odysseus-style column, Rhythm light theme)

```
┌──────────────────────────────┐
│ ☰  Agents                     │  Header: collapse toggle + wordmark
├──────────────────────────────┤
│ ＋ New Session                 │  (exists — _instantCreateSession)
│ 🔍 Search                      │  session search (NEW, small)
│                               │
│ CHATS                         │  section label
│   [By Project ▾]              │  project grouping/selector (folds 64px rail)
│   • session row (model badge) │  live session list w/ sort + project grouping
│   • session row …             │
│                               │
│ TOOLS                         │  always-expanded group (Odysseus style)
│   🧠 Brain        → AgentMemoryView      (relocate from Settings)
│   🔬 Deep Research → AgentResearchView    (relocate from toolbar)
│   ⏰ Tasks         → AgentSchedulesView   (relocate; AI jobs, not church tasks)
│   📖 Cookbook     → NEW recipe/skill library
│   🪝 Webhooks     → AgentWebhooksView     (relocate from Settings)
│   🤖 Profiles     → showAgentProfileSheet (surface rail's profiles as a row)
│   📧 Email        → NEW agentic email (MCP)
│   🎨 Gallery      → NEW agentic design (Canva MCP)
├──────────────────────────────┤
│ 👤 Account     ⚙︎ Settings     │  footer (Settings exists)
└──────────────────────────────┘
```

Notes:
- The column lives INSIDE the Agents screen, replacing `ProjectsRail` + `_SessionListPanel`. The main app sidebar is unchanged.
- TOOLS rows may open their target either inline (swap the right-hand work area) or as a pushed route — decided per-issue, but the column itself stays mounted. Phase A keeps the existing push-route behavior for the relocated views (lowest risk); inline embedding is a non-goal unless trivial.
- "Tasks" = scheduled AI jobs (the scheduler/timer). "Cookbook" = the reusable recipes/skills the timer runs. Keep these conceptually distinct.

---

## Phase breakdown

- **Phase A — Single-column nav shell + relocation (the parity fix).** No backend change. Build the Odysseus-style column; fold the projects rail into a "By Project" selector at the top of CHATS; relocate Brain/Deep Research/Tasks/Webhooks/Profiles into TOOLS nav rows and remove their Settings tiles / toolbar icons; add session Search; add the footer (Account + Settings). This is the bulk of the "looks like Odysseus" win and ships independently.
- **Phase B — Cookbook.** New `agent_cookbook` table (both DBs) + repository/controller/routes + Flutter `agent_cookbook` feature dir + a Cookbook nav row. A recipe = a reusable multi-step agent recipe/skill (name, description, steps, optional bound profile/config). No MCP role needed.
- **Phase C — Agentic Email (MCP).** Foundational: add `mcpRole` to interactive session creation (C1). Then: add gmail MCP server to the curated catalog + `.mcp-roles/email-assistant.mcp.json`; expose `GET …/gmail-signals`; Flutter `agent_email` feature dir = recent-signals list + "launch email-triage/compose agent" (creates a session scoped to `email-assistant`); Email nav row.
- **Phase D — Agentic Gallery (Canva MCP).** Depends on C1. Add `.mcp-roles/graphic-designer.mcp.json` (scopes Canva); new `agent_designs` table (both DBs) + repository/controller/routes; Flutter `agent_gallery` feature dir = "launch designer agent" + grid of produced designs (thumbnail/title/Canva link); Gallery nav row.

Order rationale: A first (parity fix, zero backend, every later feature is just a nav row that slots in). B is fully independent. C1 (session role scoping) is the shared dependency for C and D, so it lands before either's launch flow.

---

## Validation plan

**Per Flutter issue (every issue that touches `apps/desktop_flutter`):**
```bash
cd apps/desktop_flutter && dart format . && flutter analyze --no-fatal-infos && flutter test
```
Plus a widget test that pumps the REAL mounted Agents surface (per repo memory "Agents inspector was orphaned" — require a test that pumps the mounted nav column, not an isolated widget) asserting the relocated view/nav row is reachable.

**Per api_server issue (every issue that touches `apps/api_server`):**
```bash
cd apps/api_server && node_modules/.bin/tsc --noEmit && npm test
```
New routes get a `src/__tests__/*.ts` test spinning up `createApp().listen(0)` with `server.maxRequestsPerSocket = 1` (per testing-guide undici-flake guidance) covering the happy path + the empty/unauthorized boundary.

**Schema-drift gate (B, C, D — any new table/column):** confirm the table is created in BOTH `migrations.ts` (SQLite) and `postgres_bootstrap.ts` (Postgres) with matching columns; a vitest asserts the route returns `[]` (not 500) on an empty DB.

**Manual smoke (pre-merge, per phase):** `flutter run -d macos` against `https://api.vcrcapps.com` — verify the single nav column renders in the light theme; New Session / Search work; every TOOLS row opens its target; By Project filters the session list; Email lists recent signals + launches a scoped session; Gallery launches a designer session + renders the design grid. Follow with `failure-postmortem`.

---

## Known Ambiguities

- **A2 (project grouping UX):** "By Project" can be a dropdown selector OR collapsible group headers in the CHATS list. Spec says "grouping/selector" — issue should pick the dropdown selector (lowest-risk reuse of `AgentProjectsController.select`) unless a quick group-header variant is obviously better; flag for reviewer if the implementer diverges.
- **C1 (role application depth):** whether `mcpRole` is enforced by passing `allowedTools` to the SDK at session create (init-time gate, preferred per security constraint) vs. stored-and-filtered. Issue C1 must specify init-time gating only; surface to reviewer if the SDK cannot accept a per-session tool allowlist (fallback: scope via a generated per-session `.mcp.json` passed as the session cwd config).
- **Gmail MCP package pin:** the exact gmail MCP server package/command is unverified (cf. repo memory `TODO(verify-pin)` on community MCP packages). Issue C2 must version-pin and verify the package exists before merge; do not ship an unpinned `npx` spec.

---

## Issue table

| Order | Title | Goal | Likely files | Tests / evaluation | Dependencies |
|-------|-------|------|--------------|--------------------|--------------|
| A1 | Agents left-nav: single Odysseus-style column shell | Replace `ProjectsRail` + `_SessionListPanel` in `_buildWorkspace` with one column: header (☰ collapse + "Agents"), ＋New Session, CHATS section hosting the existing session list, TOOLS group placeholder, footer (Account + ⚙︎Settings). Light theme tokens. Transcript + inspector untouched. | `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (`_buildWorkspace`, `_SessionListPanel`, `_SessionListHeader`); NEW `lib/features/agents/views/_agents_nav_column.dart`; `lib/app/core/ui/tokens/rhythm_theme.dart` (read only) | flutter analyze/format/test; REAL-SURFACE widget test pumping the mounted Agents view asserting the nav column + CHATS list render and a session row is selectable | — |
| A2 | Fold projects rail into "By Project" selector at top of CHATS | Remove the 64px `ProjectsRail`; add a "By Project" selector (dropdown, default "All") at the top of CHATS that drives the existing `selectedProjectId` filter; keep the add-project action; move the rail's profiles entry out (handled by A5). | `agents_view.dart`; `lib/features/agents/views/_projects_rail.dart` (remove/retire); `lib/features/agent_projects/controllers/agent_projects_controller.dart` (reuse `select`/`selectedProjectId`); `_agents_nav_column.dart` | analyze/format/test; widget test: selecting a project filters the session list; "All" shows all | A1 |
| A3 | Add session Search to the nav | 🔍 Search row/field that filters the CHATS session list by name/preview (client-side over `controller.sessions`). Empty query = no filter. | `_agents_nav_column.dart`; `agents_view.dart`; `lib/features/agents/controllers/agents_controller.dart` (read `sessions`; add a search-filter helper if needed) | analyze/format/test; widget test: typing filters rows, clearing restores | A1 |
| A4 | Relocate Brain / Deep Research / Tasks / Webhooks into TOOLS nav rows; remove Settings tiles + toolbar icons | Add TOOLS rows opening `AgentMemoryView`, `AgentResearchView`, `AgentSchedulesView`, `AgentWebhooksView` (existing `const X({super.key})` views, controllers already in `main.dart`). Remove the Settings tiles and the toolbar icons that previously surfaced them. | `_agents_nav_column.dart`; `agents_view.dart` (remove `Icons.schedule`/`Icons.travel_explore` from `_SessionListHeader` ~776–801); `lib/features/settings/views/settings_view.dart` (remove tiles 1465–1517 for the 3 relocated views) | analyze/format/test; widget test: each TOOLS row navigates to its view; Settings no longer lists them | A1 |
| A5 | Surface Profiles as a TOOLS nav row | 🤖 Profiles row opens `showAgentProfileSheet(context)`; remove the profiles section from the retired rail. | `_agents_nav_column.dart`; `lib/features/agents/views/_agent_profile_sheet.dart` (reuse `showAgentProfileSheet`); `_projects_rail.dart` (remove profiles section) | analyze/format/test; widget test: Profiles row opens the sheet | A1, A2 |
| B1 | Cookbook backend: `agent_cookbook` table + CRUD routes | New table (id, title, description, steps_json, bound_config_id?, created_at, updated_at) in BOTH SQLite + Postgres; repository/controller/routes mirroring `agent_scheduled_tasks`; register in `app.ts`. | `apps/api_server/src/database/migrations.ts`; `…/postgres_bootstrap.ts`; NEW `…/repositories/agent_cookbook_repository.ts`, `…/controllers/agentCookbookController.ts`, `…/routes/agentCookbookRoutes.ts`; `…/src/app.ts` | tsc --noEmit; vitest: CRUD happy path + empty-DB returns `[]` (schema-drift gate, both engines) | — |
| B2 | Cookbook Flutter feature + nav row | New `agent_cookbook` feature dir (view/controller/repository/data/model) listing + authoring recipes; register controller in `main.dart`; 📖 Cookbook TOOLS row. | NEW `apps/desktop_flutter/lib/features/agent_cookbook/**`; `apps/desktop_flutter/lib/main.dart` (provider); `_agents_nav_column.dart` | analyze/format/test; widget test: Cookbook row opens the view; list renders from data source | A1, B1 |
| C1 | Interactive sessions: add `mcpRole` (init-time tool gating) | Add `mcpRole?` to the session-create DTO; at create, resolve `.mcp-roles/<role>.mcp.json` and pass its `mcpServers`/`allowedTools` to the SDK session (init-time gate ONLY — no runtime dispatch check). Unknown/missing role → 400 (no silent fallback to full tools). | `apps/api_server/src/models/agent_session.ts`; `…/controllers/agent_sessions_controller.ts` (`create`); `…/services/opencode_client_service.ts` / `opencode_engine.ts` (pass allowlist); read `.mcp-roles/*.mcp.json` | tsc; vitest: role resolves → allowlist passed to SDK mock; unknown role → 400; no role → unchanged behavior | — |
| C2 | Gmail MCP server in catalog + `email-assistant` role + signals endpoint | Add a version-pinned gmail entry to `curated_mcp_servers.ts`; create `.mcp-roles/email-assistant.mcp.json` (mirror `church-admin`: gmail + rhythm in `mcpServers`, scoped `allowedTools`, `disabledMcpServers: [bash,computer,editor,filesystem]`); add `GET /integrations/gmail-signals` → `gmail_signals_repository.listRecentAsync(ownerId)`. | `apps/api_server/src/config/curated_mcp_servers.ts`; NEW `.mcp-roles/email-assistant.mcp.json`; NEW `…/routes/gmail_signals_routes.ts` + controller; `…/src/app.ts`; reuse `…/repositories/gmail_signals_repository.ts` | tsc; vitest: signals route returns recent list + `[]` on empty; role JSON validates against the shape. Safety: gmail pin verified (no unpinned npx); role scopes only gmail+rhythm | — (C1 for launch flow in C3) |
| C3 | Email Flutter feature + nav row | New `agent_email` feature dir = recent-signals list (from C2 endpoint) + "Launch email assistant" button that creates a session with `mcpRole: 'email-assistant'` (via C1); 📧 Email TOOLS row. | NEW `apps/desktop_flutter/lib/features/agent_email/**`; `apps/desktop_flutter/lib/main.dart`; `_agents_nav_column.dart`; `lib/features/agents/controllers/agents_controller.dart` (pass `mcpRole` on create) | analyze/format/test; widget test: Email row opens view; signals render; launch button calls createSession with role | A1, C1, C2 |
| D1 | Gallery backend: `graphic-designer` role + `agent_designs` table + routes | Create `.mcp-roles/graphic-designer.mcp.json` (scopes Canva tools: generate-design, create-design-from-brand-template, export-design, …; `disabledMcpServers` as above); new `agent_designs` table (id, title, canva_url, thumbnail_url, session_id, created_at) in BOTH DBs; repository/controller/routes; register in `app.ts`. | NEW `.mcp-roles/graphic-designer.mcp.json`; `migrations.ts`; `postgres_bootstrap.ts`; NEW `…/repositories/agent_designs_repository.ts`, `…/controllers/agentDesignsController.ts`, `…/routes/agentDesignsRoutes.ts`; `…/src/app.ts` | tsc; vitest: CRUD + `[]` on empty (both engines); role JSON validates. Safety: role scopes only Canva | — (C1 for launch flow in D2) |
| D2 | Gallery Flutter feature + nav row | New `agent_gallery` feature dir = "Launch designer" button (creates session with `mcpRole: 'graphic-designer'`) + grid of designs (thumbnail/title/Canva link from D1 endpoint); 🎨 Gallery TOOLS row. | NEW `apps/desktop_flutter/lib/features/agent_gallery/**`; `apps/desktop_flutter/lib/main.dart`; `_agents_nav_column.dart` | analyze/format/test; widget test: Gallery row opens view; design grid renders; launch button calls createSession with role | A1, C1, D1 |

---

## Next in chain

Hand off to `issue-writer` to convert this table into GitHub-ready issues (do not create remote issues until the user confirms). Then `acceptance-contract` per issue before `coding-agent`.
