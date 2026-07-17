# Mega-PR Execution Plan — #1042–#1108 (37 issues)

**Author:** planning-agent (Tier 1) · **Date:** 2026-07-17 · **Branch base:** `main` (remote `ajhochy/Rhythm`)
**Sources:** `docs/ai/current-plan-opencode-utilization.md` (OCU epic issue table + deps), each issue body (`gh issue view`), `docs/ai/repo-map.md`, `docs/ai/architecture.md`, `docs/ai/testing-guide.md`, GitNexus/grep collision investigation.

## Goal (one sentence)

Land 37 open issues in a single coordinated mega-PR by scheduling them into **clusters that respect dependency order AND touch disjoint files**, so at most **2 coding-agents** run in parallel without write collisions.

## What this plan is / is not

- **Is:** a topological + file-ownership schedule. Acceptance criteria already live in the issue bodies (each has "Acceptance criteria" + "Required tests"); this plan carries a one-line acceptance summary per issue and points at the authoritative body.
- **Is not:** a re-derivation of per-issue criteria. Clarification interview skipped — see `## Clarification interview`.

## Clarification interview

Skipped. This is a scheduling/parallelization plan over 37 pre-specified GitHub issues, each already carrying concrete acceptance criteria + required tests + likely files. No new behavior is being specified here; there is nothing to clarify with the user beyond the concurrency cap (given: 2). Any per-issue ambiguity is the implementing `coding-agent`'s to resolve against the issue body via `acceptance-contract`.

---

## 1. The collision hot zones (why ordering matters)

Dependencies alone do not determine parallelizability — **shared-file writes** do. Investigation surfaced these multi-issue files. Any two issues sharing a hot-zone file **cannot** run concurrently.

| Hot-zone file | App | Issues that WRITE it | Verdict |
|---|---|---|---|
| `services/opencode_client_service.ts` | api | #1042, #1044, #1045, #1047(no), #1048, #1049, #1057, #1060, #1063, #1064, #1065, #1066, #1068, #1070 | **Serialize all api wrapper-adders**; single biggest backend collision point |
| `services/opencode_stream_bridge.ts` | api | #1042, #1044, #1045, #1057, #1063, #1070 | Serialize with client_service group |
| `services/opencode_agent_writer.ts` | api | #1073, #1088, #1094 | **Serialize** — projection/mode/permission/tool serialization |
| `services/agent_profile_sync.ts` | api | #1073, #1088 | Serialize |
| `repositories/agent_configs_repository.ts` | api | #1073, #1088, #1094 | Serialize |
| `database/migrations.ts` | api | #1058(#1017), #1069, #1071(no)+#1072, #1073, #1088 | **Serialize every migration-adder** (schema drift rule) |
| `services/agent_model_resolver.ts` | api | #1071, #1108 | Serialize |
| `services/opencode_plugin_config.ts` (managed config) | api | #1069, #1071, #1072 | Serialize |
| `config/env.ts` | api | #1049 (Stage 1), #1093 (Stage 2) | Different stages → no concurrent collision, but same file — keep in one api lane |
| `routes/agent_sessions_routes.ts` | api | #1060, #1063, #1064, #1065, #1066 | Serialize (M5 route-adders) |
| `views/agents_view.dart` | flutter | #1046, #1059, #1061, #1063, #1064, #1065, #1066 | **Serialize all flutter M5/queue UI** — biggest flutter collision point |
| `views/_changes_tab.dart` | flutter | #1059, #1064 | Serialize |
| `views/_agent_profile_sheet.dart` | flutter | #1074, #1079 | Serialize |
| `controllers/agents_controller.dart` | flutter | #1043,#1046,#1047,#1059,#1061,#1062,#1066 | Serialize (very hot) |
| `data/agents_data_source.dart` | flutter | #1043,#1059,#1061,#1062,#1063,#1064 | Serialize |

**Consequence:** the two biggest hot zones — api `opencode_client_service.ts`/routes and flutter `agents_view.dart`/`agents_controller.dart` — mean **most api_server work and most flutter work each form one long serial spine**. True parallelism comes from running **one api spine agent + one flutter spine agent** concurrently (they touch disjoint apps), plus a few genuinely-isolated standalone issues.

This is the core strategy: **App-partitioned parallelism** (api ‖ flutter), sequenced within each app by hot-zone ownership and dependency.

---

## 2. Flags (docs-only / tracking / fork-blocked)

| Issue | Flag | Note |
|---|---|---|
| **#1076 (OCU-35)** | **TRACKING ONLY** | Watch-list. No code. Close by supersession. Add to PR body as "no-op, kept open." **Exclude from all clusters.** |
| **#1084** | **Docs/UX, near-trivial** | Mirrored-task read-only affordance OR revert toast. Flutter-only, isolated widget/styling. No backend. |
| **#1068 (OCU-27)** | **FORK-BLOCKED** | Depends on **#1067 (OCU-26)** which is **NOT in this set**. #1067 regenerates the fork SDK; without it there are no regenerated types to adopt. **#1068 cannot be implemented in this mega-PR** — it also requires a fork rebuild + re-sign (`bun run build --single`). **Recommend: EXCLUDE #1068**, or land only a no-behavior stub. Confirm with user before assigning. Listed below as **BLOCKED**. |
| **#1093** | **ACTIVE — clusterable** | OPEN. Its precursor was NOT this — PR #1095 (`feat: add opt-in hybrid Engraph memory retrieval`) is already **MERGED** on `main`, so the retrieval seam it needs exists. #1093 adds the engraph CLI-shellout client + semantic scoring behind a default-`fts` toggle. api-only. Clustered in Wave D-model as **D-0** (touches `config/env.ts`, disjoint from projection/config-writer files). |
| **#1096** | **DEP now SATISFIED — but still DEFER** | Its stated blocker (PR #1095 merged + approved) is **already met** (verified 2026-07-17: #1095 MERGED). Still **recommend deferring #1096 to a follow-up PR**: it is a 2-work-package epic (backend device-local Engraph service-manager with loopback auth + 1s health gate + process-ownership, then a full Flutter Settings UI with signed-app smoke checklist) — far larger than a mega-PR-sized unit, and #1093 (D-0) should land + settle first. Flagged, not clustered by default. |
| **#1099** | **Trivial one-liner** | `agent_runner.ts:37` default `3` → `8`. Isolated. |

---

## 3. Clusters (topologically ordered)

Each cluster is a set of issues that (a) respects dependency order and (b) touches disjoint files from every other cluster it runs *concurrently* with. Clusters are grouped by app and file ownership. **Concurrency cap = 2 agents.**

Legend: **[api]** = api_server, **[flt]** = flutter, **[both]** = spans both apps, **[fork]** = opencode_fork.

---

### WAVE A — isolated quick wins (fully parallel-safe, no shared files with anything)

These touch files nothing else in the mega-PR touches. Can be done first, in any order, even bundled by one agent.

#### Cluster A1 — Trivia [api]
| Issue | App | Likely files | Dep | Acceptance (one-line) |
|---|---|---|---|---|
| #1099 | api | `services/agent_runner.ts` (`getMaxConcurrentRuns` default) | — | Concurrent-run cap default is 8, env still overrides; capacity test updated. |
| #1048 (OCU-07) | api | `services/opencode_client_service.ts`†, `controllers/agent_sessions_controller.ts` | — | Hard-delete calls engine `session.delete` (404-tolerant); soft/archive unchanged. |

† #1048 touches `opencode_client_service.ts` — the api hot zone. It is placed here because it is the *smallest* client_service change; if A1 and the api spine (Cluster B) run concurrently, **#1048 must be folded into the api spine, not A1.** See ordering §4.

#### Cluster A2 — Docs/UX [flt]
| Issue | App | Likely files | Dep | Acceptance |
|---|---|---|---|---|
| #1084 | flt | mirrored-task row widget in Tasks feature (read-only affordance / revert toast) | — | User sees mirrored task fields are prod-authoritative (read-only style or revert toast). Flutter analyze/format clean. |

---

### WAVE B — the two long serial spines (run B-api ‖ B-flt concurrently: 2 agents)

This is the workhorse wave. **B-api and B-flt touch disjoint apps → safe to run as the 2 concurrent agents.** Within each spine, issues are strictly ordered by hot-zone ownership + dependency.

#### Spine B-api — api_server backend (ONE agent, sequential internally)

Ordered so each step's writes to `opencode_client_service.ts` / `opencode_stream_bridge.ts` / routes land before the next reads them.

| Order | Issue | App | Likely files | Dep | Acceptance |
|---|---|---|---|---|---|
| B-api-1 | #1042 (OCU-01) | api | `opencode_client_service.ts`, `opencode_stream_bridge.ts`, `agent_sessions_controller.ts`, `routes/agent_sessions_routes.ts`, `@types/opencode-ai-sdk.d.ts` | — | Permission replies go through `POST /permission/:id/reply` (once/always/reject+msg); "always" persists live; deprecated path is fallback-only. |
| B-api-2 | #1044 (OCU-03) | api | `opencode_stream_bridge.ts`, `opencode_client_service.ts`, `ws_gateway.ts` | #1042 | Pending permissions/questions rehydrate on (re)connect; no dup cards. |
| B-api-3 | #1045 (OCU-04) | api | `opencode_client_service.ts`, `opencode_stream_bridge.ts`, `server.ts`, `repositories/agent_sessions_repository.ts` | — | Stuck working/starting rows reconciled to engine truth on ready; error rows not clobbered. |
| B-api-4 | #1049 (OCU-08) | api | `opencode_client_service.ts`, `config/env.ts`, `cli/setup/rhythm_config_store.ts`, `config/rhythm_config.ts` | — | Websearch env injected when key set; absent → no env delta; key never logged. |
| B-api-5 | #1050 (OCU-09) | api | `routes/opencode_commands_routes.ts` (new), `app.ts`, `opencode_client_service.ts` | — | Commands CRUD writes `commands/*.md` + reloadConfig; collision→409; delete refuses built-ins. |
| B-api-6 | #1057 (OCU-16) | api | `opencode_client_service.ts`, `routes/opencode_worktrees_routes.ts` (new), `app.ts`, `opencode_stream_bridge.ts` | — | Worktree CRUD + reset routes work on a real repo; ready/failed relayed as typed WS frames. |
| B-api-7 | #1058 (OCU-17) | api | `controllers/agent_sessions_controller.ts`, `repositories/agent_sessions_repository.ts`, `database/migrations.ts`, `services/agent_runner.ts` | #1057 | `isolateWorktree` create routes edits into worktree; metadata persisted; migration clean. **(migrations.ts writer — see §5)** |
| B-api-8 | #1060 (OCU-19) | api | `opencode_client_service.ts`, `routes/agent_session_files_routes.ts` (new) or `agent_sessions_routes.ts`, `agent_sessions_controller.ts` | — | find/file proxy subroutes round-trip; path-traversal → 400; 2MB cap. |
| B-api-9 | #1063 (OCU-22) api-half | api | `opencode_client_service.ts`, `routes/agent_sessions_routes.ts`, `opencode_stream_bridge.ts` | — | `/vcs` + `/vcs/status` wrappers/routes; `vcs.branch.updated` typed WS relay. |
| B-api-10 | #1064 (OCU-23) api-half | api | `opencode_client_service.ts`, `routes/agent_sessions_routes.ts` | — | `/vcs/diff?mode=` + `/vcs/diff/raw` proxied; raw content-type preserved. |
| B-api-11 | #1065 (OCU-24) api-half | api | `opencode_client_service.ts`, `routes/agent_sessions_routes.ts`, `agent_sessions_controller.ts` | — | `session.shell` wrapped + `POST /:id/shell` route. |
| B-api-12 | #1066 (OCU-25) api-half | api | `opencode_client_service.ts`, `routes/agent_sessions_routes.ts` | — | `session.init` wrapped + `POST /:id/init` route. |
| B-api-13 | #1070 (OCU-29) | api | `opencode_stream_bridge.ts`, `opencode_client_service.ts` | soft: #1044/#1045 | Bridge on single `/global/event` + heartbeat watchdog; fallback flag. **LAST in spine** (rewrites bridge subscription — do after all bridge-relay adders). |

#### Spine B-flt — flutter client (ONE agent, sequential internally)

Ordered so each step's writes to `agents_view.dart` / `agents_controller.dart` / `agents_data_source.dart` land before the next. **B-flt UI issues that consume B-api routes (#1061,#1062 need #1060; #1059 needs #1058) must start after their api counterpart merges into the branch** — see §4 cross-spine gates.

| Order | Issue | App | Likely files | Dep | Acceptance |
|---|---|---|---|---|---|
| B-flt-1 | #1047 (OCU-06) | flt | `views/_question_tool_card.dart`, `controllers/agents_controller.dart`, question payload model | — | Question card honors `custom`/`multiple`; reply payload `string[][]`; single-select unchanged. |
| B-flt-2 | #1046 (OCU-05) | flt (+ ws_gateway guard check) | `views/agents_view.dart`, `controllers/agents_controller.dart`, `services/ws_gateway.ts`† | — | Composer stays enabled while working; queued chip; blocks only on ended/error. †tiny ws_gateway guard-removal — see §5. |
| B-flt-3 | #1063 (OCU-22) flt-half | flt | `views/agents_view.dart`, `data/agents_data_source.dart` | #1063 api-half | Branch badge + dirty count in header; hidden for non-git; live-updates on WS frame. |
| B-flt-4 | #1064 (OCU-23) flt-half | flt | `views/_changes_tab.dart`, `data/agents_data_source.dart` | #1064 api-half | Changes-tab scope toggle (session/all/branch) + export patch (git apply --check passes). |
| B-flt-5 | #1065 (OCU-24) flt-half | flt | `views/agents_view.dart` (composer + renderer) | #1065 api-half | `!cmd` runs shell into transcript; `\!` escapes; plan-mode asks/denies. |
| B-flt-6 | #1066 (OCU-25) flt-half | flt | `views/agents_view.dart`, `controllers/agents_controller.dart` | #1066 api-half | Header "Prepare project for agents" runs init as a turn; streams progress. |
| B-flt-7 | #1061 (OCU-20) | flt | `views/agents_view.dart`, `data/agents_data_source.dart`, `controllers/agents_controller.dart` | #1060 (api) | `@`-mention fuzzy file attach via find/file proxy; content fetched via proxy (worktree-safe). |
| B-flt-8 | #1062 (OCU-21) | flt | `views/_files_tab.dart` (new), `views/_session_side_panel.dart`, `controllers/agents_controller.dart`, `data/agents_data_source.dart` | #1060 (api) | Files tab browse + preview + git-status dots; refuses >2MB. |

---

### WAVE C — the agent-projection hot zone (STRICTLY SERIAL — never parallel with each other)

`opencode_agent_writer.ts` + `agent_profile_sync.ts` + `agent_configs_repository.ts` + `migrations.ts` are shared by **#1088, #1073, #1094**. These three **cannot run concurrently with each other**, and each adds a `migrations.ts` schema change (drift rule). Run them as one serial chain, done by a single api agent. They MAY run concurrently with a **flutter** cluster (Wave D) since they are api-only.

| Order | Issue | App | Likely files | Dep | Acceptance |
|---|---|---|---|---|---|
| C-1 | #1088 | api | `opencode_agent_writer.ts`, `agent_profile_sync.ts`, `repositories/agent_configs_repository.ts`, `controllers/agentSchedulesController.ts`, `database/migrations.ts` | — (relates #1039, merged) | Picker visibility decoupled from schedulability; hidden specialist schedulable via real profile; `assertSchedulableProfile` accepts hidden-schedulable. **Live e2e: schedule a hidden specialist, run through real AgentRunner, assert non-empty output.** |
| C-2 | #1073 (OCU-32) | api | `opencode_agent_writer.ts`, `agent_profile_sync.ts`, `repositories/agent_configs_repository.ts`, `controllers/agent_configs_controller.ts`, `database/migrations.ts` | after C-1 (same files) | Full permission-key round-trip (arbitrary keys + wildcards) into `.md` frontmatter; sync lossless; live: agent websearch denied. |
| C-3 | #1094 | api (+ maybe fork verify) | `opencode_agent_writer.ts`, `repositories/agent_configs_repository.ts`, `controllers/agent_configs_controller.ts`, `database/migrations.ts` | after C-2 (same files) | OpenAI native `image_generation` grantable per-profile, NOT via MCP allowlist; scoped + approval-respecting; effective after `/system/refresh`. Fork already supports the tool (`opencode_fork/.../image-generation.ts`) — **api/engine-spawn wiring only, verify no fork change needed.** |

---

### WAVE D — managed-config + model-resolver hot zone (STRICTLY SERIAL among themselves)

`opencode_plugin_config.ts` (managed config) shared by #1069/#1071/#1072; `agent_model_resolver.ts` shared by #1071/#1108. Run as one serial api chain. MAY run concurrently with a flutter cluster.

| Order | Issue | App | Likely files | Dep | Acceptance |
|---|---|---|---|---|---|
| D-0 | #1093 | api | `services/engraph_client.ts` (new), `services/memory_retrieval.ts`, `config/env.ts`, `__tests__/memory_retrieval_semantic.test.ts` (new) | PR #1095 (merged ✓) | Engraph CLI-shellout semantic retrieval behind `AGENT_MEMORY_RETRIEVAL_MODE` (default `fts`); owner-scoping preserved; ≤1s timeout fail-closed to FTS; toggle-off = no regression. |
| D-1 | #1108 | api | `services/agent_runner.ts` (`resolveRunModel`), `services/agent_model_resolver.ts`, `services/model_fallback.ts` | — | Anthropic-exhaustion → OpenAI fallback picks usable model/account and **persists across ≥2 prompts**; no per-prompt revert; error names provider/model/account. **Live-ish: fallback selection + override persistence tests.** |
| D-2 | #1071 (OCU-30) | api | `services/opencode_plugin_config.ts` (or sibling managed_config), `services/agent_model_resolver.ts`, `server.ts` | after D-1 (agent_model_resolver) | Managed `small_model`/`username`/`reference`/compaction/tool_output defaults; absent-only for user-tunable; reloadConfig. |
| D-3 | #1069 (OCU-28) | api | new `rhythm-telemetry` vendored plugin, `opencode_plugin_config.ts`, `run_quality_routes.ts`, `run_quality_service.ts`, `database/migrations.ts` | after D-2 (plugin_config + migrations) | tool.execute hooks POST tool-events; counts/names align with transcript; async fire-and-forget; disable flag. **(migrations.ts writer — see §5)** |
| D-4 | #1072 (OCU-31) | api | `routes/org_settings_routes.ts` (new), `database/migrations.ts`, `database/postgres_bootstrap.ts`, `opencode_plugin_config.ts`, `server.ts` | after D-3 (plugin_config + migrations) | Org instructions markdown synced from prod, registered in engine `instructions`; offline→cached; user entries preserved. **Only prod-touching issue → postgres_bootstrap backfill required (schema drift).** |

---

### WAVE E — dependent UI layers (after their backends land in-branch)

These consume Wave B/C backends. Grouped by app for concurrency.

#### Cluster E-flt-1 — Permission + playbooks + worktree UI [flt]
| Order | Issue | App | Likely files | Dep | Acceptance |
|---|---|---|---|---|---|
| E1 | #1043 (OCU-02) | flt | `views/_permission_card.dart`, `controllers/agents_controller.dart`, `data/agents_data_source.dart` | #1042 (B-api-1) | PermissionCard "Always allow" + deny-reason on standard + destructive modal. |
| E2 | #1051 (OCU-10) | flt | `features/agent_playbooks/*` (new), `views/_agents_nav_column.dart`, `main.dart` | #1050 (B-api-5) | Playbooks manager UI CRUD; built-ins read-only; new playbook shows in slash popover immediately. |
| E3 | #1052 (OCU-11) | flt | `views/_slash_command_popover.dart`, `data/commands_data_source.dart`, `views/agents_view.dart` | #1050 (B-api-5) | Arg hints + custom-command dispatch verified; subtask→child chip; popover refreshes on new playbook. |
| E4 | #1059 (OCU-18) | flt | `views/agents_view.dart`, `views/_session_list_body.dart`, `views/_changes_tab.dart`, `controllers/agents_controller.dart`, `data/agents_data_source.dart` | #1058 (B-api-7) | Worktree create toggle + isolation badge + Changes-tab reset/remove; ready/failed toasts. |

> **Note:** E3 and E4 both touch `views/agents_view.dart`; E1/E3/E4 touch `agents_controller.dart`; E4 touches `_changes_tab.dart` (also B-flt-4). E-flt-1 is therefore **internally serial** and must land **after Spine B-flt completes** (agents_view.dart/controller ownership). One flutter agent owns B-flt → E-flt-1 as a continuous spine.

#### Cluster E-flt-2 — profile-sheet permission matrix [flt]
| Order | Issue | App | Likely files | Dep | Acceptance |
|---|---|---|---|---|---|
| E5 | #1073→#1074 (OCU-33) | flt | `views/_agent_profile_sheet.dart`, `features/agent_configs/*` | #1073 (C-2) | Tool-permission tri-state matrix in profile sheet; live: websearch=Deny enforced. |
| E6 | #1079 | flt | `views/_agent_profile_sheet.dart`, `features/agent_configs/*` | soft: #1088 (C-1) | "Show in agent picker" toggle in profile sheet → PATCH `sessionSelectable`; hint on scheduled-but-hidden. |

> **Note:** E5 and E6 both write `_agent_profile_sheet.dart` → **serial with each other**. Both depend on Wave C backends. One flutter agent owns E-flt-2. E6 (#1079) should land after C-1 (#1088) so the toggle reflects the decoupled semantics.

---

### WAVE F — final cleanup (LAST, after everything it audits has landed)

| Order | Issue | App | Likely files | Dep | Acceptance |
|---|---|---|---|---|---|
| F1 | #1075 (OCU-34) | both | `opencode_client_service.ts`, `opencode_client_service.test.ts`, `data/agents_data_source.dart`, `data/agents_repository.dart`, `views/_session_model_picker.dart` (delete) | after B (esp. #1052 dispatchCommand note) | Dead code removed (`listProviders`, `fetchChildSessions`, `dispatchCommand`, `SessionModelPicker`); grep proves zero refs; tsc + analyze green. |

> **Note:** F1 deletes from `opencode_client_service.ts` (api hot zone) and `agents_data_source.dart` (flutter hot zone) → **must run after both Spine B-api and B-flt (and E) are done**, single agent, last. Per issue: delete `dispatchCommand` even if #1052 landed.

---

## 4. Ordering — concurrency plan (cap = 2 agents)

**Strategy: app-partitioned parallelism.** api-only and flutter-only clusters run as the 2 concurrent lanes. Cross-app UI-consumes-backend gates force some sequencing.

```
STAGE 0 (2 agents ‖):   A1 [api trivia]        ‖  A2 [flt docs/ux #1084]
                        (fold #1048 into B-api if B starts before A1 done)

STAGE 1 (2 agents ‖):   Spine B-api            ‖  Spine B-flt
  ── the workhorse.        (#1042→#1044→#1045      (#1047→#1046→ vcs/shell/init
     api & flutter are      →#1049→#1050→#1057      flt-halves → #1061→#1062)
     disjoint apps →        →#1058→#1060→ vcs/
     fully parallel.        shell/init api-halves
                            →#1070)
  CROSS-SPINE GATES (flt step waits for the matching api route to exist in-branch):
    - B-flt-3 #1063-flt  after  B-api-9  #1063-api
    - B-flt-4 #1064-flt  after  B-api-10 #1064-api
    - B-flt-5 #1065-flt  after  B-api-11 #1065-api
    - B-flt-6 #1066-flt  after  B-api-12 #1066-api
    - B-flt-7 #1061      after  B-api-8  #1060
    - B-flt-8 #1062      after  B-api-8  #1060
  (These are ~ordered the same way in both spines, so a lockstep cadence keeps
   both agents busy. If the flt agent outruns api, it parks on the next
   non-gated step, e.g. #1047/#1046 which have no api dep.)

STAGE 2 (2 agents ‖):   Wave C [api projection]  ‖  Wave D [api model/config]
  ── BOTH are api-only and STRICTLY SERIAL internally. They touch DISJOINT
     api files (C: agent_writer/profile_sync/agent_configs_repo; D:
     plugin_config/agent_model_resolver/run_quality) EXCEPT both write
     migrations.ts → see §5 migration coordination. With the migration rule
     honored, C ‖ D is safe as the 2 lanes.
     C:  #1088 → #1073 → #1094
     D:  #1093 → #1108 → #1071 → #1069 → #1072
     (D-0 #1093 touches config/env.ts, also touched by Stage-1 B-api-4 #1049 —
      different stage, no live collision; keep both in the api lane's history.)

STAGE 3 (2 agents ‖):   E-flt-1 [flt UI spine]   ‖  E-flt-2 [flt profile sheet]
  ── E-flt-1 needs B-api #1042/#1050/#1058 (Stage 1) done.
     E-flt-2 needs Wave C #1073/#1088 (Stage 2) done.
     They touch DISJOINT flutter files (E-flt-1: agents_view/controller/
     changes_tab/nav_column/playbooks; E-flt-2: _agent_profile_sheet only)
     → safe as 2 lanes.
     E-flt-1: #1043 → #1051 → #1052 → #1059
     E-flt-2: #1074 → #1079

STAGE 4 (1 agent):      Wave F  #1075  (dead-code sweep — LAST, touches both
                        api & flutter hot zones; nothing may be mid-flight)
```

**Sequential-because-shared-file (NOT dependency):** the internal ordering of B-api, B-flt, C, D, E-flt-1, E-flt-2 is forced by hot-zone file ownership, not logical dependency. That is why each is a single-agent spine rather than N parallel agents.

**Sequential-because-dependency (true prereqs):**
`#1042→#1043,#1044`; `#1050→#1051,#1052`; `#1057→#1058→#1059`; `#1060→#1061,#1062`; `#1063-api→#1063-flt` (& 1064/1065/1066 halves); `#1073→#1074`; `#1088→#1079(soft)`; `#1108→#1071`(shared file); `#1067(EXCLUDED)→#1068(BLOCKED)`; `PR#1095→#1096(DEFERRED)`.

---

## 5. Migration coordination (schema-drift rule)

`database/migrations.ts` is appended by **#1058, #1073, #1088, #1069, #1072** (and #1072 also `postgres_bootstrap.ts`). Migrations are numbered/ordered append-only, so two agents editing `migrations.ts` concurrently **will** collide.

**Rule for this mega-PR:** migrations land in a **fixed reserved order**, one agent at a time, even across waves:

1. #1088 (agent_configs permission/mode fields)
2. #1073 (agent_configs `permissionsJson`)
3. #1094 (agent_configs image-gen capability field)
4. #1058 (agent_sessions worktree fields)
5. #1069 (`tool_events` table, local SQLite)
6. #1072 (org_settings + **postgres_bootstrap backfill** — the ONLY prod-schema issue)

Since Wave C (steps 1–3) and Wave D (steps 5–6) run in parallel at Stage 2, **the migration-number assignment must be brokered before Stage 2 starts** (reserve blocks: C gets migration slots N..N+2 incl. #1058 which is actually a Stage-1 item — assign #1058's slot first during Stage 1). Practically: **the orchestrator assigns each migration a fixed integer up front from this list**; agents use their assigned number, never "next available." This is the one place the 2 lanes share a file and must be pre-coordinated.

Also note the AGENTS.md rule: a new Postgres column needs an explicit backfill in `postgres_bootstrap.ts` — **only #1072 touches prod schema**; all other migrations here are **local-SQLite-only** (agent_sessions, agent_configs, tool_events are local), so no postgres_bootstrap changes for #1058/#1069/#1073/#1088/#1094.

---

## 6. Verification matrix (live e2e vs analyze/tests)

Per AGENTS.md behavioral-verification gate + testing-guide. **"Live e2e" = build fork (`bun run build --single`) + api_server, launch with `RHYTHM_OPENCODE_BIN_DIR`, run against sandbox API :4098** (`tools/dev/sandbox.sh`, `RHYTHM_LIVE_E2E=1`).

| Issue | Verification kind | Why |
|---|---|---|
| #1042 | **LIVE e2e (:4098)** | "always" persistence + deny-message-to-agent are fork-facing; unit-green ≠ live-green (per body). |
| #1044 | **LIVE e2e** | restart-rehydration is stateful/engine-facing. |
| #1045 | contract + 1 manual live restart | reconciliation logic unit-testable; restart scenario manual. |
| #1048 | contract + **LIVE** (GET /session/:id → 404) | engine delete is fork-facing. |
| #1049 | contract + **LIVE** (`/experimental/tool/ids` includes websearch) | env-injection only provable against running engine. |
| #1050 | contract + **LIVE** (engine GET /command includes new cmd, no restart) | reloadConfig is engine-facing. |
| #1057 | contract + **LIVE** (real git worktree dir+branch) | creates real git state. |
| #1058 | controller/repo/migration tests + **LIVE** (edit lands in worktree, main untouched) | isolation is the whole point; must verify on disk. |
| #1060 | contract + 1 LIVE smoke (list this repo dir) | path-traversal guard unit-testable; live smoke documents real dir. |
| #1063/#1064/#1065/#1066 (api) | contract + **LIVE** (real repo/branch/shell/init) | all are engine-passthrough of real git/shell/init. |
| #1069 | plugin unit + ingestion route test + **LIVE** (tool-event rows align with transcript) | hook fires only in real engine. |
| #1070 | envelope/watchdog unit (fake timers) + **LIVE** (2 dirs one stream; kill mid-turn → resubscribe <45s) | SSE consolidation is the historically-buggy area. |
| #1071 | managed-config unit + 1 LIVE (title gen uses small_model; @vault ref resolves) | cost routing observable only live. |
| #1072 | route tests + local sync unit + **LIVE** (marker instruction observed on agent) + **prod schema** | prod-touching + engine-facing. |
| #1073 | writer/sync/migration unit + **LIVE** (engine enforces websearch=deny) | permission enforcement is fork-facing. |
| #1088 | unit (picker/deleg/schedule independent) + **LIVE behavioral** (schedule hidden specialist → real AgentRunner → non-empty output) | explicit in acceptance criteria. |
| #1094 | contract + **LIVE** (OpenAI-backed profile generates image; not in allowedMcpsJson) | provider-tool passthrough only provable live. |
| #1108 | fallback-selection + override-persistence tests + **LIVE-ish** (2 consecutive prompts, no revert) | provider-exhaustion path; reproduce per steps. |
| #1075 | existing suites are the guard (tsc + `flutter analyze`) + grep-zero-refs | pure deletion, no new behavior. |
| #1099 | capacity unit test update | one-liner. |
| **Flutter UI** #1043,#1046,#1047,#1051,#1052,#1059,#1061,#1062,#1063-flt,#1064-flt,#1065-flt,#1066-flt,#1074,#1079,#1084 | **`flutter analyze --no-fatal-infos` + `dart format .` + widget test pumping the REAL mounted surface** | per AGENTS.md; the "agents-inspector orphan" lesson — isolated widget tests are insufficient. Where the widget consumes a live route (#1061/#1062/#1059/vcs-flt), a manual smoke item covers the end-to-end. |

**Standing rule (AGENTS.md):** exceptions to live e2e are pure refactors / type-only / doc-only / dep bumps. In this set that's **#1075** (deletion), **#1084** (docs/ux), **#1099** (constant). Everything else engine-facing needs the live gate.

---

## 7. Excluded / deferred (confirm with user)

| Issue | Disposition | Reason |
|---|---|---|
| **#1076 (OCU-35)** | Keep open, tracking-only, no code | Watch-list by design. |
| **#1068 (OCU-27)** | **BLOCKED — recommend exclude** | Depends on #1067 (fork SDK regen), which is **not in this set** and requires a fork rebuild+re-sign. No regenerated types to adopt without it. |
| **#1096** | **DEFER to follow-up PR** | Blocker (PR #1095) already MERGED, so it *could* proceed — but scope (backend Engraph service-manager + Flutter Settings + signed-app health/smoke) is a multi-PR epic on its own; land #1093 (D-0) first. |

---

## 8. Open risks / notes for downstream agents

- **Hot-zone lockstep is the whole game.** The two long api/flutter spines (Stage 1) and the two api projection/config chains (Stage 2) are single-agent by necessity. Do not try to fan out inside a spine — `opencode_client_service.ts` and `agents_view.dart` will collide.
- **Migration numbers must be pre-assigned** (see §5) before Stage 2 fan-out.
- **#1094 fork check:** the `image_generation` tool already exists in `opencode_fork/packages/core/.../image-generation.ts` and `openai-responses.ts`. Confirm this is pure api/spawn wiring (no fork edit) during the acceptance-contract step; if a fork change IS needed it becomes fork-rebuild-blocked like #1068.
- **#1070 (SSE consolidation)** is the riskiest backend change (dual-bus history) — it is placed LAST in Spine B-api so it rewrites the bridge after all per-event relay adders (#1042/#1044/#1057/#1063) are in. Keep the fallback env flag.
- **Pre-existing test pollution** (`issue_723_mcp_remove_reconcile.test.ts` writes real `~/.config/opencode/opencode.json`) — run api_server suites under sandboxed HOME (per project-state.md).
- **Data safety:** all OCU issues are local agent-server (:4001) surface only. **#1072 is the sole prod-schema writer** → additive org_settings column + postgres_bootstrap backfill, flag for manual review per production posture.
- **No PR is merged by an agent.** Draft PR → human smoke → human merge (AGENTS.md).

## Issue → cluster quick index

| Issue | Cluster | Issue | Cluster | Issue | Cluster |
|---|---|---|---|---|---|
| 1042 | B-api-1 | 1058 | B-api-7 | 1072 | D-4 |
| 1043 | E1 | 1059 | E4 | 1073 | C-2 |
| 1044 | B-api-2 | 1060 | B-api-8 | 1074 | E5 |
| 1045 | B-api-3 | 1061 | B-flt-7 | 1075 | F1 |
| 1046 | B-flt-2 | 1062 | B-flt-8 | 1076 | TRACKING (excl.) |
| 1047 | B-flt-1 | 1063 | B-api-9 / B-flt-3 | 1079 | E6 |
| 1048 | A1 (or fold B-api) | 1064 | B-api-10 / B-flt-4 | 1084 | A2 |
| 1049 | B-api-4 | 1065 | B-api-11 / B-flt-5 | 1088 | C-1 |
| 1050 | B-api-5 | 1066 | B-api-12 / B-flt-6 | 1093 | (base for #1096; in prior epic) |
| 1051 | E2 | 1068 | BLOCKED (excl.) | 1094 | C-3 |
| 1052 | E3 | 1069 | D-3 | 1096 | DEFERRED |
| 1057 | B-api-6 | 1070 | B-api-13 | 1099 | A1 |
| 1093 | D-0 | 1071 | D-2 | 1108 | D-1 |
