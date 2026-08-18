# Track 4 contract — outbox + row replication (S2.1–S2.3)

The durable half of the uplink: mirror-row changes stream to the relay with a
monotonic seq, survive uplink gaps via replay, and the relay's own SQLite
converges to the Mac's mirror. Envelopes stay lossy (never replayed); rows are
the record. Read plan §2 and the Invariants in
`docs/ai/plan-synology-relay.md` first.

## Deliverables

1. `apps/api_server/src/database/migrations.ts` — two pragma-guarded tables:
   - `relay_outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, op TEXT NOT NULL, pk TEXT NOT NULL, row_json TEXT, created_at TEXT DEFAULT (datetime('now')))`
   - `relay_sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), last_applied_seq INTEGER NOT NULL DEFAULT 0)`
2. **New** `apps/api_server/src/repositories/relay_outbox_repository.ts`:
   `append(tbl, op, pk, row: Record<string,unknown> | null): number` (returns seq),
   `listSince(seq: number, limit: number)`, `pruneThrough(seq: number)`,
   `maxSeq(): number`. All raw better-sqlite3 via getDb().
3. **Hooks** — inside the SAME transaction as each mirror mutation, append one
   outbox row whose `row_json` is the post-write row read back verbatim
   (SELECT *), `op='upsert'`; deletes append `op='delete'`, no row:
   - `agent_session_messages_repository.ts`: `upsertStructured`,
     `upsertMessageInfo`, `upsertPart`, `deleteBySdkMessageId`.
     **NOT `applyPartDelta`** — per-token outbox writes would double hot-path
     volume; relay text converges at the next full-part flush
     (`// ponytail:` comment this).
   - `agent_sessions_repository.ts`: every method that INSERTs or UPDATEs
     `agent_sessions` (at minimum: `insert`, `setSdkSessionId`,
     `reconcileMobileSession`, and the status/preview/activity update methods
     the stream bridge session handlers call — grep the bridge for the repo
     methods it invokes and hook each).
   - pk: the row's `id` column as a string, both tables.
   - Outbox writes only happen when a relay is configured
     (`env.relayUrls.length > 0` on the Mac; guard inside the hook helper so
     non-relay users pay zero cost). The relay role itself must NOT write
     outbox rows while applying (no echo).
4. `apps/api_server/src/services/relay_uplink_client.ts`:
   - Replace the Phase-1 resync stub: on `ctrl/resync {sinceSeq}` stream
     `repl/row` frames for every outbox row with seq > sinceSeq (batches of
     500, seq order), then `ctrl/resync-done {throughSeq: <last streamed seq,
     or sinceSeq when none>}`, then resume live flushing.
   - New method `flushOutbox(): void | Promise<void>` — sends any outbox rows
     newer than the last sent seq. The bridge calls it between its persist and
     hub-publish steps; it must also run after resync completes.
   - On `ctrl/ack {seq}`: `pruneThrough(seq)`.
   - Rows always go out BEFORE any envelope forwarded after them (per-frame
     ordering on the single socket is enough; just flush before the hub loop
     sends the envelope — see bridge wiring below).
5. `apps/api_server/src/services/opencode_stream_bridge.ts` — in
   `_listenGlobal`, between `_relayEvent(...)` (persist) and
   `_publishToHub(...)`, call `getRelayUplinkClient()?.flushOutbox()`
   (fire-and-forget, never throws into the loop).
6. `apps/api_server/src/services/relay_uplink_server.ts` (relay side):
   - `ctrl/resync {sinceSeq}` now reads `relay_sync_state.last_applied_seq`.
   - On `repl/row`: apply in seq order, transactionally, idempotently —
     `tbl` MUST be whitelisted to `agent_sessions` / `agent_session_messages`
     (reject anything else); upsert = INSERT OR REPLACE with the row's own
     column values (verbatim strings — Invariant 5), delete = DELETE by pk.
     Update `last_applied_seq` in the same transaction. Skip rows with
     seq <= last_applied_seq (replay tolerance).
   - Send cumulative `ctrl/ack {seq}` at least every 100 applied rows and on
     resync-done.
   - New API: `onResynced(cb: () => void): void` — cb fires after every
     `ctrl/resync-done`. `relay_gateway_routes.ts` registers a callback that
     force-closes every live phone SSE response (end the response; phones
     reconnect and re-read the caught-up mirror — Invariant 3). Track the live
     SSE responses in the router (a Set added on connect, removed on close).
     The routes file is otherwise owned by Track 5 — confine your edit to the
     SSE handlers + this registration, and keep it additive.

## Acceptance tests (do not modify)

`apps/api_server/src/__tests__/relay_repl_contract.test.ts` — covers outbox
hooks (incl. the applyPartDelta exclusion), client replay/ack/prune, wire
ordering (rows before envelopes), relay applier idempotence + sync state +
whitelist rejection + SSE force-close, and a source-order contract on the
bridge (persist → flushOutbox → publish).

## Verification loop

- `cd apps/api_server && npx tsc --noEmit`
- `npx vitest run src/__tests__/relay_repl_contract.test.ts src/__tests__/relay_uplink_client_contract.test.ts src/__tests__/relay_uplink_server_contract.test.ts`
  (the Phase-1 contracts must STAY green — the resync stub replacement changes
  behavior only for sinceSeq describing rows that exist).
  Note: the Phase-1 client test pins `resync-done {throughSeq: sinceSeq}` when
  the outbox is EMPTY — that stays true by construction.
- Sandbox can't bind sockets? tsc + contract-reading, flag it; orchestrator
  runs the suites.

## Constraints

- No new dependencies. Do not touch apps/mobile, relay_gateway_routes.ts, or
  mobile_mirror_reads (parallel tracks own those).
- If a contract test is demonstrably wrong, flag loudly — do not silently edit.
