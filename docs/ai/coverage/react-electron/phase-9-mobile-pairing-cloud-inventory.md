# Phase 9 capability inventory — Flutter vs React/Electron

Reference: `origin/main` at `9fa2761ed78159f83f56982c03fcd85dc035039a` for Flutter. Candidate: the current `apps/web/src/` and `apps/electron/src/` worktree. Supporting API/mobile code is the current worktree. This is a capability inventory, not a test-declaration count.

## Missing capabilities — Flutter has them; React/Electron does not

1. **The packaged desktop owns the local API/mobile-gateway lifecycle.** Flutter locates and starts the bundled API server, injects the relay credential, waits for `/health`, and terminates the owned child on shutdown (`origin/main:apps/desktop_flutter/lib/app/core/server/api_server_service.dart:94`, `:115`, `:133`, `:183`, `:253`, `:298`, `:398`). Electron imports no process-spawn API and creates only the renderer window plus Google OAuth IPC (`apps/electron/src/main.mjs:1`, `:47`, `:54`, `:84`, `:138`); no React/Electron implementation was found that starts, supervises, or stops `api_server`/the engine. A packaged Electron install therefore cannot presently supply the desktop half of mobile pairing or continuity by itself.

2. **Desktop users can diagnose and enable Mobile Access.** Flutter exposes `missing | loggedOut | wrongTarget | healthy`, `canConfigure`, and `gatewayUrl`, calls `GET /mobile-gateway/access` and `POST /mobile-gateway/access/enable`, and renders enable/refresh/error states (`origin/main:apps/desktop_flutter/lib/features/agents/data/mobile_access_data_source.dart:9`, `:11`, `:151`, `:173`, `:183`; `origin/main:apps/desktop_flutter/lib/features/agents/views/mobile_access_dialog.dart:304`). React's renderer gateway exposes only `tasks` and `sessions` domains (`apps/web/src/gateway/index.ts:4`) and Electron's frozen preload bridge exposes only gateway base values and Google sign-in (`apps/electron/src/preload.cjs:9`). No React implementation of the access diagnostics/configuration surface was found.

3. **Desktop users can create, see, expire, and regenerate a one-time pairing QR.** Flutter requests a pairing offer, builds the exact QR payload from `gatewayUrl`, `pairingCode`, and optional `relayUrl`, renders a QR with a live expiry countdown, clears it at expiry or after a newly paired device appears, and offers regeneration (`origin/main:apps/desktop_flutter/lib/features/agents/data/mobile_access_data_source.dart:25`, `:47`, `:194`; `origin/main:apps/desktop_flutter/lib/features/agents/views/mobile_access_dialog.dart:44`, `:48`, `:86`, `:129`, `:250`, `:394`). No React/Electron pairing-code request, QR renderer, expiry timer, consumption dismissal, or regenerate control was found under `apps/web/src/` or `apps/electron/src/`.

4. **Desktop users can inspect and revoke the active paired device.** Flutter fetches `GET /mobile-gateway/devices`, models `id`, `name`, `createdAt`, and `revokedAt`, lists active devices, and calls `DELETE /mobile-gateway/devices/:id` (`origin/main:apps/desktop_flutter/lib/features/agents/data/mobile_access_data_source.dart:54`, `:225`, `:276`; `origin/main:apps/desktop_flutter/lib/features/agents/views/mobile_access_dialog.dart:263`, `:275`). No React/Electron device inventory or desktop revoke implementation was found. The phone can revoke itself, but that does not replace the missing desktop trust-administration capability (`apps/mobile/components/settings/paired-mac-section.tsx:113`; `apps/mobile/lib/pairing/paired-host-store.ts:1042`).

5. **Live desktop prompts survive a transient socket outage and reconnect automatically.** Flutter waits for actual socket readiness, queues up to 50 outbound frames rather than silently losing them, reconnects with exponential backoff, flushes the queue, and offers an explicit session rehydrate path (`origin/main:apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart:73`, `:77`, `:167`, `:181`, `:227`, `:241`, `:251`; `origin/main:apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart:2500`). React's live socket reports `error` but has no `close` handler, retry scheduler, post-open re-subscribe, or queue after the initial `CONNECTING` window (`apps/web/src/gateway/sessions.ts:168`). Its visible `reconnect()` behavior is fixture-only state mutation (`apps/web/src/store.tsx:341`, `:355`), while live mode only records `Session service unavailable` (`apps/web/src/store.tsx:151`, `:158`, `:210`).

6. **Live desktop file attachments cross the real prompt boundary and rehydrate as structured parts.** Flutter sends `parts` containing text plus file/image attachments and renders optimistic attachment chips; the server forwards the canonical parts array (`origin/main:apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart:2526`, `:2542`, `:2545`, `:2586`; `apps/api_server/src/services/ws_gateway.ts:288`). React accepts attachments in UI state but sends only `data` and optional `modelOverride`, omitting `parts` (`apps/web/src/store.tsx:278`, `:297`). Its REST mapper also maps every returned part to `kind: 'markdown'`, losing file/tool/reasoning identity (`apps/web/src/gateway/sessions.ts:77`, `:87`).

7. **Live desktop users can inspect and refresh the canonical session diff.** Flutter fetches `GET /agent-sessions/:id/diff`, keeps per-session loading/error/data state, and refreshes only the affected session on `session.diff` (`origin/main:apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart:716`; `origin/main:apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart:254`, `:645`, `:658`, `:684`). React's live session gateway has no diff method (`apps/web/src/gateway/sessions.ts:20`) and its live mapping hard-codes `artifacts: []` and no diff data (`apps/web/src/gateway/sessions.ts:94`). Fixture diff UI exists, but no live React implementation was found.

8. **Live desktop users can follow delegated child sessions without inventing new IDs.** Flutter preserves `parentSessionId` and `sdkSessionId`, links a persisted child to its normal session view, and falls back to fetching an engine child transcript while supporting nested breadcrumbs (`origin/main:apps/desktop_flutter/lib/features/agents/models/agent_session.dart:130`, `:139`, `:196`; `origin/main:apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart:1078`, `:1115`, `:1141`). React discards the relationship by forcing `childIds: []` and does not map `parentSessionId` (`apps/web/src/gateway/sessions.ts:94`, `:105`); no live child-session request/navigation implementation was found.

These are eight distinct user capabilities. The first four are the wholly absent desktop pairing role; the last four are continuity behaviors that already exist in shipping Flutter and at the API/mobile boundary but are not carried through the live React desktop.

## Capability-family detail

### 1. Desktop host readiness and Mobile Access entry

| Surface | Actual capability | Evidence |
|---|---|---|
| Flutter | Owns API startup/shutdown, readiness polling, relay bearer injection, and exposes Mobile Access from Settings even while the server is starting or failed. | `origin/main:apps/desktop_flutter/lib/app/core/server/api_server_service.dart:115`, `:133`, `:183`, `:253`, `:298`; `origin/main:apps/desktop_flutter/lib/features/settings/views/settings_view.dart:1139`, `:1146`, `:1218` |
| React/Electron | Reads externally supplied `RHYTHM_LIVE_API_URL`, `RHYTHM_LIVE_ENGINE_URL`, and `RHYTHM_LIVE_TOKEN`; it neither owns those services nor exposes a Mobile Access domain. | `apps/electron/src/preload.cjs:9`; `apps/web/src/gateway/index.ts:24`, `:64` |
| Result | **Missing in React/Electron:** owned service lifecycle and the Mobile Access diagnostics/configuration entry. | Missing capabilities 1–2. |

### 2. Pairing offer and phone acceptance

Flutter creates the offer only after the access state is `healthy`, renders the QR/countdown, and polls the device list so successful consumption removes the offer (`origin/main:apps/desktop_flutter/lib/features/agents/views/mobile_access_dialog.dart:117`, `:129`, `:250`, `:405`). The API creates a 32-byte base64url secret with a five-minute default TTL, persists only its SHA-256 verifier, checks `hostId`, expiry, and one-time consumption, then returns a new device credential (`apps/api_server/src/services/mobile_pairing_service.ts:65`, `:68`, `:75`, `:83`, `:96`, `:108`, `:116`, `:122`, `:126`, `:129`).

The phone strictly parses only `gatewayUrl`, `pairingCode`, and optional `relayUrl`; preflights `/mobile-gateway/health`; checks the advertised protocol fingerprint/features; posts `pairingCode`, the observed `hostId`, and `deviceName`; verifies the response came from the same host/account; and persists the token separately from non-secret host metadata (`apps/mobile/lib/pairing/paired-host-store.ts:61`, `:197`, `:247`, `:694`, `:728`, `:762`, `:835`, `:842`, `:854`, `:869`). The scan/manual-input surface is implemented on mobile (`apps/mobile/app/pair.tsx:41`, `:93`, `:135`, `:180`).

React/Electron has no desktop offer producer or renderer. Therefore the existing phone and API code cannot be reached through the candidate packaged desktop.

### 3. Device trust, replacement, and revocation

The server stores verifier-only device credentials and authenticates only non-revoked records using timing-safe comparison (`apps/api_server/src/services/mobile_pairing_service.ts:127`, `:136`, `:168`, `:175`). `Authorization: Device <token>` is a distinct trust scheme from cloud bearer auth (`apps/api_server/src/middleware/mobile_device_auth.ts:26`, `:31`; `apps/mobile/lib/transport/paired-mac-client.ts:4`). Desktop/session users may list devices; desktop or the same device may revoke, while a device cannot revoke another device (`apps/api_server/src/routes/mobile_gateway_routes.ts:107`, `:114`; `apps/api_server/src/controllers/mobile_gateway_controller.ts:81`). Pair/revoke mutations replicate a replace-all verifier snapshot to the relay (`apps/api_server/src/services/mobile_pairing_service.ts:8`, `:144`, `:168`).

Mobile implements explicit replacement confirmation and rollback: it refuses silent host/account replacement, revokes a newly created device if validation or storage fails, restores the prior credential/metadata when possible, and does not claim success if the old Mac could not be revoked (`apps/mobile/app/pair.tsx:50`; `apps/mobile/lib/pairing/paired-host-store.ts:742`, `:791`, `:813`, `:869`, `:938`). It also distinguishes remote revoke from local Forget (`apps/mobile/components/settings/paired-mac-section.tsx:113`, `:123`; `apps/mobile/lib/pairing/paired-host-store.ts:1042`, `:1097`).

React/Electron has no desktop device-trust surface, so staff cannot inspect or revoke from the replacement desktop client.

### 4. Paired/cloud transport and recovery

The QR carries both the direct `.ts.net` `gatewayUrl` and optional exact configured `relayUrl`; the phone chooses relay first while retaining the direct base for transports that need it (`origin/main:apps/desktop_flutter/lib/features/agents/data/mobile_access_data_source.dart:41`; `apps/mobile/lib/pairing/paired-host-store.ts:182`; `apps/mobile/lib/transport/paired-mac-client.ts:26`, `:165`). Every paired request resolves the current SecureStore device token and emits `Authorization: Device <token>` without putting it in a URL (`apps/mobile/lib/transport/paired-mac-client.ts:46`, `:78`, `:184`). Project-scoped PTY connections also send `X-Rhythm-Project-ID` (`apps/mobile/lib/transport/paired-mac-client.ts:189`).

On restore/foreground and on a bounded backoff schedule, mobile probes health, can adopt the configured relay without re-pairing, refreshes the compatibility tuple, preserves saved host metadata while the phone is offline, and clears the credential after a 401 revoke (`apps/mobile/lib/pairing/paired-host-store.ts:501`, `:550`, `:589`, `:624`, `:647`; `apps/mobile/providers/paired-host-provider.tsx:143`, `:164`, `:175`).

React desktop's live gateway is loopback-only and externally configured (`apps/web/src/gateway/index.ts:39`, `:41`; `apps/web/src/gateway/sessions.ts:149`, `:169`). That is valid for its own local renderer traffic, but it is not the paired/cloud desktop-host transport and does not replace Flutter's pairing role.

### 5. Project scope and non-disclosing authorization

The API lists only active registered projects with usable canonical roots and returns only `{id, name, icon}`; roots never cross the phone boundary (`apps/api_server/src/services/mobile_project_scope.ts:25`, `:44`, `:71`). Scoped operations require `X-Rhythm-Project-ID`, resolve the root from the repository row, reject caller root overrides, and canonicalize operation paths inside that root (`apps/api_server/src/services/mobile_project_scope.ts:49`, `:101`, `:124`, `:184`, `:213`). Missing/archived/unusable projects collapse to `Mobile project` not-found (`apps/api_server/src/services/mobile_project_scope.ts:40`, `:57`).

Routes apply device authentication and project scope to project preflight, profile catalog, session state, SSE, artifacts, tools, and the OpenCode proxy (`apps/api_server/src/routes/mobile_gateway_routes.ts:182`, `:194`, `:211`, `:225`, `:236`, `:374`, `:390`, `:395`). The mobile client uses the exact header for session create, profile list, session-state update, and PTY (`apps/mobile/providers/services/mobile-gateway-service.ts:11`, `:65`, `:141`, `:159`; `apps/mobile/lib/transport/paired-mac-client.ts:189`).

Session discovery is owner-aware: project-scoped lists require exact `owner_user_id` and `project_id`; projectless rows appear only in owner-unscoped discovery and remain bound to the caller's owner identity (`apps/api_server/src/services/mobile_chat_catalog.ts:136`, `:156`, `:171`, `:196`). Child discovery requires the same owner, project, and parent SDK ID (`apps/api_server/src/services/mobile_chat_catalog.ts:207`). External `session.share` and `session.unshare` are explicitly disallowed by the generated mobile operation manifest, and failures are shaped through the safe mobile error handler (`apps/api_server/src/services/mobile_opencode_operations.generated.ts:99`, `:105`; `apps/api_server/src/routes/mobile_gateway_routes.ts:431`).

This family is substantially implemented in API/mobile. The Phase 9 contract must prove it live with two projects and two identities; source presence alone is not acceptance.

### 6. Desktop/mobile session continuity

The canonical persisted desktop record has separate local `id` and `sdkSessionId`, explicit `profileId` versus `opencodeAgentId`, owner/project/parent bindings, and one shared status and permission vocabulary (`apps/api_server/src/models/agent_session.ts:22`, `:24`, `:46`, `:50`, `:80`, `:86`, `:92`, `:108`, `:126`). The mobile gateway decorates engine-shaped sessions with a `rhythm` execution state instead of inventing a new role or identity (`apps/api_server/src/services/mobile_profile_catalog.ts:34`, `:87`; `apps/api_server/src/services/mobile_opencode_proxy.ts:336`, `:344`). Mobile's provider uses the engine `Session` plus that same execution state and supports prompts, attachments, diffs, children, reload, and session opening (`apps/mobile/providers/opencode-provider-types.ts:65`, `:138`, `:148`, `:186`, `:194`, `:208`, `:211`, `:217`).

React live mode does retain the selected local desktop session ID in localStorage and refetches list/detail on renderer reload (`apps/web/src/store.tsx:141`, `:151`, `:213`). It can create/list/detail/delete sessions and stream basic text/status events (`apps/web/src/gateway/sessions.ts:149`; `apps/web/src/store.tsx:159`, `:250`, `:278`). Those are real capabilities, not gaps.

However, the React mapper collapses structured parts and discards child/artifact relationships, the prompt frame drops attachments, and the socket has no reconnect/re-subscribe lifecycle (`apps/web/src/gateway/sessions.ts:77`, `:94`, `:168`; `apps/web/src/store.tsx:278`). Thus reload of basic text works, but attachment/diff/child continuity and outage recovery do not.

### 7. Restart, expiry, and isolation cleanup

Intended durable state is narrowly split: the server persists only pairing/device verifiers and timestamps; the phone persists non-secret `PairedHost` metadata in AsyncStorage and one device token in SecureStore (`apps/api_server/src/repositories/mobile_devices_repository.ts:3`, `:13`, `:47`; `apps/mobile/lib/pairing/paired-host-store.ts:9`, `:35`, `:437`, `:869`). Pairing codes are one-time and expiring, revoke immediately excludes a device from authentication, and relay snapshots refresh on mutations/reconnect (`apps/api_server/src/services/mobile_pairing_service.ts:108`, `:122`, `:129`, `:142`, `:175`; `:8`).

Phase 9 must test independent readiness windows and cleanup beyond SQL: gateway listeners, device/pairing records created by the test, engine sessions, worktrees, branches, attachment files, phone-side metadata/credential fixtures, and packaged Electron child processes. No existing source inspection proves that multi-process cleanup contract. Electron currently owns no child process, which is itself missing capability 1 rather than a cleanup pass.

## Canonical persisted and API vocabulary

The names below come from type/interface declarations or protocol handlers, never display copy.

| Boundary | Canonical field/value shape | Declaration evidence |
|---|---|---|
| Pairing QR payload | `{ gatewayUrl: string, pairingCode: string, relayUrl?: string | null }` | `origin/main:apps/desktop_flutter/lib/features/agents/data/mobile_access_data_source.dart:47`; `apps/mobile/lib/pairing/paired-host-store.ts:61` |
| Pairing offer response | `{ id: string, hostId: string, pairingCode: string, expiresAt: string, relayUrl?: string }` | `apps/api_server/src/services/mobile_pairing_service.ts:68`; `apps/api_server/src/controllers/mobile_gateway_controller.ts:41` |
| Pair request | `{ pairingCode: string, hostId: string, deviceName: string }` | `apps/api_server/src/services/mobile_pairing_service.ts:96`; `apps/mobile/lib/pairing/paired-host-store.ts:762` |
| Pair response / compatibility | `{ deviceId, hostId, userId, deviceToken, gatewayVersion, rhythmVersion, opencodeVersion, contractFingerprint, features, minimumMobileVersion, relayUrl? }` | `apps/api_server/src/services/mobile_pairing_service.ts:96`; `apps/mobile/lib/pairing/paired-host-store.ts:74` |
| Pairing-code persisted record | `{ id, hostId, userId, codeVerifier, expiresAt, consumedAt, createdAt }` | `apps/api_server/src/repositories/mobile_devices_repository.ts:3` |
| Paired-device persisted record | `{ id, hostId, userId, name, tokenVerifier, revokedAt, createdAt }` | `apps/api_server/src/repositories/mobile_devices_repository.ts:13` |
| Phone persisted non-secret host metadata | `{ rhythmUserId, gatewayUrl, relayUrl?, deviceId, hostId, deviceName, gatewayVersion, rhythmVersion, opencodeVersion, contractFingerprint, minimumMobileVersion, features, pairedAt, recovery? }` | `apps/mobile/lib/pairing/paired-host-store.ts:35` |
| Phone secret/storage keys | device token at `rhythm.paired.device`; metadata at `rhythm.paired.host.meta` | `apps/mobile/lib/pairing/paired-host-store.ts:9` |
| Paired-host state | `'unpaired' | 'pairing' | 'connected' | 'offline' | 'tailscaleUnavailable' | 'accountMismatch' | 'revoked' | 'incompatible' | 'unhealthy'` | `apps/mobile/lib/pairing/paired-host-store.ts:24` |
| Desktop access state | `'missing' | 'loggedOut' | 'wrongTarget' | 'healthy'` plus `message`, `canConfigure`, `gatewayUrl?` | `origin/main:apps/desktop_flutter/lib/features/agents/data/mobile_access_data_source.dart:9`, `:11` |
| Auth schemes | desktop/cloud: `Authorization: Bearer <sessionToken>`; paired device: `Authorization: Device <deviceToken>` | `apps/api_server/src/middleware/mobile_device_auth.ts:31`, `:62`; `apps/mobile/lib/transport/paired-mac-client.ts:4` |
| Project selection | header `X-Rhythm-Project-ID`; scope `{ id: string, root: string }`; public catalog `{ id, name, icon }`; preflight response `{ projectId, path }` | `apps/api_server/src/services/mobile_project_scope.ts:14`, `:25`, `:184`, `:230` |
| Profile catalog | `{ profiles: [{ profileId, opencodeAgentId, name, defaults: { providerId, modelId, reasoningEffort, approvalMode }, display: { icon, color } }] }` | `apps/api_server/src/services/mobile_profile_catalog.ts:9`, `:25` |
| Session execution state | `{ localSessionId, profileId, opencodeAgentId, profileAvailability, providerId, modelId, thinkingBudget, permissionMode }` | `apps/api_server/src/services/mobile_profile_catalog.ts:29`, `:34`; `apps/mobile/providers/opencode-provider-utils.ts:60`, `:65` |
| Session identity/continuity | local `id`; engine `sdkSessionId`; `projectId`; `ownerUserId`; `parentSessionId`; `profileId`; `opencodeAgentId` | `apps/api_server/src/models/agent_session.ts:46`, `:50`, `:80`, `:86`, `:108`, `:126` |
| Session status | `'starting' | 'working' | 'idle' | 'resumable' | 'closed' | 'error'` | `apps/api_server/src/models/agent_session.ts:22` |
| Permission mode | `'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'` | `apps/api_server/src/models/agent_session.ts:24` |
| Stored transcript role/parts | role `'output' | 'input' | 'system'`; structured message exposes ordered `parts: unknown[]`, `tokens`, and `cost` | `apps/api_server/src/models/agent_session.ts:154`, `:175` |
| Desktop input frame | `{ v: 1, type: 'session.input', id: localSessionId, data?: string, parts?: Part[], modelOverride?, thinking?, fastMode?, agent? }`; file parts use `type`, `mime`, `filename`, `url` | `apps/api_server/src/services/ws_gateway.ts:20`, `:288`, `:310`, `:353`, `:358`, `:363`; `origin/main:apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart:2542` |
| Mobile chat catalog IDs | engine-shaped `id` is `sdk_session_id`; child edge is `parentID`; project fields are `projectId`, `projectName`; execution metadata is nested under `rhythm` | `apps/api_server/src/services/mobile_chat_catalog.ts:22`, `:103` |
| Compatibility features | `'pairing'`, `'device-revocation'`, `'project-scope'`, `'opencode-http-proxy'`, `'opencode-sse-proxy'`, `'opencode-pty-proxy'` | `apps/api_server/src/services/mobile_pairing_service.ts:21` |

## Contract consequences

- A Phase 9 pass must not accept a fixture-only QR or an externally started development server as proof of the packaged desktop role.
- `hostId` is the canonical host fingerprint/identity value. The phone must display/confirm that value (or a deterministic non-secret rendering derived from it); a hostname display string is not a substitute.
- Desktop local IDs remain `AgentSession.id`; phone/OpenCode catalog IDs remain `sdkSessionId`/engine `id`. Continuity must prove the server mapping rather than equating the strings.
- `profileId` and `opencodeAgentId` are different namespaces. No test may substitute one for the other.
- Project scope is the opaque `X-Rhythm-Project-ID`, never a caller-provided root or `cwd` override.
- Cleanup evidence must enumerate listeners, phone credentials/metadata, pairing/device rows, engine sessions, worktrees, branches, and files; zero SQL rows alone is insufficient.
