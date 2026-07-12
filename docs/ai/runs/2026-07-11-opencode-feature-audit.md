---
date: 2026-07-11
repo: Rhythm
branch: uso/agent-followups
pr: none (research audit, no code changes)
issues: []
status: complete
tags: [run, rhythm, audit, opencode]
---

# Opencode Engine Feature Audit — what the fork exposes vs. what Rhythm uses

Method: 2 Codex agents audited the fork engine (`apps/opencode_fork/packages/opencode/src/`),
2 Explore agents inventoried Rhythm's consumption (`apps/api_server/src/` + `apps/desktop_flutter/lib/`),
GitNexus re-indexed (61k nodes, fork included), ground truth cross-checked against
`apps/opencode_fork/packages/docs/openapi.json` (131 typed routes; source now has 133 — spec is stale
by `/skill/reload` + `/config/reload`).

## Engine surface (fork, v1.14.49 base + Rhythm fork commits)

- **133 HTTP routes** across session/message, file/find, vcs, config, project, provider/auth, mcp,
  question, permission, pty, skill, command, agent, tui, global, sync, experimental
  (console/tool/resource/worktree/workspace), v2 `/api/*`.
- **~72 SSE event types**, incl. a v2 `session.next.*` family (26 events, event-sourced).
- **33 top-level config keys**; per-agent config keys incl. `permission`, `steps`, `variant`, `temperature`.
- **18 built-in tools** (+ conditional: `websearch`, `lsp`, `repo_clone`, `repo_overview`, `plan_exit`,
  `question`; + `mcp_dispatch` for deferred MCP; + project `{tool,tools}/*.ts` custom tools; + plugin tools).
- Fork-specific (all Rhythm-driven, all used): per-session `mcpAllowlist`/`skillAllowlist` (+ null-clear,
  subagent propagation, deferred MCP), `POST /skill/reload`, `POST /config/reload`, SSE dual-bus fixes,
  question recovery.

## What Rhythm uses (confirmed, deep)

api_server wraps ~40 SDK/HTTP methods, all with live callers except `listProviders` (dead).
Full pipeline: session create/get/abort/resume, prompt/promptAsync, messages, diff, revert/unrevert,
summarize, fork, children, todo, permissions (deprecated respond endpoint), questions (fork API),
MCP status/add/connect/disconnect/oauth (+ opencode.json dual-write), skills list/reload + file CRUD,
agents list + `.md` projection (`opencode_agent_writer`) + config/reload, provider oauth/auth.set,
plugins (auth only), PTY create/update/remove + WS.
Stream bridge handles 19 event types with allowlist backstops, redispatch, auto-title, error classification.
Flutter surfaces nearly all of it (sessions/children, permission cards+modes, question option picker,
todo panel, skills manager, MCP manager, profiles, multi-account auth, terminal tab, revert, compaction,
slash-command popover, fork-from-message).

Engine env flags set at spawn: `OPENCODE_BIN(_DIR)`, `OPENCODE_ENGINE_PORT`, `OPENCODE_CONFIG_PATH`,
`OPENCODE_DISABLE_EXTERNAL_SKILLS`, `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS`, `OPENCODE_GEMINI_PROJECT_ID`.
No feature-unlock flags are set.

## Gap matrix — engine capability → Rhythm status

| Engine capability | Rhythm status |
|---|---|
| `POST /permission/:id/reply` (`once`/`always`/reject+message), `GET /permission` | NOT USED — uses deprecated per-session respond; no "always allow"; pending cards lost on restart |
| Message queuing while busy (engine stores mid-run user msgs) | NOT USED — composer disables send |
| Question `custom` free-text + `multiple` | PARTIAL — option buttons only |
| `session.delete` on engine | NOT USED — engine sessions leak on Rhythm delete |
| `GET /session/status` (bulk resync) | NOT USED — status from events + DB only |
| `websearch` tool (needs `OPENCODE_ENABLE_EXA`/`OPENCODE_WEBSEARCH_PROVIDER`) | OFF |
| Custom commands (`commands/**/*.md`, `$ARGUMENTS`, per-cmd agent/model, `subtask`) | NOT USED — only lists built-ins; MCP prompts auto-appear |
| `skills.urls` remote skill index | NOT USED — local dir only (relevant to Odysseus shared skill store) |
| Worktrees `/experimental/worktree` + events | NOT USED (known pain: agents write to main checkout) |
| `file`/`find`/`find/file`/`file/status`, `vcs` status/diff(raw,branch)/apply, file.watcher events | NOT USED (only session.diff) |
| `session.shell` (#709 doc block exists) | NEVER WRAPPED |
| `session.init` (AGENTS.md generation) | NOT USED |
| Plugin hooks (`tool.execute.before/after`, `chat.params`, system transform, compaction, OTel) | NOT USED (plugins = auth only) |
| `/global/event` consolidated stream + heartbeat | NOT USED (per-directory streams) |
| Config: `small_model`, `username`, `reference`, `instructions`, `compaction.*`, `tool_output`, `attachment`, `watcher` | NEVER SET |
| Per-agent permission matrix (~17 keys + wildcards) | PARTIAL — writer manages edit/bash/webfetch + task roster only |
| `lsp`/`formatter` config + status; `find/symbol`; `lsp` tool (flagged) | NOT USED |
| `/experimental/tool` (schemas), `/experimental/resource` (MCP resources) | NOT USED |
| Plan mode (`OPENCODE_EXPERIMENTAL_PLAN_MODE`, `plan_exit`) | DIVERGED — Rhythm plan mode = client-side auto-deny |
| v2 `/api/*` + `session.next.*` | NOT USED (engine side partially stubbed — not ready) |
| Workspaces/control-plane/sync, console orgs, share, TUI routes, global upgrade | NOT USED (experimental/irrelevant) |

## Recommendations (priority order) — see chat report 2026-07-11

Top 5: (1) modern permission reply w/ Always-allow + restart rehydration, (2) message queuing,
(3) saved-prompt command builder, (4) org skill library via `skills.urls`, (5) worktree-isolated sessions.
Platform: regenerate SDK types from fork (kill hand-written d.ts + 4 fetch shims + `as any` pty),
Rhythm telemetry plugin via tool.execute hooks, `/global/event` consolidation, engine-session delete hygiene,
websearch enable, free-text questions, `session.shell`/`session.init`, config adoptions (`small_model`,
`reference`, `instructions`), full permission matrix in profile sheet.

## Cleanups found

- Dead: `listProviders` (service), Flutter `fetchChildSessions`, `dispatchCommand`, `SessionModelPicker`.
- `session.shell()` d.ts doc block for a method that was never wrapped.
- `openapi.json` stale vs. server source (131 vs 133 ops); generated SDK lacks `skill/config reload`.

## Files

No code changes. Agent reports archived in session scratchpad
(`codex-api-surface.md`, `codex-subsystems.md`).
