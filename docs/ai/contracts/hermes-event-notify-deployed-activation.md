# Hermes V2 — deployed evidence / activation contract

Status: **BLOCKED; ACTIVATION NOTRUN; no executable activation command exists in
the supplied evidence.** Documentation-only artifact at Rhythm HEAD
`5165796982ee281da72726fcda6a957671bf259d`, PR1616. Does not modify or supersede
[canonical V2](hermes-event-notify-v2.md) or qualify a native sink.
Run receipt: [deployed activation blocker](../runs/2026-10-13-hermes-deployed-activation-blocker.md).

## Evidence identity and limits

Parent supplied the following results of authorized, source-only deployed
inspection through trusted `ssh pi` with `StrictHostKeyChecking=yes`. This writer
did not SSH, fetch source, import it or make any runtime/network request.
Deployed image: `sha256:4fbb112fb9f90efac654c43239cffc233122c2b7536aaad9de1e88455c20de0a`;
cwd `/vault`; WebUI source is a host mount. Image digest alone does not pin mounted
source. Git revision unavailable; `api/_version.py` absent. **Never identify this
deployment as current `81e1e7f`.** Hashes below identify parent-inspected files,
not an independently obtained complete source tree or integration test fixture.

| Key / deployed file | Parent-supplied SHA256 |
|---|---|
| R: api/routes.py | `7500a207fbba663f25407d04f47a6e618e8e16aa07634a8cd921d5081ee8b66c` |
| B: api/background_process.py | `da85c1be47cdc4fe1b39daafebd2a8c4b4cb362b2f769e16a06a78d44e47ea33` |
| C: api/config.py | `e62d1aa1c8ea1f81a236a236021794a9875996bf917854c8cad98aca2999cfdb` |
| A: api/auth.py | `c8c324d4d3882cf789fc697f72dbc9e21e09a4eacb50e327e884ccce93ea95aa` |
| J: api/turn_journal.py | `4ab5d87b7c6371f430b5d2ba03de338d6f6dc1d80c8258ddcb60473664abbdeb` |
| D: api/webui_session_db.py | `8ef2d677fdf8e7d5c39c84133c75fe5fa08eb15fd8930ff4c5312078596fe84c` |
| M: api/models.py | `2631a28024f9dc6018a5ceeebd5c7e09bfdae9496f496f7e7e233c951456fa82` |
| UI: static/messages.js | `80522759fb39cb815f4c32846832741c96ce6ff8422db87e232cd48e9c9932e7` |
| S: static/sessions.js | `c00bf0536e7ed6458d082f1f0261e3e82fb0af05821f91a630f2bad7f295dbdc` |

Existing relay: running namespace matches, no published ports;
`alpine/socat:1.8.1.1@sha256:7f9a06753033f2b7de18edc2353f2c15153413d95a039163c6db270fc7a6c3b0`.
Existing origin is HTTP `127.0.0.1:4001`, **not** an accepted current subscriber
origin. Namespace/loopback is transport evidence, not proof of upstream owner,
owner-bearer `/hermes-notify` availability, or equivalence to device-auth RPC.

Locally pinned inputs (recheck via run command): V2 SHA256
`61d623be80c3228439a436738da534820d4d1c3b08dfdc93a2df10ab3a7ed5fe`;
subscriber SHA256 `273d8398312391ecb3189cb11d951bdac512bf00624286cf46df9811ba134cca`.
Historical independent gate `7065f528`: 109 checks + 6 probes, no failures,
**Rhythm architecture only**, not deployed Hermes acceptance. Three runner cases
used real runner/dispatcher/repositories with injected engine boundary; actual
fork SSE was separate. Parent reports clean HEAD51657969 and all three CI green;
no current CI query or test rerun here. Older canonical references to failed SSH
describe historical runs; parent now supplies source inspection, not behavioral proof.

## Complete primary V2 / subscriber requirement mapping

Every row is an obligation, not a PASS claim. `RH` means historical Rhythm-only
architecture qualification; `SOURCE` means parent-identified deployed path;
`GAP` means no qualifying deployed evidence. Canonical line ranges identify scope.

| ID / canonical requirement | Current subscriber / Rhythm evidence | Deployed mapping and remaining boundary |
|---|---|---|
| V01 L12–17 actual run/owner/original chat/historical anchor/stage; no second lifecycle tracker | RH; subscriber V2 runId=workflowId, owns required (27–54,119–126) | GAP: no trusted local run-owner/chat/profile registry supplied; WebUI profile visibility R640–679 is not Rhythm run membership |
| V02 L19–23 real current two-sided stage/session + attempt; retry new session; immutable origin/conflicting chat409 | RH run registration/retry | GAP: native chat POST has no demonstrated Rhythm origin registration or dispatch hook; no remote ID adoption allowed |
| V03 L25–32 recheck immutable owner, origin-stage, all current exact reverse bindings; transfers/stale SDK denied; owner recovery after reset | RH revocation/projection; adapter deliver must recheck, including inbox recovery | GAP: A1095 checks WebUI auth, not V2 run authority; no deployed adapter recheck |
| V04 L36–55 local SQLite schema, quarantine, additive stage fence, preserve events/ACKs, no production migration | RH local service initialize | GAP: D151 atomic full session payload and M1650 shrink/metadata guards do not implement notifier schema/quarantine; no migration performed |
| V05 L57–61 explicit V2 exclusion before V1 limit; V1 ACK404; version-qualified inbox/tombstones | RH; Inbox identity mismatch fails (63–75) | GAP: no installed V2 subscriber/inbox identified; never delete V1 tombstones |
| V06 L65–68 unchanged owner requireAuth, strict IDs/POST object fields, owner-body400/auth401/membership404 | RH routes; subscriber identity regex | SOURCE A1095 cookie/trusted-auth session or auth-disabled; R6157–6205 auth/CSRF and6268–6297 same-origin policy. Nonbrowser no-Origin exempts browser CSRF only; auth stays intact. No evidence Rhythm bearer authenticates WebUI |
| V07 L70–75 exact origin/events/ack/stream routes, bodies/version2/runId | RH; Subscriber request/ack/run (108–115,138,150) | GAP: owner endpoints upstream of existing relay not proved; native GET/session/stream and POST/chat/start are different APIs |
| V08 L77–82 ordered100 pending/accepted, stable cursors, visible omitted; after/Last-Event-ID; preheader/perflush revocation,32 clients/15s heartbeats/slow-reader replay, no second engine SSE | RH route/journal transport | SOURCE R15469 session stream,22554 known_count selfheal,22660 turn-start/finished-gap recovery; **no durable external-event replay**. Native renderer SSE may be needed but must not add another engine SSE |
| V09 L84–91 exact V2 event keys/kinds/states and runId=workflowId | validate27–54 enforces schema/types/identities/cursor, no extras | GAP: native chat start consumes session_id/message, not this event schema; wrapping text does not create an event receipt |
| V10 L92–98 fixed/sanitized labels only, fully settled qualified success, no idle completion/children contradiction; lifecycle ceilings | RH projection; subscriber fixed labels/workflow enum and terminal counts (18–53) | GAP: WebUI wake/run status alone cannot qualify Rhythm workflow success; ACK/bg-task-complete is diagnostic only |
| V11 L100–103 exact event/run/anchor owner ACK, monotone/idempotent; refs not action authority, engine IDs not canonical cards | RH routes/ACK; subscriber exact visible receipt check84–94 | GAP: no native external-event receipt or visible ACK identified; no real approval/card action allowed |
| V12 L107–114 explicit run-id selects V2, else V1; owner token reference, no extra login; HTTPS except isolated4898, no redirects/proxies/credential URLs/listener | CLI175–192; NoRedirect96–98, ProxyHandler({})106; no listener | SOURCE existing HTTP4001 relay conflicts with policy. Current allow-loopback-test only accepts127.0.0.1:4898, cannot activate on4001. LAN/tailnet trust requires no new mandatory auth, but owner checks remain |
| V13 L116–119 owns from operator local owner/run/original chat registry, recheck deliver on recovery; busy/unavailable=None | receive125 before inbox accept; drain77–94 trusts adapter to recheck every deliver | GAP: registry/adapter absent. R640–679 profile helper409 known other/404 unknown is useful non-disclosure, insufficient origin authority |
| V14 L119–127 exact {version:2,eventId,runId,hermesSessionId,state:visible}; atomic transcript+dedup+recoverable receipt | Inbox enforces shape, not truth; no native adapter ships | GAP: J66–109 fsync JSONL + directory fsync, D151 fullpayload atomic write, M1650 os.replace each provide separate durability, **not atomic Rhythm event receipt/transcript/wake** |
| V15 L125–128 accepted only after durable ingestion; HTTP200/SSE/enqueue/history/fixture!=wake/render/human/LLM proof | Inbox63–75 durable SQLite accept; receive127–130 accepted then drain | GAP: no deployed accepted ingress/visible receipt. Known native turn start is not proof the external event was durably ingested |
| V16 L129–130 local tombstones survive ACK; failed ACK retries receipt; reconnect zero replay;600s watchdog not polling | drain89–94 leaves visible=1 on failed ACK; receive reuses identity; run132–173 zero replay/backoff/watchdog | GAP: B1966–2022 record_deferred_wakeup threadlock/processId dedup and2025 popdict; C12755–12793 PROCESS_SESSION_INDEX/PENDING/SEEN/DEFERRED all **in memory**. No restart/crash receipt/recovery |
| V17 L134–147 architecture proof separate from Pi wake/render, real dispatch hook/bridge projection/cards unintegrated; finite-hub/retention ceilings | 109+6 RH receipt retained unchanged; native atomic local fixture only | SOURCE snippets advance version/path mapping, not qualification. No automatic preengine hook/bridge/canonical card claim; no lossless-source completeness claim |
| V18 L148–149 no activation/deploy/migration/real cards/relay changes/restart authority | Scope exclusions preserved | All runtime steps NOTRUN; no source patch or proposed opt-in is authorized to activate |

Additional primary native/user obligations:

| ID / outcome | Exact deployed evidence | Disposition |
|---|---|---|
| N01 existing original-session native wake | R25755–25799 start_session_turn, persisted model/workspace/provider, per-session lock/active409; R25941–26001 _start_run, server_turn_started fanout if channel exists, closed-tab no-op | SOURCE only; invoke in running server, not docker-exec import in another process |
| N02 existing HTTP supported input and guards | R17616 POST/api/chat/start; R26474 IDs/runtime barrier,26623 normalized nonempty message; profile/auth/CSRF and busy409 retained | No eventId receipt or proved offline provider selection. Do not issue this POST |
| N03 background-only retry/rearm | R25080 _start_chat_stream_for_session process_id identity/retry/rearm; B2262 _start_server_side_wakeup_turn retry-aware in-process callable | Not external ingress; do not forge process/task completion or use dict pop as durable claim |
| N04 visible original WebUI render | UI8737 server_turn_started attaches existing renderer with correctsid/stream dedup/recovered; S2811 attachLiveStream recovery | SOURCE renderer wiring, actual visible proof NOTRUN |
| N05 browser closed / reopen saved transcript | S3815 GET/api/session?session_id&messages=1&resolve_model=0, R22660 late turn-start/finished gap reload saved count | SOURCE saved recovery, not event replay or closed-browser behavior proof |
| N06 busy no steering/drop; repeat/reopen/crash dedup | native active409 and session lock; subscriber retains durable inbox busy=None | Busy/reopen/eventId native dedup acceptance NOTRUN; no receipt-atomic wake recovery supplied |
| N07 deterministic provider via existing route, no config/env/restart/network | persisted provider path identified only | GAP: request model/provider resolution and runner injection/source seam not supplied. Never infer offline injection from session message/model fields |
| N08 one disposable chat, temporary subscriber, existing private route, owner mapping | all require operator-attested local protected binding | GAP: no fixture tuple/protected reference artifacts supplied. No arbitrary remoteIDs, extra login or real chat |

## Exact blocked step / smallest separately approvable work

**BLOCKED STEP A:** construct the non-restarting activation invocation that sends
a V2 external event through a supported authenticated ingress in the **running
WebUI server**, atomically retains event identity/transcript and a recoverable
receipt, then schedules original-session wake using a proven deterministic
offline provider. Supplied POST `/api/chat/start` accepts `session_id,message`
but has no identified eventId/durable-ingress contract or supported offline
injection. Standalone Python/docker-exec import is a different process. Source
editing is not hot-loading. No extension/reload/plugin hook in the running server
has been proved. Therefore an exact safe non-restarting command is unavailable;
**none is offered or executed**.

Smallest next source request (parent/Hermes; no broad permissions request):
provide bounded sanitized, hash-pinned snippets from R `_handle_chat_start`,
`start_session_turn`, `_start_run` and the called model/provider resolver and
runner constructor/injection seam; include request-field validation, saved
profile/model/provider overrides and the complete offline-adapter selection
path, plus any *existing* running-server extension registration/reload path.
Include the actual WebUI transcript transaction/caches/write boundary and any
existing external event receive/status contract. Supply safe copied tracked
source dependencies if a native integration fixture is expected, excluding
`.env`, `.git`, live configs/DB; snippets alone cannot support imported-native tests.

If those snippets confirm no such ingress, the smallest separately approvable
**source change**, not a runtime installation, is one owner/profile-bound WebUI
receive/status capability at the native transcript persistence boundary:
validate exact V2 tuple/digest using the protected local registry; persist the
dedup identity with the transcript/receipt in its actual atomic boundary; keep
durable pending-wake state; after commit invoke existing `start_session_turn`
within that same server, retaining busy409 for retry; recover ambiguous wake
without blind duplicate prompts; expose independent saved/render observation
before emitting visible. Preserve fullpayload, shrink, locks and cache semantics.
Its first source-fixture RED must target duplicate replay, abort between writes,
crash between commit/wake, busy409, revoked ownership and original-session reopen.
Do not reuse the local native atomic prototype: it writes active assistant history,
returns version1/persisted, lacks owns/deliver/wake, and is not this deployed WebUI.
If a supported no-restart extension hook is absent, installing any such source
change cannot satisfy the current non-restart constraint. Parent must resolve
that specific deployment constraint separately; patching source is insufficient.

**BLOCKED STEP B:** select the current subscriber base origin for the existing
HTTP4001 relay. HTTPS is required except the isolated4898 fixture. Do not pass
`--allow-loopback-test` and expect4001 to work, change relay/ports, broaden global
HTTP or repurpose mobile-device buffered RPC as owner SSE.

Smallest separately approvable transport source change: an opt-in **exact pinned
loopback fixture origin** `http://127.0.0.1:4001` drawn solely from a protected
operator registry bound to the fixture owner/run/chat/profile and attested
upstream. No arbitrary host/port/URL input, redirects, proxy inheritance or
credential-bearing URLs; no token forwarding across origins; owner bearer
unchanged. Independently test exact-origin acceptance only with opt-in and reject
other ports/hosts/DNS aliases/IPv6/userinfo/path/query/fragment and redirect token
leak. This is a proposal **NOT IMPLEMENTED/NOT TESTED/NOT APPROVED**; tests must
precede implementation. Loopback does not authenticate upstream or prove owner
endpoints; parent must separately attest those endpoints and ownership using
existing evidence, not a new live request from this writer.

## Operator-protected file references and future evidence protocol

Named placeholders below are **file references**, not literal credentials,
argv values, invented flags or existing-file claims. No files were opened/created
for these references. A later approved launcher must resolve them locally,
reject symlinks/untrusted writable ownership, omit secret bytes from logs, and
leave existing auth/session policy intact; no mandatory extra login is proposed.

| File reference | Required contents / authority |
|---|---|
| `<OPERATOR_FIXTURE_REGISTRY_FILE>` | owner-attested single runId + original Hermes stored/live chat mapping + profile + current run/stage/attempt binding + exact origin/upstream attestation; never learned from remote notification IDs |
| `<RHYTHM_OWNER_TOKEN_FILE>` | protected existing owner-bound Rhythm bearer; future launcher may load RHYTHM_NOTIFY_TOKEN transiently, never token argv/URL/log |
| `<EXISTING_WEBUI_AUTH_REFERENCE_FILE>` | protected reference to existing accepted WebUI auth session, not a claim Rhythm bearer is accepted there |
| `<OFFLINE_PROVIDER_PROOF_FILE>` | hash-qualified existing request/runner injection path, fixed responder output, zero provider/tools/network behavior for only the disposable profile/chat |
| `<SANITIZED_DEPLOYED_SOURCE_MANIFEST_FILE>` | mounted-file hashes, safe source dependency copy receipt, no .env/.git/live config or DB |
| `<TEMP_SUBSCRIBER_V2_INBOX_FILE>` | new version-qualified scratch inbox under operator-approved fixture scratch root, never V1 tombstone rewrite |
| `<FIXTURE_EVIDENCE_DIRECTORY>` | sanitized eventId/cursor/digest/tuple, accepted receipt, wake observation, saved and rendered original transcript/reopen evidence, busy/replay recovery, owned process identity |

Dependencies intended for future activation: Python stdlib subscriber + reviewed
operator adapter module; existing WebUI native server/renderer/transaction path;
approved offline deterministic provider; already existing private transport.
No new dependency install, listener or relay is implied. Intended scratch writes:
new V2 inbox/WAL, registry fixture attestation, evidence files and **one disposable
chat only after approval** through proved native ingress; no existing live data
mutation/migration, no direct live DB write, no prototype installation.

Future fixed fixture input: sanitized server label `Rhythm session updated.` for
one locally authorized V2 event. Replay the same full immutable event identity
(only state may advance); changing any identity under the same eventId must deny.
Expected provider output must be supplied in OFFLINE_PROVIDER_PROOF_FILE, not
assumed from a model name. Required observable protocol cases (specification,
**not executable tests or results**):

1. Unauthorized/foreign/unknown profile or tuple: deny, no inbox/transcript/wake.
2. Valid event: durable inbox then accepted ACK; exactly one original-chat native
   transcript effect + recoverable receipt, separately observed wake and render.
3. Busy: no steering/interruption; retain pending delivery; idle retry one effect.
4. Duplicate/reconnect/failed ACK: same receipt/tombstone, one effect; identity
   collision denied; current ownership rechecked on every recovery.
5. Closed browser: wake completes without channel; reopen reads same saved chat,
   renders exactly one event; native SSE saved-count recovery alone is not proof.
6. Disposable source-fixture abort/crash: no partial transcript/receipt publication;
   committed-but-not-woken state recoverable; never restart installed WebUI.

Visible ACK may be emitted only after qualified original-session receipt with
exact `{version:2,eventId,runId,hermesSessionId,state:'visible'}`. Persisted or
accepted states, diagnostic ACKs, HTTP200, fake sink receipt and renderer source
text must never be substituted. Human/LLM processing remains separately observed.

Rollback after any **future approved** activation: stop only the temporary
subscriber process using its recorded owned identity; preserve inbox, tombstones,
chat and sanitized evidence for review, do not delete existing data. Do not stop
WebUI/relay, restart containers or recreate a service. No process exists to stop
in this run. Parent must approve actual activation only after Steps A/B resolve;
renewed approval is for these concrete changes, not unchanged mapping scope.

## Current outcome receipt

| Outcome | Status |
|---|---|
| Deployed supported turn/renderer/saved-read paths | SOURCE-IDENTIFIED from parent evidence; runtime NOTRUN |
| Exact non-restarting activation command | BLOCKED at Steps A/B; no invented command |
| Offline preflight/protocol executable artifact or adapter | NOT DEVELOPED / NOT TESTED: native ingress/offline source seam absent; docs-only blocked branch taken |
| Actual Pi durable event ingestion / accepted ACK | BLOCKED / NOTRUN |
| Original-session native wake | BLOCKED / NOTRUN |
| Actual visible original WebUI update / visible ACK | BLOCKED / NOTRUN |
| Busy retention/native eventId dedup | BLOCKED / NOTRUN |
| Browser-closed/reopen/duplicate recovery | BLOCKED / NOTRUN |
| 109 checks + 6 probes | Historical independent Rhythm-only PASS preserved, not rerun |
| Native atomic storage prototype | Historical local-source storage only; not deployed adapter/activation |

This is an evidence/compatibility blocker, not a host permission denial. Full
feature is not READY_FOR_VERIFICATION. Parent can verify this mapping read-only;
runtime test commands remain NOTRUN. All future Rhythm commands/tests must use
canonical `tools/dev/sandbox.sh up/status/down`, four fixed paths
RHYTHM_APPROVED_FIXTURE_ROOT=`/private/tmp/hermes-event-notify-20261012-fixture`,
RHYTHM_LIVE_DB_PATH=`/private/tmp/hermes-event-notify-20261012-fixture/rhythm.db`,
RHYTHM_SANDBOX_OPENCODE_CONFIG=`/private/tmp/hermes-event-notify-20261012-fixture/notifier-opencode.json`,
RHYTHM_SANDBOX_DIR=`/private/tmp/hermes-event-notify-20261012-sandbox`, read-only
sanitized inputs and owned4898/4897/4899. This run launches none, changes no
environment/config, and issues no request to live4001/4096 or existing relay.
