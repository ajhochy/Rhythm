---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: READY_FOR_VERIFICATION_NATIVE_VISIBLE_SLICE_ONLY
tags: [run, rhythm]
---

# Focused native visible implementation

## Scope / approvals / ownership

Explicit parent specialist handoff; acceptance-contract loaded first, coding-agent
second. No orchestrator or peers dispatched. Worktree
`/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012`,
retained HEAD `ee914fce`. Read AGENTS, project-state/current-plan and focused native
run. No new feature/scope approval requested: approved receiver/native receipt,
minimal existing-renderer hook, concrete NativeAdapter, native patch outputs and
visible tests only. Necessary patch builder/verifier/guard updates included.

Host writer64d owns host_job/test_host and its run; none read, edited or executed.
Prior model/profile fence, original 107 pins and frozen red tests retained.
Subscriber/consumer implementations and their dirty state were not edited.
No SSH, installs, runtime restart, live chats/cards/DB/config/credentials, real
provider/tool operations, production/relay/Tailscale calls, migration, shared
dependency install, destructive cleanup, commits/push/merge/deploy. No host
permission denial or bypass involved. Parent independent final gate, host output
integration and existing-inbox schema migration hold remain in force.

## Phase 0 — frozen executable RED

All Python commands below run from the retained worktree `tools/dev`.

```sh
python3 -B -m unittest hermes_webui_receiver.test_native_visible_contract -v
```

Observed `Ran 1 test in 5.802s / FAILED (failures=1)` at unchanged line38:
actual state `completed`, expected exact five-field state `visible`. Real renderer
hit `<p>Fixture native reply.</p>`, width732/height24.5, unobscured=true. This is the
requested behavioral failure, not an import/setup failure. Mandate: make this
unchanged contract pass, not weaken it. Parent independently re-runs the contract
against read-only artifacts with verifier-owned temporary HOME/evidence.

## Phase 1 — bounded impact review

Inspected native.py, receiver.py, patch builder/verifier, source guard, actual
server GET/write dispatcher, browser auth/login session reconciliation, existing
CSRF/origin helpers, profile context getter, real renderer data-msg-idx callsites
and renderMessages cache/scroll boundaries, native wakeup/browser fixtures and
subscriber owns/deliver/drain interface. No second renderer was introduced.

GitNexus upstream impact for Native, drain, build, renderMessages and verify in
their copied/native paths returned `Target not found / UNKNOWN` for every query.
Caller/process blast radius is UNKNOWN, not zero. No HIGH/CRITICAL result was
returned. Static callers reviewed: server → scoped handlers; owned drain → observe;
existing renderMessages calls from UI/session/stream flows → bounded receipt;
subscriber inbox drain → NativeAdapter.deliver. Risk review: auth+CSRF must not be
bypassed, saved completion is not visibility, stale/foreign replies must not claim
the owner, and background completion must never overwrite a visible receipt.
Actual copied HTTP/auth boundary and real DOM tests were proportionate checks.

## Files / implementation

Direct implementation and checks under `tools/dev/hermes_webui_receiver/`:

1. `native.py`: scoped GET render-metadata and POST render-receipt after existing
   browser login gate; explicitly reuses existing CSRF/same-origin guards. Owner
   matches existing verified login username, or operator-provisioned protected
   browserSessionDigest for an existing identity-less login. Auth-disabled LAN
   retains its existing single-operator trust boundary; profile/session/link are
   still rechecked. No browser Rhythm bearer. Under session lock + SQLite write
   transaction, recheck current protected run, submitted event/hash/turn, completed
   journal, exact saved assistant hash/index, busy state and server-created nonce.
   Reject user-body owner/arbitrary state/text, wrong chat/turn/event/hash/nonce,
   absent completion and revoked links. Persist idempotent visible receipt.
2. `receiver.py`: additive render_proofs table; background state updates cannot
   regress an already visible receipt. Existing schema migration remains excluded.
3. `render_receipt.js`: appended to existing UI, invoked at real renderMessages
   entry (including cached/reopen render paths). Bounded 0/100/500/1500ms render
   opportunities, plus existing visibility/focus/scroll events; no polling worker
   or LLM wakeup. Check selected chat, nonbusy, foreground document, exact saved
   message content at native index, existing rendered row, viewport and hit-test.
   No source-text-only test, second renderer, DOM seed, injected CSS, or nonce
   instruction. Visibility is authenticated UI-relay attestation, NOT proof of
   human reading. Same event is relayed once after successful receipt.
4. `native_adapter.py`: stdlib NativeAdapter owns/deliver; same-UID regular 0600
   registry/token files opened NOFOLLOW; exact protected binding and token digest,
   protected native receiver endpoint. Native private HTTP needs explicit opt-in;
   fixture loopback origin is exact. No redirects/proxies, no secret argv/logs or
   login. Deliver performs bounded receive+status, returns None until real visible,
   then only the exact five-field receipt. Subscriber heartbeat/recovery provides
   later opportunities; Rhythm's existing exact4001/4898 policy is unchanged.
5. `build_native_patch.py`: exact original-pin recovery retained; new ui.js output
   and scoped browser route registrations; seven output manifest regenerated.
6. `verify_native_artifact.py`: Python and node JS syntax verification and accurate
   output/pin counts rather than stale five-output text.
7. `test_visible_receipts.py`: actual HTTP forgery/replay/revocation/body-owner and
   closed-browser actual adapter checks. Direct receipt requests here test the
   trusted relay boundary; they are NOT presented as real DOM proof.
8. `test_visible_reopen.py` + `test_visible_reopen.mjs`: actual adapter → copied
   HTTP → saved reply with browser closed → foreign chat → real existing app
   confirmation modal obscuration → correct unobscured renderer → exact native
   visible receipt → reopen, one provider call. No fake adapter visible response.
9. `test_visible_auth.py`: auth-enabled copied HTTP using actual existing session
   provisioning in isolated fixture HOME. Unauthenticated401, foreign-owner404,
   missing CSRF403, wrong origin403, body owner400, owner+CSRF visible200.
10. `native.patch`, `native_patch_manifest.json`, `source_guard.json`: new output
    identities, visible slice status, still unqualified for installation.

Seven generated source paths were written:
`source_snapshot/server.py`, `api/routes.py`, `api/models.py`, `static/ui.js`,
`api/rhythm_notify.py`, `api/rhythm_inbox.py`, `api/rhythm_schema.py` (all api/static
paths relative to source_snapshot). Four generated outputs changed contents this
slice: server.py, ui.js, rhythm_notify.py, rhythm_inbox.py. Models/routes/schema
outputs remain the prior bytes. In total this run wrote **21 paths**, including
the seven generated outputs and this dedicated run; **18 content-new/changed
paths**, with the three unchanged regenerated outputs counted separately.

## Checks — two rounds only

Attempt/check1:

```sh
python3 -B -m hermes_webui_receiver.build_native_patch && python3 -B -m unittest hermes_webui_receiver.test_native_visible_contract hermes_webui_receiver.test_visible_receipts -v
```

Observed `Ran 3 tests in 9.403s / OK`; frozen actual renderer returns exact visible
receipt. Before check2, added saved-content comparison, explicit existing CSRF
reuse, trusted login reconciliation, real reopen/obscuration and auth tests.
No failed-check repair or third implementation/check round occurred.

Attempt/check2 (final artifact):

```sh
python3 -B -m hermes_webui_receiver.build_native_patch && python3 -B -m unittest hermes_webui_receiver.test_native_visible_contract hermes_webui_receiver.test_visible_receipts hermes_webui_receiver.test_visible_reopen hermes_webui_receiver.test_visible_auth hermes_webui_receiver.test_repair_round1.RepairRound1.test_queued_profile_mutation_cannot_be_erased_to_authorize_launch hermes_webui_receiver.test_repair_round1.RepairRound1.test_saved_completion_is_not_forever_started hermes_webui_receiver.test_native_http hermes_webui_receiver.test_native_wakeup hermes_webui_receiver.test_native_browser test_hermes_webui_receiver test_hermes_notify_subscriber -v && python3 -B -m hermes_webui_receiver.verify_native_artifact && git diff --check
```

Observed `Ran 30 tests in 65.649s / OK` = unchanged existing10 native/profile/
completion + existing15 receiver/subscriber units + five visible checks.
Verifier: `PASS: 7 patched outputs; all 107 original pins recovered exactly;
Python/JS syntax verified`. `git diff --check` passed.

```text
ACTUAL_RENDERER_NATIVE_RECEIPT {"eventId":"fixture-event","hermesSessionId":"fixture-chat","runId":"fixture-run","state":"visible","version":2}
{"closedAwaitingRender":"PASS","foreign":"PASS","obscured":"PASS","reopen":"PASS","qualifiedReceipts":1}
QUEUED_PROFILE {"profile":"foreign-profile","providerCalls":1,"status":[404,{"error":"unavailable"}]}
CLOSED_BROWSER_COMPLETION {"version":2,"eventId":"fixture-event","runId":"fixture-run","hermesSessionId":"fixture-chat","state":"completed"}
```

Existing real browser liveDOM/reopenDOM/foreignChat PASS, 14 external requests
aborted. Existing sandboxed serviceWorker diagnostics and git-info400 remain;
not a clean-console claim. Frozen tests and browser driver's assertions unchanged.
Only external upstream provider is deterministic fixture setup; native server,
turn/save/journal, receipt and existing renderer are actual copied implementations.

## Artifact identities / parent handoff

Native patch SHA256 `a4c0ec35fe76226db0a484367282c437ed2507fabdbdfdc22ffaaccee6e15a01`.
Manifest SHA256 `e56afa198b585de76f3d416eda799fc5335a7d36d5471f7d9211a06c4d868c3a`.
Native module SHA256 `52a90a9e785c3bde30cd11f766a3c861eedbaed738dcedc695478e75548df780`.
Builder SHA256 `e16291f05ad4d1bc3f6b7530e4601bb2ccb4c7ab715f9f5234ba897349319224`.

The manifest is authoritative for all seven output hashes. Original107 pins
remain unchanged/recovered. Preserved model output SHA256
`3c943e69fc18b33768a852c256c15825447bb3065cf3933946ec80116bafec43`, routes output
`a6b0ceb93cd4cdfc09c5d79480713faeaf16d4939cb92680e3d930f0e3603d34`, schema output
`8b0002f10c6906443af059920bf93fd60810d7e16f58351b381324ebce85af38`.
New seventh output `static/ui.js`, SHA256
`7e5ba50ec4c03c8797fafc49bb989de2a95967955f617e79ced23cf3ad4791ce`.
Parent host writer must integrate exact seven-output manifest; not done here.

## Remaining honest gates / teardown

**Actual subscriber → real Rhythm4898 V2 membership → nativeHTTP → DOM → ACK is
NOTRUN.** This dispatch supplies no canonical sanitized fixture root/database/
Opencode config/run membership identifiers. No live credential/DB inspection or
invented arbitrary parent/run membership was used to fill them. Concrete adapter
and native-visible pipeline are GREEN, but subscriber real ACK remains a separate
parent integration gate; the unit subscriber tests are not claimed as that gate.
Canonical four-variable 0400-fixture sandbox up/status/down on4898/4897/4899 was
NOTRUN because no Rhythm API test was started. No manual Rhythm API/engine process
was launched and no live4001/4096/approval4198 was touched.

Auth-disabled LAN's trust boundary and UI attestation do not prove human reading.
Whole-race/durable authority revision/reset/shrink qualification remains excluded,
as requested; native receipt checks current saved bytes rather than qualifying
all historical rewrite races. Existing inbox CHECK migration and host/schema
integration hold remain mandatory before deployment. Identity-less logins require
protected operator browserSessionDigest referencing their existing login; no new
login path was added. Authenticated browser+provider/relay credentials are never
interchanged.

All fixture server/provider children terminate/wait in finally; browsers close
in finally; isolated copied sources/HOME/state/temp auth tokens are disposed by
TemporaryDirectory. No persistent listener or live runtime action belongs to
this run. Independent verifier can read the resulting artifact without modifying
it: fixtures copy to verifier-owned temporary directories; frozen contract's
evidence defaults to temporary HOME (or verifier-specified existing evidence dir).

**READY_FOR_VERIFICATION — native visible slice only.** Parent independent final
gate, actual Rhythm ACK and host/schema integration pending; NOT install-ready.
