---
date: 2026-10-15
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: 1617
issues: []
status: ready-for-independent-verification
tags: [run, Rhythm]
---

# Hermes Cloud owner credential compatibility

## Scope / approvals

Parent specialist handoff authorizes safe fixture tests and the minimal new-feature
boundary fix in shipping worktree HEAD `a3343a35`. Five pre-existing untracked Mac
rollout files are preserved. No peer dispatch, commit, push, deployment, signing,
app resource edits, restart, live DB, credential read, activation, card decision,
native link/subscriber creation, or runtime grant exchange is authorized here.
The installed 0.18.77 app remains untouched; future artifact/update requires parent
qualification and separate user restart approval. Native cookie identity mapping
remains STOP, never infer native username from numeric local owner.

Parent-supplied read-only observation (not re-run by this specialist): existing
credential reference `~/.config/opencode/opencode.json#/mcp/rhythm/environment/RHYTHM_API_TOKEN`
(0600; value never read/output here) gives Cloud `/auth/me` 200 with normal Node
fetch, but local `/auth/me` and new protected routes 401. Cloud numeric ID is not
local identity. Python urllib Cloud 403 was WAF-related, not proof of stale auth.
No new login/token refresh is required by this fix.

## Phase 0 — acceptance

Loaded acceptance-contract then coding-agent. Read AGENTS, project-state,
current-plan, regression-registry and July 30 Cloud-token auth run.
Contract: `apps/api_server/src/__tests__/hermes_cloud_owner_auth.test.ts`:
valid Cloud9001 -> local2 minimal identity; relay list/get/exact approve/reject;
foreign admin isolation; notify origin/history/ACK/SSE; bearer required;
bad/revoked/sub-mismatch fail closed; network-unavailable503; hosted no fallback;
local sessions unchanged. Only upstream Cloud HTTP is synthetic, not SUT auth.

Command (cwd apps/api_server):
```
env -i PATH=/usr/bin:/bin:/opt/homebrew/bin HOME=/private/tmp DB_CLIENT=sqlite DB_PATH=:memory: RHYTHM_OPTIMIZER_MODE=shadow OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1 ../../tools/dev/.hermes-shipping-runtime/node/bin/node node_modules/vitest/vitest.mjs run src/__tests__/hermes_cloud_owner_auth.test.ts --no-file-parallelism
```
Initial harness run exposed Vitest's forced AGENT_LOCAL=false and missing notifier
initialization; corrected setup BEFORE freezing the contract. Actual RED at
20:00:16: 6 failed / 1 passed. Valid Cloud identity/list/foreign list/origin returned
401; offline returned401 instead of503; local identity404 instead of200.
Existing denial checks passed (regression invariants, not claimed new failures).
Mandate: make these checks pass without weakening them. Parent independent
verifier must rerun against frozen source; no write access to source is needed.

## Phase 1 — impact

GitNexus api_impact before editing both route files: approval file indexed only
old taint/consume routes (LOW, 1 attributed consumer, 0 flows); notify file missing.
impact agentApprovalsRouter LOW/0 indexed dependents; createHermesNotifyRouter,
execute_fixture and CLI main UNKNOWN/unindexed. requireAuth (not modified) query
returned LOW/2 direct/0 processes, inconsistent with known broad shared use;
do not infer low global auth risk from this stale/incomplete index.
Manual exact caller review: app.ts mounts approvals and SQLite/non-relay notify;
CLI main alone calls execute_fixture. New source HTTP fixture mounts both real
routers. Reviewed complete routes, controller, relay hash/nonce security,
MobileCloudIdentityService and auth middleware. Auth resolver/cache/crypto stay
byte-identical. Consequential risk: cross-owner auth confusion; tests explicitly
use Cloud9001/local2 and foreign Cloud admin9002/local1. No raw cloud UID compare.

## Files / Checks / Notes

### Changed files

- `apps/api_server/src/routes/agent_approvals_routes.ts`: only the three new relay
  route middleware selections use strict local-or-Cloud auth when AGENT_LOCAL.
- `apps/api_server/src/routes/hermes_notify_routes.ts`: same strict conditional
  owner resolver and additive read-only `/identity` (`version:1,ownerUserId`).
- `tools/dev/hermes_fixture_provision.py`: the two owner lookups now use that
  endpoint's `ownerUserId`; all endpoint validation/runtime capability logic stays.
- `apps/api_server/src/__tests__/hermes_cloud_owner_auth.test.ts`: seven RED
  contract checks plus supplemental V2 bridge and Python transport/path checks.
- `tools/dev/hermes_cloud_owner_compatibility_checks.mjs`: env-gated canonical
  lifecycle, source HTTP matrix, strict emit, real stdio MCP inventory and receipts.
- `docs/ai/guides/hermes-shipping-rollout.md`: additive auth-method table only.
- This run record. No changes to the five pre-existing untracked rollout files.

### Phase 2 results

First production implementation passed all seven frozen runtime assertions
(20:01:31). No production repair was needed. Two bounded test-support repairs:
1. Strict API build rejected undici's `json():unknown` in test code. Added only
   the response type annotation, no assertion changes. Initial runner also missed
   stock down after prelaunch build failure; explicitly ran canonical down with
   identical four fixture vars, ports and runtime flags. Updated finally to cover
   an existing prelaunch sandbox too. Diagnostic evidence retained in
   `...-sandbox.evidence.X5ybPs` / `.lzvkyd`.
2. Supplemental V2 test expected a visible ACK in the replay page. Existing source
   explicitly omits visible tombstones. Corrected ONLY that new supplemental
   assertion to check exact accepted event, exact event absent after visible, and
   durable visible tombstone. The original seven checks were not weakened.

Final executable command (shipping worktree root):
```
env -i PATH=/usr/bin:/bin:/opt/homebrew/bin RHYTHM_LIVE_E2E=1 tools/dev/.hermes-shipping-runtime/node/bin/node tools/dev/hermes_cloud_owner_compatibility_checks.mjs
```
Final output: canonical API5498/engine5497/gateway5499 ready; API PID94449,
engine PID94571. **local9 / hosted9 PASS**, strict API and MCP `tsc -p tsconfig.json
--strict` exit0, real MCP discovery **109+3=112**, provider/model requests0,
canonical down PASS; subsequent lsof confirms all own5498/5497/5499 and
5198/5197/5199 listeners gone. No fork edits/build claim: reused pinned private
engine SHA256 `d60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072`.
All up/status/down commands and strict build args are in the receipt; env is
fixed in the runner, not inherited. Canonical builder made synthetic sources only;
DB and `auth-opencode-config.json` are0400, all four required vars supplied.

Final receipt under `/private/tmp/hermes-auth-compatibility-20261014-fixture/`:
- `compatibility-receipt-2d4332d8-e28c-4c00-94ae-77cca1098a3e.json`
- `local-2fe72f56-b5d4-42e2-958f-9e659cda9a13.json`
- `hosted-3362c183-15b8-4908-b6b7-e784cd06c220.json`

**Proof boundary:** canonical running full API/engine verifies health, local
identity200 and missing bearer401. Cloud9001→local2 and exact owner decisions,
V1/V2 origin/history/SSE/ACK are exercised through real source Express HTTP
routers, real resolver, real SQLite and a private loopback upstream Cloud stub,
in sandbox-scoped HOME/TMPDIR, NOT through the full sandbox server process.
Stock sandbox does not forward a custom Cloud URL; it was deliberately not
modified or bypassed. No auth/handler/engine is mocked in these new tests.
Real Python `request_json` hits the source HTTP endpoint (Node fetch performs
the upstream Cloud verification). AST checks assert both CLI lookup sites name
the new endpoint/body shape. This is NOT a full native provisioning/activation
proof; protected CLI endpoint policy remains exact4898/default or4001/operator.
Previous two hardcoded4998 live coordinator tests and physical/native delivery
were not rerun here. Parent must not describe these as new installed-app proof.

Cloud network failure produces503; upstream HTTP503, like all upstream non-OK
statuses, is401 under the **unchanged** resolver. Bad/revoked/mismatch tests use
different tokens from the positive cached token; existing five-minute positive
cache and revocation latency are not changed. No raw cloud numeric UID is used.

### Existing focused regressions

1. `env -i PATH=/usr/bin:/bin:/opt/homebrew/bin tools/dev/.hermes-shipping-runtime/node/bin/node tools/dev/hermes_shipping_auth_checks.mjs`
   — unchanged runner, canonical5198/5197/5199, **33 auth +10 Cloud PASS**,
   Cloud401 exactly1, unexpectedCloud0, model requests0, source hashes unchanged,
   stock down PASS. Reports under `/private/tmp/hermes-auth-cloud-20261014-fixture/`:
   `supplemental-cff21aaf-bc99-46bc-baab-4150ac207d8e.json` and
   `control-a02894b8-6c04-4ad0-a37f-430ea67b0924.json`.
2. Cwd `apps/api_server`, prefix:
   `env -i PATH=/usr/bin:/bin:/opt/homebrew/bin HOME=/private/tmp/hermes-auth-compatibility-20261014-fixture DB_CLIENT=sqlite DB_PATH=:memory: RHYTHM_OPTIMIZER_MODE=shadow NODE_OPTIONS=--require=/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014/tools/dev/hermes_shipping_auth_test_helper/loopback.cjs ../../tools/dev/.hermes-shipping-runtime/node/bin/node node_modules/vitest/vitest.mjs run`
   followed by `src/__tests__/hermes_approvals.test.ts src/__tests__/hermes_source_contract.test.ts src/__tests__/hermes_coordinator_notify_contract.test.ts src/__tests__/hermes_coordinator_notify_boundaries.test.ts src/__tests__/hermes_coordinator_notify_revocation.test.ts src/__tests__/hermes_wire_projection.test.ts src/__tests__/coordinator_workflow_runs.test.ts --no-file-parallelism --reporter=json --outputFile=/private/tmp/hermes-auth-compatibility-20261014-fixture/source-regression.json`
   — **42 PASS**. Same prefix then
   `src/__tests__/coordinator_conversation_repository.test.ts src/__tests__/mcp_capabilities_and_tool_registration.test.ts src/security/__tests__/external_content_role_graph.test.ts --no-file-parallelism --reporter=json --outputFile=/private/tmp/hermes-auth-compatibility-20261014-fixture/remaining-regression.json`
   — **6 PASS**; the two requested historical role-file paths matched no tests in
   this tree (not claimed executed). Together **43 existing source +5 wire PASS**.
   Counts overlap approvals in auth33; do not sum indiscriminately.
3. Cwd `tools/dev`:
   `env -i PATH=/usr/bin:/bin:/opt/homebrew/bin HOME=/private/tmp/hermes-auth-compatibility-20261014-fixture python3 -B -m unittest test_provision_contract test_provision_bridge_contract test_provision_transport_boundaries test_provision_native_http test_provision_native_birth test_provision_operator_mode`
   — **29 PASS /2 SKIP**,31 discovered, no failures,7.318s. Skipped native fixture
   tests are not live native qualification. Existing cookie-enabled STOP and
   protected owner/machine-reference boundary remain intact.
4. `git diff --check` exit0; HEAD remains `a3343a35`. `git diff --quiet HEAD --
   apps/api_server/src/middleware apps/api_server/src/security
   apps/api_server/src/services/mobile_cloud_identity_service.ts
   apps/api_server/src/services/hermes_notify_service.ts apps/mcp_server/src
   apps/opencode_fork tools/dev/sandbox.sh` exit0. All protected code unchanged.
5. Final hygiene: `git diff --no-index --check /dev/null <new-file>` for the new
   test, runner and run log returned no whitespace diagnostics; test/runner hashes
   rechecked identical to the table. `git status --short` shows only the seven
   assigned changed/new files and five preserved pre-existing untracked files.

### Frozen source identities (SHA256)

| File | SHA256 |
| --- | --- |
| approval routes | `f955aa8ef50cfe91aae22e14797b8a8b509ba26f01c0a28b26313c2ce49bae50` |
| notify routes | `4d1fd00079a3b03af74d0fbbf28a0ee2153ee62261ad551dfce1da4ab566bcc7` |
| CLI | `d40ea2d42e85082dcc5f53522df2398b2fe0bc6648ffa4908cb7cde376ae7db4` |
| acceptance test | `f2b8d1c504c9f4914fd8f72fb5c874766b45754f4d93dc43c108660edc0d07d4` |
| gated runner | `9193cc4095a601610a9b545b4cdbe709006b85cdca72739639830227a87fbff8` |
| compiled approval routes | `2f1712e5f27b3311f78913f7f8c6708f4b803beb84afc38a3da309a96707abb9` |
| compiled notify routes | `47d1eb500decd30c5a8d501f56199012bc2fdcf488fa0df266960d95d5643cc7` |
| unchanged auth middleware | `7994e398650951078248fdd9a3914d24db0084033f2f8bdb6f6a1d388851bda3` |
| unchanged Cloud identity service | `fb20f2c0549a693bc08e1ef7ed57313bf99b7fe8e535154093101f07d19b45c2` |
| unchanged MCP index | `eede5b4c8d02b02e9fda7af0f4f8dd1ed03b211286bc55097247933977cc618c` |

## Handoff

**READY_OWNER_CREDENTIAL_COMPAT / READY_FOR_VERIFICATION — source fixture scope.**
Parent independent verifier reruns the gated runner against these frozen hashes;
source can remain read-only (generated build/fixture paths need write access).
No independent verification claim is made by this implementer. Fresh receipt
must distinguish source-HTTP Cloud proof from full-server local proof as above.
Production change is only three relay boundaries, notify owner selection plus
minimal identity, and two CLI lookup expressions. Protocol envelopes, nonce/MAC,
tool roles, HumanCAP, engine action/payload binding and runtime permissions stay.
Runtime machine capability remains a separate existing protected file prerequisite,
never replaced by owner bearer. Unknown operator references remain prerequisites,
not new human login requirements. Activation0, no user conversations/runs/links/
subscribers/tokenfiles created, no app/Pi changes, no live decisions or credentials
access. All fixture-created decisions/rows are disposable synthetic data only.
Parent owns any later0.18.78 qualification artifact and must ASK before update or
restart. Current0.18.77 remains untouched. No Git commit/push or release action.

## Parent independent full-server gate

Verifierac0e7463-689c-4a61-a88e-534a0fbcb4d7 returned
**PASS_OWNER_CLOUD_CREDENTIAL_COMPAT** against the freshly built canonical5498 API,
5497 engine and5499 gateway. Private upstream Cloud fixture was bound before imports;
SUT middleware/resolver/handlers/fetch were not mocked. Cloud UID9001 mapped to local
UID2 (identity exactly version1/ownerUserId2), own card list/get/approve/reject and
V1/V2 history/SSE/ACK passed. Foreign Cloud admin references404; missing/invalid/
unknown/conflicting-subject/device-style tokens401 without new users/sessions;
network unavailable503 and upstream503→401 preserve existing semantics. Existing
local token required no upstream; global auth/me remained Cloud401 intentionally.
Real MCP stdio used Cloud credentials and inventoried112 tools, own list/get passed.
Desktop HumanCAP stayed separate and denied with exact unconfigured-verifier503.

Independent runs also passed local9/hosted9 source HTTP checks,48 source/wire,
33 auth and10 Cloud controls, strict API/MCP builds. Counts overlap and are not
summed. Receipt:/private/tmp/hermes-auth-compatibility-20261014-fixture/independent-fullserver-aaecd1ac-1574-497c-83cb-e87a6dc55c87.json.
Two verifier-harness corrections were retained; no product changes by verifier.
Frozen source/fixtures matched,0400 inputs preserved, both sandbox families down.

This is source compatibility, NOT a live fix. Running0.18.77/SOURCE319 remains
untouched. No live fixture/link/subscriber/card decision or restart occurred.
Parent next: commit/push this exact correction, qualification-only signed/notarized
0.18.78 artifact build, independent artifact check, then obtain permission before
any app replacement/relaunch. Existing valid Cloud credential needs no new login.
