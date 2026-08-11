# Rhythm Architecture

## Overview
macOS desktop productivity app for church staff. Flutter desktop client with a local Node.js/Express API server.

## Dual-server model

| Server | Port | Managed by | Data |
|---|---|---|---|
| Production API (`api.vcrcapps.com`) | 443 | Remote (Postgres) | All user-facing app data |
| Local agent server (`apps/api_server`) | 4001 | Flutter (spawned on launch) | Agent sessions, Opencode engine |

Flutter's `serverConfigService.url` controls the production API only. The agent server is always `http://localhost:4001` (`AppConstants.agentLocalBaseUrl`) — never coupled to the user-configurable URL.

## Cloud live artifacts

The hosted production API owns authenticated live-artifact metadata and authorization in Postgres; immutable bundle/state bytes persist under `/data/live-artifacts`. Stable artifact IDs support private, selected-collaborator, and organization access with revision-checked writes. The local Rhythm MCP surface exposes five hosted API tools, while the shipping Dashboard renders artifacts in a WKWebView with a closed bridge limited to state get/update and declared current-user `pco.services.read`. The authoritative V1 contract and verified flow are `docs/ai/contracts/live-artifacts-av07.json` and `docs/ai/runs/2026-08-09-live-artifacts-av07.md`.

## Scheduler ownership (#1214)

`agent_scheduled_tasks` is agent-EXECUTION state, owned solely by the local
SQLite-backed agent server (`apps/api_server` embedded/spawned by Flutter) —
never the hosted Postgres production API. The two datasets are NOT the same
rows and must never be conflated (see #1213's dual-endpoint routing rule).

`startAgentSchedulerJob()` (`services/agentSchedulerService.ts`) gates on
`env.dbClient`: a Postgres-backed process (`DB_CLIENT=postgres`) never
advances or fires a due task — it logs one actionable startup diagnostic
naming any enabled rows it finds stranded there, then returns without
scheduling a tick. This is the authoritative ownership boundary — it does not
depend on `RHYTHM_ROLE`/`AGENT_LOCAL`, both of which have drifted on the real
hosted deployment in the past (see `docs/ai/decisions/2026-07-28-scheduler-quarantine.md`).

Quarantine is fully recoverable: no row is deleted, disabled, or migrated by
this code path. See
`docs/release/hosted_deployment_synology_cloudflare.md` → "Scheduler
quarantine" for the operator backup/disable procedure for legacy production
rows.

## Opencode Engine

The local `apps/api_server` Node.js process embeds `@opencode-ai/sdk` in-process via dynamic `import()`. This replaced the old approach of spawning `claude-code`/`codex` as CLI subprocesses via `node-pty` (PR #574, 2026-05-13).

### Key components

| Component | Path | Purpose |
|---|---|---|
| `OpencodeClientService` | `services/opencode_client_service.ts` | Typed wrapper: sessions, providers, auth, events |
| `opencode_engine.ts` | `services/opencode_engine.ts` | Singleton client + in-memory `opencodeSessionMap` |
| `OpencodeStreamBridge` | `services/opencode_stream_bridge.ts` | SDK SSE events → WS gateway relay (shared stream) |
| Auth routes | `routes/opencode_auth_routes.ts` | `GET /opencode/auth/` (list), `POST /opencode/auth/:id` (API key), OAuth start/callback |
| Capabilities route | `routes/agents_capabilities_routes.ts` | Provider-based `GET /agents/capabilities` |
| Agent sessions controller | `controllers/agent_sessions_controller.ts` | `POST` creates SDK session + maps ID; `DELETE` clears map + marks closed |
| SDK artifact | `vendor/opencode-ai-sdk/` | Complete fork-generated JS + declarations, consumed through a normal `file:` dependency |
| Auth UI | `lib/features/settings/widgets/ai_account_section.dart` | Settings auth; refreshes connected providers from `GET /opencode/auth/` on mount |

### Session lifecycle
```
POST /agent-sessions
  → repo.insert(dto)                        ← local DB row (agentKind, cwd, name)
  → opencodeClient.createSession(name, cwd) ← SDK session
  → opencodeSessionMap.set(localId, sdkId)  ← in-memory routing
  → streamBridge.streamSession(...)         ← subscribe to SSE (once, shared)
  → opencodeClient.promptAsync(initial)     ← fire-and-forget initial prompt
  → HTTP 201

WS session.input { id: localId, data: text }
  → opencodeSessionMap.get(localId) → sdkId
  → opencodeClient.prompt(sdkId, text)
  → SSE events → streamBridge → WS broadcast → Flutter

DELETE /agent-sessions/:id
  → streamBridge.stopStream(id)    ← adds id to stoppedSessions; events for this SDK id are dropped
  → opencodeSessionMap.delete(id)  ← clean up map entry (shared SSE stream stays alive)
  → repo.markClosed(id)
  → HTTP 204
```

### Auth model
Per-user AI accounts. Each user signs into their own provider on their machine. No shared credentials. Credentials stored by Opencode SDK in `~/.local/share/opencode/auth.json`.

### Provider tiers (Settings UI)
1. **Subscriptions:** Claude OAuth, ChatGPT OAuth (opens system browser)
2. **Free API:** Google Gemini (API key), GitHub Copilot (OAuth)
3. **Custom:** OpenRouter or any provider API key

### Child-session navigation (OPC-M3-6)

When the SDK spawns a subagent task, the Opencode engine creates a child session under the parent's SDK session id. These child sessions have NO local DB row — they exist only in the SDK.

```
GET /agent-sessions/:id/children
  → opencodeSessionMap.get(localId) → sdkId
  → opencodeClient.listChildren(sdkId)   ← SDK: returns child Session[]
  → HTTP 200 [child session summaries]

GET /agent-sessions/:id/children/:childSdkId/messages
  → (parent lookup — 404 if not found)
  → opencodeClient.listMessages(childSdkId)  ← child SDK id used directly
  → maps SDK Message[] → M1-2 structured shape (role: user→input, assistant→output)
  → HTTP 200 { messages: [...] }
```

Flutter: `TaskChip` (in parent transcript) gains `parentSessionId`/`parentSessionName` params. Tapping calls `AgentsController.openChildSession(...)` → fetches child messages → sets `activeChildSessionId` → `_TranscriptPanel` swaps to `ChildTranscriptView` (read-only, breadcrumb back, no composer). `closeChildSession()` clears state without refetching the parent.

### Known dead code
_(none — `pty_runner.ts` was deleted in PR #574/#571; confirmed zero references as of OPC-M1-4 / issue #688)_

### Known gaps
_(none — `resume()` creates a fresh SDK session and starts streaming; the "stub" note was stale as of OPC-M1-4 / issue #688 audit)_
