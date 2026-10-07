---
date: 2026-10-07
repo: Rhythm
branch: codex/coordinator-conversation-20261007
pr: "https://github.com/ajhochy/Rhythm/pull/1610 (stacked on #1604)"
issues: []
status: pending
tags: [run, rhythm, approvals, investigation]
---

# Live approval regression investigation

Draft PR: [#1610](https://github.com/ajhochy/Rhythm/pull/1610) with product commit `30f51138`, stacked on #1604. No merge or install occurred.

## Scope

Read-only review of the currently running signed desktop candidate, its active
SQLite/WAL state, renderer provenance, repository history, and persisted tool
metadata. No approval was requested, approved, rejected, or consumed in the
running app; no UI was
opened after the Computer Use observation was corrected to a different app copy.
Normal PIDs 8192, 8198, and 8242 remained unchanged.

## History and installed provenance

- `9fa2761e` (2026-08-15, #1393) introduced inline and native approval delivery.
- `c3961b02c1c89f21b474b284ec97b5db12d62ca6` added approval-queue refresh/error
  presentation. It is an ancestor of the signed installed candidate and is not
  an ancestor of C17.
- `5c366674` (2026-10-06) introduced the signed bounded-workflow proposal path,
  including direct creation of a pending `agent_approvals` row only after its
  foreground, source, and plan-root checks pass.
- Signed candidate `237f54db60bb0f58f42e8f0fbce3b1069a70c652` is a descendant of
  C17 and contains the queue refresh fix. Root verified the packaged renderer
  asset SHA-256 `e291f5a0927875f9c25ee90ab950060efb01e548ac881bc952125fae7ca37714`.
  The source comparison records unchanged Flutter approval renderer/API-route
  blobs from C17 to the installed candidate, and unchanged web shell/store and
  approval-gateway blobs; only the unrelated web transcript blob differs.

The exact provenance and renderer markers are in
[`live-approval-renderer-provenance-20261007.json`](../evidence/live-approval-renderer-provenance-20261007.json).
It confirms the installed renderer contains `Refresh approvals`,
`approval-queue-status`, and the preserved-card warning text. It does not prove
an authenticated nonempty queue rendered in the correct desktop app.

## Matching AutoTrack report

The exact user report is in AutoTrack local session
`5d18be45-d0bd-464c-9c55-34a8ddda43d4`, at `2026-10-07T21:28:22Z`.
It concerns an engine Bash permission, not the separate `agent_approvals`
workflow-card table. The original engine request
`per_117cef424001QiWjg43aZPYJB4` is independently recorded as an ask at
`19:20:01Z` in the current engine log, line 45248. The next line records
`permission.asked` publication.

The API log is more decisive than the assistant's later explanation:

- `~/Library/Logs/Rhythm/api_server.log:17448` records automatic handling in
  a bypass-permissions, non-headless session.
- Line 17449 records `replyToPermission failed (404)` at
  `2026-10-07T19:20:01.464Z` for that exact permission ID.
- The installed modern reply route returns 404 when the request is not
  pending in the routed directory. It does not fall back to a legacy route.
- The assistant later claimed to cancel the request. Its cancellation command
  itself appears in another engine permission ask, `per_118458f69001RIpMyURY3lceAq`,
  at `21:29:34Z`. No stored successful reply or rejection was recovered for
  either request. The claimed cancellation is not verified.

The old ask log omits its session ID and directory. The SDK ID embedded in
the cancellation command identifies its target, not necessarily the session
issuing either ask. Initial requester attribution to child `858a8f24…` was
therefore withdrawn. That known child's current engine directory and persisted
local CWD both match the FPS CamControl project root; its earlier durable
delegation completion is not evidence about the unidentified requester's
lifecycle. A current read-only `GET /permission` for that project directory
returns an empty queue, which cannot explain how the old request disappeared.

A final read-only persistence search found no exact permission-ID match in
engine permission/event records or in the 52 candidate part rows from
19:19:00–19:21:30 UTC. Current retained persistence therefore does not recover
the original requester or directory; this is not proof that the event was
never emitted.

## Recovery and routing review

History was inspected before source changes. OCU-03/#1044 added pending-request
recovery; #751 added durable SDK lookup for incoming events; #1382-D unified
permission policy across live events and recovery. E24's renderer evidence
covered HTTP/WebSocket fixtures, while its live check had no real pending ask.
That history does not prove populated native delivery worked in this incident.

Two source gaps were found and kept distinct:

1. Pending-request recovery uses only the ephemeral SDK map, unlike incoming
   events' durable database fallback. This does **not** explain the original
   request: its event reached the API and elicited a reply. No fix for this
   separate gap is included in this follow-up.
2. The global SSE adapter preserves `__directory`, but the permission event
   handler drops it and falls back to the local session CWD. A mismatch can
   route a reply to another engine instance and produce 404. The narrow fix
   preserves the event directory for automatic replies; the isolated real
   engine/API transport regression passed. The historical envelope was not
   retained, so this is not established as AutoTrack's exact cause.

The directory change does not repair every stale-CWD path. Manual reply
endpoints and the HTTP pending-permission listing still use persisted
`session.cwd`; a stale value can therefore still affect manual replies and
reconnection. No manual 404 was observed in the matching trace: its confirmed
failure was automatic. Full manual/reconnect routing is outside this narrow
follow-up and remains unverified.

The existing automatic path also announces `permission.resolved` before the
engine reply is acknowledged. The follow-up now emits that frame only after
a successful acknowledgement and keeps failed replies retryable on a later
recovery read. It does not promise an automatic retry or invent a pending card.
This observation alone does not establish the installed Electron
UI's reaction: Flutter accepts both `permission.resolved` and
`permission.replied`, while the web store closes cards on `permission.replied`.
No generic error event is added because the web store interprets it as a
terminal session error; a failed reply does not prove that the session ended
or that the request remains pending. Local policy-denial notices remain
immediate; glob-watchdog timing is unchanged to avoid introducing a
progress-before-acknowledgement race.

A bounded 60-second read-only global event observation subsequently captured
four unrelated ask/reply pairs with matching request IDs and directories.
There was no AutoTrack event and no matching reply-failure log for those four
IDs. This confirms that permission replies can succeed in the current runtime;
it does not reproduce or explain the historical AutoTrack failure.

## Separate Coordinator evidence

PID 8198 holds the WAL-aware active Electron database at
`~/Library/Application Support/Rhythm Electron/rhythm.db`; the read used
SQLite `mode=ro`, not an immutable snapshot. At the observation point, the
newest approval card was `2026-10-06T13:31:07Z`; there were no pending rows, no
cards in the preceding 24 hours, and 26 cards in the preceding seven days.

The live `Rhythm Coordinator` session `90af1132-780…` uses the Secretary
profile (configured `anthropic/claude-sonnet-5-5`) with a persisted fixed
`anthropic/claude-opus-5-5` session model. It is also
`bypassPermissions` with `approval_bypass_explicit=1`. Its tool event history
contains one generic `rhythm_request_approval` call at `2026-10-07T15:20:04Z`
(08:20 PT; 24 ms), but its response is not recoverable from persisted metadata
and it created no row. Timing correction: this record predates the current
PID 8192 launch at `2026-10-07T18:14:56Z` (11:14 PT), so it cannot be
attributed to the current signed `237f` bundle. It contains zero bounded
proposal calls and zero bounded start calls. Therefore no evidence shows the
current live Coordinator reached either the bounded proposal creator or a
pending-card renderer.

Root also made read-only engine requests to `http://127.0.0.1:4096/permission`
and `/question`: both returned HTTP 200 with empty arrays for the default
context and when given this Coordinator session's persisted CWD. This is narrow
current queue evidence only; it does not establish that no other CWD or session
has a pending engine permission or question.

## Limits and next evidence

The fixed-root/profile-equality problem introduced with C17 is independently
confirmed in the P2 sandbox: a plan-mode, non-bypass fixed Opus root against the
Secretary Sonnet default held two bounded proposals before card creation. The
working candidate permits only that persisted fixed override and Q3 created
sandbox cards. This is separate from the current live session, which has an
explicit bypass and did not invoke the bounded proposal tool; it does not
establish the cause of the user's live observation.

The matching chat and engine permission failure are now identified. A renderer
regression is not proven, and the historical reason for the scoped 404 remains
unresolved. The Coordinator/table observations above do not explain AutoTrack.
No agent may create or decide an approval in the running app. Any repair is
verified only in the stock isolated sandbox, with transport fixtures
distinguished from actual-model and installed-UI evidence.

All four CI checks passed for draft head `058073b2`, whose apps tree is identical
to tested product commit `30f51138`. Those results precede this follow-up and do
not qualify later source edits. Sanitized read-only trace and CI receipts live
under `/Users/ajhochhalter/Documents/Codex/2026-10-07/coordinator-conversation-evidence`.

## Follow-up review and fixture qualification

Product changes are limited to `apps/api_server/src/services/opencode_stream_bridge.ts`.
The event directory reaches the existing policy function; the acknowledgement
callback changes only when resolution is announced. Pre-edit GitNexus impact
was HIGH for `_relayEvent` and `decidePermission` (10 upstream results, two
direct callers, create/resume/fork flows) and LOW for `beginPermissionReply`
(seven results, one direct caller). HIGH was disclosed and drove verification;
it did not reopen the user's approved scope.

Root independently ran 88 focused tests: six files/81 tests in
`permission-routing-root-focused.log`, plus two security/legacy boundary
files/seven tests in `permission-routing-root-boundaries.log`. The first run's
five obsolete synchronous-resolution assertions and the live fixture's initial
nullable-session type error are preserved in the corresponding `*-red.log`
receipts. After repair, API typecheck exited zero. A separate Terra integration
review found no actionable defect and confirmed that hard-denial behavior and
the manual/reconnect limitation remain intact.

The live test uses a loopback scripted provider with the actual fork and API.
It qualifies automatic permission transport and observable tool execution; it
is not actual-model judgment, real delegation creation, profile projection,
or installed desktop evidence. Its owned session is explicitly configured with
read-allow/edit-ask rules, and only its own parent/CWD fields are changed after
provider admission to exercise stale persisted CWD.

Fixture setup failures were kept separate from product results: a missing
project/owner export caused a legitimate `history_ambiguous` hold; a detached
background API exited after its command returned, consistent with the documented
automation-host cleanup behavior; a profile did not
project the exact required edit rule; and a provider probe caused an empty-JSON
parse error. No Dayflow guard was weakened. The documented Q3 adapter pattern
supplied only managed-context exports and workstream enablement to the exact
owned server invocation. Keeping the stock restart command attached retained
the API process for testing; no API was launched by hand.

Root's serialized live rerun exited zero: **one passed, one skipped**, 10.78
seconds. It observed matching real engine ask/reply events at the authoritative
directory, a completed file edit and final output, an empty permission queue,
and a still-stale persisted CWD. The focused unit regression was RED before
the forwarding fix, using `/persisted/project` instead of the event directory.
The live command, run from `apps/api_server`, was:

```bash
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4598 \
RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4597 \
DB_PATH=/private/tmp/rhythm-permission-directory-sandbox-20261007/rhythm.db \
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-permission-directory-sandbox-20261007 \
npx --no-install vitest run \
  src/__tests__/issue_1458_bypass_engine_permission_live_e2e.test.ts \
  -t 'global event directory' --no-file-parallelism
```

The fresh final `npx --no-install tsc --noEmit` also exited zero. Product bridge
SHA-256: `039b01bbea2993236a3812bbca4fe6bd3c66a94e46a4457c572da48d65103c35`;
live test: `92ee2ba2071e15a04884ed9570eb0d12a3accb7124dc1f33bec44f40a857d757`;
engine binary: `bf0475608e7ef7b41cef81fb02f88645c437e1412f4bd6f3edc4361c884316b5`.
Exact build/source/log provenance is in `permission-routing-root-receipt.json`.

Stock `tools/dev/sandbox.sh down` exited zero using the same fixture, adapter,
directory, and port settings as launch. It removed only the owned runtime and
preserved sanitized logs at
`/private/tmp/rhythm-permission-directory-sandbox-20261007.evidence.kgh45L`.
Independent assertions confirmed no listeners on4597/4598/4599 and unchanged
normal desktop/API/engine PIDs8192/8198/8242 with their original launch times.
The synthetic fixture and worktree are retained; no normal app was opened,
restarted, replaced, or installed.

Pre-commit `gitnexus detect-changes --scope staged --repo rhythm-coordinator-conversation`
exited zero: nine files, seven mapped symbols, zero affected indexed processes,
aggregate LOW. Only the expected bridge methods/class and documentation were
mapped. This aggregate diff rating does not replace the disclosed HIGH upstream
impact for the shared permission methods. Generated proof PNGs remain excluded.
