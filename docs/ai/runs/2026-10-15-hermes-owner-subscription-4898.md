---
date: 2026-10-15
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: 1617
issues: [NOTIFY-HERMES]
status: native-ack-pass-boundary-fixture-fail
tags: [run, Rhythm]
---

## Scope / approvals
Explicit parent specialist handoff: finish real owner MCP subscription to native
browser ACK with test/environment correction only. HEAD12b6521e; preserve dirty
caf implementation and five unrelated Mac files. Canonical owned sandbox ports
4898/4897/4899 approved; no subscriber/native allowlist weakening, transport remap,
Bridge enrollment, product/auth/DTO/engine edits, live data, app restart, packaging,
commit/push, deployment or signing. Parent independently verifies frozen checks and
owns subsequent integration. Existing approval remains resolved for this scope.

## Phase 0 — complete
Loaded acceptance-contract first and coding-agent second. Read repo memory, previous
run and regression registry. Frozen acceptance assertions in
tools/dev/hermes_owner_subscription_checks.mjs and native helper are the mandate;
only fixture/port configuration is corrected, not assertions.

RED command:
`env -i PATH=/usr/bin:/bin:/opt/homebrew/bin RHYTHM_LIVE_E2E=1 tools/dev/.hermes-shipping-runtime/node/bin/node tools/dev/hermes_owner_subscription_checks.mjs`
Exit1: `ValueError: HTTPS or exact opted-in loopback origin required` at Subscriber
construction on5598. Source5d340568-28d8-4981-90fc-8d2996c07638 was actually created;
native66ea4a748bfb actually born/linked. API35/MCP4/CLI1 passed, strict MCP passed;
stock sandbox up/status/down passed; sanitized diagnostics `.evidence.G99Ktg`.

## Phase 1 — complete
Ports4898/4897/4899 had no listeners before correction (lsof exit1, unrelated SMB
stat warning). GitNexus impact queried both helper paths and provision main:
UNKNOWN/unindexed, not zero-risk evidence. Read both entire acceptance helpers and
provision endpoint/binding writers. Intended changes: helper fixture paths and
canonical ports only. No shared product symbol edits. Risk: fixture config mismatch
or delivering to wrong native binding; retain exact origin validation, fresh
canonical builder fixture, immutable link and browser/source ACK assertions.

## Files / Checks / Notes
Changed only tools/dev/hermes_owner_subscription_checks.mjs and
tools/dev/hermes_owner_subscription_native.py fixture/port configuration, plus this
run record. Original read-only5598 fixture is untouched. Fresh builder fixture:
/private/tmp/hermes-owner-subscription-4898-20261015-fixture; stock sandbox:
/private/tmp/hermes-owner-subscription-4898-20261015-sandbox. All four explicit path
variables and all three ports are set in the executable runner. Node22.23.0 and
cached engine SHA256 d60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072.
Validation results follow; no readiness claim yet.

## Phase 2 — bounded result, not complete
Every invocation used the RED command above: env-i; Node22.23.0; four explicit
path variables in runner; API4898/engine4897/gateway4899; verified cached engine
d60f5a with skip-build1; sqlite/shadow/PURE; monitoring/default plugins/model fetch
off. Stock sandbox up/status/down each time, no hand-started API.

1. Port/path correction alone: **full command exit0**, diagnostics
   `.evidence.HaWrd4`. API strict build, MCP strict tsc, unchanged API35,
   registration4, CLI1 and inventory114 PASS. Official MCP subscribe/unsubscribe,
   immutable destination, body tamper/missing bearer, disabled history/ACK PASS.
   Source de407d3d-5d18-4297-ab9e-9475ec235511, native fc989be1c651,
   event0650e9a3-a6c3-46a0-a42e-74039bf46628: real browser/source ACK PASS.
2. Added requested coverage: native selected event held at deterministic provider
   boundary, source accepted/no render metadata, duplicate plus subscriber DB
   reopen still one effect, release then actual browser/source visible ACK.
   Added tools/dev/hermes_owner_subscription_boundaries.mjs, invoked after original
   checks. Sources all born POST /agent-sessions201 with real durable SDKs. SQL only
   mutates revocation fields on disposable rows, never creates sources/events/ACKs.
   SDK negative uses another API-created source's actual SDK, not invented identity.
3. Expanded run `.evidence.9CiWjT`: native/browser/ACK PASS; matrix failed on an
   incidental assumption that ordinary PATCH would404 on a revoked row. Repair1
   expected200; `.evidence.ZuET5c`: native/browser/ACK PASS; later revoked PATCH404.
   Repair2 permits ordinary PATCH200/404 (permission/engine lookup), while the
   required notify history/SSE/ACK404, no rebind and preserved-row checks remain
   exact. These incidental PATCH expectations were not subscription criteria.
   No product auth changed. Stop after these two matrix repairs.
4. Final `.evidence.LJ2Lpd`: API35/registration4/CLI1 and strict builds PASS;
   native/browser/ACK PASS. Matrix owner transfer, NULL-owner and current-SDK
   history404/new SSE404/ACK404/rebind denial/existing SSE closure/no new rows
   reached and passed. Then project fixture mutation failed with
   `SQLITE_CONSTRAINT_FOREIGNKEY` at boundaries.mjs38: the synthetic project target
   has no project row. **Full command exit1.** Project/expanded unsubscribe matrix
   not completed; original MCP unsubscribe/history404/ACK404 checks passed.
   Next repair is test-only: create a synthetic project through supported API or
   canonical fixture builder and use its actual ID; retain notify assertions.
   No product defect identified. No further repair attempted in this stage.

### Final actual native proof / protected evidence
- Owner1 confirmed by identity API200. Source
  `7b39b805-9f79-4905-aa6d-c1a430222330`; nativeSID `99c3e3f60079`;
  selected event `72cc6cfd-3e72-499e-9d82-dd22d0acc395`.
- Evidence directory:
  `/private/tmp/hermes-owner-subscription-4898-20261015-fixture/owner-native-e3impp96`.
- `current-shipping-native-ack.png` visually inspected: source update plus actual
  assistant "Fixture native reply." visible. DOM732x24.5 unobscured, exactly1
  qualified receipt; foreign-chat and modal-obscuration denial PASS. SHA256
  `e9e2a8e5a4e9be648eb74b82470227ba7a7aa543e00d32361497941f0bc04405`.
- Protected `render-receipt.json` saved; canonical sorted receipt payload SHA256
  `f56cbe857c442c40d004c27c73ccf326498c00c53faf168927216207146dcef6`.
  This is canonical payload digest, not the atomic file-byte digest. Nonce/token
  values must not be printed.
- Protected600 `provider-calls.jsonl` SHA256
  `10c5e25899ee7878187d90996d6701f9cc67360bafd952b46a1e56eb65366c34`.
  One effect per selected event; no source model request. Owner file600 verified;
  fixture DB and config400 verified. No live runtime credential read.
- Snapshot107 + patch7 hashes checked before copy. New native HTTP birth+rename,
  messages0/no provider before delivery, immutable Receiver.link/current binding,
  actual API PATCH->engine session.updated->outbox exact11-field V2 history/SSE->
  pinned NativeAdapter->real worker/journal/save->Chromium receipt->source ACK.
  Only upstream provider replaced by FixtureAgent; native/subscriber unchanged.
  No fake source POST event, inserted source/event/ACK, or Bridge enrollment.
- Source visible retained SQL row plus selected event absent from actual HTTP
  replay; agent_session descriptor uses actual local sourceId/runId/sessionId,
  workflowRunId null; no completion events; Bridge jobs0.

### Files / final hygiene / handoff
This stage changed two existing helpers, added
tools/dev/hermes_owner_subscription_boundaries.mjs and this log only. Existing
caf API/MCP/provision code, API35/registration4/CLI1 test files, pinned native and
subscriber, and five unrelated Mac files not edited. `git diff --check` exit0.
Final lsof4898/4897/4899 exit1/no listeners (unrelated SMB warning); stock shutdown
retained sanitized diagnostics. No app/Pi restart, live fixture, enrollment,
auth/DTO/engine/Bridge change, dependency install, Git commit/push, signing, CI,
deployment or destructive cleanup.

**NOT READY_OWNER_MCP_SUBSCRIPTION** aggregate: required project/expanded
unsubscribe matrix incomplete. Real owner MCP->browser->source ACK is now PASS
on expressly approved4898; not port-blocked. No separately instrumented fake-cap
file read/request audit or direct old engine-only MCP403 live call was added;
do not infer these from Bridge jobs0. No native-process-restart or second-event
busy-queue claim: busy duplicate/subscriber-DB-reopen proof covers one selected
real event. Parent verifier can rerun same command against read-only source with
writable disposable fixtures after fixing project fixture. Preserve approved
scope/exclusions; no renewed approval needed for unchanged test setup. Parent
must note112+2=114 tools in PR1617. Integration/commit,0.18.79 notarization and
artifact-specific app-switch ASK remain parent-owned; no live rollout claim.
