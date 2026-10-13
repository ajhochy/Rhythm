# Hermes event notification V2 — durable run-origin contract

Canonical candidate architecture as of 2026-10-13, draft PR #1616, HEAD
`18c53596` plus the qualified dirty source. This is **not deployed acceptance**.
See the [decision](../decisions/2026-10-13-hermes-durable-run-origin.md) and
[run / independent gate](../runs/2026-10-13-hermes-durable-run-origin.md).
The [V1 contract](hermes-event-notify-v1.md) preserves the historical session-origin
boundary; its two-table description is not the V2 schema.

## Authority and retry

Delivery belongs to an immutable tuple: actual durable run, actual owner, original
Hermes conversation, historical journal anchor and origin stage. The anchor's
`sessionId` is storage identity, **not a current attempt credential**. An opaque
client `workflowId` never grants durable-run authority. Existing
`RecipeWorkflowRunner`, dispatcher and repositories own lifecycle/attempts/joins;
this journal is a delivery outbox and projection, not another lifecycle tracker.

Explicit owner-authorized registration requires a real existing run, a currently
owned session, exact two-sided session/run/stage membership and a nonempty stage
attempt ID. A retry dispatches a **new session** and may reaffirm the same run and
original conversation. It never rebinds the old session or changes historical
event IDs, cursors, source keys or ACK states. Another conversation conflicts (409).

Every V2 read/ACK rechecks the active immutable owner against the current run owner,
the stored origin tuple, origin-stage existence, and every present current stage
session's exact reverse binding. Same-run sibling substitution, stage relocation,
conflicting provisional/committed sessions, malformed membership and owner transfer
fail closed. Neither former nor new owner inherits a transferred origin. A reset
with no current bound session permits legitimate run-owner recovery of pending
history, but grants no authority to the old session. Incoming engine events still
require current exact session/run/stage membership; stale SDK sessions cannot signal.

## Local SQLite schema and compatibility

`HermesNotifyService.initialize()` retains `hermes_notify_origins` and
`hermes_notify_events` unchanged and adds `hermes_notify_run_origins`:

| Column | Actual definition / role |
|---|---|
| `run_id` | TEXT PRIMARY KEY REFERENCES recipe_workflow_runs(id) |
| `owner_user_id` | INTEGER, nullable while quarantined; immutable owner when active |
| `session_id` | TEXT UNIQUE REFERENCES hermes_notify_origins(session_id); historical anchor |
| `hermes_session_id` | TEXT, nullable while quarantined; immutable original conversation when active |
| `stage_execution_id` | TEXT, nullable while quarantined; immutable origin-stage fence |
| `state` | TEXT NOT NULL CHECK(state IN ('quarantined','active')); authorization, not lifecycle |

Idempotent `INSERT OR IGNORE` creates quarantined metadata for legacy origins whose
workflow IDs match real runs, without inferring owner, conversation or anchor.
Explicit owner activation requires a unique consistent legacy owner/conversation/
session-stage tuple plus valid current membership. Ambiguous legacy tuples return
409 and remain without V2 authority; inconsistent membership fails 404/409, not
silent reassignment. Older dev metadata missing `stage_execution_id` receives an
additive column; active rows without that fence are quarantined. Events and ACKs
are not rebuilt or rewritten. No Postgres/bootstrap/production migration is claimed.

V2 activation is explicit. V1 cannot read or ACK activated V2 history: exclusion
occurs before V1's 100-row limit, and V1 ACK returns 404. Unactivated V1 retains
current-session authority; opaque legacy correlations cannot qualify terminal
success. V1/V2 inbox identity mismatches fail closed: use a separate version-qualified
V2 inbox, never delete/rewrite old dedup tombstones to force compatibility.

## Exact HTTP / SSE wire

All endpoints use unchanged `requireAuth` with an explicit owner-bound bearer;
no agent-local optional-auth fallback. IDs match `[A-Za-z0-9_-]{1,128}`. POST bodies
must be objects with only the listed fields; client-supplied owner fields are 400,
bad credentials 401, and unauthorized/missing membership 404.

| Endpoint | Exact body / response |
|---|---|
| POST `/hermes-notify/runs/:runId/origin` | `{sessionId,hermesSessionId}` → 201 `{version:2,runId}` |
| GET `/hermes-notify/runs/:runId/events?after=CURSOR` | `{version:2,runId,events}` |
| POST `/hermes-notify/runs/:runId/ack` | `{eventId,state}` with `accepted` or `visible` → `{version:2,runId,state}` |
| GET `/hermes-notify/stream?runId=ID&after=CURSOR` | SSE `event: notification`, `id: <cursor>`, JSON event data |

GET returns at most 100 pending/accepted rows in ascending stable cursor order;
visible rows are omitted. Missing `after` is zero; supplied cursors are 1–15 decimal
digits. SSE also accepts `Last-Event-ID` when `after` is absent, preflights V2
authority before headers, and rechecks every flush; revocation closes the stream.
Existing transport has a 32-subscriber limit, 15-second heartbeat and slow-reader
disconnect for durable replay. No second engine SSE connection is introduced.

Exact V2 event keys (no additional fields):

```json
{"version":2,"runId":"durable-run-id","eventId":"opaque-event-uuid","cursor":1,"sessionId":"historical-anchor-id","hermesSessionId":"original-hermes-id","workflowId":"durable-run-id","kind":"progress","text":"Rhythm session linked.","referenceId":null,"state":"pending"}
```

`runId` equals `workflowId`. Kinds are `progress`, `completion`, `error`,
`approval-request`, `question`; state is `pending`, `accepted`, `visible`.
Only fixed server labels or sanitized `Rhythm workflow STATUS: N settled, M awaiting.`
labels cross the boundary, never raw model/tool/error/status/verdict text. Unknown
run status denies authority; unqualified/unknown verdicts cannot produce success.
Success requires registry success, no pending approval or cancellation timestamp,
nonempty fully settled successful stages and qualified outcomes (gate `pass`).
Engine idle is not workflow completion. Unsettled children or contradictory success
remain withheld. Source cancellation/approval-clearing limitations are not repaired.

ACK is event/run/anchor-specific, owner-only, idempotent and monotone: `visible`
cannot regress to `accepted`. Invalid state is 400; wrong run/event/owner is 404.
References grant no reply/action authority. Engine permission IDs are **not canonical
approval-card IDs**; canonical card publication is still unintegrated/unqualified.

## Subscriber and accepted trust boundary

`tools/dev/hermes_notify_subscriber.py --run-id ID` explicitly selects V2 run GET/
ACK/SSE. Without `--run-id`, only V1 is accepted. Auth comes from
`RHYTHM_NOTIFY_TOKEN`; supply it via an operator-protected token reference/environment,
never literal argv, URLs, docs or logs. No extra login ceremony is required within
the accepted LAN/tailnet trust model, but this is not a qualified relay route:
the implementation requires HTTPS except the explicit isolated
`--allow-loopback-test` HTTP fixture at `127.0.0.1:4898`. It rejects redirects,
ambient proxies and credential-bearing URLs; it opens no listener.

The operator-owned adapter must implement `owns(event)` against a trusted local
owner/run/original-conversation dispatch registry, never adopt remote IDs, and
recheck authority in `deliver(event)` on every delivery/recovery. `deliver` returns
`None` while busy/unavailable or the exact receipt:

```text
{version:2,eventId,runId,hermesSessionId,state:'visible'}
```

Atomic original-session transcript write + event dedup + recoverable receipt is
required. Durable inbox ingestion means only `accepted`; HTTP200, SSE write,
enqueue, native history storage or a fixture receipt is not proof of wake, render,
human visibility or LLM processing. Local tombstones survive ACK; failed remote
ACK preserves the receipt for retry. Reconnect replays pending history from zero;
600-second GET recovery is a watchdog, not primary polling. No native adapter ships.

## Qualification and remaining boundary

Independent gate `7065f528`: **qualified PASS for Rhythm architecture only**,
109 unique checks / 0 failures plus 6 independent probes / 0 failures. Three
synthetic workflows use actual `RecipeWorkflowRunner`, dispatcher and repositories
with only the engine boundary injected; they are not live Encompass/Rhythm/Opus
execution. Actual fork SSE is separately exercised. Native atomic active-history
storage is separately proved, **not wake/render/visible acceptance**.

Primary Pi ingest/original-session wake/visible browser/browser-closed acceptance
is **BLOCKED/NOTRUN**: read-only SSH host-key verification failed; no bypass.
Parent must supply sanitized deployed Hermes image/source/routes, owner/session
mapping, durable receipt/cache/render/offline-fixture artifacts and coordinate a
narrow, non-restarting synthetic fixture activation. Real dispatch-origin hook,
bridge-job projection and canonical card-ID publication remain unintegrated and
unqualified. Finite-hub/offline source completeness and retention remain ceilings.
No Pi activation, production deploy/migration, real cards/desktop approvals,
network/relay change or installed/container restart is authorized by this contract.
