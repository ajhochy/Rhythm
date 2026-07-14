# Current Plan — Opencode Utilization Epic

**Source:** `docs/ai/runs/2026-07-11-opencode-feature-audit.md` (full engine-vs-Rhythm gap audit, 2026-07-11).
**Goal:** Fully utilize the opencode engine capabilities Rhythm already ships but doesn't consume.
**Non-goals:** v2 `/api` namespace, workspaces/control-plane/sync, external session share (watch list — tracking issue only). No engine-fork feature work except SDK/spec regeneration.
**Constraints:** Never merge PRs automatically; each issue is one PR-able unit; Postgres/SQLite schema drift rule applies to any migration; fork changes require fork rebuild + re-sign (see memory gotchas).

## Milestones

| # | Milestone | Theme | Issues |
|---|---|---|---|
| M1 | Opencode Utilization 1: Interaction Polish | Permission always-allow, rehydration, queuing, free-text questions, hygiene, websearch | OCU-01..08 (#1042–#1049) |
| M2 | Opencode Utilization 2: Playbooks | Custom slash commands as saved prompts | OCU-09..11 (#1050–#1052) |
| M3 | Opencode Utilization 3: Org Skill Library | Remote skill index via `skills.urls` | OCU-12..15 (#1053–#1056) |
| M4 | Opencode Utilization 4: Worktree Isolation | Isolated git worktrees per session | OCU-16..18 (#1057–#1059) |
| M5 | Opencode Utilization 5: Files & VCS Context | file/find/vcs APIs, session.shell, session.init | OCU-19..25 (#1060–#1066) |
| M6 | Opencode Utilization 6: Platform & SDK | SDK regen, telemetry plugin, global SSE, config adoption, permission matrix | OCU-26..33 (#1067–#1074) |
| M7 | Opencode Utilization 7: Hygiene & Watch List | Dead code, watch-list tracking | OCU-34..35 (#1075–#1076) |

## Issue table

| ID | App | Title | Depends on |
|---|---|---|---|
| OCU-01 (#1042) | api_server | Migrate permission replies to `POST /permission/:requestID/reply` (once/always/reject + message) | — |
| OCU-02 (#1043) | flutter | PermissionCard: "Always allow" button + deny-with-reason field | OCU-01 (#1042) |
| OCU-03 (#1044) | api_server | Rehydrate pending permissions/questions on engine (re)connect via `GET /permission` + `GET /question` | OCU-01 (#1042) |
| OCU-04 (#1045) | api_server | Session status resync via `GET /session/status` on engine ready/reconnect | — |
| OCU-05 (#1046) | flutter | Message queuing: allow send while agent busy, show "queued" chip | — |
| OCU-06 (#1047) | flutter | QuestionToolCard: free-text (`custom`) + multi-select (`multiple`) support | — |
| OCU-07 (#1048) | api_server | Call engine `session.delete` on hard delete (stop storage leak) | — |
| OCU-08 (#1049) | api_server | Enable engine `websearch` tool (provider env + key plumbing) | — |
| OCU-09 (#1050) | api_server | Commands CRUD routes writing `commands/*.md` + config reload | — |
| OCU-10 (#1051) | flutter | Playbooks manager UI (list/create/edit/delete custom commands) | OCU-09 (#1050) |
| OCU-11 (#1052) | flutter | Slash popover: argument hints + custom-command dispatch verification | OCU-09 (#1050) |
| OCU-12 (#1053) | api_server (prod) | Org skill index endpoint (`index.json` + skill file serving) | — |
| OCU-13 (#1054) | api_server | Wire engine `skills.urls` to org index in managed opencode.json | OCU-12 (#1053) |
| OCU-14 (#1055) | flutter | Skills UI: source badges (local vs org-remote), read-only remote handling | OCU-13 (#1054) |
| OCU-15 (#1056) | api_server | Publish pipeline: promote approved skill → org library | OCU-12 (#1053) |
| OCU-16 (#1057) | api_server | Worktree API wrappers + routes + ready/failed event relay | — |
| OCU-17 (#1058) | api_server | Session create with `isolateWorktree` option (worktree as session cwd) | OCU-16 (#1057) |
| OCU-18 (#1059) | flutter | Worktree UI: create-session toggle, session badge, Changes-tab actions | OCU-17 (#1058) |
| OCU-19 (#1060) | api_server | Proxy find/file endpoints (find text/files, file list/content/status) | — |
| OCU-20 (#1061) | flutter | Composer @-mention file attach (typeahead via find/file) | OCU-19 (#1060) |
| OCU-21 (#1062) | flutter | Inspector "Files" tab (browse + preview) | OCU-19 (#1060) |
| OCU-22 (#1063) | both | Branch badge + working-tree status (`/vcs`, `vcs.branch.updated`) | — |
| OCU-23 (#1064) | both | Changes tab: branch-diff mode + raw patch export | — |
| OCU-24 (#1065) | both | `session.shell` quick-run command (recorded in transcript) | — |
| OCU-25 (#1066) | both | `session.init` "Prepare project for agents" action | — |
| OCU-26 (#1067) | opencode_fork | Regenerate openapi.json + SDK (incl. `/skill/reload`, `/config/reload`, allowlist PATCH body) | — |
| OCU-27 (#1068) | api_server | Adopt regenerated SDK types; delete hand-written d.ts drift; remove fetch shims + `as any` pty | OCU-26 (#1067) |
| OCU-28 (#1069) | api_server | Rhythm telemetry plugin (`tool.execute.before/after` → run-quality ingestion) | — |
| OCU-29 (#1070) | api_server | Consolidate SSE onto `/global/event` + heartbeat watchdog | — |
| OCU-30 (#1071) | api_server | Managed config adoption: `small_model`, `username`, `reference`, compaction/tool_output defaults | — |
| OCU-31 (#1072) | api_server | Org instructions file (`instructions` key synced from prod) | — |
| OCU-32 (#1073) | api_server | Agent writer: full permission-key support (arbitrary keys + wildcards) round-trip | — |
| OCU-33 (#1074) | flutter | Profile sheet: per-agent native-tool permission matrix | OCU-32 (#1073) |
| OCU-34 (#1075) | both | Dead-code cleanup: `listProviders`, `fetchChildSessions`, `dispatchCommand`, `SessionModelPicker` | — |
| OCU-35 (#1076) | tracking | Watch list: v2 API / workspaces / share — adoption criteria, revisit at fork rebases | — |

## Validation strategy

- Every api_server issue: unit/contract tests in `src/__tests__` (SQLite), `npm test` green, plus live-behavior verification against the running engine where the change is engine-facing (allowlist/permission/skills lessons: unit-green ≠ live-green — verify against the BUILT fork binary).
- Every flutter issue: `flutter analyze --no-fatal-infos` + widget test pumping the real mounted surface (agents-inspector orphan lesson), `dart format .`.
- OCU-26/27: full api_server suite + tsc; diff generated types against runtime binary behavior.
- Milestone-level manual smoke checklist item added per UI-visible change.
