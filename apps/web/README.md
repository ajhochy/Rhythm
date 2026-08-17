# Rhythm Desktop · web prototype (all destinations)

A React 18 + TypeScript + Vite prototype of the complete Rhythm Desktop workspace: Dashboard,
Planner, Tasks, Rhythms, Projects, Messages, Facilities, Automations, Integrations, and the
original Agents workspace. Shipping Flutter determines behavior, labels, workflow, and route
contracts; `../rhythm-dashboard-redesign.html` determines the mineral visual language (dark
default, light theme supported). Every page uses typed deterministic fixtures and never calls
the live Rhythm backend.

## Run locally

```bash
npm install --include=dev
npm run dev
```

Open `http://127.0.0.1:4173/#/agents` (or any destination: `#/dashboard`, `#/planner`,
`#/tasks`, `#/rhythms`, `#/projects`, `#/messages`, `#/facilities`, `#/automations`,
`#/integrations`).

```bash
npm run build
npx playwright test --list
npm run test:external:chrome
```

The suite fixes the clock at August 12, 2026 in `America/Los_Angeles`, uses one worker, honors
reduced motion, blocks non-local network traffic, and uses stable test IDs.

## Verification status (2026-08-13 overnight completion run)

- `npm run build` — **passed** (tsc project references + Vite production bundle).
- Full installed-Chrome Playwright — **230/230 passed** in one run: the preserved 58-test
  Agents baseline plus nine page contracts (`tests/contract/issue-2001…2009-*.spec.ts`, one
  test per acceptance criterion) and nine page click-through suites (`tests/pages/*.spec.ts`)
  with responsive (1440/1024/768/390), 200% text, RTL, CJK/emoji, forced-colors,
  reduced-motion, 44px-target, and zero serious/critical axe coverage per page.
- Production-dist smoke — **passed**.
- Electron audit — **no dependency, file, or bundle** (web-only).
- Canonical acceptance contracts with per-criterion status live in `docs/ai/contracts/`
  (issues 2001–2009, all `pass`); behavior inventories with Flutter citations in
  `docs/ai/inventories/`. The paused live-mode work is quarantined under
  `docs/ai/paused-live-mode/` and only runs with `RHYTHM_LIVE_E2E=1`.
- Screenshot sweep artifacts: `test-results/sweep/` (`RHYTHM_SWEEP=1 npx playwright test
  tests/screenshot-sweep.spec.ts --config tests/external-host-playwright.config.ts`).

## Destination pages (issues 2001–2009)

Each page follows the same conventions: `src/pages/<slug>/` module owning its fixtures and
scoped styles; deterministic `?state=` matrix (ready/loading/empty/server-error/forbidden/
unavailable/readonly) persisted in the URL; a visible `page-trace` endpoint-receipt ledger with
exact `METHOD /route {payload} → status` entries; disabled controls exposing their prerequisite
accessibly; deep links parsed from the hash route. The global Endpoint Map (account menu →
Prototype diagnostics) covers all 208 control-to-endpoint contracts. Unknown routes render a
recoverable not-found state. The Messages page drives the live shell unread badge (seeded at 6).

## Reference-fidelity checklist

- [x] Exact Flutter global navigation order, Messages unread badge, responsive More overflow, background activity, notifications, and account/settings; theme, demo states, reset, and Endpoint Map are isolated under **Prototype diagnostics** in the account menu.
- [x] Dashboard-reference mineral canvas, 12px desktop inset, compact 48px header, text-tab underline, one 24px workspace surface, hairline dividers, restrained turquoise accent, Inter UI, and SF Mono operational data.
- [x] Three-pane Agents workspace with collapsible/resizable Agents, transcript/composer, and Inspector rails; responsive 1440/1280/1024 behavior.
- [x] Chats/Scheduled/Background scopes, toggle-to-search with Escape restoration, project/sort controls, AGENTS/SUB AGENTS disclosures, lifecycle groups, overflow lifecycle actions, multi-select bulk actions, and the complete Flutter tools catalog.
- [x] Shipping-shaped session header, deterministic transcript parts, permission/question decisions, offline queue/reconnect, child-agent read-only transcript, message history actions, and demo system states.
- [x] Context plus Flutter-shaped Inspector workflows: scoped expandable Changes with patch export and guarded revert/worktree actions; persistent PTY connected/exited/error recovery; hierarchical Files with text/image/binary/2 MB preview guards; artifact selector/history retry/secure preview/Dashboard handoff; and display-only todos.
- [x] Flutter-shaped advanced session dialog: required name, non-done task, editable cwd/Browse…, optional isolated worktree/name, Git branches/new branch, dirty-tree Stash confirmation, conditional Anthropic account, Start validation/submission, and friendly 4xx/expandable 5xx fixture errors. Agent/model/permissions/reasoning remain in the composer.
- [x] Exact composer permission modes (Default, Accept Edits, Plan, Bypass confirmation), per-turn/session-default model choice, reasoning levels, agent/Fast controls, commands, mentions, shell escape, attachments, and explicit local-only offline buffering.
- [x] Safe theme storage catches sandbox `SecurityError`; Vite uses `base: "./"`; navigation is hash/file safe; no live backend or server-only browser assumptions.
- [x] Singular question routes, exact file routes, VCS/raw diff, PTY, model, budget, OpenCode, agent-config, and WebSocket contracts audited against Flutter data sources.
- [x] Brain memory search/expand/edit/delete; Research project/run/retry/export/discussion; Agent Schedules create/edit/toggle/delete/trigger/history; and Webhook create/copy/revoke workflows use deterministic fixture state and exact Flutter routes, including `/agent-webhooks/:id/receive` URLs.
- [x] Skills and Playbooks managed authoring, Cookbook create/delete/run, Review Queue approval gate, Report Card rollup/detail, Gmail signal detail/assistant launch, and Creative Media grid/detail/session launch replace the former static Tool summaries.
- [x] At 1280px the reasoning and Prepare controls remain directly reachable; at narrower desktop widths Session actions preserves access. Completed/unresumable sessions disable every composer control and show the inline reason.
- [x] All 12 Tool routes expose ready, loading, first-use/empty, retryable 503, forbidden 403, unavailable, and read-only fixtures with native action gating, recovery, per-endpoint receipts, and blocking axe checks.
- [x] Parent → child → grandchild transcripts, keyboard-resizable panes with live ARIA values, attachment truncation/file-reference/path-traversal/missing-file recovery, keyboard menus, 44px coarse-pointer targets, 200% text, RTL, forced colors, and strict offline CSP are covered.

## Product structure

- `src/fixtures.ts` — stable sessions, messages, diff, files, artifacts, todos, profiles, costs, token counts, and fixed dates.
- `src/store.tsx` — typed fixture state machine, safe storage adapter, offline queue, and observable mutations.
- `src/endpointMap.ts` — exact control-to-Flutter-contract traceability.
- `src/components/` — semantic shell, rail, transcript, composer, inspector, profiles, tools, dialogs, and Endpoint Map.
- `src/components/ToolWorkspace.tsx` — Flutter-shaped deterministic workflows for every non-Profile Agents Tool, plus an observable exact-method/route fixture ledger.
- `tests/` — 58 web-only browser checks for shell, lifecycle, transcript, profiles, inspector, accessibility, sandbox, endpoint contracts, no-dead-control, every Tool state/action, responsive layouts, and the complete operator flow.

## Deterministic demo states

Use **Demo states** or `#/agents?demo=<state>`.

| State | Query | Seeded behavior |
| --- | --- | --- |
| Working | `running` | Sunday service handoff parent plus working child |
| Permission | `permission` | Allow once, Always allow, or Deny with reason |
| Question | `question` | Choice/custom answer or reject |
| Offline | `offline` | Explicit local queue, reconnect, and flush |
| Completed | `completed` | Completed transcript and HTML artifact |
| Connecting | `connecting` | Direct desktop connection in progress |
| Retrying | `retrying` | Failed connection retry with transcript retained |
| Resumable | `resumable` | Runtime unavailable; transcript readable and resumable |
| Empty | `empty` | Honest empty state and starters |
| Loading | `loading` | Semantic `aria-busy` state |
| Error | `error` | Service-unavailable recovery |
| Choose a model | `no-provider` | Agent-less provider/model recovery |

**Reset fixtures** restores every stable ID, timestamp, branch, cost, token count, file, artifact, todo, and outcome.

Shipping session statuses are `starting`, `working`, `idle`, `resumable`, `closed`, and `error`. “Waiting on you,” offline/reconnecting, scheduled or locally queued input, completed, archived, and unavailable/stuck are derived presentation conditions or separate fixture fields, not persisted backend status values.

## Endpoint-to-control matrix

| Control | Method/channel | Exact route/event | Flutter source function | Fixture handler | Playwright test |
| --- | --- | --- | --- | --- | --- |
| Session rail / Refresh | GET | `/agent-sessions` | `agents_data_source.dart:listSessions` | `listSessions` | `sessions:scopes-search-sort` |
| Select session | GET | `/agent-sessions/:id` | `agents_data_source.dart:getSession` | `getSession` | `sessions:select-loads` |
| New session | POST | `/agent-sessions` | `agents_data_source.dart:createSession` | `createSession` | `sessions:create-instant-advanced` |
| Session settings | PATCH | `/agent-sessions/:id` | `agents_data_source.dart:updateSession` | `updateSession` | `workbench:session-settings` |
| Close session | DELETE | `/agent-sessions/:id` | `agents_data_source.dart:closeSession` | `closeSession` | `sessions:lifecycle` |
| Archive session | PATCH | `/agent-sessions/:id` | `agents_data_source.dart:archiveSession` | `archiveSession` | `sessions:lifecycle` |
| Unarchive session | PATCH | `/agent-sessions/:id` | `agents_data_source.dart:unarchiveSession` | `unarchiveSession` | `sessions:lifecycle` |
| Delete permanently | DELETE | `/agent-sessions/:id/hard` | `agents_data_source.dart:deleteSession` | `hardDeleteSession` | `sessions:lifecycle` |
| Stop / Bulk cancel | POST | `/agent-sessions/:id/cancel` | `agents_data_source.dart:cancelSession` | `cancelSession` | `sessions:lifecycle` |
| Resume session | POST | `/agent-sessions/:id/resume` | `agents_data_source.dart:resumeSession` | `resumeSession` | `sessions:lifecycle` |
| Fork from message | POST | `/agent-sessions/:id/fork` | `agents_data_source.dart:forkSession` | `forkSession` | `transcript:history-actions` |
| Revert message | POST | `/agent-sessions/:id/revert` | `agents_data_source.dart:revertSession` | `revertSession` | `transcript:history-actions` |
| Restore history | POST | `/agent-sessions/:id/unrevert` | `agents_data_source.dart:unrevertSession` | `unrevertSession` | `transcript:history-actions` |
| Compact session | POST | `/agent-sessions/:id/summarize` | `agents_data_source.dart:summarizeSession` | `summarizeSession` | `transcript:history-actions` |
| Prepare project | POST | `/agent-sessions/:id/init` | `agents_data_source.dart:initProject` | `initializeProject` | `workbench:prepare-project` |
| Transcript / Load older | GET | `/agent-sessions/:id/messages` | `agents_data_source.dart:fetchTranscriptPage` | `listMessages` | `transcript:load-older` |
| Display-only todo panel | GET | `/agent-sessions/:id/todo` | `agents_data_source.dart:fetchSessionTodos` | `listTodos` | `inspector:todos` |
| Transcript diff | GET | `/agent-sessions/:id/diff` | `agents_data_source.dart:fetchSessionDiff` | `getDiff` | `inspector:changes` |
| Child transcript | GET | `/agent-sessions/:parentId/children/:childSdkId/messages` | `agents_data_source.dart:fetchChildMessages` | `getChildMessages` | `transcript:child-agent` |
| Memory provenance | GET | `/agent-sessions/:id/memory-provenance` | `agents_data_source.dart:fetchMemoryProvenance` | `getMemoryProvenance` | `inspector:context` |
| Permission card | GET | `/agent-sessions/:id/pending-permissions` | `agents_data_source.dart:fetchPendingPermissions` | `listPendingPermissions` | `permission:all-replies` |
| Permission reply | POST | `/agent-sessions/:id/permissions/:permissionId/reply` | `agents_data_source.dart:respondPermission` | `replyPermission` | `permission:all-replies` |
| Answer question | POST | `/agent-sessions/:id/question/:callId/reply` | `agents_data_source.dart:replyQuestion` | `replyQuestion` | `question:answer` |
| Reject question | POST | `/agent-sessions/:id/question/:callId/reject` | `agents_data_source.dart:rejectQuestion` | `rejectQuestion` | `question:reject` |
| Agent selector | GET | `/agent-sessions/agents?cwd=…` | `agents_data_source.dart:fetchAvailableAgents` | `listAgents` | `composer:selectors` |
| VCS metadata | GET | `/agent-sessions/:id/vcs` | `agents_data_source.dart:getVcs` | `getVcs` | `inspector:context` |
| VCS status | GET | `/agent-sessions/:id/vcs/status` | `agents_data_source.dart:getVcsStatus` | `getVcsStatus` | `inspector:files` |
| Changes scopes | GET | `/agent-sessions/:id/vcs/diff?mode=git\|branch` | `agents_data_source.dart:getVcsDiff` | `getVcsDiff` | `inspector:changes` |
| Export patch | GET | `/agent-sessions/:id/vcs/diff/raw` | `agents_data_source.dart:getVcsDiffRaw` | `getRawVcsDiff` | `inspector:raw-patch` |
| Find filenames | GET | `/agent-sessions/:id/files/find-files` | `agents_data_source.dart:findFiles` | `findFiles` | `inspector:files` |
| Browse directory | GET | `/agent-sessions/:id/files/list` | `agents_data_source.dart:listSessionFiles` | `listFiles` | `inspector:files` |
| Open file | GET | `/agent-sessions/:id/files/content` | `agents_data_source.dart:fileContent` | `getFileContent` | `inspector:files` |
| File status | GET | `/agent-sessions/:id/files/status` | `agents_data_source.dart:filesGitStatus` | `getFileStatus` | `inspector:files` |
| Composer shell shortcut | POST | `/agent-sessions/:id/shell` | `agents_data_source.dart:shellCommand` | `runShell` | `composer:shell` |
| Open terminal PTY | POST | `/agent-sessions/:id/pty` | `agents_data_source.dart:createPty` | `createPty` | `inspector:terminal` |
| Resize terminal PTY | PATCH | `/pty/:id` | `agents_data_source.dart:resizePty` | `resizePty` | `inspector:terminal` |
| Close terminal PTY | DELETE | `/pty/:id` | `agents_data_source.dart:killPty` | `killPty` | `inspector:terminal` |
| Terminal stream | WS | `/ws/pty/:id` | `agents_data_source.dart:ptyWsUrl` | `streamPty` | `inspector:terminal` |
| Reset worktree | POST | `/agent-sessions/:id/worktree/reset` | `agents_data_source.dart:resetWorktree` | `resetWorktree` | `inspector:worktree-actions` |
| Remove worktree | POST | `/agent-sessions/:id/worktree/remove` | `agents_data_source.dart:removeWorktree` | `removeWorktree` | `inspector:worktree-actions` |
| Current model route | GET | `/agents/models` | `agent_models_data_source.dart:fetchRoutes` | `listModelRoutes` | `composer:selectors` |
| Model catalog | GET | `/agents/models/catalog` | `agent_models_data_source.dart:fetchCatalog` | `listModelCatalog` | `composer:selectors` |
| Usage budget | GET | `/agents/usage-budget` | `usage_budget_data_source.dart:fetch` | `getUsageBudget` | `inspector:context` |
| Slash commands | GET | `/opencode/commands` | `commands_data_source.dart:list` | `listCommands` | `composer:slash` |
| Profile MCP scope | GET | `/opencode/mcp` | `opencode_mcp_data_source.dart:listCapabilities` | `listMcps` | `profiles:capabilities` |
| Profile skill scope | GET | `/opencode/skills` | `opencode_skills_data_source.dart:list` | `listSkills` | `profiles:capabilities` |
| Brain memory list/search | GET | `/agent-memory`, `/agent-memory/search?q=…` | `agent_memory_data_source.dart:list/search` | `listMemories/searchMemories` | `tools:brain-crud` |
| Brain memory edit/delete | PATCH/DELETE | `/agent-memory/:id` | `agent_memory_data_source.dart:update/delete` | `updateMemory/deleteMemory` | `tools:brain-crud` |
| Research projects | GET/POST/PATCH | `/agent-research/projects`, `/agent-research/projects/:id` | `agent_research_data_source.dart:listProjects/createProject/updateProject` | `list/create/updateResearchProject` | `tools:research-project-runs` |
| Research run / retry / archive | POST | `/agent-research/projects/:projectId/runs`, `/agent-research/:id/retry`, `/agent-research/projects/:id/archive` | `agent_research_data_source.dart:startProjectRun/retry/archiveProject` | `startRun/retryResearch/archiveProject` | `tools:research-project-runs` |
| Research magazine/export/discussion | GET/POST | `/agent-research/projects/:projectId/runs/:runId/magazine`, `/export?format=…`, `/discussions` | `agent_research_data_source.dart:magazineUri/exportUri/startDiscussion` | `open/export/startResearchDiscussion` | `tools:research-project-runs` |
| Agent Schedules CRUD | GET/POST/PATCH/DELETE | `/agent-schedules`, `/agent-schedules/:id` | `agent_schedules_data_source.dart:list/create/update/delete` | `list/create/update/deleteSchedule` | `tools:schedules-crud-trigger` |
| Trigger schedule / run history | POST/GET | `/agent-schedules/:id/trigger-now`, `/agent-sessions?scheduledTaskId=:id` | `agent_schedules_data_source.dart:triggerNow/listRuns` | `triggerScheduleNow/listScheduleRuns` | `tools:schedules-crud-trigger` |
| Webhooks list/create/delete | GET/POST/DELETE | `/agent-webhooks`, `/agent-webhooks/:id` | `agent_webhooks_data_source.dart:list/create/delete` | `list/create/deleteWebhook` | `tools:webhooks-create-delete` |
| Webhook receive URL | POST | `/agent-webhooks/:id/receive` | `agent_webhooks_view.dart:_copyWebhookUrl` | `receiveWebhook` | `tools:webhooks-create-delete` |
| Managed Skills CRUD / refresh | GET/POST/PUT/DELETE | `/opencode/skills?withMetadata=true`, `/opencode/skills/:name`, `/system/refresh` | `opencode_skills_data_source.dart:listWithMetadata/create/update/delete/reload` | `list/create/update/delete/reloadSkills` | `tools:managed-skills-playbooks` |
| Managed Playbooks CRUD | GET/POST/PUT/DELETE | `/opencode/commands`, `/opencode/commands/:name` | `agent_playbooks_data_source.dart:list/create/update/delete` | `list/create/update/deletePlaybook` | `tools:managed-skills-playbooks` |
| Cookbook create/delete/run | GET/POST/DELETE | `/agent-cookbook`, `/agent-cookbook/:id`, `/agent-cookbook/:id/run` | `agent_cookbook_data_source.dart:list/create/delete/runRecipe` | `list/create/delete/runRecipe` | `tools:cookbook-crud-run` |
| Review Queue / human decisions | GET/POST | `/agent-org-proposals?status=…`, `/agent-org-proposals/:id/approve`, `/reject` | `org_proposals_data_source.dart:listProposed/approve/reject` | `list/approve/rejectOrgProposal` | `tools:review-human-gate` |
| Report Card | GET | `/agents/run-quality?windowDays=…` | `run_quality_data_source.dart:getRollup` | `getRunQualityRollup` | `tools:report-card` |
| Gmail signals | GET | `/integrations/gmail-signals` | `agent_email_data_source.dart:listSignals` | `listGmailSignals` | `tools:email-launch` |
| Creative Media gallery/artifact | GET | `/agent-designs`, `/agent-designs/:id/artifact` | `agent_gallery_data_source.dart:list`, `agent_gallery_view.dart:_openArtifact` | `listAgentDesigns/openAgentDesignArtifact` | `tools:gallery-launch` |
| Profiles list | GET | `/agent-configs` | `agent_configs_data_source.dart:list` | `listProfiles` | `profiles:crud` |
| Create profile | POST | `/agent-configs` | `agent_configs_data_source.dart:create` | `createProfile` | `profiles:crud` |
| Save / Rename profile | PATCH | `/agent-configs/:id` | `agent_configs_data_source.dart:update` | `updateProfile` | `profiles:crud` |
| Delete profile | DELETE | `/agent-configs/:id` | `agent_configs_data_source.dart:delete` | `deleteProfile` | `profiles:crud` |
| Open selected session artifact | GET | `/live-artifacts/:id` | `_artifacts_tab.dart:_loadSelected` | `getLiveArtifact` | `inspector:artifacts` |
| Agent event stream | WS | `/ws/agents` | `app_constants.dart:agentLocalWsUrl` | `observeAgentEvents` | `composer:offline-queue` |
| Select / reconnect session | WS event | `session.subscribe` | `agents_controller.dart:reconnectSession` | `subscribeSession` | `sessions:select-loads` |
| Composer Send | WS event | `session.input` | `agents_controller.dart:sendInput` | `sendSessionInput` | `composer:offline-queue` |
| Slash command dispatch | WS event | `session.command` | `agents_controller.dart:sendCommand` | `sendSessionCommand` | `composer:slash` |
| Session terminal resize | WS event | `session.resize` | `agents_controller.dart:resize` | `resizeSession` | `inspector:terminal` |

### Payload examples

- Create session: `{ cwd, name, taskId?, branch?, stash?, createBranch?, anthropicAccountId?, isolateWorktree?, worktreeName?, profileId? | agentId?, projectId?, mcpRole? }`
- Update session: `{ name?, profileId?, agentId?, providerId?, modelId?, permissionMode?, thinkingBudget?, fastMode?, anthropicAccountId? }`
- Archive/restore: PATCH `/agent-sessions/:id` with `{ archived: true }` or `{ archived: false }`; DELETE closes a session, and DELETE `/hard` permanently removes it.
- Permission reply: `{ reply: "once" | "always" | "reject", message? }`
- Question reply: `{ answers: string[][] }`
- Session subscribe: `{ id }`.
- Session input: `{ id, data }` or `{ id, parts }`, with optional `modelOverride` and optional `agent`.
- Session command: `{ id, command, arguments }`.
- Session resize: `{ id, cols, rows }`.
- When offline, input remains explicit local UI state and no WebSocket frame is sent until reconnect. The prototype never adds queue metadata to the wire payload or implies a server-side deferred-write queue.

## Web-only delivery

- Vite uses `base: "./"`, so production assets resolve from `file://`.
- Navigation is hash-based and needs no server fallback.
- Runtime state uses browser-safe APIs only; every localStorage access is caught for sandboxed Studio previews.
- Electron packaging is intentionally deferred until this web version is accepted and a current, dependency-audited, Developer ID-signed, notarized, and Gatekeeper-verified pipeline is available.
