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

## 12. Local smoke safety — `RHYTHM_LOCAL_SMOKE` (issue #476)

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
