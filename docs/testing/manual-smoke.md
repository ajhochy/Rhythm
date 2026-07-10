# Manual Smoke Test — Opencode Engine

**PR:** [#574](https://github.com/ajhochhalter/Rhythm/pull/574)
**Branch:** `opencode-engine-issue-564`

Run these checks against a running instance of the app before merging.

---

## 1. Server health

```bash
curl http://localhost:4001/opencode/health
```
Expected: `{"status":"ready","message":"Opencode SDK ready"}`

If status is `"unavailable"`, the Opencode SDK failed to initialize (check logs).

---

## 2. Capabilities endpoint

```bash
curl http://localhost:4001/agents/capabilities
```
Expected: JSON map of agent IDs to booleans (e.g., `{"claude-code":true,"codex":true,...}`)

- `claude-code` should be true when `anthropic` provider is connected
- `codex` should be true when `openai` provider is connected
- `opencode` should be true when engine is ready

---

## 3. Auth — Store API key

```bash
curl -X POST http://localhost:4001/opencode/auth/google \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"test-key-123"}'
```
Expected: `{"success":true,"message":"API key stored for google"}`

```bash
curl http://localhost:4001/opencode/auth/
```
Expected: `{"providers":["google"],"ready":true}` (or whatever providers are connected)

---

## 4. Auth — Missing API key

```bash
curl -X POST http://localhost:4001/opencode/auth/google \
  -H "Content-Type: application/json" \
  -d '{}'
```
Expected: 400 `{"error":"apiKey is required"}`

---

## 5. Create an agent session

Requires: api_server running and Opencode engine ready.

```bash
curl -X POST http://localhost:4001/agent-sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(curl -s http://localhost:4001/health | jq -r '.token // empty')" \
  -d '{"agentId":"claude-code","cwd":"/Users/$(whoami)","name":"Smoke Test Session"}'
```

If auth is bypassed (AGENT_LOCAL=true), omit Authorization header.
Expected: 201 with session object containing `id`, `agentKind`, `status`.

---

## 6. List agent sessions

```bash
curl http://localhost:4001/agent-sessions \
  -H "Authorization: Bearer ..."
```
Expected: 200 with `{"sessions":[...],"resumable":[...]}`

---

## 7. Delete agent session

```bash
SESSION_ID="<id from step 5>"
curl -X DELETE "http://localhost:4001/agent-sessions/$SESSION_ID" \
  -H "Authorization: Bearer ..."
```
Expected: 204

---

## 8. Engine not ready — 400 on session create

With the engine not initialized, verify graceful degradation:

```bash
# (Simulate by setting isReady=false in opencode_engine mock, or
# use a fresh server that hasn't loaded the SDK yet)
curl -X POST http://localhost:4001/agent-sessions \
  -H "Content-Type: application/json" \
  -d '{"agentId":"claude-code","cwd":"/tmp","name":"Fail Test"}'
```
Expected: 400 with descriptive error message

---

## 9. Flutter UI

> **Always export `RHYTHM_LOCAL_SMOKE=1` for local smoke runs** (see §12). It
> disables `AgentTriggerWatcher`, so the run never issues
> `DELETE /claude-triggers/*` against production.

```bash
cd apps/desktop_flutter && RHYTHM_LOCAL_SMOKE=1 flutter run -d macos
# or, equivalently:
# flutter run -d macos --dart-define=RHYTHM_LOCAL_SMOKE=1
```

- [ ] App launches without errors
- [ ] Navigate to Settings → AI Account — three sections render (Subscriptions, Free API, Custom)
- [ ] Click "Authorize" on Claude — system browser opens (or attempts to)
- [ ] Paste a Gemini API key, click Save — status message shows success/failure
- [ ] Navigate to Agents → Manage agents — "Connect an AI Account" card visible
- [ ] Create a new agent session — verify it appears in the session list

---

## 10. Full test suite

```bash
cd apps/api_server && npm test
```
Ideally all tests pass. If better-sqlite3 ABI mismatch occurs, run `npm rebuild better-sqlite3` and retry.

```bash
cd apps/desktop_flutter && flutter test
```
Expected: all pass.

---

## 11. Settings UI cleanup (issues #575–#579)

### #575 — Manage Agents card
- [ ] Open Agents → Manage agents. Cards show only: icon, name, enabled toggle, AI Agent checkbox, and an Available/Unavailable badge.
- [ ] No "Command" text field is visible.
- [ ] No "Supports session resume" checkbox is visible.
- [ ] No Advanced expansion with resume command / session ID pattern.
- [ ] Add a custom (non-preset) config — badge should show Unavailable (this is expected; preset IDs drive the capabilities map).

### #577 — Settings AGENT SERVER card
- [ ] Open Settings. The AGENT SERVER section shows a single row: green dot + "Running on localhost:4001".
- [ ] No "Claude Code CLI: installed/not installed" row.
- [ ] No "Codex CLI: installed/not installed" row.
- [ ] No Refresh button.
- [ ] No "Install Claude Code" yellow banner.

### #576 / #579 — OAuth error surfacing
- [ ] Settings → AI Account → tap "Authorize Claude" (anthropic). If the SDK is ready and OAuth succeeds, the system browser opens. If it fails, the message shown contains the SDK's actual error string, not the generic fallback.
- [ ] Tap "Authorize GitHub Copilot". Same expectation — real error surfaced if it fails.

### #578 — OpenRouter API key save
- [ ] Settings → AI Account → paste any string into the OpenRouter API key field → Save.
- [ ] If the server returns HTML (route missing in `dist/`), the UI shows a readable "Failed: <status reason>" message instead of a FormatException crash.
- [ ] With a rebuilt `apps/api_server/dist/`, saving a valid key shows success.

---

## 12. Agent feature issues #626 / #629 / #631 — automated vs manual split

### #626 — Session chip status flip

**Automated by widget/controller tests:**
- `AgentsController` receives `SessionUpdatedMessage` and upserts the session
  in all list variants (idle→working, working→idle, archived, unknown id).
- `notifyListeners()` fires on every upsert — chip widget rebuilds.
- Test file: `test/features/agents/issue_626_chip_status_flip_test.dart` (5 tests)

**Still manual (live SDK):**
- Confirm the chip visually animates (color + spinner) during a real agent run
  over a live WebSocket without issuing a REST poll. Requires: running app,
  opencode SDK connected, one active agent session.
- Steps:
  1. `RHYTHM_LOCAL_SMOKE=1 flutter run -d macos`
  2. Open Agents tab, create a session, send a prompt.
  3. Observe the session-list chip flipping to the "working" spinner color while
     the agent is running, then back to the idle green dot when it finishes.
  4. Confirm the network tab shows no polling of `/agent-sessions` during the flip.

---

### #629 — System context note renders

**Automated by widget/controller tests:**
- `_MiniMessageBlock` (agent_bubble_overlay.dart) correctly dispatches the
  `system` role to a muted italic Text widget (not the opaque output box).
- Text content matches `strippedText`.
- Source-text guard asserts the production `isSystem` branch still exists.
- Test file: `test/features/agents/issue_629_system_message_render_test.dart`
  (5 widget tests + 1 source guard)

**Still manual (live SDK):**
- Tap "Open Chat" from a live task-ready trigger bubble linked to a real task
  with title and notes. Confirm the chat transcript shows the task context as a
  grey italic note before the first assistant reply.
- Requires: running app, production server with a `claude-trigger` entry, task
  record with `notes` populated.
- Steps:
  1. From the Rhythm app, trigger a task that fires a `claude-trigger`.
  2. When the task-ready bubble appears, tap "Open Chat".
  3. Verify the transcript opens with an italicised grey line containing the
     task title (and notes if present).

---

### #631 — Slash-command popover lists commands

**Automated by widget/controller tests:**
- `CommandsDataSource.list()` parses JSON array → `SlashCommand` items.
- Returns `[]` on non-200, on exception, and on malformed response body.
- `SlashCommandPopover` opens on '/' input, renders command names + descriptions,
  filters on partial match, fires `onCommandSelected` with trailing space.
- Test file: `test/features/agents/issue_631_slash_commands_test.dart`
  (5 data-source unit tests + 7 widget tests)

**Still manual (live SDK):**
- Confirm real commands defined in `opencode.json` appear in the popover.
- Requires: running app, opencode SDK initialized, at least one custom command
  defined in the project's `opencode.json`.
- Steps:
  1. Open Agents tab, select an active session.
  2. Click the composer input and type `/`.
  3. Verify the popover appears with the commands from `opencode.json`.
  4. Type a partial name to confirm filtering.
  5. Press Enter to confirm the selected command writes to the input.

---

## 13. Local smoke safety — `RHYTHM_LOCAL_SMOKE` (issue #476)

`AgentTriggerWatcher` polls the **production** `GET /claude-triggers` endpoint
and issues `DELETE /claude-triggers/:id` after handing each trigger to the
local agent server. During a local `flutter run` this means a dev session can
mutate production trigger state — violating the no-production-traffic
invariant.

**Always export the flag before launching a local/dev smoke run:**

```bash
# env var (desktop)
RHYTHM_LOCAL_SMOKE=1 flutter run -d macos

# or compile-time dart-define (works on all platforms incl. web)
flutter run -d macos --dart-define=RHYTHM_LOCAL_SMOKE=1
```

When the flag is set to `1`, `AgentTriggerWatcher.start()` is a no-op and logs:

```
[AgentTriggerWatcher] RHYTHM_LOCAL_SMOKE=1 detected — watcher is disabled for this run. No production traffic will be issued.
```

**Verify:** the `flutter run` log contains the line above and **no**
`DELETE /claude-triggers/*` lines for the duration of the smoke run.

---

# Manual Smoke — Non-mobile issue wave (PR #1005, 2026-07-10)

**Branch:** `workflow/run-2026-07-10-nonmobile-issues`

All backend behavior for these is **already live-verified** against a standalone
server running this branch's build (see
`docs/ai/runs/2026-07-10-nonmobile-issues-wave.md`). What remains is a real
desktop-app click-through — build & run the app from the branch first, because
the app talks to its **embedded** `:4001` server, not the dev server:

```bash
cd apps/api_server && npm run build      # embed this branch's fixed server
cd ../desktop_flutter && flutter run -d macos
```
(Fully quit any running Rhythm first — Cmd+Q — so the old embedded server is not reused.)

## #999 — Session History renders tool transcripts
1. Open **Session History** and pick a session that used tools (most real agent runs).
2. **Expected:** the transcript shows tool calls / reasoning / step markers — NOT
   rows of `(empty message)`. (Pre-fix: tool-using sessions were all "(empty message)".)

## #1000 — scheduled-task enable/disable toggle
1. Open **Scheduled Tasks**, toggle any task's enable/disable switch.
2. **Expected:** it saves without error (no red 500). Toggle back; still fine.
   (Pre-fix: saving `enabled` 500'd — the switch was dead.)

## Not required to smoke here (backend-only, already probe-verified)
#1002 (scheduled runs succeed), #1004 (no over-prune), #1003 (approve refusal),
#1001 (E2E isolation) — verified via live backend probes; no dedicated UI surface.
