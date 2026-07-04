# Config Doctor Agent Profile — Design

**Date:** 2026-07-04
**Status:** Approved by AJ
**Goal:** Turn the read-only `rhythm doctor` CLI into a chattable agent profile that can also *fix* what it finds — reusing existing infrastructure (the engine's built-in bash tool, Rhythm's permission-approval UI, the doctor CLI itself) rather than building new plumbing.

## Motivation

Tonight's session surfaced two real classes of config/data problems by hand: a server pointed at the wrong `DB_PATH`/`MEMORY_VAULT_PATH` (env mismatch), and an orphaned duplicate `agent_configs` row missing its `.md` agent file (issue #900), which crashes any session routed to it. `rhythm doctor` (existing CLI, `apps/api_server/src/cli/doctor.ts`) diagnoses config/API-key/MCP-reachability issues but is read-only and requires a terminal — there's no way to hand a non-technical user (or a delegated agent) something conversational that can actually apply fixes.

## Key constraint established during brainstorming

**An in-app agent cannot fix the server it's running inside of.** If `:4001`/`:4096` are down, there's no agent to chat with at all — "is the process alive" checks only make sense as an external script (the existing CLI). Config Doctor is therefore scoped to problems reachable *from inside* a live session: config files, the DB (via API, not raw SQL), and agent profiles. For anything needing a process-level intervention it can't safely perform on its own host process (restart, corrupted native module, source-level fix), it hands off to a fully-powered external agent (Claude Code or Codex) running in a separate OS process, launched in a real Terminal.app window — chosen specifically because a real terminal's ability to show progress doesn't depend on Rhythm's own server/UI working correctly.

## Feasibility (verified against the actual codebase before designing)

- The opencode engine exposes a native `bash` tool (`ShellTool`, `apps/opencode_fork/packages/opencode/src/tool/shell.ts`, registered unconditionally in `tool/registry.ts`) — not an MCP server. No new MCP server is needed for any part of this feature.
- Rhythm's permission model already renders a real Accept/Deny approval card for bash/write/edit/patch calls (`_permission_card.dart`; these are in the `_destructiveTools` set, so risky calls can surface as a blocking modal), with a 60s auto-deny timeout. `agent_session.ts` defines `PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'`.
- Bash execution is scoped to the session's `cwd` by default (`agent_sessions.cwd`); the shell tool resolves `workdir` against the session's directory and rejects paths outside it unless an `external_directory` permission is separately granted.
- No macOS app-sandbox restriction blocks spawning `osascript`/`open -a Terminal` from the bundled engine binary (intentional per the project's "no app-sandbox" entitlement).
- Querying the live SQLite DB directly via bash risks dirty reads against the running server's WAL connection — Config Doctor uses Rhythm's own REST API (`http://localhost:4001`, guaranteed reachable since it's hosting the very conversation) for any Rhythm-data checks instead.

## Design

### 1. Agent profile: "Config Doctor"

New `agent_configs` row:

| Field | Value |
|---|---|
| `id` / `ocAgent` | `config-doctor` |
| `label` | "Config Doctor" |
| `icon` | 🩺 |
| `isAgent` | `true` |
| `isManager` | `false` |
| `sessionSelectable` | `true` (pickable in the composer's agent dropdown and the Agents sidebar, same as Secretary/AI Trend Researcher) |
| `enabled` | `true` |
| `permissionMode` (session default when created from this profile) | `'default'` — every bash/write/edit call requires an explicit approval click. This is the safety backbone of the whole feature; nothing executes unattended, including the terminal handoff. |
| `allowedMcpsJson` | `[]` (empty — no MCP servers; bash covers everything this profile needs, and an empty list keeps the model from seeing irrelevant tools) |
| `modelProvider` / `modelId` / `defaultAnthropicAccountId` | `null` (inherits app/profile default, same as any other profile — no special-casing needed against the dual-accounts feature) |

**System prompt** (behavioral contract, not literal wording):

1. On the first turn of any conversation, run `cd apps/api_server && npm run doctor` via bash and read its output.
2. For Rhythm-specific structural checks the CLI doesn't cover (e.g. duplicate-labeled enabled agent profiles missing their `.md` file), fetch `GET http://localhost:4001/agent-configs` via bash `curl`, cross-reference against `ls ~/.config/opencode/agents/`, and identify orphans by comparing each enabled `isAgent` row's `ocAgent` against the files present.
3. Explain findings in plain English, grouped by severity (broken now / will break on next restart / cosmetic).
4. For known-safe fixes — editing `.env` or `~/.config/opencode/opencode.json` directly, or calling `POST /agent-configs/:id/resync-agent-file` (below) for an orphaned profile — propose the exact action and execute it. Each actual write/bash call still surfaces its own approval card; no separate confirmation step needs to be engineered into the prompt.
5. For anything requiring a process-level intervention (restart, corrupted native module, source-level fix, anything beyond config/data), stop and ask: "Would you like me to open this in Claude Code, Codex, or would you rather handle it yourself?" On choosing an external agent, write the diagnosis + suggested fix to a temp file first (e.g. `/tmp/rhythm-config-doctor-<timestamp>.md`, via the normal file-write tool — its own approval card) rather than interpolating free-form text into a shell/AppleScript string, then run (via bash) a command that opens a Terminal.app window and launches the chosen CLI pointed at that file, e.g. `osascript -e 'tell application "Terminal" to do script "cd <repo> && claude \"$(cat /tmp/rhythm-config-doctor-<timestamp>.md)\""'` (analogous for `codex`). Writing to a temp file first avoids quote/injection issues from arbitrary diagnosis text reaching an interpolated shell string. This bash call rides the same approval gate as everything else — no new permission category for v1.
6. Never modify `agent_configs` via raw SQL, and never query the live DB file directly — always go through the REST API on `localhost:4001`.

### 2. New backend endpoint: `POST /agent-configs/:id/resync-agent-file`

Thin controller method wired to the existing internal `writeAgentProfileFile(config)` function (`apps/api_server/src/services/opencode_agent_writer.ts`). Looks up the `agent_configs` row by `id`, calls the writer, responds `200` with the updated config or `404` if the id doesn't exist. Follows the existing `AGENT_LOCAL` auth-bypass pattern used by sibling `agent-configs` routes.

This is the concrete, non-freehand fix for the #900 class of bug: Config Doctor detects a profile whose `.md` file is missing on disk and calls this endpoint to regenerate it using the exact same logic normal profile creation/sync already uses — no risk of the LLM hand-writing a subtly-wrong frontmatter format.

### 3. Data flow (typical session)

1. User opens/creates a Config Doctor session (Agents sidebar or quick-create with this profile).
2. First turn: bash `npm run doctor` → approval card → user approves → agent reads and summarizes the output.
3. Agent runs the duplicate-profile check via `curl` (another bash call, another approval).
4. Agent presents a plain-English report: what's fine, what's broken, and for each broken item whether it can fix it directly or needs the terminal handoff.
5. Fixable items: agent proposes and executes, one approval per actual action.
6. Handoff items: agent asks which external tool (or "I'll handle it"); on selection, a real Terminal.app window opens with that CLI already running, seeded with context. Config Doctor's own chat stays open in Rhythm — e.g. to re-run diagnostics after the terminal-based fix completes.

### 4. Explicitly out of scope for v1 (YAGNI)

- No new MCP server.
- No auto-fix without approval — ever; `permissionMode: 'default'` is non-negotiable for this profile.
- No scheduled/background runs — chat-initiated only, not a watcher process.
- No new permission category for the terminal handoff — rides the existing bash-approval gate. A dedicated `external_program`/`system_integration` permission tag would be a nice-to-have polish item, not required.
- Does not attempt to diagnose or fix "the server is dead right now" — that remains the standalone CLI's job (see Motivation).

### 5. Testing

- **Backend:** a vitest test for the new route mirroring existing `agent_configs_controller` test patterns — `200` + file written/updated for a valid id, `404` for an unknown id.
- **Agent behavior:** no unit test is possible for an LLM system prompt, so verification is manual smoke: create a Config Doctor session, confirm it runs `npm run doctor` on its own, confirm it correctly surfaces the still-live orphaned "AI Trend Researcher" duplicate from #900, confirm the resync-file fix actually resolves it (the profile becomes usable), and confirm the terminal handoff opens a real, working Claude Code or Codex session with the diagnosis seeded in.
