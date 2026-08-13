# Plan: Synology Relay for Mobile (always-on reads, tunneled writes, live streams)

**Status:** approved direction, not yet implemented
**Decided with AJ 2026-08-12:** separate relay container · path routing at `https://api.vcrcapps.com/relay` · replicate device verifiers (no re-pair) · full scope (live relay + offline reads + artifacts). Deferred write queue is explicitly OUT of scope.
**Prerequisite:** PRs #1384 (`mobile/sqlite-mirror`) and #1386 (`mobile/mirror-event-fanout`) merged to `main`. This plan builds on both — the mirror readers come from #1384, the event hub from #1386. Branch each phase off post-merge `main`.

---

## 1. Architecture summary

```
Phone ──(only endpoint: https://api.vcrcapps.com/relay, Device token)──────┐
   reads (sessions/transcripts) → relay's own SQLite mirror                │
   live stream (SSE)            → relay-local event hub                    │
   writes + everything else     → RPC-tunneled down the uplink             │
                                                                           │
rhythm-relay container (NAS)  ◄══ ONE outbound WebSocket ══  Mac api_server
   ▲ events channel: engine-shaped envelopes, byte-verbatim, no replay
   ▲ repl channel:   seq-ordered mirror row changes (replayed after gaps)
   ▲ file channel:   artifact push-on-produce
   ▼ rpc channel:    forwarded HTTP requests (writes, memories, profiles…)
   ▼/▲ ctrl channel: hello/health/acks/resync/presence

Mac (unchanged core): engine :4096 → OpencodeStreamBridge → mirror → hub
```

**Invariants that must hold (do not violate in any step):**

1. **Byte-transparent envelopes.** The `{directory, payload}` envelope the phone receives from the relay must be byte-identical to what `MobileSseProxy` sends today. The phone gates on exact-equality of `gatewayVersion`/`opencodeVersion`/`contractFingerprint` (`apps/mobile/lib/pairing/paired-host-store.ts:12-22,182-205`).
2. **Single writer.** Only the Mac mutates mirror rows. The relay applies replicated rows verbatim; phone "writes" are commands tunneled to the Mac. Never write agent tables on the relay outside the replication applier.
3. **Catch-up ≥ stream.** A phone that reconnects to the relay must read state at-least-as-fresh as the last envelope it received. Guaranteed by: (a) row changes and envelopes travel the same ordered WebSocket, rows emitted first (mirroring the Mac's persist-before-publish, `opencode_stream_bridge.ts:800-804`); (b) after an uplink gap resync, the relay force-closes phone SSE connections so clients run their existing reconnect-refresh.
4. **Envelopes are never replayed; rows always are.** Phones already tolerate missed envelopes (they refresh on reconnect — decision doc `docs/ai/decisions/2026-08-11-mobile-event-fanout-hub.md`). Rows are the durable record, so they get the seq/outbox treatment.
5. **Timestamp normalization.** The relay serves reads through the same repositories/readers as the Mac (`toUtcIsoInstant`, `agent_session_messages_repository.ts:59-70`), so replicated rows must be stored byte-verbatim (no reformatting) and normalized only on read, same as today.

**Out of scope (do not build):** deferred write queue (prompt-while-Mac-asleep); PTY/terminal over the relay (relay returns 501, phone falls back to the direct `.ts.net` path — see S1.11); multi-Mac-per-user (protocol is keyed by `userId` + `machineId` so it can be added later); delta-compression of tool output on the uplink (known bandwidth ceiling, documented, not needed now).

---

## 2. Uplink protocol (implement exactly this)

One WebSocket, Mac dials relay. JSON text frames: `{"ch": <channel>, "t": <type>, ...}`. Binary is only used on the `file` channel (length-prefixed chunks are fine as base64 in JSON for v1 — simpler, artifacts are capped).

| ch | t | direction | payload |
|---|---|---|---|
| ctrl | hello | Mac→relay | `{userId, machineId, health}` — `health` is the Mac's full `/mobile-gateway/health` response body, verbatim |
| ctrl | health | Mac→relay | updated health body (send on any change, e.g. engine restart) |
| ctrl | resync | relay→Mac | `{sinceSeq}` — relay's last applied repl seq (0 on first connect) |
| ctrl | resync-done | Mac→relay | `{throughSeq}` — outbox replay complete, live tail follows |
| ctrl | ack | relay→Mac | `{seq}` — cumulative; Mac may prune outbox ≤ seq |
| repl | row | Mac→relay | `{seq, table, op: "upsert"\|"delete", pk, row}` — `row` is the full row as stored (verbatim strings), absent for delete |
| repl | devices | Mac→relay | `{rows: [...]}` — full `mobile_devices` snapshot (tiny table); relay replaces-all in one transaction |
| events | env | Mac→relay | `{envelope}` — the exact `{directory, payload}` object the hub publishes |
| rpc | req | relay→Mac | `{id, method, path, headers, bodyB64}` — `path` already has the `/relay` prefix stripped, starts with `/mobile-gateway/` |
| rpc | res | Mac→relay | `{id, status, headers, bodyB64}` |
| file | artifact | Mac→relay | `{artifactId, meta, dataB64}` (single frame ≤ 8 MB after encode; larger artifacts are skipped and served via rpc on demand) |

Auth: the Mac opens the WS with `Authorization: Bearer <cloud session token>` (the same token `AgentTriggerWatcher` uses). The relay validates it against prod `/auth/me` using the existing pattern in `apps/api_server/src/services/mobile_cloud_identity_service.ts:64-99` and binds the connection to that `userId`. One live uplink per user: a new hello closes the previous socket.

Reconnect: Mac side uses exponential backoff 1s→60s over an **ordered candidate list** (`RHYTHM_RELAY_URLS`, LAN first — this is what keeps same-LAN traffic off Cloudflare). Relay side: on uplink drop, mark `macOnline=false`; on resync-done, force-close all phone SSE connections for that user.

---

## 3. Phase 0 — plumbing (small PR, no behavior change for existing users)

### S0.1 Add the `relay` role
- **File:** `apps/api_server/src/config/env.ts`
- At the `RHYTHM_ROLE` parser (lines 24-38): extend the union `all|local|cloud` with `relay`.
- At line 334 (`agentExecutionEnabled = role !== 'cloud'`): change to `role !== 'cloud' && role !== 'relay'` (relay must never spawn the engine, scheduler, or Chrome).
- Add exported flags: `isRelayRole = role === 'relay'`, and env parsing for `RHYTHM_RELAY_URLS` (comma-separated, Mac side, default empty = uplink disabled) near the other RHYTHM_* vars.
- **Check:** existing env tests still pass; new unit test asserts `relay` role disables `agentExecutionEnabled`.

### S0.2 Skip Mac-only startup on relay role
- **File:** `apps/api_server/src/server.ts`
- The role gates at lines 147-160 and 483-485 (scheduler / opencode spawn / WS gateway / managed Chrome skipped on cloud) must also skip on relay. The mobile-gateway second server on 127.0.0.1:4002 (lines 467-479, 759-765) must NOT start on relay (the relay serves phones on its main port instead).
- **Check:** `RHYTHM_ROLE=relay npm run dev` boots with no engine spawn attempt, `/health` responds.

### S0.3 Relay router skeleton mounted at `/relay`
- **New file:** `apps/api_server/src/routes/relay_gateway_routes.ts` — Express router; for Phase 0 it serves only `GET /relay/health` → `{status:'ok', role:'relay', macOnline:false}`.
- **File:** `apps/api_server/src/app.ts` — mount it OUTSIDE the `agentExecutionEnabled` block (lines 177-272), gated on `env.isRelayRole` only. Nothing else from the agent block runs on relay.
- **Check:** supertest hits `/relay/health` on a relay-role app; a cloud-role app 404s it.

### S0.4 Compose service + tunnel path
- **File:** `apps/api_server/docker-compose.synology.yml` — add service `rhythm-relay`: same image `ghcr.io/ajhochy/rhythm-api:main`, `env_file: .env.relay`, volume `rhythm_relay_data:/data`, host port map `4010:4000` (LAN uplink candidate), Watchtower label same as rhythm-api.
- **New file:** `apps/api_server/.env.relay.example` — `RHYTHM_ROLE=relay`, `DB_CLIENT=sqlite`, `DB_PATH=/data/relay.db`, `RHYTHM_CLOUD_API_URL=https://api.vcrcapps.com`, `LIVE_ARTIFACT_STORAGE_DIR=/data/relay-artifacts`.
- **Manual deploy step (document in runbook, S0.5):** in the Cloudflare Zero Trust dashboard, add a public-hostname ingress entry `api.vcrcapps.com` path `/relay*` → `http://rhythm-relay:4000`, ABOVE the existing catch-all to `rhythm-api`. Verify SSE is not buffered (see smoke S4.2).
- **Check:** `curl https://api.vcrcapps.com/relay/health` returns the relay payload, and `curl http://<nas-lan-ip>:4010/relay/health` works on LAN.

### S0.5 Runbook
- **File:** `docs/release/hosted_deployment_synology_cloudflare.md` — add a "Relay container" section: compose service, env file, tunnel path rule, LAN port, and the verification curls above.

---

## 4. Phase 1 — uplink, live relay, tunneled writes (phone works via relay while Mac is online)

### S1.1 Mac-side uplink client
- **New file:** `apps/api_server/src/services/relay_uplink_client.ts`
- Class `RelayUplinkClient` started from `server.ts` (non-cloud, non-relay roles only) when `env.relayUrls.length > 0`. Uses the `ws` package (already a dependency — the WS gateway uses it).
- Responsibilities: dial candidates in order; send `ctrl/hello` with `{userId, machineId, health}` — health obtained by calling the local gateway's health handler (self-HTTP `GET http://127.0.0.1:4002/mobile-gateway/health` is acceptable and reuses all logic); resend `ctrl/health` when the bridge reconnects to the engine (subscribe to the same signal that flips `opencodeEventHub.setLive`).
- Bearer source: reuse however `AgentTriggerWatcher`'s desktop token reaches api_server — if none exists server-side, add env `RHYTHM_RELAY_BEARER` and document that Settings will populate it later; do NOT invent a new auth scheme.
- **Check:** unit test with a mock WS server asserting hello/health frames and candidate-order failover.

### S1.2 Forward hub envelopes up the uplink
- **File:** `apps/api_server/src/services/relay_uplink_client.ts` (+ read-only touch of `apps/api_server/src/services/opencode_event_hub.ts`)
- Subscribe to `opencodeEventHub` exactly like `MobileSseProxy` does (`mobile_sse_proxy.ts:406-415`), with a deeper bounded queue: `maxQueue: 4096` (the uplink is one subscriber carrying all phones; the default 512 in `opencode_event_hub.ts:32` is per-phone-sized). On overflow the hub closes the subscription — the client must resubscribe and treat it like a reconnect (rows unaffected; envelopes lossy by design).
- Send each envelope as `events/env`, object passed through verbatim — no reshaping, no field reordering (Invariant 1).
- **Check:** unit test: publish N envelopes to the hub, assert byte-identical JSON arrives on the mock relay socket.

### S1.3 RPC dispatch on the Mac
- **File:** `apps/api_server/src/services/relay_uplink_client.ts`
- On `rpc/req`: replay the request against `http://127.0.0.1:4002<path>` with the forwarded method/headers/body, 30s timeout, then answer `rpc/res`. Forward `Authorization` and `X-Rhythm-Project-ID` headers untouched — the existing device-auth and project-scope middleware (`mobile_gateway_routes.ts:313-327`) then applies unchanged, which is the whole point: zero new authz code on the Mac.
- Cap in-flight RPCs (16) and body size (match the gateway's existing limit in `mobile_opencode_proxy.ts`).
- **Check:** integration test: fake relay sends an `rpc/req` for `GET /mobile-gateway/projects`; response matches a direct local call.

### S1.4 Relay-side uplink server
- **New file:** `apps/api_server/src/services/relay_uplink_server.ts`
- WS upgrade handler on the relay's main HTTP server at path `/relay/uplink` (wire the upgrade in `server.ts` next to the existing PTY upgrade pattern, lines 470-479). Validate bearer via the `mobile_cloud_identity_service` pattern against `env.RHYTHM_CLOUD_API_URL`. Track `{userId → connection, health, macOnline}`. Handle `ctrl/hello`, `ctrl/health`, `events/env`, `repl/*`, `rpc/res`, `file/artifact`.
- **Check:** unit tests for auth rejection (bad bearer → 401 close), duplicate-hello supersession, and health caching.

### S1.5 Device-verifier replication (snapshot model)
- **Mac file:** `apps/api_server/src/services/mobile_pairing_service.ts` — after any mutation of the devices table (pairing completion ~line 113-122, revocation), call `relayUplinkClient.sendDevicesSnapshot()`; also send one snapshot right after `ctrl/hello`. Snapshot = full `mobile_devices` table (and its project-scope table if scope rows live separately — replicate both, same frame).
- **Relay file:** `relay_uplink_server.ts` — on `repl/devices`, replace-all rows in one transaction in the relay's SQLite (tables already exist — `runMigrations()` creates the full schema on the relay's empty DB).
- **Check:** test: pair→snapshot→revoke→snapshot; relay DB matches Mac DB after each.

### S1.6 Relay-side device auth middleware
- **File:** `apps/api_server/src/routes/relay_gateway_routes.ts`
- Reuse `mobile_pairing_service.authenticateDevice` — it reads via `getDb()` so on the relay it transparently checks the replicated verifiers. Same `Authorization: Device <token>` scheme, same sha256 verifier comparison. Mount it on everything under `/relay/mobile-gateway/*`.
- **Check:** valid replicated device token passes; unknown/revoked token 401s.

### S1.7 Relay health with fingerprint passthrough
- **File:** `apps/api_server/src/routes/relay_gateway_routes.ts`
- `GET /relay/mobile-gateway/health`: return the cached health body from `ctrl/hello|health` **verbatim**, with exactly one added field: `macOnline: boolean`. If no uplink has ever connected: 503 `{error:'no_uplink'}`. Never synthesize `gatewayVersion`/`opencodeVersion`/`contractFingerprint`/`features` (Invariant 1).
- **Check:** test asserts deep-equality of passthrough fields against the hello payload.

### S1.8 Relay-side event hub + phone SSE
- **Files:** `relay_uplink_server.ts` + `relay_gateway_routes.ts`
- Instantiate a second `OpencodeEventHub` (the class in `opencode_event_hub.ts` — export the class, keep the module singleton for the Mac path). `events/env` frames publish into it; `setLive(true)` on hello, `false` on uplink drop.
- `GET /relay/mobile-gateway/events` and `/relay/mobile-gateway/sessions/:id/events`: port the hub-consumption + `deliver()` logic from `MobileSseProxy` (`mobile_sse_proxy.ts:406-415, 587-640`) — extract `deliver()`'s scoping/dedupe/shaping into a shared helper if cleaner, or instantiate `MobileSseProxy` with the relay hub and **no engine fallback** (the per-device engine-dial fallback at :445-504 must be unreachable on the relay — there is no 127.0.0.1:4096 there). Owner/project scoping (`mobileSseEventBelongsToOwner`) works once Phase 2 replicates session rows; in Phase 1, scope by device→project binding from the replicated device rows and drop envelopes whose directory can't be resolved (fail closed, same as today).
- **Check:** integration test: envelope in on uplink → SSE frame out to a subscribed fake phone, byte-identical payload.

### S1.9 Tunnel everything else
- **File:** `apps/api_server/src/routes/relay_gateway_routes.ts`
- Catch-all `router.all('/relay/mobile-gateway/*')` (after health/events routes): if `macOnline`, forward as `rpc/req` with the `/relay` prefix stripped; else 503 `{error:'mac_offline'}` immediately (this is the fast, honest failure the phone turns into an offline banner). Streamed responses are not supported on this path — the only streaming endpoints are events (S1.8) and PTY (S1.11).
- **Check:** e2e-style test through fake uplink: `POST /relay/mobile-gateway/opencode/session/:id/prompt_async` reaches a stub Mac handler and the response round-trips.

### S1.10 Phone: accept the relay URL + transport preference
- **File:** `apps/mobile/lib/pairing/paired-host-store.ts`
  - `safeGatewayUrl` (:108-135): keep the `.ts.net` bare-origin rule unchanged; add a second accepted form — exact string match against the relay base `https://api.vcrcapps.com/relay` (constant, overridable by `EXPO_PUBLIC_RHYTHM_RELAY_URL` for dev). Note this form carries a path; do not strip it.
  - Store an optional `relayUrl` alongside `gatewayUrl` in the paired-host record; selection order: relay first when present, `.ts.net` as fallback.
- **File:** `apps/mobile/lib/transport/paired-mac-client.ts` — audit every URL builder (request base, `sseUrl`/`ptyUrl` at :134-176) to join paths against a base that may itself contain a path (use `new URL(path, base + '/')`-style joining, not origin concatenation).
- **Files:** `apps/api_server/src/services/mobile_pairing_service.ts` + the phone pairing screen — include `relayUrl` in the pairing payload/QR when the Mac has `RHYTHM_RELAY_URLS` configured; phone persists it. For already-paired phones, also return `relayUrl` from `/mobile-gateway/health` so existing pairings adopt the relay on their next health check without re-pairing.
- **Check:** unit tests for `safeGatewayUrl` acceptance matrix; existing `.ts.net` tests unchanged.

### S1.11 PTY: explicit non-goal marker
- **File:** `apps/api_server/src/routes/relay_gateway_routes.ts` — the PTY connect path returns 501 `{error:'pty_requires_direct_connection'}`.
- **File:** phone terminal service (`apps/mobile/providers/services/terminal-service.ts:48`) — when transport is relay and PTY connect gets 501, retry once via the stored `.ts.net` URL if present, else surface "Terminal needs direct connection".
- `// ponytail: PTY over the uplink = WS-in-WS tunneling; add only if phone terminal usage over relay is actually demanded.`

**Phase 1 milestone check (manual smoke, real phone):** phone on LTE, no Tailscale: pair status green via relay, session list loads (tunneled), send prompt, watch live stream, approve a permission. Kill the Mac's network → phone shows offline within seconds (health `macOnline:false` / SSE drop).

---

## 5. Phase 2 — mirror replication + offline reads (browse with the Mac asleep)

### S2.1 Outbox table + writer on the Mac
- **File:** `apps/api_server/src/database/migrations.ts` — new pragma-guarded table:
  `relay_outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, op TEXT NOT NULL, pk TEXT NOT NULL, row_json TEXT, created_at TEXT DEFAULT (datetime('now')))`.
- **New file:** `apps/api_server/src/repositories/relay_outbox_repository.ts` — `append(tbl, op, pk, row)`, `listSince(seq, limit)`, `pruneThrough(seq)`.
- **Hook points (call `append` inside the same better-sqlite3 transaction as the mirror write):**
  - `agent_session_messages_repository.ts`: `upsertStructured` (:167), `upsertMessageInfo` (:229), `upsertPart` (:274), `deleteBySdkMessageId` → op delete. **NOT `applyPartDelta` (:337)** — per-token outbox writes would double hot-path volume; relay transcript text converges at the next full-part flush. `// ponytail: deltas excluded from replication; relay mid-stream reads lag until part flush, final state identical.`
  - `agent_sessions_repository.ts`: `reconcileMobileSession` (:542) and every other agent_sessions insert/update used by the bridge session handlers (`opencode_stream_bridge.ts:1725-1801` — enumerate the repo methods those call and hook each).
- Row payload = the exact stored row (SELECT after write), strings verbatim (Invariant 5).
- **Check:** unit test — each hooked method produces exactly one outbox row whose `row_json` round-trips to the stored row; `applyPartDelta` produces none.

### S2.2 Uplink: repl streaming + resync
- **File:** `apps/api_server/src/services/relay_uplink_client.ts`
- Live tail: after each hooked write, drain new outbox rows in seq order onto the socket **before** any envelope produced by the same bridge event (emit rows first — Invariant 3; simplest correct implementation: the bridge's ingest loop calls `uplink.flushOutbox()` between `_relayEvent` and `_publishToHub`, i.e. around `opencode_stream_bridge.ts:800-804`).
- On `ctrl/resync {sinceSeq}`: stream `listSince(sinceSeq)` in batches (500 rows/frame), then `ctrl/resync-done`, then resume live. On `ctrl/ack {seq}`: `pruneThrough(seq)`.
- **Check:** test — kill/restore mock relay mid-stream; relay-side applied rows equal Mac rows; outbox pruned after ack.

### S2.3 Relay-side applier
- **File:** `apps/api_server/src/services/relay_uplink_server.ts`
- Apply `repl/row` in seq order, transactionally, idempotently (upsert by pk / delete by pk); persist `last_applied_seq` in a one-row `relay_sync_state` table (add to migrations, same guard style); send cumulative `ctrl/ack` every 100 rows or 2s. After `resync-done`, force-close all phone SSE connections for that user (Invariant 3b).
- **Check:** replay-the-same-batch-twice test → identical DB state (idempotence).

### S2.4 Serve mirror reads on the relay
- **File:** `apps/api_server/src/routes/relay_gateway_routes.ts`
- Before the rpc catch-all, route the three mirror-served operations through #1384's readers (`apps/api_server/src/services/mobile_mirror_reads.ts` — `readMirrorSessionList`, `readMirrorSessionChildren`, `readMirrorTranscript`), which work unchanged on the relay DB because they go through `getDb()`. Fall-through changes: reader returns null → if `macOnline`, tunnel via rpc (same as today's live fallback, just remote); else 503 `{error:'mac_offline_and_mirror_incomplete'}`.
- Response headers must match the Mac's mirror-serving path (including `x-next-cursor`) so the phone can't tell who answered.
- **Check:** contract test comparing relay-served vs Mac-served responses for the same seeded rows.

### S2.5 Phone: offline browsing UX
- **File:** `apps/mobile/providers/opencode-provider.tsx` — treat `macOnline:false` in health as a banner state, not an error: reads proceed (relay mirror), composer/approvals disabled with "Desktop offline" hint. Distinguish 503 `mac_offline` (disable action) from network failure (retry).
- **Check:** component test with mocked 503s.

**Phase 2 milestone check:** put the Mac to sleep; phone (LTE) still lists sessions and reads full transcripts from the relay; composer shows offline; wake Mac → composer re-enables within one health poll, stream resumes.

---

## 6. Phase 3 — artifacts + presence polish

### S3.1 Artifact push-on-produce (Mac)
- **File:** `apps/api_server/src/services/opencode_stream_bridge.ts` — the generated-media registration handler (the async handler noted in `docs/ai/runs/2026-08-11-sqlite-mirror-phase2.md:190-193`) additionally calls `relayUplinkClient.pushArtifact(artifactId)`: read the file the existing `/mobile-gateway/artifacts/:id` route serves, send as `file/artifact` if ≤ 8 MB encoded; larger → send metadata-only frame (`dataB64: null`).
- **Check:** unit test — registration event → file frame with correct bytes; oversize → metadata-only.

### S3.2 Artifact store + serve (relay)
- **Files:** `relay_uplink_server.ts` (store to `env.LIVE_ARTIFACT_STORAGE_DIR`, i.e. `/data/relay-artifacts/<artifactId>`) and `relay_gateway_routes.ts` (`GET /relay/mobile-gateway/artifacts/:id`: serve local file if present; else if `macOnline`, rpc-tunnel and **cache the response body** to the store; else 404 with `mac_offline` hint). Device-auth gated like everything else.
- **Check:** push→serve-offline test; cache-on-fetch test.

### S3.3 Presence polish
- Relay health already carries `macOnline` (S1.7). Add `lastUplinkAt` to the health extras and surface "last seen" in the phone's offline banner. Trivial; no new mechanism.

**Phase 3 milestone check:** generate an image in a session, sleep the Mac, open the artifact on the phone from the relay.

---

## 7. Config reference (end state)

| Where | Key | Value |
|---|---|---|
| Mac api_server | `RHYTHM_RELAY_URLS` | `ws://<nas-lan-ip>:4010/relay/uplink,wss://api.vcrcapps.com/relay/uplink` (LAN first — keeps same-LAN traffic off Cloudflare) |
| Mac api_server | `RHYTHM_RELAY_BEARER` | cloud session token (until Settings UI populates it) |
| Relay container | `RHYTHM_ROLE` | `relay` |
| Relay container | `DB_CLIENT` / `DB_PATH` | `sqlite` / `/data/relay.db` |
| Relay container | `RHYTHM_CLOUD_API_URL` | `https://api.vcrcapps.com` (bearer validation) |
| Relay container | `LIVE_ARTIFACT_STORAGE_DIR` | `/data/relay-artifacts` |
| Cloudflare tunnel | ingress | `api.vcrcapps.com` path `/relay*` → `http://rhythm-relay:4000`, above the rhythm-api catch-all |
| Phone | relay base | `https://api.vcrcapps.com/relay` (constant; `EXPO_PUBLIC_RHYTHM_RELAY_URL` override for dev) |

## 8. Risks & required smokes

1. **SSE buffering through Cloudflare (issue #1287 class):** before calling Phase 1 done, run a real-phone smoke on LTE confirming envelope latency < 2s during a streaming turn. If frames arrive in bursts, fix tunnel/proxy buffering (`Cache-Control: no-store`, flush per frame) — do not ship batched streams.
2. **Fingerprint drift:** any relay-side reshaping of health or envelopes bricks paired phones ("incompatible"). The passthrough tests in S1.7/S1.8 are the guard; keep them byte-level (deep-equal on parsed JSON is NOT sufficient for the health fields the phone string-compares — compare the raw serialized values it gates on).
3. **Uplink backpressure:** one slow uplink must not affect desktop clients — it's just another hub subscriber with its own queue; verify the hub-overflow path disconnects only the uplink subscription (existing hub semantics, `opencode_event_hub.ts:52-56`).
4. **Outbox growth while relay is unreachable:** unbounded by design until ack. Add a size log line and document that a week-long relay outage means a large (but bounded-by-transcript-volume) replay. Acceptable; do not add silent truncation.
5. **Two `MobileSseProxy` variants drifting:** prefer extracting shared `deliver()` scoping into one helper used by both (S1.8) over copy-paste.

## 9. Suggested PR slicing

1. PR-A: Phase 0 (S0.1–S0.5) — infra + role, zero user-visible change.
2. PR-B: S1.1–S1.9 — uplink + relay surface (server-side complete, phone unchanged).
3. PR-C: S1.10–S1.11 — phone transport (needs a mobile release).
4. PR-D: Phase 2 (S2.1–S2.5).
5. PR-E: Phase 3 (S3.1–S3.3).

Each PR: `flutter analyze` n/a except PR-C (`npx tsc`/lint for apps/mobile), api_server test suite green, `dart format` untouched, verification-gate before open, manual smoke per milestone check above. Never merge without AJ's device smoke.
