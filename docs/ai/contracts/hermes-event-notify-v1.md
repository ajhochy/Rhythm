# Hermes event notification v1 — candidate trust contract

Parent-owned final integration. This contract does **not** amend approval contracts.

## Trust and dispatch

Use an explicit owner-bound bearer; no local optional-auth or production fallback.
Create the Rhythm session through its existing authenticated API, then
`POST /hermes-notify/origins` with exactly `{sessionId, hermesSessionId, workflowId}`
**before** sending a prompt/dispatch. IDs are opaque `[A-Za-z0-9_-]{1,128}` values.
The server derives the owner from auth and requires exact existing session ownership.
Origin is immutable; a conflicting rebind is 409. This authenticates the Rhythm
owner, **not** proof that a client-supplied Hermes ID exists. The Pi-side adapter's
trusted dispatch registry must independently bind the tuple to an owned original
Hermes session. `adapter.owns(event)` must prove this before any consumer ACK.
No automatic dispatch/create-controller integration is claimed in this candidate.

## Wire

`GET /hermes-notify/events?after=0` returns `{version:1, events:[...]}`, at most
100 pending/accepted events in cursor order. Follow the last cursor for pagination.
`GET /hermes-notify/stream?after=0` is SSE, `event: notification`, `id: <cursor>`.
`Last-Event-ID` is accepted as a reconnect cursor. A consumer reconnects from zero
to recover **pending** events, including events accepted while the parent is busy.
No token frames are stored or forwarded. The existing consolidated engine event
hub is the source, not a second engine SSE connection or LLM poller.

Exact event fields:

```json
{"version":1,"eventId":"opaque-event-uuid","cursor":1,"sessionId":"rhythm-session-id","hermesSessionId":"owned-original-session-id","workflowId":"dispatch-workflow-id","kind":"completion","text":"Rhythm session completed.","referenceId":null,"state":"pending"}
```

Kinds: `progress`, `completion`, `error`, `approval-request`, `question`.
Text is a fixed server-generated label, never model/tool/error text. Permission
and question events carry only validated reference IDs, never reply authority,
tool arguments, credentials, URLs, arbitrary instructions or execution grants.
Current permission references are **engine permission IDs, not approval-card IDs**;
approval owner's canonical card-ID publication hook remains parent integration.
The subscriber rejects unknown fields, versions, labels, oversized lines and
changed identity on replay. No identifier in a payload authorizes a session switch.

`POST /hermes-notify/ack` accepts exactly `{eventId,state}`. `accepted` means
durably stored in the consumer inbox; it remains pending on Rhythm. `visible`
means the adapter has a durable original-session transcript receipt; it stops
replay. ACK state is monotone/idempotent and owner-only. Neither HTTP200 nor SSE
write nor enqueue means delivered, woken, read by a human or processed by an LLM.

## Concrete local subscriber boundary

`tools/dev/hermes_notify_subscriber.py` is an outbound urllib SSE client with a
SQLite inbox, 1–60 second reconnect backoff, 20 second I/O timeout, bounded
8192-byte SSE lines and 100-event drains. It only performs the 600-second GET
watchdog; primary traffic is SSE. It refuses redirects, ambient HTTP proxies,
credential-bearing URLs and missing explicit auth. It opens **no listener**.

An operator-owned importable adapter module exposes `adapter` with:

- `owns(event) -> True` only for a tuple in the trusted authenticated dispatch registry.
- `deliver(event) -> None` while busy/unavailable, or the exact durable receipt
  `{version:1,eventId,hermesSessionId,state:'visible'}`.
- `deliver` **must** atomically deduplicate `eventId` with the original-session
  transcript write, and recover that receipt after a crash. A mere queue/API200
  must return `None`, not a visible receipt.
- `deliver` rechecks current session ownership/dispatch binding on every call,
  including recovery of previously accepted inbox events after restart/revocation.
- Runtime wakeup is separate from transcript insertion and must be proved through
  the actual supported session lifecycle. Never inject tool instructions or use
  cron to circumvent an unsupported WebUI platform.

The runnable `FixtureTranscriptAdapter` in `test_hermes_notify_subscriber.py` uses
real SQLite to exercise transcript commit/duplicate/crash windows. It is a local
fixture, **not Hermes** and never qualifies runtime wakeup/visible-user acceptance.

```sh
python3 -B tools/dev/test_hermes_notify_subscriber.py
python3 -B tools/dev/hermes_notify_subscriber.py --help
# After separate authorization and a real adapter implementation:
# RHYTHM_NOTIFY_TOKEN supplied privately by operator; never put it in argv/logs.
python3 -B tools/dev/hermes_notify_subscriber.py --base-url https://APPROVED_PRIVATE_ORIGIN --inbox /OWNED_DISPOSABLE_OR_MANAGED_PATH/inbox.db --adapter OWNER_APPROVED_ADAPTER_MODULE
```

## Known ceilings / missing boundaries

SQLite/local engine only; two isolated additive tables initialize when mounted.
No Postgres/relay replica migration. Event IDs/cursors already persisted survive
API/consumer restart. No claim of lossless **source** recovery for events emitted
while the API subscriber is offline or overflows; global hub is lossy. No atomic
integration with session creation/dispatch, and no completed model-turn live test.
No actual Pi private relay route for this owner-bearer SSE endpoint has been
qualified. Existing relay serves paired mobile/session streams and its RPC tunnel;
those are not automatically a Hermes-authenticated SSE route. Do not add a listener
or change relay/Tailscale config to hide this missing integration.
Journal/inbox tombstones retain disk history; no retention policy is claimed.
Busy-parent exactly-once is conditional on adapter atomic receipt semantics;
stock Hermes's process-global notification queue does not supply that contract.
Actual Hermes ingestion, original-session wakeup, visible update and browser-closed
behavior remain BLOCKED/NOTRUN, independently of Rhythm delivery passing.
