---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: BLOCKED
tags: [run, rhythm]
---

# Actual Hermes native notification boundary

## Scope / continuity

Single-owner continuation in
`/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012`.
Initial clean HEAD `082e814b48e5aa913442f6615d62f870612b0d41` verified locally.
Parent handoff reports bootstrap repair independently passed and pushed; parent
monitors new-head CI. No CI query, commit, push, integration or merge in this run.
Read AGENTS, project-state, current-plan, notification v1 contract, notification
run and PR1616 bootstrap recovery run. Loaded acceptance-contract first, then
coding-agent. No orchestrator or peer dispatch. Prior approvals carry forward;
task-scoped permission bypass does not widen authorization.

Permitted boundary: read installed Hermes **source only**, investigate supported
original-session delivery, optionally implement a minimal source artifact under
Rhythm tools/dev and use owned disposable fixtures. No installed Hermes writes,
config/auth/live DB reads, installed-process interaction, real provider calls,
production relay requests, actual AJ session prompts or communications. No new
public/LAN listener, relay/Tailscale change, container/SSH/deployment operation,
shared dependency install, live4001/4096, approval4198 or desktop operations.
PR1615 and approval-reserved source remain separate and untouched. Parent owns
shared origin-dispatch/card-ID integration and independent verification.

## Phase 0 — acceptance disposition

WAIVED: failing behavioral acceptance test for this non-behavioral source-review
and bounded-blocker report only; no implementation or test assertions changed.
This does **not** waive the requested native behavior or turn it into acceptance.
The fixed notification v1 contract remains authoritative: trusted origin before
dispatch; busy retention; eventId dedup atomic with original-session transcript;
recoverable visible receipt; native wakeup and actual visible/browser-closed
behavior proved separately. The generic SQLite fixture remains **not Hermes**.

No behavioral RED or GREEN was run for native Hermes. No test against a mock,
queue insertion or HTTP200 is offered as substitute evidence. Parent verifier
can independently inspect the source references and this report read-only.

## Phase 1 — concrete supported paths / compatibility evidence

Installed local source: `/Users/ajhochhalter/.hermes/hermes-agent`, HEAD
`68518c1f9bca11d9f5dbdf59ecf7e024cce057ba`, describe `68518c1f9`.
AGENTS was the first source file read. Targeted git status below was empty;
this identifies the inspected files, **not** the protected Pi deployment version.
No Pi source/version, sanitized original-session mapping or owned Pi runtime was
provided or inspected. Do not assume local dashboard, desktop, Open WebUI and Pi
WebUI are the same surface.

### A. Dashboard/desktop native JSON-RPC (real supported path, not exercised)

- `hermes_cli/web_server.py:17683–17707`, `gateway_ws`: `/api/ws` is an
  authenticated, request-policy-gated WebSocket, only when embedded chat is enabled.
  It calls `tui_gateway.ws.handle_ws` with authenticated transport identity.
- `tui_gateway/methods_session.py:372–476`: `session.resume` takes the **stored**
  `session_id`, resolves the profile's SessionDB, and returns a live session ID
  plus `stored_session_id`. It can rebind the transport and cancel orphan reap.
  Remote notification IDs alone do not authorize adopting that session.
- `tui_gateway/methods_prompt.py:287–381`: `prompt.submit` takes live
  `session_id`, `text`, and `queued`; it rebinds transport. Busy submits normally
  steer/interrupt according to policy; `queued` selects the queue path. This is
  not a passive notification API. No notification eventId/atomic durable receipt
  parameter was found in this handler.
- `tui_gateway/server.py:8722–8770`, `_enqueue_prompt`: busy text is held in
  session memory and may merge consecutive messages. Its text-self-duplicate
  protection is not durable notification eventId dedup across process restart.
- `server.py:10841–11015`, `_notification_poller_loop`: the **process-local**
  completion queue is consumed by the original session's poller, with positive
  ownership checks, busy requeue, status emission and `_run_prompt_submit`.
  Async-delegation-specific claim/complete helpers are not a general external
  Rhythm notification ingress contract. Do not forge an async-delegation event.
- `tui_gateway/ws.py:518–569` detaches/reaps sessions on transport disconnect;
  `server.py:173–207` resolves orphan reap (default20seconds). Browser-closed
  persistence cannot be inferred from an attached session's status event.

### B. Native API-server wake (different transport, not Pi WebUI proof)

- `gateway/wake.py:56–94`, `deliver_wake`: push adapters use an internal
  MessageEvent through handle_message; non-push adapters use `_self_post_chat_completion`.
- `wake.py:97–169`: authenticated self-POST `/v1/chat/completions`,
  `X-Hermes-Session-Id: <raw stored session ID>`, user message, `stream:false`.
  Missing API_SERVER_KEY raises; 429 has bounded retries. Self-post completion
  returns no eventId-bound durable transcript receipt.
- `gateway/platforms/api_server.py:5108–5164`: explicit session continuity
  requires configured API auth and loads SessionDB history. Without the header,
  it derives a fingerprint session ID—unsafe to substitute for original-session
  binding. `:4495–4552`, `_handle_session_messages`, exposes authenticated
  `/api/sessions/{session_id}/messages` and resolves compression lineage. This
  is an observable transcript surface, not proof a particular WebUI renders it.
- `api_server.py:1339–1384`, `_IdempotencyCache`: in-memory1000-entry/300second
  cache; `:5286–5305` optionally uses Idempotency-Key. It cannot supply restart
  dedup atomic with native transcript persistence. A crash after native turn
  commit but before subscriber receipt remains ambiguous. Do not retry that
  ambiguity and claim exactly-once, or mark visible from HTTP200.
- `gateway/config.py:325–400`, `Platform`: no built-in `webui`; unknown names
  require a known bundled/runtime-registered platform adapter. No plugin
  registration was proved for the protected Pi. Do not invent `webui`/cron origin.

### C. Existing Rhythm private relay is protocol-incompatible with this SSE client

- `apps/api_server/src/routes/relay_gateway_routes.ts:731–740` tunnels
  `/mobile-gateway/*` through requireDevice, not owner-bearer `/hermes-notify/*`.
  Its SSE routes are paired mobile/session streams, not notification v1 replay.
- `services/relay_uplink_protocol.ts:94–113` RPC is finite request/response with
  base64 body; `relay_uplink_client.ts:630–663`, `dispatchRpc`, consumes the entire
  response via arrayBuffer before returning. It is not a streaming SSE tunnel.
- `app.ts:283–284` mounts `/hermes-notify` only on SQLite/nonrelay local execution
  surface. `hermes_notify_routes.ts:8,15–60` requires owner auth, immutable origin,
  pending replay and monotone accepted/visible ACK. Mobile-device auth/replica ACK
  cannot replace these semantics. Subscriber `request` appends `/hermes-notify`
  to a credential-free origin; changing its URL cannot turn mobile relay into it.

GitNexus queries `private relay transport Hermes origin dispatch` and
`RelayGateway relay RPC tunnel uplink` located the relay surface. Upstream impact
on `createRelayGatewayRouter` (Rhythm, matching file, summaryOnly) returned LOW:
1 direct dependent,0 affected indexed processes,1 Services module. Actual source
was inspected; graph counts do not prove completeness. No HIGH/CRITICAL rating.
**No symbol or API handler is edited**, so no API-impact/edit approval is needed.
The complete intended write surface after review is this one run note only.

## Phase 2 — exact bounded blocker / stop

BLOCKED: no qualified existing private owner-bearer notification route to the Pi,
and no version-identified Pi original-WebUI session ingress/transcript protocol
with durable eventId receipts. The inspected native paths identify real turn
entrypoints, but neither demonstrates the required receipt/restart contract for
that target. Extending relay routes/auth or supplying a Hermes-side durable
receipt capability requires parent integration / separately owned source work;
it cannot be hidden in a local generic transcript adapter.

No installed runtime import was attempted: `tui_gateway/server.py:57–60` loads
project-root `.env` **even with disposable HERMES_HOME**, and `:135–140` starts
update checking. `hermes_cli/env_loader.py:491–522` may sanitize/load project
dotenv; `hermes_cli/banner.py:332–347,672–679` may fetch git origin and modify
the installed checkout. Merely changing HOME or setting -B is insufficient for
the specified read-only/no-auth/no-network posture. A sanitized tracked-source
fixture without dotenv/.git and a clean environment could avoid these hazards;
it would still qualify only this local version, not supply the missing Pi
protocol/receipt authority. No assertion that local Hermes cannot run offline.
Stopped at the target compatibility/contract boundary; did not patch Hermes,
start a surrogate gateway or invent a listener/cron/provider workaround.

This is a scope/access/compatibility blocker, **not a host permission denial**.
No operation was denied by the host, and no renewed general authorization is
requested for unchanged scope. Implementation attempts0; repair attempts0.

## Commands / actual results

Rhythm cwd is the notify worktree; Hermes cwd is installed source, read-only.
Source exploration used read/grep tools restricted to named source files (no
configuration, auth or database content). Exact terminal commands:

```sh
# Rhythm initial: empty short status, exact HEAD printed.
git status --short && git rev-parse HEAD
# Hermes: exact HEAD above, describe68518c1f9.
git rev-parse HEAD && git describe --tags --always
# Hermes: empty targeted status followed by source fingerprints.
git status --short -- AGENTS.md gateway/wake.py gateway/config.py gateway/platforms/api_server.py tui_gateway/server.py tui_gateway/methods_prompt.py tui_gateway/methods_session.py tui_gateway/ws.py hermes_cli/web_server.py hermes_cli/env_loader.py hermes_cli/banner.py && shasum -a 256 gateway/wake.py gateway/platforms/api_server.py tui_gateway/server.py tui_gateway/methods_prompt.py tui_gateway/methods_session.py tui_gateway/ws.py hermes_cli/web_server.py
# Rhythm before report: unchanged source, branch printed, no listeners/sandbox.
git diff --quiet HEAD -- apps tools/dev && git status --short && git branch --show-current && lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN; test ! -e /private/tmp/hermes-event-notify-20261012-sandbox
```

| Hermes source | SHA256 |
|---|---|
| gateway/wake.py | `6fa68e922f08c551a792a87a1f82ad7d16f89209395f916d141a571503fdc517` |
| gateway/platforms/api_server.py | `8d87036dd488cb811dbabb7048102d0c28fbf54e0e658c464683000118537ec3` |
| tui_gateway/server.py | `8d508871edd7a53f2d3d4ef100808a565f2972daf9f79a3b45c39e5e9adf692a` |
| tui_gateway/methods_prompt.py | `658c55f43608713d1de26b735a4f288ee27421f8b6a3ae7d1a8e30d6f4c967d8` |
| tui_gateway/methods_session.py | `cd4aed404fdeb4e0312227dc012eb2fcecf4c487a89ee61104e6f6e74a069114` |
| tui_gateway/ws.py | `93bbae032260a752a8d232e93b94867f614ef29771a9490d42abdff1c0e2d23e` |
| hermes_cli/web_server.py | `553ace4dfc7eb3f13e3e492b1be4c6410bb3a0fe659515d8d50871f5edc29b9f` |

## Status / safe next step

| Gate | Actual status this run |
|---|---|
| Supported local native turn/transcript entrypoints | SOURCE-IDENTIFIED, runtime NOTRUN |
| Actual Hermes notification ingest | BLOCKED / NOTRUN |
| Synthetic original-session native wakeup | BLOCKED / NOTRUN |
| Actual original-session visible transcript | BLOCKED / NOTRUN |
| Browser-closed delivery / reopen rendering | BLOCKED / NOTRUN |
| Native busy queue / restart eventId dedup | NOTRUN; inspected candidates insufficient |
| Prior20notify +49bootstrap checks | Historical independent PASS receipts read; NOT rerun here; source/assertions preserved |
| New-head CI | Parent-monitored; not queried or claimed green |
| Owned sandbox / fixture servers | NOT started; named sandbox absent,4898/4897/4899 no listeners |
| Origin-before-real-dispatch / canonical cardID | Parent integration required; no reserved-file edits |

Safe next step: parent obtains a **sanitized source/protocol artifact**, not
secrets or live data, identifying exact Pi WebUI/Hermes revisions, original-session
ID mapping and existing authorized private ingress/transcript surface. Separately
resolve the durable receipt capability and private transport with their owners.
Only then bind a source-fixture test to the real supported entrypoint and fixed
synthetic session/provider inputs, with independent transcript/reopen assertions,
busy/restart/crash replay and no token notifications. Any Rhythm runtime checks
must retain canonical tools/dev/sandbox.sh and the four existing fixture/path
variables with owned ports4898/4897/4899 from the bootstrap run. No permission
to change deployments, access credentials or restart installed Hermes is implied.

Only file added: this run. No deployable native adapter or full-success claim.
Parent independent review is required; full feature remains **BLOCKED**.

Final local validation:
`git diff --check && git diff --quiet HEAD -- apps tools/dev && git status --short && git rev-parse HEAD && test ! -e /private/tmp/hermes-event-notify-20261012-sandbox`
exited0; only this untracked run note listed; HEAD remained082e814b48e5aa913442f6615d62f870612b0d41.
Diff whitespace check covers tracked changes, not the untracked Markdown note.
No application/test changes or sandbox runtime were created.
