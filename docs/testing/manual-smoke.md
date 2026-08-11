# Manual Smoke Test — Opencode Engine

**Feature/PR:** `<current feature or PR>`
**Branch:** `<current branch>`

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

### Live Artifacts / Worship Calendar (AV-07)

- [ ] Dashboard stays unchanged; open the fixed Dashboard tab after opening an artifact.
- [ ] Use **+** to find and open a Worship Calendar; pin/close it, restart, and confirm tabs persist only for the signed-in user.
- [ ] As an authorized collaborator/org member, edit the calendar and confirm the same artifact updates; exercise revision conflict → reload and deleted/unavailable states.
- [ ] Use **Sync from PCO** under the current viewer's own PCO account; verify disconnected/denied/offline feedback remains in that tab.
- [ ] Confirm blocked links, downloads, file/media access, and network/navigation attempts show feedback without leaving the viewer.
- [ ] Log out or switch users and confirm prior artifact tabs/data clear before the next user loads.
- [ ] Compare Dashboard, overflow/picker, Worship Calendar, conflict, deleted, and error states with the AV-06/AV-07 screenshot evidence in `docs/ai/runs/`.

### Session Inspector artifact previewer (#1359–#1362)

Run in the shipping macOS app against `tools/dev/sandbox.sh`; record the same
artifact ID from the persisted session mutation through Dashboard handoff.

- [ ] In a narrow layout, open Agents → exact session → Artifacts. Confirm the selector, compact title/status/reload toolbar, and one interactive preview fit without sharing controls or overflow.
- [ ] Resize the inspector after editing content inside the WKWebView. Confirm the interactive state survives and only one preview remains mounted.
- [ ] Using only the keyboard, focus and open the selector, change artifacts, reload, and activate Open in Dashboard. Confirm every target is at least 44px.
- [ ] With VoiceOver, hear the selected artifact's full title, generic availability status, reload action, and Dashboard action; confirm truncated visual titles retain the full spoken name and no authorization details are exposed.
- [ ] During an in-flight artifact load, perform a session switch and a Rhythm user switch. Confirm the prior WKWebView is removed and no late response appears in the new identity.
- [ ] Perform only a provider-account switch. Confirm the inspector and WKWebView are not reset.
- [ ] Exercise revoked/deleted artifacts. Confirm each row remains discoverable with only generic Unavailable/Deleted copy and no access detail.
- [ ] Create and later update one supported artifact mutation, then use Dashboard handoff. Confirm the same stable artifact ID is pinned and selected exactly once in Dashboard.

These checks remain unrun until orchestrator smoke; an unchecked item is not a
pass. Record failures, observed output, and follow-up ownership in the run note.

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

### #1052 (OCU-11) — Subtask playbook renders a child-session TaskChip

**Automated by widget/controller tests:**
- Argument hint ghost text + popover refresh-on-open + arg passthrough.
- Test file: `test/features/agents/issue_1052_slash_popover_hints_test.dart`

**Still manual (live SDK) — traced but not automated:**
- Engine trace confirms a `subtask:true` command's initiating `subtask` part
  is executed by `handleSubtask` (session/prompt.ts), which internally runs
  the real `task` tool on a NEW assistant message — i.e. the transcript ends
  up with an ordinary `tool` part named `task`, which the existing
  `TaskChip` dispatch (`_buildToolRenderer` in agents_view.dart) already
  renders. No new rendering code was needed; this item exists to visually
  confirm that trace holds against a live engine.
- Steps:
  1. Create a Playbook (Tools → Playbooks) with "Run as subtask" enabled.
  2. Run `/your-playbook` in an active session.
  3. Verify a navigable TaskChip appears in the transcript and tapping it
     opens the child session transcript.

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

## 14. Rhythm Agents iOS release gate (issues #1172–#1175)

Run this section only after the aggregate automated gates, isolated real-engine
tests, independent review, and signed development build are green for the exact
source SHA recorded in `docs/ai/evidence/issue-1175-release.json`. Use a
non-sensitive device model label in evidence (for example `iPhone 16 Pro`);
never record a UDID, pairing code, device token, account token, Apple
credential, or webhook secret.

### Human prerequisites

- [ ] AJ confirms the test iPhone is signed into the intended Apple test
  account and Tailscale tailnet.
- [ ] Install or trust the signed development build when iOS prompts. This is
  the first intentionally human-gated step; do not bypass device trust or
  signing controls.
- [ ] On the Mac, open Rhythm's **Enable Mobile Access** flow and confirm
  Tailscale Serve reports healthy. Do not expose the OpenCode port directly.
- [ ] Keep PR #1165 draft and unmerged throughout the matrix.

### Pairing and failure isolation

- [ ] Scan the one-time QR and pair successfully. Confirm the code/token is not
  shown again after pairing.
- [ ] Confirm the app names the paired Mac and selected Rhythm project without
  exposing a filesystem root.
- [ ] Turn off only the Mac/Tailscale connection. Paired-Mac screens become
  offline/read-only while production-owned Email and Gallery remain usable.
- [ ] Restore the Mac connection and confirm cached views refresh without
  duplicated Activity or transcript entries.
- [ ] Revoke mobile access from the Mac. The phone loses gateway access and
  cannot reconnect with the revoked credential.
- [ ] Pair to a replacement Mac, confirm the new host works, and confirm the
  previous host credential no longer works.

### Agents, realtime, and Activity (#1172)

- [ ] Confirm exactly three primary tabs: **Agents**, **Tools**, and
  **Settings**.
- [ ] Create, open, rename, archive, restore, fork, and delete a chat. Confirm
  delete requires an explicit destructive confirmation.
- [ ] Send a prompt and observe live SSE updates. Background the app during the
  run, foreground it, and confirm authoritative refresh produces no duplicates.
- [ ] Open a child session, answer a question, approve and deny a permission,
  inspect diff/todo/file content, and open the PTY. Confirm PTY text input,
  output, and resize work.
- [ ] In Activity, verify active, waiting, failed, and completed rows; exercise
  source/status filters and pagination; deep-link a session, research run,
  schedule, webhook, and cookbook item to the exact target.
- [ ] Force-quit during an active run, relaunch, and confirm the interrupted run
  remains visible and recovers after reconnect.

#### Mobile lifecycle follow-up (#1280, #1364, #1366)

- [ ] On a physical iPhone, type/wrap enough text to grow the composer from one
  line through six lines. Confirm the box grows on each real UIKit layout event,
  caps at six lines, and only then scrolls internally.
- [ ] After a cold launch over the representative remote gateway, open an exact
  desktop/projectless chat and record tap-to-first-transcript latency. It must
  stay below `OPEN_PROJECT_SESSION_TIMEOUT_MS` (15 seconds) while the remaining
  chat catalog continues to appear in the background.
- [ ] While discovery is still loading, switch paired project scope and open a
  different explicit chat. Delay/restore the old response and confirm it cannot
  replace the selected transcript or introduce duplicate/cross-scope rows.
- [ ] Drop and restore Mac/Tailscale reachability during that open. Confirm the
  offline state appears, polling resumes while the stream is unavailable, the
  stream reconnects, and the recovered transcript contains no duplicate turns.
- [ ] Background/foreground and force-quit/relaunch once during the matrix to
  exercise native timer suspension and UIKit/network lifecycle behavior that
  Jest cannot reproduce.

#### Reviewed session-binding cleanup (#1363 — human-gated)

Run this only against the local-agent SQLite database on the paired Mac. The
command is dry-run-only unless `--apply` is explicitly present, and output paths
must not already exist.

- [ ] Build the API CLI: `cd apps/api_server && npm run build`.
- [ ] Generate the candidate report without mutation:
  `node dist/cli/index.js session-binding-cleanup --db <rhythm.db> --output <review.json>`.
- [ ] Match every candidate to the corresponding desktop and mobile chat. Set
  every `reviewDecision` to either `approve` or `preserve`; leave intentional
  `Theological-Researcher` bindings as `preserve`. For an approved row, set the
  reviewed `proposed.profileId` and matching `proposed.agentKind`, or use a null
  profile only when the chat should be Unassigned.
- [ ] Stop unless a human has approved the complete reviewed JSON. Applying is
  intentionally not part of automated verification.
- [ ] After approval only, apply once and reserve a new audit path:
  `node dist/cli/index.js session-binding-cleanup --db <rhythm.db> --apply --approval-file <review.json> --audit-output <audit.json>`.
- [ ] Confirm the audit is `applied`, lists only explicitly approved session
  IDs under `appliedSessionIds`, and lists legitimate bindings under
  `preservedSessionIds`.
- [ ] Fully quit and relaunch both desktop and mobile, then verify each approved
  chat shows the reviewed profile and each preserved chat is unchanged.

### Every Tool and destructive confirmations (#1173)

- [ ] Open every Tool: Brain, Research, Scheduled Jobs, Webhooks, Profiles,
  Cookbook, Review Queue, Report Card, Email, Gallery, Skills, Playbooks, MCP,
  and Providers/Models.
- [ ] For each screen, observe at least the applicable loading, empty, offline,
  forbidden, expired-auth, and retryable-error state; retry must recover when
  the dependency is restored.
- [ ] Create/search/delete Brain memory; start/cancel/retry Research; enable,
  disable, run-now, and delete a schedule. Delete and run-now require
  confirmation.
- [ ] Create a webhook, copy its receive URL, rotate/revoke it, and delete it
  after confirmation. The replacement secret is visible exactly once and is
  absent after leaving/reopening the screen.
- [ ] Edit a Profile's prompt/model/scope/delegation and confirm projection
  success precedes refresh. Verify inherited (`null`) scope remains distinct
  from explicit empty scope.
- [ ] Exercise Cookbook recipe CRUD/run, Review Queue approve/reject with
  high-risk approval, and Report Card summaries. Destructive/high-risk actions
  require confirmation.
- [ ] Verify Email and Gallery still work while the Mac is offline. Verify
  paired-Mac Tools are read-only from secret-free cache while offline.
- [ ] Exercise Skills history/availability, Playbook CRUD/run, MCP
  connect/disconnect/OAuth removal, and provider/model diagnostics.

### Accessibility and appearance

- [ ] Repeat the Agents, Activity, Webhooks, and confirmation paths in light
  and dark appearance.
- [ ] Set iOS text size to the largest accessibility size. No critical action,
  status, secret warning, filter, or confirmation is clipped or unreachable.
- [ ] With VoiceOver, traverse the three tabs, Activity filters/items, Webhook
  actions, offline/error states, and destructive dialogs. Labels, traits,
  reading order, focus return, and button hit targets are understandable.
- [ ] Confirm color is not the only signal for active/waiting/failed/completed
  state and reduced-motion mode does not hide status changes.

### Release decision

- [ ] Record pass/fail against the exact signed development build ID and source
  SHA, using only the device model label.
- [ ] If any item fails, stop: do not produce or submit the production build.
- [ ] After the full physical matrix passes, AJ explicitly authorizes the
  production EAS build and TestFlight submission.
- [ ] Verify the submitted TestFlight artifact hash matches the recorded
  production artifact, then leave PR #1165 draft for AJ's final approval.
