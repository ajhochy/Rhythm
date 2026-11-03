---
date: 2026-10-15
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: 1617
issues: [NOTIFY-HERMES]
status: bounded-fail-native-origin-policy
tags: [run, Rhythm]
---

## Scope / approvals
Explicit parent handoff, single implementation owner, HEAD12b6521e. Only assigned
shipping worktree. Approved owner-only notification subscription, two additive MCP
tools, existing durable origins/outbox and source-kind authority, thin provisioning
attach-existing mode, tests and guide. No Bridge/runtime/action role changes,
NativeAdapter/native code/schema changes, live data/credentials, activation,
app/Pi restart, release/sign/build packaging, dependencies, commit/push/merge.
Five unrelated untracked Mac supervisor/test/run files preserved. Parent owns
independent verification, integration and any future0.18.79 qualification/restart ASK.

## Phase 0 — acceptance
Loaded acceptance-contract FIRST, coding-agent second. Read AGENTS, regression
registry, project-state/current-plan and latest Cloud compatibility/currentwire ACK/
operator CLI receipts. Named executable contract: tools/dev/hermes_owner_subscription_checks.mjs.
Mandate: make the frozen assertions pass, not weaken them. Parent independently
reruns against read-only source and writable disposable fixtures.

Command (shipping root):
`env -i PATH=/usr/bin:/bin:/opt/homebrew/bin RHYTHM_LIVE_E2E=1 tools/dev/.hermes-shipping-runtime/node/bin/node tools/dev/hermes_owner_subscription_checks.mjs`
RED: official MCP inventory missing rhythm_subscribe_updates (false vs true).
Same command with `--source-red`: real ordinary authenticated POST /agent-sessions
201, then POST /hermes-notify/subscriptions404 vs201. Neither test enrolls Bridge
registrar or provides machine capability. Builds passed, own5598/5597/5599 up/status/
down passed both times. Evidence .ushcgi and .xzca4V. Fixture canonical builder,
fresh synthetic DB/config0400, API5598 engine5597 gateway5599, all four path variables
fixed in runner; private Node22.23 and engine d60f5a... reused unchanged.

## Phase 1 — impact / risks
GitNexus: HermesNotifyService (including member relations), createHermesNotifyRouter,
CLI main UNKNOWN/unindexed; apiImpact notify routes absent. MCP index LOW/0 indexed
direct/flows, NOT global zero-risk evidence. Manual surface review: full service,
routes, CLI and its direct calls; app/server mount/start and broker bindBridge;
existing source/wire/Cloud/coordinator tests and copied native bootstrap/ACK flow.
Shared service risk is owner/project/SDK/source-kind confusion or revoked Bridge
fallback; metadata must remain immutable, authority checked at publication/history/
SSE/ACK, workflow run/stage/attempt canonical, ordinary source never completion.
Existing approval tools/security and Bridge dispatch code remain unchanged.
No HIGH/CRITICAL returned; unknown new files are not assumed safe/zero-impact.

## Files / Checks / Notes
Implementation and validation results follow below; no readiness claim yet.

### Implemented files (uncommitted)
- apps/api_server/src/services/hermes_notify_service.ts: additive subscription_json
  on existing origins; typed ordinary/workflow subscription and disable, immutable
  owner/project/SDK pins, current authority on publication/history/ACK; V2 ordinary
  source identity with no lifecycle completion or fake Recipe row. Reuses coordinator
  authority helper; Bridge job checks retained, not reclassified as ordinary.
- apps/api_server/src/routes/hermes_notify_routes.ts: strict existing owner auth,
  POST subscriptions and subscriptions/disable, strict body keys, no owner override
  or arbitrary URL. Existing V2 projection/labels unchanged.
- apps/mcp_server/src/tools/updateSubscriptions.ts: exactly subscribe/unsubscribe.
- apps/mcp_server/src/index.ts: two additive tools, **112+2=114**. Parent must update
  PR1617 count. All previous registrars retained, existing approval tools untouched.
- apps/mcp_server/src/__tests__/mcp_capabilities_and_tool_registration.test.ts:
  exact29 registrar/114 tool count.
- tools/dev/hermes_fixture_provision.py: explicit attach-existing-owned-source;
  no runtime reference/read/requests, default dryrun, protected metadata, exact
  owner/default profile/new native birth, supported Receiver.link and own registry.
  Existing old Bridge flow remains separate. New mode only adds exact5598 synthetic
  sandbox allowance; operator remains exact4001 with --allow-private-relay.
- tools/dev/hermes_owner_subscription_checks.mjs: canonical lifecycle and official
  SDK MCP, ordinary API create, source descriptor, noBearer/body tamper/reassign/
  unsubscribe history+ACK controls, issue regressions and native acceptance runner.
- tools/dev/hermes_owner_subscription_native.py: actual hash-pinned copied WebUI,
  deterministic upstream-only provider, supported native birth, official MCP attach,
  API rename->engine event->SSE->unchanged subscriber/NativeAdapter->Chromium->ACK
  executable check. FAIL described below, not a passing proof.
- tools/dev/test_owner_subscription_cli.py: dryrun no-runtime/unknown callback deny.
- docs/ai/guides/hermes-owner-mcp-subscriptions.md and this run record.

### Actual validation
1. Original owner-control slice passed canonical sandbox before native extension:
   real create201, MCP inventory114, subscribe typed descriptor, V2 history with no
   completion, unknown body400/missingBearer401/reassignment toolError, disable then
   history404/ACK404. Up/status/down .XEh5AM.
2. Full native command (same executable default command above) FAIL at
   hermes_owner_subscription_native.py112 constructing actual Subscriber:
   `ValueError: HTTPS or exact opted-in loopback origin required`.
   Actual source a13af295-f5b2-49bd-a40d-d46b6276ecbf created through ordinary API;
   native SID27c8e79c7024 created through new+rename, messages0 before delivery;
   official external MCP subscribe and CLI install_link nativeCurrentBinding PASS.
   Supported source PATCH rename200 reached; no seeded source events/ACKs. Native
   fixture retained under approved root owner-native-_7yj5jln. Down .20bkEl.
3. Root cause is precise: **unchanged pinned subscriber** validate_origin lines101–111
   accepts HTTP only exact4898 with loopback_test or4001 with private_relay. Assigned
   canonical sandbox is5598. NativeAdapter/native schema are not the failure. No
   validator patch, HTTP/TLS proxy, port remap, base mutation or live-port fallback
   attempted. Repair attempts0: source edits cannot satisfy this external transport
   invariant under assigned unchanged-client/5598 constraints. Stop bounded here.
4. Final control/regression-only command:
   `env -i PATH=/usr/bin:/bin:/opt/homebrew/bin RHYTHM_LIVE_E2E=1 tools/dev/.hermes-shipping-runtime/node/bin/node tools/dev/hermes_owner_subscription_checks.mjs --control-only`
   Exit0. API strict build PASS; MCP strict tsc PASS; existing source/wire35 PASS
   (6 files), MCP registration4 PASS, owner CLI1 PASS (invoked twice, not counted2).
   Official live MCP inventory112+2=114 and control assertions PASS. This switch
   explicitly does NOT qualify native ACK. Own5598/5597/5599 up/status/down PASS,
   evidence .LNxU03. Exact child commands/env are in executable runner.
5. git diff --check exit0; protected shared_agents/security/middleware/approval routes/
   fork diff --quiet exit0. lsof own5598/5597/5599 returned1/no listeners (unrelated
   Time Machine SMB stat warning). Five unrelated untracked files unchanged.

### Bounded FAIL / remaining qualification
**NOT READY_OWNER_MCP_SUBSCRIPTION.** Main acceptance stopped at real subscriber
origin validation; browser/native visible/real ACK not reached. Do not claim native
provider effects, busy queue/dedup/restart, source model success or approval engine
effects from this run. Default acceptance still FAILS without special switches.
Existing pending/question/card/coordinator regressions passed unchanged, but ordinary
subscription coordinator descendant event projection, canonical workflow subscription
live matrix and owner/admin/NULL/revoked-source full negative matrix are not fully
qualified. Cloud resolver compatibility is prior proof, not rerun Cloud proof here.
JSON-pointer owner credential config input not implemented; protected plain owner
file remains prerequisite (no credential value read live). No fabricated success,
new credential/runtime subsystem, SQL source fixture row, native/client modification,
or workaround architecture added. Parent must resolve the explicit pinned subscriber
test-origin versus5598 requirement before full qualification; unchanged scope and
exclusions stay approved and need not be re-requested. This is a partial executable
implementation, not release-ready. No activation/restart/build packaging/commit/push.
