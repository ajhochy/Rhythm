# Track 6 contract — phone offline UX (S2.5)

When the phone talks to the relay and the Mac is asleep, reads keep working
(relay mirror) while actions fail fast. The phone must present that state as a
calm, expected mode — not an error.

## Scope (apps/mobile only)

1. **Typed offline error.** `lib/transport/api-error.ts` exports
   `class MacOfflineError` (extend the existing error base used by ApiError
   consumers so catch sites keep working). The shared request path used by
   `PairedMacClient.request` maps an HTTP 503 whose JSON body has
   `error: 'mac_offline'` OR `error: 'mac_offline_and_mirror_incomplete'` to
   `MacOfflineError`. Any other 503 keeps today's error shape.
   `fetchResponse` (raw Response consumers) stays unmapped.
2. **Presence derivation.** New pure module `lib/transport/presence.ts`:
   - `type GatewayConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'desktop-offline'`
   - `deriveMacPresence(health: unknown): 'online' | 'offline' | 'unknown'` —
     an object body with `macOnline === false` → 'offline'; `macOnline === true`
     → 'online'; an object body WITHOUT the field (direct .ts.net health) →
     'online'; anything else → 'unknown'.
   - `connectionStatusForPresence(base, presence)` — presence 'offline' maps
     any healthy base ('connected') to 'desktop-offline'; other presences
     return base unchanged; a base of 'error'/'idle'/'connecting' is never
     upgraded by presence.
3. **Wiring.**
   - The provider that polls `/mobile-gateway/health` runs the body through
     `deriveMacPresence` and feeds `connectionStatusForPresence` into the
     connection status it already exposes; a caught `MacOfflineError` on a
     write also flips presence to 'offline' until the next healthy poll.
   - `components/chat/chat-composer.tsx`: widen the `connectionStatus` prop to
     `GatewayConnectionStatus`. The existing `!== 'connected'` logic already
     disables send for 'desktop-offline'; additionally render the composer
     hint/placeholder as a calm "Desktop offline — you can still read
     sessions" state (match the component's existing copy patterns).
   - Reads must NOT be blocked by 'desktop-offline' anywhere.
4. No new dependencies. Existing suites must stay green:
   `npm run test:paired-host`, `npx jest tests/relay-transport-contract.test.ts`,
   `npx jest tests/chat/chat-composer.test.tsx`.

## Acceptance tests (do not modify)

`apps/mobile/tests/relay-offline-contract.test.ts` — MacOfflineError mapping
matrix, deriveMacPresence matrix, connectionStatusForPresence matrix, and a
compile-level pin that 'desktop-offline' is a valid GatewayConnectionStatus.

## Verification loop

- `cd apps/mobile && npx tsc --noEmit`
- `npx jest tests/relay-offline-contract.test.ts tests/relay-transport-contract.test.ts`
- `npm run test:paired-host`
- `npx jest tests/chat/chat-composer.test.tsx`
- Sandbox restrictions? Keep tsc clean, implement to the contract, flag it.

Do NOT touch apps/api_server in this track. Flag demonstrable contract-test
defects loudly instead of editing them.
