# Track 2 contract — relay-side uplink server + phone surface

Implements plan §2 + S1.4, S1.6–S1.9, S1.11 of `docs/ai/plan-synology-relay.md`.

## Deliverables

1. **New file** `apps/api_server/src/services/relay_uplink_server.ts`
2. **Extended** `apps/api_server/src/routes/relay_gateway_routes.ts`
3. **server.ts wiring**: inside the relay role only, attach the uplink upgrade
   handler to the main HTTP server:
   `if (env.isRelayRole) httpServer.on('upgrade', (req, sock, head) => { if (!relayUplinkServer.handleUpgrade(req, sock, head)) sock.destroy(); })`
4. Nothing else. Do not touch Mac-side services, the mobile app, or the
   protocol module.

Frame shapes come from `src/services/relay_uplink_protocol.ts` — import, never
redeclare.

## RelayUplinkServer (exact exported interface)

```ts
export interface RelayUplinkServerOptions {
  /** Validates the Mac's bearer. Default: GET {env.RHYTHM_CLOUD_API_URL}/auth/me
   *  with 5s timeout (mirror mobile_cloud_identity_service's pattern). */
  bearerValidator?: (token: string) => Promise<{ userId: number } | null>;
  hub?: OpencodeEventHub; // relay-local hub; default new instance
}

export class RelayUplinkServer {
  constructor(options?: RelayUplinkServerOptions);
  /** True if the request was for /relay/uplink and was handled. */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  readonly hub: OpencodeEventHub;      // fed by events/env frames
  isMacOnline(): boolean;              // true between resync-done and socket loss
  getHealth(): unknown | null;         // last ctrl/hello|health body, verbatim
  /** Tunnel one HTTP request to the Mac. Throws MacOfflineError when offline. */
  sendRpc(req: { method: string; path: string; headers: Record<string, string>; bodyB64: string }): Promise<RpcResFrame>;
  stop(): void;                        // close uplink sockets (shutdown)
}

export class MacOfflineError extends Error {}
export const relayUplinkServer: RelayUplinkServer; // module singleton (default options)
```

## Uplink session behavior

1. **Upgrade + auth.** Only path `/relay/uplink` is handled. The upgrade
   request must carry `Authorization: Bearer <token>`; the validator must
   resolve a userId, else respond `HTTP/1.1 401` on the socket and destroy it.
2. **Handshake.** First frame from the Mac must be `ctrl/hello`. On hello:
   cache `health` verbatim, then send `ctrl/resync {sinceSeq}` where sinceSeq
   is the last applied repl seq (0 when none — Phase 1 always 0). On
   `ctrl/resync-done`: set macOnline=true and `hub.setLive(true)`.
3. **Frames.**
   - `ctrl/health` → replace cached health.
   - `events/env` → `hub.publish(envelope)` verbatim.
   - `repl/devices` → replace-all rows of `mobile_devices` (and the optional
     `deviceProjects` table array when present) in ONE transaction via getDb().
     Applying a snapshot must be idempotent.
   - `rpc/res` → resolve the matching pending sendRpc by id.
4. **Disconnect.** macOnline=false, `hub.setLive(false)`, pending sendRpc
   calls reject with MacOfflineError.
5. **Supersession.** A second authenticated hello (any user — single-tenant)
   closes the previous uplink socket first.
6. A malformed frame is ignored (parseUplinkFrame returns null); it must not
   kill the connection.

## Phone surface (relay_gateway_routes.ts)

`createRelayGatewayRouter(deps?: { uplink?: RelayUplinkServer; ownershipRepository?: MobileOpenCodeOwnershipReader })`
— defaults: the singleton uplink; the real repository-backed ownership reader.
Existing `GET /health` gains `macOnline: uplink.isMacOnline()`.

All routes below require `Authorization: Device <token>` validated against the
relay DB (reuse `requireMobileDevice` / the pairing service — they read via
getDb(), which on the relay holds the replicated rows). 401 without it.

1. `GET /mobile-gateway/health` — no uplink ever seen → 503 `{error:'no_uplink'}`.
   Else: the cached health body VERBATIM (every field byte-preserved — the
   phone string-compares gatewayVersion/opencodeVersion/contractFingerprint)
   plus exactly one added field `macOnline`.
2. `GET /mobile-gateway/events` and `GET /mobile-gateway/sessions/:id/events` —
   SSE served from `uplink.hub` with THE SAME scoping/dedupe/shaping the Mac
   applies: reuse MobileSseProxy in hub mode (ownershipRepository injected; an
   engine fallback must be impossible — construct with a fetchFn that throws).
   When `hub.isLive()` is false respond 503 `{error:'mac_offline'}` instead of
   hanging. Heartbeat envelopes pass through like the Mac path.
3. Any `/mobile-gateway/pty/*` request → 501 `{error:'pty_requires_direct_connection'}`.
4. **Catch-all** `ALL /mobile-gateway/*` (after the routes above):
   - offline → 503 `{error:'mac_offline'}` immediately;
   - online → `uplink.sendRpc` with method, path = the full path INCLUDING
     query string, minus the `/relay` mount prefix (so it starts with
     `/mobile-gateway/`), headers (at minimum: authorization,
     x-rhythm-project-id, content-type, accept), raw body base64. Surface the
     rpc/res status, headers (minus hop-by-hop), and body verbatim.
   - Project-scope enforcement happens on the MAC via the tunneled headers —
     the relay does not duplicate it on this path.

## Constraints

- No new npm dependencies. TypeScript strict, `npx tsc --noEmit` clean.
- The contract tests in
  `src/__tests__/relay_uplink_server_contract.test.ts` are the acceptance
  criteria. Do not modify them except for a demonstrable test defect — flag
  loudly in your summary if so.
- Your sandbox may not allow binding sockets. If vitest fails with bind
  errors, implement to the contract, keep tsc clean, and the orchestrator will
  run the tests and feed failures back.

## Done means

`npx tsc --noEmit` clean AND
`npx vitest run src/__tests__/relay_uplink_server_contract.test.ts src/__tests__/relay_role.test.ts`
fully green (orchestrator-verified).
