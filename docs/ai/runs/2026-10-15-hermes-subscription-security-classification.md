---
date: 2026-10-15
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: 1617
issues: [NOTIFY-HERMES]
status: READY_SECURITY_CLASSIFIED_MCP
tags: [run, Rhythm]
---

## Files / authorized scope

Explicit parent specialist handoff; no peer dispatch or orchestrator needed.
Frozen HEAD/source `10d8bd13ccad367e80f2b1138f765686c8f6d168`.
Only writes: `apps/mcp_server/src/security/__tests__/external_content_role_graph.test.ts`
and this NEW note. Existing five untracked Mac rollout files preserved.
No product tool/_tool/SECURITY_ACTIONS/API/approval/DTO/BridgeRole/native/CLI,
sandbox/release source edits. No commit, push, CI dispatch, signing, deployment,
app restart, Pi, provider, real approvals, credentials, or live4001/4096 access.
Approval scope is resolved and unchanged. Parent owns independent review and CI.

## Phase 0 — complete, real RED

Loaded acceptance-contract first, coding-agent second; read shipping AGENTS,
project-state/current-plan, regression registry, searched subscription run records,
and read prior final-contract/cc3 checkpoint before investigating.
Read the ENTIRE 1183-line role graph (constants, enumerator, both classification
loops, reverse coverage, every old guard/assertion) before editing.

Contract: make the existing `enumerates every external-read/consequential-write
intersection` pass for all registered/role tools without weakening exactly-one,
omitting tools, moving consequential actions, or changing product bytes. Add
executable schema/HTTP/metadata/auth boundaries for ONLY subscribe/unsubscribe.
Parent independently verifies this exact change before commit/push; read-only
source suffices for review, disposable sandbox/build output needs runtime writes.

Full `npm test` BEFORE any test edit, inside assigned canonical sandbox:
**exit1, 1 failed / 223 passed / 2 skipped (226), 35 files passed / 1 failed /
2 skipped**. Exact failure at original line487:
`updateSubscriptions.ts:rhythm_subscribe_updates must have exactly one security classification: expected [] to have a length of 1 but got +0`.
This is the introduced regression, NOT baseline/waived. Existing acceptance
assertion was never changed; tests below are additive boundary regression checks.

WAIVED: new product live-behavior test is not required for a test-only metadata
classification repair. No runtime/product behavior changed. Real stdio discovery
and unauthorized read were nevertheless rerun; no new native/provider claim.

## Phase 1 — complete, bounded impact/security review

GitNexus upstream `impact` (repo Rhythm, includeTests true) for exact test filename
and `authenticatedChatApprovals` both returned target-not-found, risk UNKNOWN.
No indexed callers/processes available; not interpreted as zero risk. Manual
whole-file review identified two classification arrays and one reverse-registry
coverage list. New set participates in all three; enumeration and exactly-one
assertions remain untouched. No shared production symbols modified.

Reviewed updateSubscriptions registrar, real SDK inventory test, router,
HermesNotifyService subscribe/unsubscribe/current authority, and bearer middleware.
Rationale: ONLY owner-authenticated delivery LINK METADATA controls. Not reads,
chat decisions, engine approvals, or generic owned-write exemptions. API derives
owner from bearer resolution (existing local-or-Cloud/local auth selection), checks
source ownership, immutable SDK/project/source/destination identity. Inputs have
fixed source kinds, bounded opaque IDs, default-only profile; no destination URL,
owner override, decision or freeform prompt. Returns known IDs/flags only.
Subscribe does not dispatch/wake a model or approve/grant/cancel any action;
unsubscribe disables delivery, not the source. Independent protected Native
operator subscriber must already match the chosen same-owner saved SID: that SID
is not a network callback. This relies on explicit trusted-owner-client discipline,
consistent with relay owner controls; it does NOT invent cryptographic human proof.
No genuine runtime security defect discovered. No action authorization bypass added.

Risk: hiding a real consequential write via broad classification. Mitigation:
explicit TWO-name set and exact membership check, unchanged old action table,
full-role exhaustive coverage, real SDK parsing/handlers with ONLY external apiPost
mocked, exact authenticated HTTP target/body, malformed IDs/kinds/profiles denied
before HTTP, undeclared callback/owner/decision/prompt fields cannot cross seam,
static authenticated-owner API and immutable authority/metadata checks. Mock is
NOT presented as runtime API ownership proof; existing real API tests provide that.

## Phase 2 — complete / commands and checks

Canonical lifecycle only; no hand-launched API. Environment copied in memory
from unchanged `tools/dev/hermes_owner_subscription_checks.mjs` lines1–30, replacing
only `resolve(import.meta.dirname,'../..')` with `process.cwd()` for data-URL import
and its sandbox directory with this task's assigned directory. Existing fixture
was present, so fixture-creation branch did not run. Asserted Node executable and
cached engine SHA256 before startup. Same four explicit paths and ports every time:

```sh
ROOT=/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014
RUNTIME="$ROOT/tools/dev/.hermes-shipping-runtime"
export PATH="$RUNTIME/node/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME=/private/tmp/hermes-owner-subscription-4898-20261015-fixture
export RHYTHM_APPROVED_FIXTURE_ROOT="$HOME"
export RHYTHM_LIVE_DB_PATH="$HOME/rhythm.db"
export RHYTHM_SANDBOX_OPENCODE_CONFIG="$HOME/subscription-opencode-config.json"
export RHYTHM_SANDBOX_DIR=/private/tmp/hermes-owner-subscription-security-20261015-sandbox
export RHYTHM_SANDBOX_API_PORT=4898 RHYTHM_SANDBOX_ENGINE_PORT=4897 RHYTHM_SANDBOX_GATEWAY_PORT=4899
export RHYTHM_SANDBOX_NODE_BIN="$RUNTIME/node/bin/node" RHYTHM_SANDBOX_ENGINE_DIR="$RUNTIME" RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow OPENCODE_PURE=1 OPENCODE_DISABLE_DEFAULT_PLUGINS=1
export OPENCODE_DISABLE_MODELS_FETCH=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1 RHYTHM_LIVE_E2E=1
```

Outer commands used `env -i PATH=/usr/bin:/bin:/opt/homebrew/bin` with private
Node22.23.0 `--input-type=module -e`, importing this prelude as base64 data URL.
Actual child commands, in sequence (cwd shipping root except stated packages):

1. `/bin/bash tools/dev/sandbox.sh up`, then `status`: exit0, API74633,
   engine74812, gateway74633. API strict build and MCP emit passed. Initial
   curl refusal was startup polling, followed by engine-ready success.
2. In `apps/mcp_server`, HOME=`$SB/home`, TMPDIR=`$SB/tmp`, RHYTHM_LIVE_E2E=0:
   `npm test`: RED above. No suite exclusions, no added skips.
3. One implementation repair: narrow set + three coverage sites + two tests.
   `npm test`: GREEN226 pass/2 unchanged skips; graph7/7; inventory4/4 pins114.
   `npm run typecheck`, private Node `node_modules/typescript/bin/tsc -p tsconfig.json --strict`,
   `npm run build`: all exit0 (strict emit is separate from noCheck build).
4. In `apps/api_server`, same sandbox HOME/TMPDIR, DB_PATH=:memory: and
   NODE_OPTIONS=`--require=$ROOT/tools/dev/hermes_shipping_auth_test_helper/loopback.cjs`:
   private Node `node_modules/vitest/vitest.mjs run src/__tests__/hermes_source_contract.test.ts src/__tests__/hermes_coordinator_notify_contract.test.ts src/__tests__/hermes_coordinator_notify_boundaries.test.ts src/__tests__/hermes_coordinator_notify_revocation.test.ts src/__tests__/hermes_wire_projection.test.ts src/__tests__/hermes_approvals.test.ts src/__tests__/hermes_cloud_owner_auth.test.ts --no-file-parallelism`:
   **44/44 PASS, 7 files**, consisting existing35 + local auth9; no hosted rerun
   or provider execution. Expected401/404/409/503 negative-path logs observed.
5. Real `tools/dev/hermes_shipping_mcp.mjs` imported in memory with ONLY root
   resolution and sandbox directory adapted, all assertions intact. Output:
   `{"tools":114,"shippingBaseline":109,"approvals":3,"subscriptions":2,"additive":5,"total":114,"unauthorizedRead":"DENIED","decisions":0,"providerRequests":0}`.
6. Added stronger undeclared-field/bearer/SDK-project assertions (no assertion
   relaxed). Final `npm test`: **226 passed / 2 skipped (228), 36 files passed /
   2 skipped (38)**; graph7/7. `npm run typecheck`, strict emit command above,
   `npm run build`: all exit0 again. No failed implementation repair iteration.
7. `/bin/bash tools/dev/sandbox.sh status`, then `down` using SAME env: exit0;
   diagnostics `.evidence.SpLMyH` retained, sandbox removed. Final lsof4898/4897/4899
   exit1/no listeners (unrelated existing SMB mount stat warning). Both fixture
   DB/config remain0400. No port/process beyond assigned lifecycle touched.

`git diff --check` exit0. No installed Prettier found in root/API/fork node_modules
or PATH; no dependency installed and no whole-file reformat performed. Existing
double-quote/comma style retained. Two fingerprint command typos failed before
reading/writing source (unsupported git hash-object -z, Python syntax typo);
corrected read-only fingerprint command succeeded before implementation.

## Frozen identity / handoff

Before/after all cached+untracked nonignored regular file bytes EXCLUDING ONLY
two assigned paths: **12085 files**, SHA256
`085bc534d6924d0007b23a436e65c6d3da20777f9868a5ebedeb7d56e247364d` identical.
Digest input sorted unique path UTF8 + NUL + raw SHA256(file bytes).
Includes protected API/auth/SDK/source/native/CLI and five pre-existing untracked
Mac files. `git diff --exit-code 10d8bd13 -- <each production path below>` exit0.
Original protectedWrites block byte-identical; ALL original test lines retained
in original order. No old email/task/direct-prompt/session-context guard removed.

| Source | SHA256 (unchanged) |
| --- | --- |
| MCP tools/updateSubscriptions.ts | 025d237cb9b8f892ff1cb2912f6a6792ae539dd1b25fce826fc2d2a8f2bdb489 |
| MCP tools/_tool.ts | 2dda024bbd3cfb74da944c1460dc750c287da63dc81137aa1cc7259c263c2fc0 |
| MCP index.ts | b736757d087b908e6575addb752577db260c65f9c0a6dc4912c7754c2562b3b2 |
| API routes/hermes_notify_routes.ts | 773f53408225d8b1accb4fe42cbfe8cf83e78e4de825ad822afc51fec76dc681 |
| API services/hermes_notify_service.ts | 1749bf22276f285878ce3800e42dac3c42f3a30065294113a46d8ff7ede0f149 |
| API middleware/auth_middleware.ts | 7994e398650951078248fdd9a3914d24db0084033f2f8bdb6f6a1d388851bda3 |

Cached engine SHA256 `d60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072`.
Final test SHA256 `11380d12978dce9118e9ec0bcd5381be2b5c0887b0cda82946be8d74141836a0`.
No artifact/source identity substitution: qualification0.18.79 remains source10d8bd13;
any later parent test-only commit SHA is DIFFERENT, with no production source change.

**READY_SECURITY_CLASSIFIED_MCP / READY_FOR_VERIFICATION.** Parent must independently
review/test the narrow category/old guards before commit/push, then require current
CI checks green. No commit/push, merge, deployment, app restart, signing/CI rebuild,
live activation, native receiver change or runtime source/provider action performed.

## Parent independent classification gate

Verifiercb0a3de8-85bb-41a7-ad1b-ba29c073e62d returned
**PASS_MCP_OWNER_DELIVERY_CLASSIFICATION**. Full MCP suite226pass/2unchangedskips,
role graph7/7, registration4/4 with114tools, strict typecheck/build passed.
Seven API suites44pass. Independent built-registrar/realSDK probes stripped18
unknown-field inputs and rejected8 malformed inputs without HTTP invocation.
This is SDK-boundary proof; actual API owner isolation comes from source suites,
not the mocked apiPost in those separate schema probes.

The category contains exactly the two subscription controls. Both classification
loops and reverse coverage retain exact-one semantics; all original protected
writes, three approval entries, trusted reads and enumeration bytes are unchanged.
Every original test line remains in order; two new tests were added. Production
code is byte-identical to source10d8bd13, so the in-progress0.18.79 qualification
build remains bound to that production source. Fingerprint12027 files unchanged;
classification testSHA11380d12978dce9118e9ec0bcd5381be2b5c0887b0cda82946be8d74141836a0.
Stock sandbox down,0400 inputs preserved; diagnostics .evidence.nyfbXd.

Parent may commit/push only this test metadata and receipt. All seven current-head
CI checks remain required; no waiver, activation, restart or release implied.
