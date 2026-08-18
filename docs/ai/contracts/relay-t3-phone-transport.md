# Track 3 contract — phone transport: relay URL acceptance + preference

Implements S1.10–S1.11 (client side) of `docs/ai/plan-synology-relay.md`, plus
the Mac-side advertisement of the relay URL.

## Scope

**apps/mobile** (primary):
1. `lib/pairing/paired-host-store.ts`
   - New exported `safeRelayUrl(value: unknown): string` — accepts EXACTLY the
     configured relay base (`process.env.EXPO_PUBLIC_RHYTHM_RELAY_URL` at
     module init, default `https://api.vcrcapps.com/relay`): https, no port,
     no query/hash/userinfo, pathname exactly the configured path. Returns the
     normalized base (no trailing slash). Throws `PairedHostError('invalidPayload', …)`
     otherwise. The existing `.ts.net` `safeGatewayUrl` rule is UNCHANGED.
   - `parsePairingPayload`: accepts an OPTIONAL `relayUrl` field. Present and
     valid → normalized onto the payload; present and invalid → throw
     (fail closed); absent → payload.relayUrl is null. All existing accepted
     payloads must keep parsing identically (tests/paired-host.test.mjs must
     stay green).
   - Persist `relayUrl` with the paired-host record; expose a pure exported
     `effectiveGatewayBase(host: { gatewayUrl: string; relayUrl?: string | null }): string`
     returning `relayUrl ?? gatewayUrl` (relay preferred).
   - Health adoption: when the paired-host health response body carries a
     valid `relayUrl` and the stored record has none, store it (validated via
     safeRelayUrl; invalid values are ignored, not fatal — health is
     Mac-authored, pairing payloads are user-scanned).
2. `lib/transport/paired-mac-client.ts`
   - Must work with a path-bearing baseUrl: every builder concatenates
     `${baseUrl}${path}` — no `new URL(path, base)` resets. (`ptyUrl` and
     `sseUrl` style builders included.)
   - New optional `directBaseUrl` (the `.ts.net` origin). `ptyUrl`/PTY
     connection building uses `directBaseUrl ?? baseUrl` — the terminal NEVER
     goes through the relay (the relay 501s PTY by design).
3. Transport wiring: wherever the paired-host record's gatewayUrl feeds
   client construction, use `effectiveGatewayBase(record)` as `baseUrl` and
   the `.ts.net` gatewayUrl as `directBaseUrl`.

**apps/api_server** (Mac-side advertisement):
4. `src/config/env.ts`: new `relayPublicUrl: string | null` from
   `RHYTHM_RELAY_PUBLIC_URL` (trimmed; empty/unset → null).
5. Pairing response (`POST /mobile-gateway/pair`) and gateway health
   (`GET /mobile-gateway/health`) include `relayUrl: env.relayPublicUrl` when
   set, omitted entirely when null. No other change to either body.

## Acceptance tests (do not modify)

- `apps/mobile/tests/relay-transport-contract.test.ts` (jest)
- `apps/api_server/src/__tests__/relay_advertisement_contract.test.ts` (vitest)
- Existing `apps/mobile/tests/paired-host.test.mjs` must stay green
  (`npm run test:paired-host`).

## Verification loop

- `cd apps/mobile && npx tsc --noEmit` and `npx jest tests/relay-transport-contract.test.ts`
- `npm run test:paired-host`
- `cd apps/api_server && npx tsc --noEmit && npx vitest run src/__tests__/relay_advertisement_contract.test.ts`
- Sandbox unable to run jest/bind sockets? Implement to the contract, keep
  both tsc runs clean, flag it; the orchestrator runs the rest and feeds back
  failures.

## Constraints

- No new dependencies in either package.
- Do not touch relay_uplink_* services, mobile_sse_proxy, or anything outside
  the five files/areas above plus the controllers that render pair/health.
- If a contract test is demonstrably wrong (e.g. it pins an option name that
  cannot work), flag it loudly in your summary rather than silently editing.
