---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: []
status: blocked
tags: [run, Rhythm]
---

# Agent sessions during an engine credential bounce

## Outcome

Blocked by the explicit reproduction gate. Three credential-write/session-create attempts did not
surface the reported raw `SDK_ERROR`, so no contract test or source fix was written.

Attempts 1 and 2 returned `201 Created`. Attempt 3 did hit the intended in-flight engine-bounce
race, but the running API logged a bounded `BAD_REQUEST` rather than `SDK_ERROR`. The command runner
did not return attempt 3's curl stdout, so an exact HTTP status/body cannot be claimed for that
attempt; the verbatim server-side evidence is preserved below.

## Files

- Added only this run note.
- No source or test files were changed.

## Reproduction attempts

### Attempt 1 — request begins after watcher settle

Credential write:

```text
HTTP/1.1 200 OK
X-Powered-By: Express
Vary: Origin
Content-Type: application/json; charset=utf-8
Content-Length: 56
ETag: W/"38-zjNIB4BE5T7YIKduTtrsXsCQfrw"
Date: Sat, 15 Aug 2026 21:51:26 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"success":true,"message":"API key stored for lmstudio"}
```

Immediate session create (after 180 ms):

```text
HTTP/1.1 201 Created
X-Powered-By: Express
Vary: Origin
Content-Type: application/json; charset=utf-8
Content-Length: 885
ETag: W/"375-mJ1xf/5Y3OhBmacFY+1HVPFVbfo"
Date: Sat, 15 Aug 2026 21:51:30 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"id":"e2c97f4e-3b8c-4451-97f8-76b7d28be316","taskId":null,"taskTitle":null,"profileId":"local-lean","opencodeAgentId":"local-lean","agentKind":"local-lean","status":"starting","statusMessage":null,"sessionToken":null,"sdkSessionId":"ses_ff89768fcffeyikDORK76EmwPG","cwd":"/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite","name":"UNIT G bounce repro 1","projectId":null,"providerId":null,"modelId":null,"agentMode":null,"permissionMode":"default","thinkingBudget":null,"fastMode":false,"lastPreview":null,"lastActivityAt":null,"archivedAt":null,"createdAt":"2026-08-15T21:51:26.420Z","updatedAt":"2026-08-15T21:51:30.056Z","mcpRole":null,"mcpAllowedToolsJson":null,"scheduledTaskId":null,"parentSessionId":null,"isSystem":false,"anthropicAccountId":null,"ownerUserId":1,"delegationDepth":0,"category":"chat","worktreeName":null,"worktreePath":null,"worktreeBranch":null}
```

### Attempt 2 — request completes before watcher settle

Credential write:

```text
HTTP/1.1 200 OK
X-Powered-By: Express
Vary: Origin
Content-Type: application/json; charset=utf-8
Content-Length: 56
ETag: W/"38-zjNIB4BE5T7YIKduTtrsXsCQfrw"
Date: Sat, 15 Aug 2026 21:51:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"success":true,"message":"API key stored for lmstudio"}
```

Immediate session create (no sleep):

```text
HTTP/1.1 201 Created
X-Powered-By: Express
Vary: Origin
Content-Type: application/json; charset=utf-8
Content-Length: 885
ETag: W/"375-h2CPmsfXMBmVJzN5n3SksnmPeh0"
Date: Sat, 15 Aug 2026 21:51:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"id":"5729dc29-38dd-4634-988f-f12c905ab432","taskId":null,"taskTitle":null,"profileId":"local-lean","opencodeAgentId":"local-lean","agentKind":"local-lean","status":"starting","statusMessage":null,"sessionToken":null,"sdkSessionId":"ses_ff8972d6affehmdhher6VO5haX","cwd":"/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite","name":"UNIT G bounce repro 2","projectId":null,"providerId":null,"modelId":null,"agentMode":null,"permissionMode":"default","thinkingBudget":null,"fastMode":false,"lastPreview":null,"lastActivityAt":null,"archivedAt":null,"createdAt":"2026-08-15T21:51:45.271Z","updatedAt":"2026-08-15T21:51:45.306Z","mcpRole":null,"mcpAllowedToolsJson":null,"scheduledTaskId":null,"parentSessionId":null,"isSystem":false,"anthropicAccountId":null,"ownerUserId":1,"delegationDepth":0,"category":"chat","worktreeName":null,"worktreePath":null,"worktreeBranch":null}
```

### Attempt 3 — in-flight create interrupted by bounce

The request used a new temporary cwd to keep the real engine create call in flight across the
watcher's 150 ms settle window. The command runner returned no curl stdout. The API log proves the
race occurred, but shows that the currently built server bounded it as `BAD_REQUEST`:

```text
2026-08-15T21:52:52.828Z [stderr] [WARN] [AgentSessionsController] session 29baf6f6-38be-423d-90c6-5f0e1c5adbf5 created unscoped (no mcpRole) — floor totalEstimatedTokens=1625 (actual total is higher once connected MCP servers are counted; see GET /agent-sessions/29baf6f6-38be-423d-90c6-5f0e1c5adbf5/tool-surface)
2026-08-15T21:52:52.967Z [stdout] [INFO] [AuthCredentialWatcher] /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/home/.local/share/opencode/auth.json changed — bouncing engine to reload credentials
2026-08-15T21:52:52.967Z [stdout] [INFO] [OpencodeClientService] reloadCredentials: bouncing engine to pick up changed auth.json
2026-08-15T21:52:52.977Z [stderr] [ERROR] [OpencodeClientService] createSession failed: TypeError: Cannot read properties of null (reading 'session')
2026-08-15T21:52:52.977Z [stdout] [INFO] [Opencode][timing] opencodeClient.createSession took 149ms for session 29baf6f6-38be-423d-90c6-5f0e1c5adbf5
2026-08-15T21:52:52.978Z [stderr] [ERROR] Handled BAD_REQUEST POST /agent-sessions — Failed to create Opencode session — check your AI account is authorized { authUserId: null }
```

## Root-cause status and callers

The reported disclosure root cause was not established because the required raw `SDK_ERROR` did
not reproduce. The observed race is at
`apps/api_server/src/services/opencode_client_service.ts:1255-1278`: credential reload disposes the
client while `createSession` is in flight, yielding `Cannot read properties of null (reading
'session')`. In the current source, `AgentSessionsController.create` checks the error-shaped result
at `apps/api_server/src/controllers/agent_sessions_controller.ts:1021-1023` and replaces it with the
bounded `BAD_REQUEST` message observed above.

No symbol was changed, so the requested pre-change shared-funnel caller audit and GitNexus impact
analysis were not entered. The directly observed caller was
`AgentSessionsController.create` at `agent_sessions_controller.ts:1007-1017`.

## RED / GREEN contract output

Not run. The stop condition prohibited writing or fixing a contract after three attempts failed to
surface the reported raw `SDK_ERROR`; consequently there is no legitimate RED or GREEN output.

## Cleanup and restored state

- All three reproduction rows/sessions were removed through the API; the exact-name SQLite query
  returned zero rows afterward.
- The temporary cwd was removed; `find /tmp -maxdepth 1 -type d -name
  'rhythm-unit-g-repro.*'` returned no paths.
- Temporary `lmstudio` auth was removed. Auth provider IDs were printed without values, and
  `lmstudio` was absent.
- `local-lean` resolves to provider `omlx`, model `gpt-oss-20b-MXFP4-Q8`.
- Engine `/global/health` is healthy. API `/opencode/health` remains `status: unavailable` because
  the event bridge did not reconnect after repeated supervised credential bounces.
- A managed `sandbox.sh down`/`up` recovery was attempted, but `down` safely refused because the
  supervised engine PID had changed from its recorded PID. No process was killed or started by hand.

## Checks

No test file was added or run. This is a blocked reproduction run, not an implementation run.
