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

```bash
cd apps/desktop_flutter && flutter run -d macos
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
