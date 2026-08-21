---
date: 2026-08-19
repo: Rhythm
branch: codex/mega-a5-gateway
pr: null
issues: [1447]
status: ready_for_verification
tags: [run, Rhythm]
---

## Contract

- `docs/ai/contracts/issue-1447.json`
- Initial failing command: `cd apps/web && node --test tests/contract/issue-1447-gateway.test.mjs`
- Expected failure: tasks requested `http://127.0.0.1:4098/tasks?status=all` instead of `https://api.vcrcapps.com/tasks?status=all`; sessions correctly remained on `:4098`.
- Final command: same; **2/2 passed** (all 26 domain routes + production URL validation).
- Manual: real-account Electron launch is not tested because it requires AJ's production credentials.

## Files

- `apps/web/src/gateway/index.ts`, `apps/web/src/main.tsx`: add and thread `productionApiBase`; route each domain to the Flutter-proven base.
- `apps/electron/src/main.mjs`, `apps/electron/src/preload.cjs`: load/save the production URL and inject its origin into the packaged renderer CSP without changing local agent ports.
- `apps/web/tests/**`: add the routing contract and update live harness configuration/mocks for the second base.
- `docs/ai/contracts/issue-1447.json`, this run note.

## Flutter-derived domain routing

`ServerConfigService.url` defaults to `https://api.vcrcapps.com` and persists `server_url` (`apps/desktop_flutter/lib/app/core/services/server_config_service.dart:4-40`). The local agent constant is separate (`app/core/constants/app_constants.dart:18-20`).

| Web domain | Base | Flutter evidence |
|---|---|---|
| tasks | Production | `lib/main.dart:321,334-337` passes `ServerConfigService.url` to `TasksLocalDataSource`. |
| sessions | Local agent | `features/agents/data/agents_data_source.dart:46-57` fixes `_baseUrl` to `agentLocalBaseUrl`. |
| dashboard | Production | `lib/main.dart:321,369-372` constructs `DashboardDataSource(baseUrl: baseUrl)`. |
| planner | Production | `lib/main.dart:321,363-367` gives configured `baseUrl` to weekly plan and task sources. |
| rhythms | Production | `lib/main.dart:321,358-361` constructs `RhythmsDataSource(baseUrl: baseUrl)`. |
| projects | Production | `lib/main.dart:321,346-355` uses configured base for templates/milestones; `features/projects/views/projects_view.dart:222,273,318,570,614,659,2132` uses `ServerConfigService.url` for instances. |
| messages | Production | `lib/main.dart:321,384-388` constructs `MessagesDataSource(baseUrl: baseUrl)`. |
| facilities | Production | `lib/main.dart:321,379-382` constructs `FacilitiesDataSource(baseUrl: baseUrl)`. |
| automations | Production | `lib/main.dart:321,339-344` constructs `AutomationRulesDataSource(baseUrl: baseUrl)`. |
| integrations | Production | `lib/main.dart:321,390-393` constructs `IntegrationsDataSource(baseUrl: baseUrl)`. |
| liveArtifacts | Production | `app/core/layout/app_shell.dart:303-310,323-327` passes watched `ServerConfigService.url` to `LiveArtifactsDataSource`. |
| userPreferences | Production | `lib/main.dart:321,399-405` and `app_shell.dart:303-310` pass configured base to `UserPreferencesDataSource`. |
| notifications | Production | `lib/main.dart:321,413-418` constructs `NotificationsDataSource(baseUrl: baseUrl)`. |
| memory | Local agent | `features/agent_memory/data/agent_memory_data_source.dart:9-26` fixes `_baseUrl` to `agentLocalBaseUrl`. |
| permissions | Local agent | `features/agents/data/agents_data_source.dart:46-57,543-620` owns local pending-permission/question routes. |
| approvals | Local agent | `features/notifications/data/agent_approvals_data_source.dart:10-29` explicitly says local, never `ServerConfigService.url`. |
| delegation | Local agent (existing route retained) | Flutter has no `/agent-delegation` peer; delegated child sessions use local `AgentsDataSource` (`agents_data_source.dart:46-57`). No unsupported production reassignment was invented. |
| mcp | Local agent | `features/settings/data/mcp_data_source.dart:76-88,152-162` explicitly requires local and never production. |
| skills | Local agent | `features/agents/data/opencode_skills_data_source.dart:158-170,186-189` fixes the local base. |
| schedules | Local agent | `features/agent_schedules/data/agent_schedules_data_source.dart:8-24` fixes the local base. |
| mobileAccess | Local agent | `features/agents/data/mobile_access_data_source.dart:79-98` defaults to `agentLocalBaseUrl`. |
| commands | Local agent | `features/agents/data/commands_data_source.dart:7-21` uses the local command catalog. |
| runQuality | Local agent | `features/run_quality/data/run_quality_data_source.dart:9-24` explicitly uses local. |
| cookbook | Local agent | `features/agent_cookbook/data/agent_cookbook_data_source.dart:9-25` fixes the local base. |
| research | Local agent | `features/agent_research/data/agent_research_data_source.dart:10-18,60-120` fixes the local base. |
| designs | Local agent | `features/agent_gallery/data/agent_gallery_data_source.dart:9-16` and `agent_gallery_view.dart:233,278-279` use local artifact URLs. |

## Electron persistence

- Default: reuse `RHYTHM_AUTH_API_BASE` from `build-config.mjs`; no duplicate production constant.
- Override precedence: `RHYTHM_PRODUCTION_API_URL` → `${app.getPath('userData')}/server-config.json` → `RHYTHM_AUTH_API_BASE`.
- The narrow preload setter invokes a sender-checked IPC handler. Writes use a mode-`0600` temporary JSON file plus atomic rename. HTTP(S), no credentials/query/fragment is enforced. The local `apiBase`/`engineBase` remain `4098`/`4097`.
- The custom production origin is added only to the packaged `index.html` CSP response; the static local-agent origins remain unchanged.

## Checks

- `cd apps/web && npm install` — pass; 77 packages installed.
- `cd apps/web && npm run typecheck` — pass (run twice).
- `cd apps/web && npm run build` — pass; Vite built 1,662 modules.
- `cd apps/web && node --test tests/contract/issue-1447-gateway.test.mjs` — **2/2 pass**.
- `cd apps/electron && npm install` — pass; 72 packages installed.
- `cd apps/electron && npm run typecheck` — nonzero only for the dispatched 12 pre-existing `src/artifact-policy.mjs` errors; `main.mjs` and `preload.cjs` are clean.
- `cd apps/electron && npm test` after web build — **31/32 pass**. Only `slice-7-c4` failed with `net::ERR_CONNECTION_REFUSED` because it requires the forbidden-for-this-slice sandbox on `4098`; the orchestrator owns that verification.
- `git diff --check` — pass.
- GitNexus pre-edit file impacts: gateway index, Electron main, and preload all LOW (0 indexed dependents); function symbols were absent from the stale index. `detect_changes(scope=all)` — LOW, 26 changed files, no affected indexed process.

### Playwright suites changed/audited

The orchestrator verified PID 52943 was a two-day-old orphaned Vite process in a retired worktree, received AJ's explicit approval, terminated only that process family, and confirmed live ports `4001`/`4096` remained intact. It then ran the non-sandbox suites serially:

- `npm run test:fixture` — **15/15 pass**.
- `npm run test:contract` — **134/134 pass**.
- auth config — **9/9 pass**.
- phase 2 fixture — **4 pass, 3 intentional skips**.
- phase 5 fixture — **17/17 pass**.
- phase 6 fixture — **14/14 pass**.
- phase 7 fixture — **13/13 pass**.
- phase 8 fixture — **10/10 pass**.

Remaining for the orchestrator-owned sandbox gate: phase 1 readiness live, phase 3/4 live, phase 9 mobile-access/session-continuity live, phase 10 live, and gateway live task/session specs.

Phase 7/8 production-domain fixtures now use intercepted `http://127.0.0.1:4198` while local agent traffic remains intercepted on `:4098`; `bypassCSP` is test-only. Other local/sandbox live suites receive the new explicit production field without changing their established backend.

## Production write safety

Routing now sends authenticated user actions for tasks, planner/task collaboration, rhythms, projects, messages, facilities, automations, integrations, live artifacts, user preferences, and notifications to the configured production API. No automatic test or smoke command targets `api.vcrcapps.com`: fixture suites use loopback mocks, the contract stubs `fetch`, and the real-account smoke was not attempted. Existing bearer authorization and existing explicit UI mutation boundaries are unchanged. Local agent mutations remain on `:4098`.

## Manual smoke for AJ

1. Ensure no `RHYTHM_PRODUCTION_API_URL` override is set, or set/save the intended Server URL; launch the Electron app normally (not `--smoke`).
2. Sign in with Google using the real account.
3. Open Tasks, Rhythms, Projects, Messages, and Facilities; confirm known real-account records appear and are not empty fixture/local SQLite data.
4. Open Agents; confirm profiles/sessions load from the Electron-owned local agent server, create a disposable session, send one harmless prompt, and confirm memory/MCP/skills/schedules still load.
5. Change the production Server URL, restart Electron, and confirm the saved value persists while Agents still use local `4098`/`4097`.
6. Avoid destructive production mutations; if a write check is needed, create a clearly named disposable task, verify it, then delete only that task.

## Notes

- No sandbox was started and ports `4001`/`4096` were never touched.
- Sandbox-dependent live Playwright suites and real-account manual smoke remain pending.
