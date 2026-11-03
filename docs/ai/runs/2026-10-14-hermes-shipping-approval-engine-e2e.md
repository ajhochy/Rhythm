---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: null
issues: [HERMES-APPROVALS]
status: READY_FOR_VERIFICATION
tags: [run, rhythm]
---

## Scope / approvals
Explicit parent specialist handoff; no orchestrator/peer dispatch. Only NEW
tools/dev/hermes_shipping_approval_engine_e2e.mjs, private child folder
tools/dev/hermes_shipping_approval_engine_fixture/, and this note are writable.
No API/MCP/fork/native/shared-helper source edits. No human desktop signature,
Keychain, native ACK, mixed decision race, release/deploy/restart, real provider,
live data, shared installs, commits/pushes or destructive cleanup. Stock sandbox
lifecycle only, owned 5198/5197/5199; private sanitized fixture root and sandbox
named in dispatch. Preserve dirty peers; parent owns final freeze/repackage and
fresh actual-restart authorization. Same scope remains approved on resumption.

## Phase 0 contract
Loaded acceptance-contract first, coding-agent second. Read shipping AGENTS,
regression registry, memory snapshots and source-continuation receipt; original
qualified old execution/live tests and their old eight-test receipt were read,
not promoted as shipping evidence. Four frozen executable criteria in new test:
AC1 exact owner pending card/audit plus two signed calls -> one task/consumption;
AC2 explicit reject -> zero tasks; AC3 payload/card/hash/revision/expiry/replay ->
zero additional tasks; AC4 foreign/bad credential/direct unsigned action -> zero.
Initial provider baseline returns valid text without task calls so the positive
effect and negative signed-call assertions must fail; no missing-import RED.
Command: `env RHYTHM_LIVE_E2E=1 tools/dev/.hermes-shipping-runtime/node/bin/node --test tools/dev/hermes_shipping_approval_engine_e2e.mjs`.
Implementer mandate: retain these assertions; implement provider emission only.
Independent verifier: parent reruns same command against current source/built
artifact without editing either test or production source.

## Phase 1 read-only impact / risk
GitNexus Rhythm query then consumeApproval upstream impact: LOW, one direct,
three total dependents, zero indexed flows, one Services module. Index is from
primary repo, not current dirty C74 snapshot: hints only, not zero-risk proof.
No existing symbol edited. Manually read relay security/controller/tools,
task payload transform, external boundary, trusted signature verifier, canonical
fixture and whole sandbox launch/lifecycle. Signed context, session/agent/taint,
hash/revision, expiry and once-only guards remain SUT. Fixture seeding is limited
to sanitized SQLite; action session SDK ID comes from actual engine creation.
No fake HTTP proof/signature or special workflow approval kind. Model provider
is local OpenAI-compatible upstream only, declaring its GET models inventory and
engine FILE config before startup. Relay auth uses requireAuth, no Cloud fallback;
runtime PROD_API_URL is independently checked loopback before bad-token requests.
Relevant source fingerprints and pinned binary d60f5a... are collected before and
after every run, not a whole-worktree release freeze.

## Checks / notes
5198/5197/5199 preflight lsof: no listeners. Private runtime Node v22.23.0,
better-sqlite3 13.0.3 verified by constructing real in-memory SQLite; engine
SHA256 d60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072.
Phase-0 command above: exit1, 24.21s, four tests: AC1/AC2/AC3 fail, AC4 pass.
Observed intended RED: AC1 task count 0 != 1; AC2 signed results 0 != 1;
AC3 has no tool output (undefined). Real upstream requests7, emittedCalls0;
real owner card/list/audit passed; AC4 already passes current shipping guards.
This proves text-only provider/inventory is insufficient, not a product failure.
Canonical fixture generated from CURRENT source; actual API/MCP builds passed;
API55905 on5198/gateway5199, fork56042 on5197. Stock down removed only owned
sandbox, unchanged relevant source/binary assertion passed. Phase0 complete;
Phase1 complete with reviewed surface above. No acceptance assertion changes.
Next: replace the text-only upstream fixture with deterministic task tool calls,
then rerun unchanged checks (at most two harness repairs). No readiness claim yet.

First Phase2 run, same command: exit1, 25.05s, three fail/one pass. Provider10
requests/emitted4; actual transcript says unavailable tool `invalid`, available
tools empty, no gate reached. This is an outdated test-session input: current
fork defaults to deferred MCP definitions. Repair1 (helper only) explicitly uses
the existing session mcpAllowlist with the ONE composed task key and deferred:false;
all other engine permissions remain denied, no permission bypass/source fix.
Added helper assertions for actual advertisement/emission/transcript call counts;
four acceptance tests remain byte-for-byte unchanged. Stock down successful;
relevant source/binary unchanged. Owner inventory112 is not execution proof.

## Phase 2 complete / real outcome
Repair1 rerun: **4 PASS/0 FAIL**, exit0,23.40s. Actual API75044, fork75167;
provider requests20, eight emitted task calls, one task/one consumption.
Then added evidence instrumentation only (no frozen assertion changes): actual
API HTTP consume denial lines, whole task-table count, built payload fingerprints.
Final requalification, same live command followed by `git diff --check`:
**4 PASS/0 FAIL**, exit0,24.39s. API94092 on5198/gateway5199; fork94216 on5197.
No second repair needed. Actual current provider catalog row is available=true,
authorized=true for declared hermes-approval-fixture/safe-task-gate; real
GET /v1/models inventory and global FILE config were exercised, no real model.

Observed proof, not inventory promotion:
- Official external SDK stdio clients list/get/decide against shipping built MCP
  and canonical sandbox API. Exact owner card list excludes foreign/NULL-owner
  cards. Actual112 names retained in receipt (109 baseline + three relay tools).
- Exact revision/hash approve audits authenticated Synthetic Admin (auth/me id1),
  `Synthetic Admin via Hermes`, source hermes, assurance relay-attested, explicit
  owner_chose_in_chat. Persisted actor equals response audit; NOT crypto-human.
- Two tool calls in one real fork turn: one task with ownerId1, one consumed row,
  second refused already-consumed. Whole synthetic task table count=1.
- Eight emitted calls matched eight real engine transcript tool results. Seven
  actual `POST /agent-approvals/consume` denial lines occur after real signature
  verification: already-consumed x2, not-approved x2, exact payload mismatch,
  changed relay card, expiry. Positive eighth call yields actual task receipt.
  Thus negative tests cannot pass solely from unavailable tool or bad signature.
- Explicit reject, changed payload, changed displayed card, stale hash/revision,
  expiry and replay create zero additional tasks. Foreign/bad credential cannot
  decide; all three external direct task clients lack engine context, fail closed,
  and approved external-denial card remains unconsumed.
- Only upstream transport was synthetic; API/security/MCP/engine/SQLite unmocked.
  Safe local fixture inserts used normal task.create security cards; no workflow
  kind, forged proof, auto-approve, signing material or live ownership adoption.

### Durable evidence / identities
Final private read-only receipt:
`/private/tmp/hermes-shipping-approval-engine-20261014-fixture/receipt-d41aaecb-d469-4d30-b128-aecebfcca1fb.json`.
Contains sourceBefore/sourceAfter (18 relevant files), compiledBefore/After (nine
approval payload files), runtime hashes, exact owner audit, actual112 tool names,
model catalog, transcript call IDs/outcomes, actual HTTP refusal reasons and total
task count. Every relevant source/compiled comparison passed; pinned fork unchanged.
Sanitized stock lifecycle logs:
`/private/tmp/hermes-shipping-approval-engine-20261014-sandbox.evidence.HtE0tY/`.
Earlier RED/failure/green receipts retained, not overwritten. Credentials only in
protected private fixture config/token files, never receipt, docs or output.
Frozen acceptance test SHA256:
`c31c485618f1b27596dd5878c026143802b72a76447bf7f0248b8f5d2fe4862e`.
Final helper SHA256:
`386017bbef039bb41d398f469cf9e43dbfa929fd18c728c8f61f56416b1e7fad`.
Node SHA256 `f4138f62bc2f24b896232afc646fd0a1e75bd3ab1e626c4f3f8ef73b41c6a732`.

### Focused checks, including failure (not hidden)
1. Shipping root: `tools/dev/.hermes-shipping-runtime/node/bin/node --test tools/dev/hermes_shipping_approval_engine_e2e.mjs`:
   exit0, suite SKIP, no helper import/runtime launch with live flag absent.
2. Shipping root: `tools/dev/.hermes-shipping-runtime/node/bin/node --check tools/dev/hermes_shipping_approval_engine_fixture/harness.mjs && git diff --check`:
   exit0. Final lsof5198/5197/5199 no listeners; sandbox path absent.
3. API package exact supplemental command:
   ```bash
   env -i PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin HOME=/private/tmp/hermes-shipping-approval-engine-20261014-fixture DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=5197 RHYTHM_AGENT_URL=http://127.0.0.1:5198 RHYTHM_API_BASE=http://127.0.0.1:5198 PROD_API_URL=http://127.0.0.1:5198 RHYTHM_OPTIMIZER_MODE=shadow ../../tools/dev/.hermes-shipping-runtime/node/bin/node node_modules/vitest/vitest.mjs run src/__tests__/hermes_approvals.test.ts src/__tests__/human_approval_signature.test.ts src/__tests__/expired_approval_decide.test.ts src/__tests__/approval_not_required_on_clean_session.test.ts src/__tests__/issue_1134_external_content_security.test.ts --no-file-parallelism
   ```
   **exit1:32 PASS/1 FAIL**,8.35s. Existing signature unit line147 expects401;
   unavailable loopback Cloud yields503 AUTH_UNAVAILABLE with sandbox down.
   No production fallback/desktop/Keychain request. Unit source/assertion untouched;
   not promoted to PASS and not counted as live desktop signature qualification.
   That extra excluded-tier unit was not rerun or repaired. Parent must account
   for this env-sensitive unit in its final broad checks; no all-repo green claim.
4. API package focused scope confirmation:
   ```bash
   env -i PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin HOME=/private/tmp/hermes-shipping-approval-engine-20261014-fixture DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=5197 RHYTHM_AGENT_URL=http://127.0.0.1:5198 PROD_API_URL=http://127.0.0.1:5198 RHYTHM_OPTIMIZER_MODE=shadow ../../tools/dev/.hermes-shipping-runtime/node/bin/node node_modules/vitest/vitest.mjs run src/__tests__/hermes_approvals.test.ts src/__tests__/expired_approval_decide.test.ts src/__tests__/approval_not_required_on_clean_session.test.ts --no-file-parallelism
   ```
   exit0,12 PASS/0fail,2.15s. Earlier #1134 file separately17 PASS in command3.
5. MCP package:
   ```bash
   env -i PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin HOME=/private/tmp/hermes-shipping-approval-engine-20261014-fixture ../../tools/dev/.hermes-shipping-runtime/node/bin/node node_modules/vitest/vitest.mjs run src/__tests__/mcp_capabilities_and_tool_registration.test.ts src/security/__tests__/external_content_role_graph.test.ts
   env -i PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin HOME=/private/tmp/hermes-shipping-approval-engine-20261014-fixture ../../tools/dev/.hermes-shipping-runtime/node/bin/node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
   ```
   Both exit0;9 tests PASS,563ms; strict typecheck PASS. Canonical sandbox built
   API strict tsc/postbuild + shipping MCP noCheck emit on every live run.

## Handoff: READY_SHIPPING_MCP_REAL_GATE (this bounded slice only)
Implemented and ran new test/provider helper, not docs-only. Only three new
owned paths changed; no product source, existing helpers, peers, dependencies,
permissions, installed app or release artifact edits. Stock up/status/down used
same four required fixture variables, runtime and ports each time. Verified
teardown after every run; ephemeral provider connections closed. No manual API,
peer4898/4998, live4001/4096, deployment or actual app restart.
Independent parent verifier runs the exact live command above; no write access
to test/product artifact required (the command writes only its private fixture,
canonical sandbox and existing canonical build outputs). Shared build outputs
may be rebuilt by source-wire owner: fingerprints qualify this run, NOT a whole
worktree release freeze. Parent must perform final freeze after peers finish.
This does not qualify native ACK, broader coordinator behavior, packaging,
signing/notarization, production or deployment readiness. Actual restart still
requires fresh AJ approval, not obtained here. Preserve supplemental unit failure
in parent handoff rather than equating live slice PASS with all checks PASS.
