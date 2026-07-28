---
date: 2026-07-23
repo: Rhythm
status: research
tags: [contract, rhythm, opencode, mobile, gitnexus]
---

# Rhythm Mobile ↔ Bundled OpenCode API map

## Scope and sources

This maps the HTTP API published by Rhythm's bundled OpenCode fork to the
forked mobile client at `/Users/aj/Documents/opencode-mobile`.

- Host source of truth: `apps/opencode_fork/packages/sdk/openapi.json`
- Bundled engine version: `apps/opencode_fork/packages/opencode/package.json`
  (`1.14.49`)
- Mobile SDK entry point: `lib/opencode/client.ts`
- Mobile adapters: `providers/services/*.ts`
- Mobile public surface: `providers/opencode-provider-types.ts`
- Mobile screens: `app/(tabs)/*.tsx` and `components/**/*.tsx`
- GitNexus indexes: `Rhythm` and `opencode-mobile`, both built with PDG data
- GitNexus group: `rhythm-mobile` (`host=Rhythm`, `client=opencode-mobile`)

The OpenAPI document contains **133 operations across 115 paths**. Static
mobile analysis found **70 operations called through `@opencode-ai/sdk`**.
Ten of those calls exist only inside service adapters that are not imported by
`OpencodeProvider`, leaving **60 user-facing operations**, **10 adapter-only
operations**, and **63 operations with no mobile call**.

## Status legend

- **UI** — called by `OpencodeProvider` and exposed through a current screen or
  user-facing context action.
- **Adapter** — an SDK wrapper exists, but `OpencodeProvider` does not import it
  and no screen can invoke it.
- **Missing** — no matching SDK call exists in the mobile source.
- **Internal** — transport endpoint used indirectly rather than as a discrete
  screen action.

## Current mobile surfaces

| Surface | Current capabilities |
| --- | --- |
| Chat | Sessions, prompt streaming, abort, commands, transcript, diff, todos, permissions, questions, fork/revert, title generation |
| Workspace | Projects, session archive/restore/delete/rename, filename search, file read/edit, file status, VCS branch, worktrees |
| Terminal | Shell discovery, PTY list/create/connect/input/terminate |
| Settings | Connection, provider credentials and OAuth, models/agents/defaults, MCP configuration and OAuth, diagnostics |
| Background | Global SSE, polling fallback, completion notifications, conversation/voice mode |

## Complete endpoint matrix

### Global, configuration, control, and event endpoints

| Method | Path | Operation | Purpose | Mobile equivalent | Status |
| --- | --- | --- | --- | --- | --- |
| PUT | `/auth/{providerID}` | `auth.set` | Store provider credentials | Settings → provider setup | UI |
| DELETE | `/auth/{providerID}` | `auth.remove` | Remove provider credentials | Settings → remove provider | UI |
| POST | `/log` | `app.log` | Write an engine log entry | None | Missing |
| GET | `/global/health` | `global.health` | Report health and engine version | Settings → diagnostics | UI |
| GET | `/global/event` | `global.event` | Subscribe to cross-project SSE events | Background event stream | UI/Internal |
| GET | `/global/config` | `global.config.get` | Read global configuration | None | Missing |
| PATCH | `/global/config` | `global.config.update` | Update global configuration | None | Missing |
| POST | `/global/dispose` | `global.dispose` | Dispose all active instances | None | Missing |
| POST | `/global/upgrade` | `global.upgrade` | Upgrade OpenCode | None; Rhythm owns bundled-engine upgrades | Missing by design |
| GET | `/event` | `event.subscribe` | Subscribe to current-instance events | Uses global event stream instead | Missing/alternate |
| GET | `/config` | `config.get` | Read current project configuration | Settings/provider capability discovery | UI |
| PATCH | `/config` | `config.update` | Update current project configuration | Auto-approve, providers, MCP enablement | UI |
| GET | `/config/providers` | `config.providers` | List configured providers/default models | Uses `/provider` plus `/provider/auth` | Missing/alternate |
| POST | `/config/reload` | `app.config.reload` | Reload project configuration | None | Missing |
| POST | `/instance/dispose` | `instance.dispose` | Dispose the current project instance | None | Missing |

### Project, path, VCS, file, agent, command, skill, and diagnostics endpoints

| Method | Path | Operation | Purpose | Mobile equivalent | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/path` | `path.get` | Return home/root/current directories | Workspace catalog | UI |
| GET | `/project` | `project.list` | List known projects | Workspace project selector | UI |
| GET | `/project/current` | `project.current` | Return current project | Workspace active project | UI |
| PATCH | `/project/{projectID}` | `project.update` | Update project metadata | None | Missing |
| POST | `/project/git/init` | `project.initGit` | Initialize a Git repository | None | Missing |
| GET | `/vcs` | `vcs.get` | Return VCS and branch information | Workspace branch label | UI |
| GET | `/vcs/status` | `vcs.status` | Return structured working-tree status | Wrapper exists, not imported | Adapter |
| GET | `/vcs/diff` | `vcs.diff` | Return structured repository diff | Wrapper exists, not imported | Adapter |
| GET | `/vcs/diff/raw` | `vcs.diff.raw` | Return raw repository diff | Wrapper exists, not imported | Adapter |
| POST | `/vcs/apply` | `vcs.apply` | Apply a validated patch | Workspace file save | UI |
| GET | `/find` | `find.text` | Search text in project files | Wrapper exists, not imported | Adapter |
| GET | `/find/file` | `find.files` | Search filenames/directories | Workspace file search | UI |
| GET | `/find/symbol` | `find.symbols` | Search workspace symbols | Wrapper exists, not imported | Adapter |
| GET | `/file` | `file.list` | List a directory | Wrapper exists, not imported | Adapter |
| GET | `/file/content` | `file.read` | Read file content | Workspace file viewer/editor | UI |
| GET | `/file/status` | `file.status` | List changed files | Workspace changed-file count | UI |
| GET | `/command` | `command.list` | List slash commands | Chat command picker/execution | UI |
| GET | `/agent` | `app.agents` | List configured agents | Chat agent selector | UI |
| GET | `/skill` | `app.skills` | List available skills | None | Missing |
| POST | `/skill/reload` | `app.skills.reload` | Reload skills from disk | None | Missing |
| GET | `/lsp` | `lsp.status` | Report language-server status | Settings → diagnostics | UI |
| GET | `/formatter` | `formatter.status` | Report formatter status | Settings → diagnostics | UI |

### Provider endpoints

| Method | Path | Operation | Purpose | Mobile equivalent | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/provider` | `provider.list` | List providers/models and connection state | Settings and model picker | UI |
| GET | `/provider/auth` | `provider.auth` | List provider authentication methods | Settings → provider setup | UI |
| POST | `/provider/{providerID}/oauth/authorize` | `provider.oauth.authorize` | Begin provider OAuth | Settings OAuth browser flow | UI |
| POST | `/provider/{providerID}/oauth/callback` | `provider.oauth.callback` | Complete provider OAuth | Settings OAuth completion | UI |

### Session and message endpoints

| Method | Path | Operation | Purpose | Mobile equivalent | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/session` | `session.list` | List sessions | Chat/workspace session list | UI |
| POST | `/session` | `session.create` | Create a session | New chat | UI |
| GET | `/session/status` | `session.status` | Return all session activity states | Busy/idle indicators and polling | UI |
| GET | `/session/{sessionID}` | `session.get` | Return one session | Mobile derives it from session list | Missing/alternate |
| PATCH | `/session/{sessionID}` | `session.update` | Update title/archive metadata | Rename/archive/restore | UI |
| DELETE | `/session/{sessionID}` | `session.delete` | Delete a session | Workspace delete | UI |
| GET | `/session/{sessionID}/children` | `session.children` | List child/subagent sessions | Wrapper exists, not imported | Adapter |
| GET | `/session/{sessionID}/todo` | `session.todo` | Return session todo items | Chat todo card | UI |
| GET | `/session/{sessionID}/diff` | `session.diff` | Return session/message file diffs | Chat diff card | UI |
| GET | `/session/{sessionID}/message` | `session.messages` | List session messages | Chat transcript | UI |
| POST | `/session/{sessionID}/message` | `session.prompt` | Send prompt and wait for response | Uses async prompt instead | Missing/alternate |
| GET | `/session/{sessionID}/message/{messageID}` | `session.message` | Return one message | Mobile refreshes full transcript | Missing/alternate |
| DELETE | `/session/{sessionID}/message/{messageID}` | `session.deleteMessage` | Delete a message | None | Missing |
| PATCH | `/session/{sessionID}/message/{messageID}/part/{partID}` | `part.update` | Update a message part | None | Missing |
| DELETE | `/session/{sessionID}/message/{messageID}/part/{partID}` | `part.delete` | Delete a message part | None | Missing |
| POST | `/session/{sessionID}/fork` | `session.fork` | Fork at an optional message | Chat/workspace fork | UI |
| POST | `/session/{sessionID}/abort` | `session.abort` | Abort active generation | Chat stop button | UI |
| POST | `/session/{sessionID}/init` | `session.init` | Analyze project and create `AGENTS.md` | None | Missing |
| POST | `/session/{sessionID}/share` | `session.share` | External transcript upload | Intentionally omitted for privacy; future sharing must stay inside Rhythm | Denied |
| DELETE | `/session/{sessionID}/share` | `session.unshare` | External transcript upload control | Intentionally omitted with the external share surface | Denied |
| POST | `/session/{sessionID}/summarize` | `session.summarize` | Generate session title/summary | Chat title generation | UI |
| POST | `/session/{sessionID}/prompt_async` | `session.prompt_async` | Submit prompt asynchronously | Primary chat send path | UI |
| POST | `/session/{sessionID}/command` | `session.command` | Execute slash command | Chat command execution | UI |
| POST | `/session/{sessionID}/shell` | `session.shell` | Run shell command as a session message | None; terminal is separate PTY | Missing |
| POST | `/session/{sessionID}/revert` | `session.revert` | Revert session to a message/part | Chat revert | UI |
| POST | `/session/{sessionID}/unrevert` | `session.unrevert` | Restore reverted content | Chat restore | UI |
| POST | `/session/{sessionID}/permissions/{permissionID}` | `permission.respond` | Legacy session permission reply | Uses global pending-permission API | Missing/alternate |

### Permission and question endpoints

| Method | Path | Operation | Purpose | Mobile equivalent | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/permission` | `permission.list` | List pending permissions | Chat permission cards | UI |
| POST | `/permission/{requestID}/reply` | `permission.reply` | Allow once/always or reject | Chat permission action | UI |
| GET | `/question` | `question.list` | List pending agent questions | Chat question cards | UI |
| POST | `/question/{requestID}/reply` | `question.reply` | Submit ordered answers | Chat answer action | UI |
| POST | `/question/{requestID}/reject` | `question.reject` | Reject a question request | Chat reject action | UI |

### MCP endpoints

| Method | Path | Operation | Purpose | Mobile equivalent | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/mcp` | `mcp.status` | Return MCP server status | Settings → MCP | UI |
| POST | `/mcp` | `mcp.add` | Add MCP server dynamically | Settings → add MCP | UI |
| POST | `/mcp/{name}/auth` | `mcp.auth.start` | Begin MCP OAuth | Settings → MCP OAuth | UI |
| DELETE | `/mcp/{name}/auth` | `mcp.auth.remove` | Remove MCP OAuth credentials | Wrapper exists, not imported | Adapter |
| POST | `/mcp/{name}/auth/callback` | `mcp.auth.callback` | Complete MCP OAuth with code | Settings → MCP OAuth | UI |
| POST | `/mcp/{name}/auth/authenticate` | `mcp.auth.authenticate` | Complete/authenticate MCP OAuth | None | Missing |
| POST | `/mcp/{name}/connect` | `mcp.connect` | Connect MCP server | Settings → connect | UI |
| POST | `/mcp/{name}/disconnect` | `mcp.disconnect` | Disconnect MCP server | Settings → disconnect | UI |

### PTY endpoints

| Method | Path | Operation | Purpose | Mobile equivalent | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/pty/shells` | `pty.shells` | List available shells | Terminal shell selection | UI |
| GET | `/pty` | `pty.list` | List PTY sessions | Terminal list | UI |
| POST | `/pty` | `pty.create` | Create PTY session | New terminal | UI |
| GET | `/pty/{ptyID}` | `pty.get` | Return one PTY | Wrapper exists, not imported | Adapter |
| PUT | `/pty/{ptyID}` | `pty.update` | Resize/update PTY metadata | Wrapper exists, not imported | Adapter |
| DELETE | `/pty/{ptyID}` | `pty.remove` | Terminate PTY | Terminal close | UI |
| POST | `/pty/{ptyID}/connect-token` | `pty.connectToken` | Create short-lived WebSocket ticket | Terminal connect flow | UI/Internal |
| GET | `/pty/{ptyID}/connect` | `pty.connect` | Upgrade to PTY WebSocket | Built manually as `ws:`/`wss:` URL | UI/Internal |

### Experimental console, tool, resource, worktree, and session endpoints

| Method | Path | Operation | Purpose | Mobile equivalent | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/experimental/console` | `experimental.console.get` | Return active Console provider metadata | None | Missing |
| GET | `/experimental/console/orgs` | `experimental.console.listOrgs` | List switchable Console organizations | None | Missing |
| POST | `/experimental/console/switch` | `experimental.console.switchOrg` | Switch Console organization | None | Missing |
| GET | `/experimental/tool` | `tool.list` | List tools and JSON schemas for a model | None | Missing |
| GET | `/experimental/tool/ids` | `tool.ids` | List tool IDs | None | Missing |
| GET | `/experimental/resource` | `experimental.resource.list` | List MCP resources | None | Missing |
| GET | `/experimental/worktree` | `worktree.list` | List worktrees | Workspace worktree panel | UI |
| POST | `/experimental/worktree` | `worktree.create` | Create worktree | Workspace create worktree | UI |
| DELETE | `/experimental/worktree` | `worktree.remove` | Remove worktree | Workspace remove worktree | UI |
| POST | `/experimental/worktree/reset` | `worktree.reset` | Reset worktree | Workspace reset worktree | UI |
| GET | `/experimental/session` | `experimental.session.list` | List cross-project/archived sessions | Workspace archived sessions | UI |

### Experimental workspace endpoints

| Method | Path | Operation | Purpose | Mobile equivalent | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/experimental/workspace/adapter` | `experimental.workspace.adapter.list` | List workspace adapters | None | Missing |
| GET | `/experimental/workspace` | `experimental.workspace.list` | List managed workspaces | None | Missing |
| POST | `/experimental/workspace` | `experimental.workspace.create` | Create managed workspace | None | Missing |
| POST | `/experimental/workspace/sync-list` | `experimental.workspace.syncList` | Synchronize workspace list | None | Missing |
| GET | `/experimental/workspace/status` | `experimental.workspace.status` | Return workspace state | None | Missing |
| DELETE | `/experimental/workspace/{id}` | `experimental.workspace.remove` | Remove managed workspace | None | Missing |
| POST | `/experimental/workspace/warp` | `experimental.workspace.warp` | Move/warp a session into workspace | None | Missing |

### Workspace synchronization endpoints

| Method | Path | Operation | Purpose | Mobile equivalent | Status |
| --- | --- | --- | --- | --- | --- |
| POST | `/sync/start` | `sync.start` | Start workspace synchronization | None | Missing |
| POST | `/sync/replay` | `sync.replay` | Replay synchronization events | None | Missing |
| POST | `/sync/steal` | `sync.steal` | Steal a session into a workspace | None | Missing |
| POST | `/sync/history` | `sync.history.list` | List synchronization events | None | Missing |

### V2 API endpoints

These are a separate, smaller protocol under `/api`. The current mobile app is
built on the established v1 SDK and does not consume this family.

| Method | Path | Operation | Purpose | Mobile equivalent | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/session` | `v2.session.list` | List v2 sessions | None | Missing |
| POST | `/api/session/{sessionID}/prompt` | `v2.session.prompt` | Send v2 prompt | None | Missing |
| POST | `/api/session/{sessionID}/compact` | `v2.session.compact` | Compact v2 session | None | Missing |
| POST | `/api/session/{sessionID}/wait` | `v2.session.wait` | Wait for v2 session completion | None | Missing |
| GET | `/api/session/{sessionID}/context` | `v2.session.context` | Return v2 session context | None | Missing |
| GET | `/api/session/{sessionID}/message` | `v2.session.messages` | List v2 messages | None | Missing |
| GET | `/api/model` | `v2.model.list` | List v2 models | None | Missing |
| GET | `/api/provider` | `v2.provider.list` | List v2 providers | None | Missing |
| GET | `/api/provider/{providerID}` | `v2.provider.get` | Return v2 provider | None | Missing |

### TUI control endpoints

The mobile app controls the headless server directly. TUI control is useful
only if Rhythm decides the phone should remote-control an interactive TUI.

| Method | Path | Operation | Purpose | Mobile equivalent | Status |
| --- | --- | --- | --- | --- | --- |
| POST | `/tui/append-prompt` | `tui.appendPrompt` | Append text to TUI prompt | None | Missing by design |
| POST | `/tui/open-help` | `tui.openHelp` | Open TUI help | None | Missing by design |
| POST | `/tui/open-sessions` | `tui.openSessions` | Open TUI session dialog | None | Missing by design |
| POST | `/tui/open-themes` | `tui.openThemes` | Open TUI theme dialog | None | Missing by design |
| POST | `/tui/open-models` | `tui.openModels` | Open TUI model dialog | None | Missing by design |
| POST | `/tui/submit-prompt` | `tui.submitPrompt` | Submit TUI prompt | None | Missing by design |
| POST | `/tui/clear-prompt` | `tui.clearPrompt` | Clear TUI prompt | None | Missing by design |
| POST | `/tui/execute-command` | `tui.executeCommand` | Execute TUI command | None | Missing by design |
| POST | `/tui/show-toast` | `tui.showToast` | Show TUI notification | None | Missing by design |
| POST | `/tui/publish` | `tui.publish` | Publish TUI event | None | Missing by design |
| POST | `/tui/select-session` | `tui.selectSession` | Select TUI session | None | Missing by design |
| GET | `/tui/control/next` | `tui.control.next` | Wait for next TUI control request | None | Missing by design |
| POST | `/tui/control/response` | `tui.control.response` | Respond to TUI control request | None | Missing by design |

## Highest-value missing mobile surfaces

### Priority 0: compatibility and secure connection

These are not missing OpenCode endpoints, but they are required before feature
work:

1. Generate/pin the mobile SDK from Rhythm's bundled `1.14.49` OpenAPI spec;
   do not use the mobile repository's latest-only `1.18.3` SDK contract.
2. Add a Rhythm pairing contract containing the HTTPS tailnet URL, username,
   short-lived credential, server version, and API compatibility fingerprint.
3. Validate HTTP, SSE, and PTY WebSocket behavior through Tailscale Serve.
4. Keep engine process lifecycle and upgrades owned by Rhythm desktop.

### Priority 1: expose already-written adapters

These require mostly provider/context/UI wiring rather than new transport work:

- Directory browser: `/file`
- Text and symbol search: `/find`, `/find/symbol`
- Repository status and diffs: `/vcs/status`, `/vcs/diff`, `/vcs/diff/raw`
- Child/subagent sessions: `/session/{id}/children`
- PTY detail/resize: `GET/PUT /pty/{id}`
- Remove MCP OAuth credentials: `DELETE /mcp/{name}/auth`

### Priority 2: valuable new adapters and surfaces

- Skills browser and reload: `/skill`, `/skill/reload`
- Project metadata and Git initialization: `PATCH /project/{id}`,
  `/project/git/init`
- Message/part deletion and editing
- Session initialization (`AGENTS.md`) and session shell execution
- Tool-schema and MCP-resource inspection
- Config reload and selected global configuration controls

### Defer or intentionally omit

- Engine self-upgrade: Rhythm ships and owns the fork binary.
- TUI controls: the mobile app is a headless-server client.
- `global.dispose` and instance disposal: unsafe without a desktop lifecycle
  contract.
- Experimental Console org switching unless Rhythm adopts that provider.
- V2 `/api` migration until its stability and feature parity are established.
- Experimental workspace/sync APIs until Rhythm chooses whether they replace or
  complement its existing project/worktree model.

## GitNexus findings and limitations

- `Rhythm`: 4,761 files, 267,549 graph nodes, 498,557 edges, 300 flows.
- `opencode-mobile`: 86 files, 6,953 graph nodes, 15,342 edges, 234 flows.
- Cross-repo contract registry: 536 contracts and 9 automatic exact links.
- Generated SDK calls are not emitted as literal HTTP consumer contracts, so
  operation-ID comparison was required to connect the maps.
- The optional LadybugDB FTS extension could not be installed; BM25 search is
  unavailable. Structural graph, route, call, PDG, and group-contract analysis
  completed successfully.
