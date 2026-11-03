---
date: 2026-10-15
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: 1617
issues: [NOTIFY-HERMES]
status: READY_OWNER_MCP_SUBSCRIPTION
tags: [run, Rhythm]
---

## Scope / approvals
Explicit parent handoff; single owner worktree HEAD12b6521e, existing dirty caf
source retained. Write only tools/dev/hermes_owner_subscription_boundaries.mjs
and this run note. One fixture correction attempt: create one legitimate project
through authenticated POST /projects in disposable sandbox DB, use returned ID,
assert FK row exists. Extra project is test metadata only. Keep all original
notify404, immutable binding, retained journal and SSE closure assertions.
Add requested absent-capability read / outbound request audit without changing SUT.
No product/auth/source/native/subscriber/validator edits, runtime enrollment,
live4001/4096, app/Pi restart, install/build artifact, CI, commit/push or cleanup.
Parent independently verifies the frozen aggregate before integration/0.18.79.

## Phase 0 — complete
Loaded acceptance-contract first, coding-agent second; read memory and prior run.
WAIVED: non-behavioral test-fixture repair only; no product behavior changes.
Existing failing acceptance evidence is recorded in
2026-10-15-hermes-owner-subscription-4898.md: full aggregate exit1,
SQLITE_CONSTRAINT_FOREIGNKEY at project mutation, not a product failure.
Mandate: preserve existing assertions and make the complete existing command pass:

```sh
env -i PATH=/usr/bin:/bin:/opt/homebrew/bin RHYTHM_LIVE_E2E=1 tools/dev/.hermes-shipping-runtime/node/bin/node tools/dev/hermes_owner_subscription_checks.mjs
```

Contract: API35/MCP4/CLI1; inventory114; actual owner MCP/native/browser/source
visible ACK for one selected real rename event; owner transfer, NULL owner,
current SDK, valid project move, unsubscribe, existing SSE closure, unchanged
retained rows/foreign control, zero Bridge jobs; no capability reads or
registrar/projection/delegation HTTP calls in audited owner MCP execution.
No provider-total extrapolation beyond the one selected event.

## Phase 1 — complete
Read full boundary helper and aggregate/native callers, supported project route
and controller, real MCP registration/subscription tools. GitNexus upstream
impact on boundary path: UNKNOWN / target not indexed, not proof of zero risk.
No shared product symbols edited. Bounded risk: fixture precondition and test
audit instrumentation; real supported API, FK existence and full unchanged
aggregate are proportionate validation. Ports4898/4897/4899 had no listeners
(lsof SMB mount warning unrelated). All four fixture paths, canonical ports,
private Node22.23, engine d60f5a skip-build1, sqlite/shadow/PURE/monitor-off remain
owned by unchanged runner, stock up/status/down only.

### Protected before hashes (SHA256)
```
773f53408225d8b1accb4fe42cbfe8cf83e78e4de825ad822afc51fec76dc681  apps/api_server/src/routes/hermes_notify_routes.ts
1749bf22276f285878ce3800e42dac3c42f3a30065294113a46d8ff7ede0f149  apps/api_server/src/services/hermes_notify_service.ts
b736757d087b908e6575addb752577db260c65f9c0a6dc4912c7754c2562b3b2  apps/mcp_server/src/index.ts
025d237cb9b8f892ff1cb2912f6a6792ae539dd1b25fce826fc2d2a8f2bdb489  apps/mcp_server/src/tools/updateSubscriptions.ts
3be3eb28ba0f89af520b1c0d3ad591851b42f7cc78c69fd5bbf7699b0aa5e304  tools/dev/hermes_fixture_provision.py
d4fbce0fcaac11d8d6416dae69aeb361c578b81c00ff4eebd7341bcff76ab76d  tools/dev/hermes_owner_subscription_checks.mjs
fa7d1648a2aad085d1591d30f2fb88281ecd7d210359697024b2d5a4f4e3116d  tools/dev/hermes_owner_subscription_native.py
```

## Files / Checks / Notes
Changed only tools/dev/hermes_owner_subscription_boundaries.mjs and this note.
The helper now POSTs /projects with owner bearer, valid name and disposable
cwd, consumes returned ID, and asserts projects row existence before any source
mutation. No FK/PRAGMA changes, forged IDs, source/event/SDK/ACK inserts or
weakened notify assertions. Identity API supplies owner1; fixture users row2
existence is checked. NULL owner is a permitted disposable-row revocation;
original pointers restored only after denial, journal and stream assertions.

Added test-only preload in a real stdio MCP child: wraps fs read/open operations
for an absent synthetic capability path and fetch to audit requests, forwarding
allowed requests to actual API unchanged and failing any other URI. It sets
RHYTHM_RUNTIME_CAPABILITY_FILE to the absent path. No SUT is mocked or edited.
The audit proves this owner subscribe/disable execution, not an OS-wide trace
of all sandbox processes or a test of hypothetical capability env aliases.

## Phase 2 — complete, first and only fixture correction attempt PASS
Exact final aggregate command (workdir is this shipping worktree):

```sh
env -i PATH=/usr/bin:/bin:/opt/homebrew/bin RHYTHM_LIVE_E2E=1 tools/dev/.hermes-shipping-runtime/node/bin/node tools/dev/hermes_owner_subscription_checks.mjs
```

**EXIT0.** Stock sandbox up/status/down used the same explicit env in the
unchanged runner (lines15–21), including all four path variables,4898/4897/4899,
Node22.23, cached engine SHA d60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072,
skip-build1, sqlite/shadow/PURE, monitoring/default plugins/model-fetch off.
API strict tsc build + MCP build and strict tsc PASS.

Observed output:
- API: `Test Files 6 passed (6)`, `Tests 35 passed (35)`.
- MCP: `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- CLI: `Ran 1 test ... OK` (same single test invoked twice by existing runner;
  not two unique tests). `PASS inventory 112+2=114`.
- Native browser: realDOM732x24.5/unobscuredtrue, qualifiedReceipts1,
  foreignPASS/obscuredPASS; actualRenameEventtrue/nativeBrowserACKtrue,
  nativeProviderEffects1/sourceModelRequests0/busyDuplicateReopentrue.
- Boundary: all four revocation lines PASS: owner2, NULL owner, actual foreign
  SDK, valid returned project ID. Each executed history404/new SSE404/ACK404,
  no rebind, real API rename with no outbox addition, existing SSE closure and
  deep-equal retained rows before restore. Foreign control source and journal
  deep-equal before/after every case and after unsubscribe.
- Expanded unsubscribe PASS: existing SSE closes, history/new SSE/ACK404,
  next genuine API rename200 adds no journal rows. Four revocation cases plus
  one unsubscribe case = **5 cases, 5 existing SSE closures** (not seven cases).
  Six boundary API-created sources; seven including original aggregate source.
- Audit: armed + exactly two HTTP calls, POST subscriptions and POST disable;
  capability read attempts0, registrar/projection/delegation HTTP attempts0.
  Absent capability file remains absent. Bridge jobs0, no runtime enrollment.
- Project fixture `0469b425-69f8-4bb0-9145-59da5766d69b` returned by API201;
  FK existence assertion PASS. Exactly one extra project, metadata-only fixture.

### Actual selected-event evidence
Owner1 source `30329bbf-62dd-440c-9a60-3c577aca7f7a`, nativeSID `9447bf73038b`,
event `a53c7bf4-79d3-4da8-9825-24441001c83c`.
Protected evidence root:
`/private/tmp/hermes-owner-subscription-4898-20261015-fixture/owner-native-k6tjifqh`.
Supported API source creation -> official MCP subscribe -> actual API rename ->
real engine SSE/outbox -> unchanged NativeAdapter/worker/journal/save ->
unobscured Chromium receipt -> actual API visible ACK all executed. While held,
selected event remained accepted with no render metadata; duplicate + subscriber
DB reopen did not add effect. After release actual browser proved visibility,
source retained SQL row visible and HTTP replay omitted selected event.
One provider effect for this selected event, owner conversation only; no claim
that all coordinator/card/question producers were live tested. Existing API35
covers their contract boundaries. Only native upstream provider is FixtureAgent;
no real model/provider Internet or fake visible/manual ACK used.

Screenshot visually inspected: actual source text “Rhythm session updated.” and
assistant “Fixture native reply.” visible. SHA256:
```
e9e2a8e5a4e9be648eb74b82470227ba7a7aa543e00d32361497941f0bc04405  current-shipping-native-ack.png
cf9ca9a928967fd465a2731dac7006d0501e39f451702da02945454c66b898ba  provider-calls.jsonl
71130f9b6919b3b62b01053466dedf227b60dead65b82eb9947b0dadb3dd35a3  render-receipt.json (file bytes)
```
Canonical sorted receipt payload SHA256 (not file bytes):
`05d1300be2d0c9e3dd45765d5d7ef166dea16784a2bf707fd709df511482a3d2`.
Do not print protected nonce/token contents. Fixture rhythm.db/config0400 and
native owner/provider/receipt0600 verified via stat. Pinned native snapshot107
and patch7 hash checks ran unchanged before copying.

Additional fixture-root proof SHA256:
```
b37dccb16ee810d2b4db1d8398be9357d4dde33b2225e44347e10c4361c08262  boundaries.json
cd074d343921eac79398b094a1d1b77458fb74e29d003a4d1d963ef74d4d990d  owner-mcp-audit.jsonl
```

### Hygiene / handoff
All seven protected before hashes above rechecked after aggregate: identical.
`git diff --check` exit0; git status retains all original dirty/untracked owner
and unrelated Mac files, with this note as the only new repository path this
stage. No source API/MCP/CLI/native/subscriber/validator/membership guard edits.
Stock teardown: `sanitized diagnostics preserved` at
`/private/tmp/hermes-owner-subscription-4898-20261015-sandbox.evidence.ltEASQ`,
`Sandbox removed` at exact owned sandbox path. Final lsof4898/4897/4899 exit1,
no listeners (same unrelated SMB mount warning). Initial startup curl refusal
was readiness polling before successful up/status, not aggregate failure.
No live API/App/Pi/registry writes, production fixture/credentials, permission
changes, real provider, external relay, dependency install, signing, CI,
restart, destructive cleanup, commit or push.

**READY_OWNER_MCP_SUBSCRIPTION / READY_FOR_VERIFICATION.** Parent independent
gate can run exact command against frozen read-only source with writable
disposable fixtures; do not request unchanged approvals again. Parent owns
commit/push and subsequent0.18.79 artifact qualification after independent PASS;
no build/install/restart authorization inferred here. No further Hermes rewrite,
runtime enrollment, workflow binding reclassification or source-auth changes.
