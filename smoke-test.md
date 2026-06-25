# Smoke Test

Scope: PR #734 / `feature/agent-scheduler`, P4 manager-to-specialist delegation D1-D5.
Date: 2026-06-24 (re-run against the live running app server)

## Findings

- The local agent API (port 4001) was already running, spawned by the live Flutter macOS app (`Rhythm.app`, pid 38523) with `AGENT_LOCAL=true`, so `/agent-delegation/delegate` is reachable without auth (route guard is `if (!env.agentLocal) requireAuth`).
- Acceptance baseline = contract `docs/ai/contracts/issue-P4-manager-delegation.json` (c1-c6). All six criteria were exercised behaviorally against the live server this run.
- Live config state confirms the D5 importer outcome: `workflow-orchestrator.isManager=true` with 12 allowed delegates including `coding-agent`, excluding itself; `coding-agent` present, enabled, isAgent.
- Happy-path delegation returned HTTP 200 in 1.7s with `output="SMOKE_DELEGATION_OK"` and created a persisted session `Delegated: Coding Agent` (`agentKind=coding-agent`, status `idle`), confirming the sub-run is re-scoped to the target profile.

## Checks

| Area | Check | How to run | Result | Reasoning |
| --- | --- | --- | --- | --- |
| Backend | Local agent API alive | `curl localhost:4001/health` | Success | `{"status":"ok","service":"rhythm-api-server"}`. Server spawned by the running app. |
| Backend D5 | Importer state: manager + delegates | `GET /agent-configs`, inspect `workflow-orchestrator` | Success | `isManager=true`, 12 delegates, includes `coding-agent`, excludes self; `coding-agent` enabled+isAgent. |
| Backend D1 | API round-trips `allowedDelegatesJson` (insert) | `POST /agent-configs` with `allowedDelegatesJson:"[\"coding-agent\"]"` | Success | Created config returned `allowedDelegatesJson=["coding-agent"]`, `isManager=true`. |
| Backend D1 | API round-trips `allowedDelegatesJson` (update) | `PATCH /agent-configs/:id` | Success | Returned `allowedDelegatesJson=["coding-agent","verification-gate"]`. Smoke config deleted (204); config count back to 21. |
| Backend D4 | Non-manager cannot delegate | `POST /agent-delegation/delegate` caller `coding-agent` | Success | 403 `caller profile is not allowed to delegate`. |
| Backend D4 | Manager → unlisted target rejected | `POST .../delegate` target `some-bogus-target` | Success | 403 `target profile is not an allowed delegate`. |
| Backend D4 | Self-delegation rejected | `POST .../delegate` caller==target | Success | 400 `self-delegation is not allowed`. |
| Backend D4 | Depth limit enforced | `POST .../delegate` `depth:1` | Success | 400 `delegation depth limit exceeded`. |
| Backend D4 | Empty prompt rejected | `POST .../delegate` `prompt:""` | Success | 400 `prompt is required`. |
| Backend D2/D3 | Allowed delegation runs re-scoped target | `POST .../delegate` caller `workflow-orchestrator` → target `coding-agent` | Success | HTTP 200, `output=SMOKE_DELEGATION_OK`, `targetAgentConfigId=coding-agent`, new session `3bb946b1-...`. |
| Backend D2/D3 | Delegated sub-run persisted + re-scoped | `GET /agent-sessions`, find session | Success | Session `Delegated: Coding Agent`, `agentKind=coding-agent`, status `idle`. |
| Frontend D5 | Profile sheet Manager toggle + Allowed Delegates editor | Manual: Agents → Profiles → open `workflow-orchestrator` → toggle/edit/save | Manual (visual) | Save mechanism (`PATCH allowedDelegatesJson`) and serialization (`agent_profile_model_picker_test.dart`, 6 tests) are both verified; only the visual click-through itself remains a human check. |

## Regressions found during smoke

| Area | Check | Result | Evidence |
| --- | --- | --- | --- |
| Frontend (UI) | Create a new agent session ("+ New") | **RESOLVED — was a misdiagnosis, not a backend bug** | Originally logged as "the backend closes every new session ~1s after create." Re-investigation (2026-06-25) **disproved** that: the server never auto-closes a freshly created session. The new row was simply appended to the **bottom** of a tall-card list and looked like it vanished. Fixed on the Flutter side: newest-first ordering + much denser session cards. See "Corrected diagnosis" below. |
| Agents (UI) | Delegated session reaches terminal state + shows model/usage | **FAIL (cosmetic, still open)** | Delegated sub-run completes server-side (`status: idle`, correct reply) but the desktop card stays "Starting" with `Model ?/?`, `$0.0000`, 0 tokens — delegated runs execute synchronously inside `POST /agent-delegation/delegate` and never stream lifecycle/usage to the desktop client over `ws://localhost:4001/ws/agents`. |

Corrected diagnosis (create→"vanish") — 2026-06-25:
- The backend does **not** auto-close sessions. Verified live against the running `:4001` server: 6 programmatic creates (agent-less, `build` ×2, `claude-code` ×2, incl. a 3-at-once burst) all stayed `starting`; a real app "+ New" stayed `starting`; DB has `starting` sessions surviving up to 186 h.
- The only path that writes `status='closed'` is `markClosed`, callable only via `agent_sessions_controller.ts:421/438` (which **throw 400**, so never on a 201 path) and `:737` = `DELETE /agent-sessions/:id`. The scheduler, `agent_runner`, the delegation service, and the opencode stream bridge never write `closed`; the server never emits a `session.closed` WS frame.
- The smoke-era `closed` rows were **selective** (siblings created seconds apart survived), i.e. a transient create+DELETE actor during that smoke run — not a reconcile.
- Real cause: `createSession` appended new rows to the **bottom** of the list and the cards were tall, so the new session was off-screen / easy to miss. Fix: sort the list newest-first (`_agents_nav_column.dart`) and shrink `SessionRow` to a single-line compact card (`_session_list_body.dart`). The new session is already auto-selected by `_instantCreateSession`.

## Known Gaps

- The profile-sheet editor click-through is the single genuine visual-UI manual check (open sheet, see Manager toggle + Allowed Delegates field, type, save). Its underlying PATCH save path and list serialization are verified automatically above, so the residual risk is purely rendering/interaction.
- D3 was verified at the HTTP boundary the `rhythm_delegate` MCP tool posts to (`POST /agent-delegation/delegate`); the tool wrapper itself is covered by `agentDelegation.test.ts` (unit) rather than a live MCP round-trip this run.
