# Track 1 contract — Mac-side relay uplink client

Implements plan §2 + S1.1–S1.3 + S1.5 (Mac half) of `docs/ai/plan-synology-relay.md`.

## Deliverable

One new file: `apps/api_server/src/services/relay_uplink_client.ts`.
No other production file may be modified in this track (singleton/server.ts
wiring and the pairing-service hook are done by the orchestrator at merge).
Frame shapes come from `src/services/relay_uplink_protocol.ts` — import them,
do not redeclare.

## Exported interface (exact)

```ts
export interface RelayUplinkClientOptions {
  urls: string[];                 // ordered candidates, LAN first
  bearer: string;                 // sent as Authorization: Bearer <..> on upgrade
  userId: number;
  machineId: string;
  hub: OpencodeEventHub;          // Mac hub; subscribe with hubMaxQueue
  healthProvider: () => Promise<unknown>;
  devicesProvider: () => Promise<{
    devices: Record<string, unknown>[];
    deviceProjects?: Record<string, unknown>[];
  }>;
  dispatchBaseUrl: string;        // http://127.0.0.1:4002
  fetchFn?: typeof fetch;
  reconnectBaseMs?: number;       // default 1_000
  reconnectMaxMs?: number;        // default 60_000
  hubMaxQueue?: number;           // default 4096
  maxInflightRpc?: number;        // default 16
}

export class RelayUplinkClient {
  constructor(options: RelayUplinkClientOptions);
  start(): void;
  stop(): Promise<void>;
  isConnected(): boolean;
  sendHealth(): Promise<void>;          // pushes ctrl/health with fresh healthProvider()
  sendDevicesSnapshot(): Promise<void>; // pushes repl/devices with fresh devicesProvider()
}
```

## Behaviors (each pinned by a contract test)

1. **Candidate dialing.** `start()` dials `urls[0]`; on connect failure tries the
   next, wrapping, with exponential backoff `reconnectBaseMs → reconnectMaxMs`
   across full passes. Uses the `ws` package client with the Authorization
   header on the upgrade request.
2. **Hello first, devices second.** On every (re)connect, frame 1 is
   `ctrl/hello {userId, machineId, health: await healthProvider()}`, frame 2 is
   `repl/devices` from `devicesProvider()`.
3. **Resync (Phase 1 stub).** On `ctrl/resync {sinceSeq}` reply immediately with
   `ctrl/resync-done {throughSeq: sinceSeq}`. (Phase 2 replaces this with
   outbox replay — keep it isolated in one method.)
4. **Envelope forwarding.** Subscribes to `hub` (queue `hubMaxQueue`); each
   envelope goes out verbatim as `events/env {envelope}` — the object is passed
   through untouched (Invariant 1: byte-transparency). If the hub subscription
   overflows (hub closes it), resubscribe and continue; envelopes are lossy by
   design, rows are not.
5. **RPC dispatch.** On `rpc/req {id, method, path, headers, bodyB64}`: replay
   against `${dispatchBaseUrl}${path}` with the given method/headers/body
   (base64-decode; empty string = no body), 30s timeout, ≤ `maxInflightRpc`
   concurrent. Answer `rpc/res {id, status, headers, bodyB64}` — include all
   response headers except hop-by-hop (`connection`, `transfer-encoding`,
   `keep-alive`, `content-length` may be recomputed).
   A dispatch failure (network error/timeout) answers `rpc/res` with
   status 502 and body `{"error":"uplink_dispatch_failed"}`.
6. **Reconnect.** A dropped socket re-enters the dial loop (behavior 1) and
   re-runs behavior 2 on success. `stop()` closes the socket and disables
   redial; safe to call twice.
7. **Never throws into the hub loop.** Socket-send failures must not propagate
   to the hub iterator; drop the frame and let reconnect handle it.

## Constraints

- No new npm dependencies (`ws` is already a dependency).
- TypeScript strict; must pass `npx tsc --noEmit`.
- Match repo logging style (`logger` from src/logger or console.warn pattern
  used by opencode_stream_bridge — check neighbors; keep logs sparse).
- The contract tests in
  `src/__tests__/relay_uplink_client_contract.test.ts` are the acceptance
  criteria. Do not modify them except to fix a demonstrable defect in the test
  itself — and call that out loudly in your summary if you do.
- You cannot bind... correction: your sandbox may not allow binding sockets.
  If `npx vitest run src/__tests__/relay_uplink_client_contract.test.ts` fails
  with a bind/listen EPERM, implement to the contract and rely on
  `npx tsc --noEmit` locally; the orchestrator runs the socket tests and will
  feed failures back to you.

## Done means

`npx tsc --noEmit` clean AND
`npx vitest run src/__tests__/relay_uplink_client_contract.test.ts` fully green
(orchestrator-verified).
