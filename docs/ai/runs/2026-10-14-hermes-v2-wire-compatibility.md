---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: null
issues: [NOTIFY-HERMES]
status: READY_WIRE_CURRENT_PINNED_SCHEMA_PENDING_INTEGRATION
tags: [run, rhythm]
---

## Scope / approvals retained

Explicit parent specialist assignment; acceptance-contract loaded FIRST, then coding-agent.
Only route, NEW wire tests, wire acceptance/pinned-validator helper and this run owned.
Authority service frozen SHA256 3f8be42e4ff81aa4f18274d01e5c7b28661fcc322bae21ffb7d225f111671ef7.
No client/native/schema/MCP/CLI core edit, source-row rewrite, dependency install,
live4001/4096/App/Pi/network/provider request, real card/approval, packaging/signing,
restart/install, commit/push or destructive cleanup authorized. Dirty peer files preserved.
Own canonical 4998/4997/4999, four fixture variables, existing 0400 sanitized fixtures;
4898 remains future CLI owner. Existing private prebuilt engine reused as assigned.
Read AGENTS, project-state, current-plan, regression registry and nativebirth-current-ack.

## Phase 0 — frozen acceptance / actual RED

Frozen command: `RHYTHM_LIVE_E2E=1 tools/dev/.hermes-shipping-runtime/node/bin/node --test tools/dev/hermes_v2_wire_acceptance.mjs`.
Named check: real GET/SSE V1/V2 preserves pinned exact schema, labels, identity,
references and authority. Real compiled HTTP + real engine metadata, no mocked SUT.
Retained-history synthetic rows cover all five kinds, two new internal labels,
ordinary canonical labels, qualified Recipe counts, question/card ID distinction.
Subsequent assertions cover unknown prose withholding, consumer unknown-field
rejection, root membership/401/404 controls, ACK monotonicity, unchanged source rows.
These synthetic rows are NOT real question/card/coding/verification producer proof.
Mandate: make this check pass WITHOUT editing it. Parent independently verifies
from read-only source plus disposable writable sandbox, no artifact-write requirement.

Before route edits, stock sandbox up/status/down using environment below:
strict API build PASS; normal MCP noCheck build PASS (NOT strict MCP proof).
API/gateway PID22941, engine23079. Test FAIL170.996ms: pinned Python validated42,
V2 GET/SSE rejected unsupported notification schema; V1 new literals rejected
not a server-generated label. Expected0 actual1, no implementation yet.
Down PASS, evidence `/private/tmp/hermes-coordinator-notify-20261014-sandbox.evidence.YCXXBD`.

```sh
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-coordinator-notify-20261014-fixture
export RHYTHM_LIVE_DB_PATH="$RHYTHM_APPROVED_FIXTURE_ROOT/rhythm.db"
export RHYTHM_SANDBOX_OPENCODE_CONFIG="$RHYTHM_APPROVED_FIXTURE_ROOT/coordinator-opencode.json"
export RHYTHM_SANDBOX_DIR=/private/tmp/hermes-coordinator-notify-20261014-sandbox
export RHYTHM_SANDBOX_API_PORT=4998 RHYTHM_SANDBOX_ENGINE_PORT=4997 RHYTHM_SANDBOX_GATEWAY_PORT=4999
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow
export RHYTHM_SANDBOX_NODE_BIN="$PWD/tools/dev/.hermes-shipping-runtime/node/bin/node"
export RHYTHM_SANDBOX_ENGINE_DIR="$PWD/tools/dev/.hermes-shipping-runtime" RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1
export OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1
bash tools/dev/sandbox.sh up && bash tools/dev/sandbox.sh status && env RHYTHM_LIVE_E2E=1 "$RHYTHM_SANDBOX_NODE_BIN" --test tools/dev/hermes_v2_wire_acceptance.mjs
result=$?; bash tools/dev/sandbox.sh down; exit "$result"
```

## Phase 1 — consolidated bounded impact

GitNexus api_impact(file=apps/api_server/src/routes/hermes_notify_routes.ts,repo=Rhythm):
No routes found. impact(createHermesNotifyRouter,upstream): target not found/risk UNKNOWN.
No LOW/HIGH bypass claim. Actual caller app.ts306 mounts under /hermes-notify only
sqlite/nonrelay. Router requireAuth before all list/SSE/ACK. Full intended route
and service inspected: list/listRun auth precedes projection; SSE re-proves authority
each flush. ACK uses eventUUID, not text/hash. Consumers reviewed: original pinned
Subscriber.validate/Inbox.identity, Receiver.identity, current-ACK actual SSE path,
internal source/coordinator/live tests. No graph coverage falsely inferred.

Security risk: broad generic normalization could leak prose or disguise success;
only two kind-qualified exact labels may map. Coding stays progress/unverified;
internal service/query metadata and engineRequestID alias remain unchanged. Public
question referenceId is opaque engine correlation, NOT reply authority; approval
referenceId remains canonical card ID. Unknown labels withheld, malformed identity
fails explicitly without partial JSON/ACK, unknown fields cannot broaden receiver.
Recipe counts/kind must match pinned consumer, including settled>0/awaiting0 success.
Source currently emits blocked_approval Recipe as progress whereas pinned validator
requires approval-request: do NOT relabel it into a card; withhold that incompatible
label, retain journal for owner query. This is compatibility fail-closed, not a new
workflow/card producer or all-pass claim. Normal compatible labels retain byte identity.
Shared GET/SSE projection ensures stable wire identity; source keys/hash unchanged.

## Phase 2 — implementation and actual results

One implementation attempt; frozen acceptance never edited. Same pure helper used
on GET V1, GET V2 and both SSE variants. Only engineRequestID is removed; exact
known new labels map by kind. Unknown prose/Recipe qualification withheld; malformed
identities, missing question/card IDs and unknown metadata fail explicitly. No
auth/ACK service change, no model/private question text copying, no event ID/cursor
or source-key rewrite. Internal owner query still says returned_result_unverified:
public V2 progress is generic, NOT a verified-success claim. Native envelope stays
original schema/version/hash fields, no new version or Pi budget.

### Files authored

- `apps/api_server/src/routes/hermes_notify_routes.ts`
- `apps/api_server/src/__tests__/hermes_wire_projection.test.ts` (new,5 tests)
- `tools/dev/hermes_v2_wire_acceptance.mjs` (new,frozen RED/GREEN)
- `tools/dev/hermes_v2_pinned_validator.py` (new,read-only pinned invocation)
- this run only

Shared API/MCP build products generated only by canonical sandbox build. No root
repo/authority/client/native/CLI/MCP source writes. Route was already untracked in
the dirty shipping worktree, so ordinary git diff --stat does not enumerate it.

### Commands / output

From `apps/api_server`, clean environment prefix used for strict and unit checks:
```sh
env -i PATH="/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014/tools/dev/.hermes-shipping-runtime/node/bin:/usr/bin:/bin:/opt/homebrew/bin" HOME=/private/tmp TMPDIR=/private/tmp DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=4997 RHYTHM_MOBILE_GATEWAY_PORT=4999 RHYTHM_OPTIMIZER_MODE=shadow COMMAND
```

1. `./node_modules/.bin/tsc -p tsconfig.json --noEmit`: exit0, no errors.
2. `./node_modules/.bin/vitest run src/__tests__/hermes_wire_projection.test.ts src/__tests__/hermes_source_contract.test.ts src/__tests__/hermes_coordinator_notify_contract.test.ts src/__tests__/hermes_coordinator_notify_revocation.test.ts src/__tests__/hermes_coordinator_notify_boundaries.test.ts --no-file-parallelism`:
   exit0,30 PASS,7.89s (initial focused subset, not43).
3. Phase0 lifecycle command unchanged after implementation: strict API build PASS,
   normal MCP noCheck PASS; API/gateway45963,engine46091. Frozen test **1 PASS**,
   271.565ms/318.898ms total. Actual pinned validation passes all5 kinds and all
   compatible labels, V1/V2 GET=SSE, exact10/11fields, reference-only question/card,
   sourceRowsUnchanged, unknown-field consumer rejection, prose withholding,
   root membership404/unauth401/foreign-run404 and ACK monotone visible controls.
   Receipt SHA256 `98f0ed89f8b6577848c4697c2ebdbab04b132433a450fd4e8ebee0eb4582a879`.
   Raw scratch wire-receipt lived inside disposable sandbox and was removed by
   stock down; this note records observed digest/output, NOT a retained raw file.
   Down exit0, diagnostics `.evidence.03cPQB` retained.
4. `./node_modules/.bin/vitest run src/__tests__/hermes_wire_projection.test.ts src/__tests__/hermes_coordinator_notify_contract.test.ts src/__tests__/hermes_coordinator_notify_boundaries.test.ts src/__tests__/hermes_coordinator_notify_live.test.ts src/__tests__/hermes_source_contract.test.ts src/__tests__/hermes_approvals.test.ts src/__tests__/coordinator_conversation_repository.test.ts src/__tests__/coordinator_workflow_runs.test.ts src/__tests__/hermes_coordinator_notify_revocation.test.ts --no-file-parallelism`:
   exit0 **48 PASS/1 live skip**,10.48s. Original43 source + new5, not a live PASS.
   Original internal engineRequestID and unverified-label assertions unchanged/pass.
5. Same canonical lifecycle env, original two live checks actually rerun. Test
   command from root (prefix clean env sets PATH private Node, HOME sandbox/home,
   TMPDIR sandbox/tmp, DB_CLIENT sqlite, engine4997/gateway4999/shadow, LIVE_E2E1
   and same four fixture variables):
   `tools/dev/.hermes-shipping-runtime/node/bin/node apps/api_server/node_modules/vitest/vitest.mjs run --root apps/api_server src/__tests__/hermes_coordinator_notify_live.test.ts src/__tests__/hermes_coordinator_revocation_live.test.ts --no-file-parallelism`.
   Build exit0; API/gateway54726,engine54857. **1 PASS/1 FAIL**,890ms:
   all five revocations show canonical UNKNOWN, HTTP list/SSE/ACK404,journal unchanged.
   Original notify live fails line75 `expected false to be true`: HTTP expectation
   of internal `Rhythm returned output; verification pending.` is incompatible
   with this explicitly assigned canonical progress mapping. Its line74 no-completion
   passes; later child/card assertions NOT reached. Test NOT edited or waived,
   no fake2PASS. Parent must assign/adjudicate wire-vs-internal fixture separation.
   Down exit0, diagnostics `.evidence.4gaCcv` retained. No further serializer repair
   justified: reverting mapping would fail the frozen requested wire contract.
6. `./node_modules/.bin/vitest run src/__tests__/hermes_source_contract.test.ts src/__tests__/hermes_approvals.test.ts src/__tests__/shared_agents_delegation.test.ts src/__tests__/human_approval_signature.test.ts src/__tests__/expired_approval_decide.test.ts src/__tests__/coordinator_goal_approval_resume.test.ts src/__tests__/approval_not_required_on_clean_session.test.ts src/__tests__/issue_1134_external_content_security.test.ts --no-file-parallelism`:
   exit0 **120 PASS**,21.27s. Actual current suite count, NOT invented84.
7. `git diff --check && tools/dev/.hermes-shipping-runtime/node/bin/node --check tools/dev/hermes_v2_wire_acceptance.mjs`: exit0.
   `stat -f '%Lp %N'` proves both canonical fixture DB/config still0400.

### Observed SHA256 (not release freeze)

```text
129a4f31283b06e18ea2b5ff8197fa0f050fcf6eac069e6f84cc3e79ec3dfaf9 apps/api_server/src/routes/hermes_notify_routes.ts
a8e78a3d2d1ad8ab6af88578fddfdf465341e9e821cdb3853e2197ab25330543 apps/api_server/dist/routes/hermes_notify_routes.js
3f8be42e4ff81aa4f18274d01e5c7b28661fcc322bae21ffb7d225f111671ef7 apps/api_server/src/services/hermes_notify_service.ts
0b4e898f9569cab6f58629be10c915daad48a7d38036b8ce52b612aae0ec05c4 apps/api_server/dist/services/hermes_notify_service.js
436583a5ec48b2bd4f50928ba903f2b573ffec0e9d3b532df470520cdf4cbaf7 apps/api_server/src/__tests__/hermes_wire_projection.test.ts
633c2e66f97c706f4a586ecb54427573838bbc7ffc590149279bd02d747fdd8e tools/dev/hermes_v2_wire_acceptance.mjs
6602e799a3fe7d9211d40ab34876d01271a58a1c890c27021a1705a7d6df52ce tools/dev/hermes_v2_pinned_validator.py
```

## Handoff / unresolved qualification

**READY_WIRE_CURRENT_PINNED_SCHEMA / READY_FOR_VERIFICATION for bounded projection
only.** Full original2-live aggregate is NOT GREEN; frozen HTTP label fixture needs
parent resolution with independent test owner, not a source authority modification.
All authored scope/exclusions/approvals retained; no renewed unchanged-scope approval
needed. Service exact3f8be42e authority freeze retained; no claim overriding300gate.

Current CLI real bridge/nativebirth/SSE/native-visible/ACK NOT RUN here: assigned
4998 ownership only,4898 explicitly belongs to future CLI owner,8e631 nativebirth
owner active. Do not start that overlapping lifecycle or steal its ephemeral native
fixture. Parent/CLI owner reruns existing hermes_cli_fixture_test.py with
HERMES_CURRENT_ACK=1 after nativebirth fixture correction and source freeze. This
wire test exercises real HTTP and engine metadata plus synthetic history, NOT a
claim of actual native delivery or verified coding result. No native ACK claim.

ALL stage/release artifacts remain **STALE**; shared compiled-tree qualification
must run after final parent freeze, final MCP action gate and actual Native ACK
against shipping API. Packaging/signing/install out of scope, user restart ASK
still pending. All owned sandbox processes torn down through stock down;4898/live
and peer/source authority unchanged by this specialist. No commit or push.
