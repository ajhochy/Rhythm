# Track 5 contract — relay-served mirror reads (S2.4)

With Track 4's replication filling the relay's `agent_sessions` /
`agent_session_messages` tables, the relay can answer the three mirror-served
read operations from its own SQLite — phones browse sessions and transcripts
with the Mac asleep. Everything else keeps tunneling.

## Deliverable

Modify ONLY `apps/api_server/src/routes/relay_gateway_routes.ts` (plus any
small new helper module you extract). Before the rpc catch-all, add
device-authed GET handlers for exactly the three mirror-served operations —
the same three #1384 serves on the Mac:

- `GET /mobile-gateway/opencode/experimental/session` → `readMirrorSessionList`
- `GET /mobile-gateway/opencode/session/:id/message` → `readMirrorTranscript`
- `GET /mobile-gateway/opencode/session/:id/children` → `readMirrorSessionChildren`

Reuse `src/services/mobile_mirror_reads.ts` — its readers run unchanged on the
relay DB because they read through getDb()/repositories. Mirror the
invocation, response shaping (host-path scrubbing, engine-shaped bodies,
headers incl. any cursor headers), and status codes from the Mac's
`serveFromMirror` path in `src/services/mobile_opencode_proxy.ts` (~lines
900-995) — a phone must not be able to tell which host answered.

Fall-through changes from the Mac semantics (this is the ONLY divergence):
- reader returns null/incomplete AND `uplink.isMacOnline()` → tunnel via the
  existing rpc catch-all logic (the live engine answers through the Mac);
- reader returns null/incomplete AND Mac offline → respond
  `503 {error: 'mac_offline_and_mirror_incomplete'}`.

Scoping: the readers are already fail-closed on (owner_user_id, project_id) —
pass the device's userId and the `X-Rhythm-Project-ID` header value.

## Acceptance tests (do not modify)

`apps/api_server/src/__tests__/relay_mirror_reads_contract.test.ts` — offline
complete-mirror reads succeed; incomplete/unknown rows 503 with
mac_offline_and_mirror_incomplete when offline; unknown rows tunnel when
online; device auth enforced.

## Verification loop

- `cd apps/api_server && npx tsc --noEmit`
- `npx vitest run src/__tests__/relay_mirror_reads_contract.test.ts src/__tests__/relay_uplink_server_contract.test.ts src/__tests__/relay_role.test.ts src/__tests__/issue_1379_mirror_reads_http.test.ts`
  (the Mac-side mirror suite must stay green — you are not touching it, prove
  it anyway).
- Sandbox can't bind sockets? tsc clean + contract fidelity; flag it.

## Constraints

- Do not touch relay_uplink_client.ts, relay_uplink_server.ts,
  opencode_stream_bridge.ts, migrations, repositories, or apps/mobile —
  parallel tracks own those. A sibling track is adding an SSE force-close
  registration to relay_gateway_routes.ts; keep your additions in a distinct
  region (between the PTY handler and the catch-all) to minimize the merge
  surface.
- No new dependencies. Flag demonstrable contract-test defects loudly instead
  of editing them.
