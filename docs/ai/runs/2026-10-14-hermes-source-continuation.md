---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: null
issues: [NOTIFY-HERMES, HERMES-APPROVALS]
status: FAIL_FULL_SCOPE_SOURCE_SLICE_VALIDATED
tags: [run, rhythm]
---

## Scope / approvals
Parent explicit specialist continuation. Sole shipping worktree writer at c74f4392;
preserve all pre-existing dirty changes. Acceptance-contract loaded first, coding-agent
second. Read shipping AGENTS, current-plan, project-state, rollout run and regression
registry. Scope is provisioning + authoritative preengine/card/coordinator publication
and sandbox/native E2E only. No peers dispatched. No release-file edits, staging,
signing, notarization, archiving, production flags, /Applications, SSH/Pi writes or
restarts, live4001/4096, real cards/providers, credential values in output, dependency
installation, destructive cleanup, commits or pushes. Parent owns repackaging and
new restart request after integration. Existing candidate becomes STALE on code change.

## Phase 0 (source slice complete)
Frozen check: apps/api_server/src/__tests__/hermes_source_contract.test.ts.
Command (private API package):
`./node_modules/.bin/vitest run src/__tests__/hermes_source_contract.test.ts --no-file-parallelism`.
Actual RED exit1: 3 failed/0 passed, 784ms. Failures: raw external-permission wrongly
published as canonical approval; canonical create has empty journal; supported V2
bind rejects trusted bridge registry as Workflow not found. Actual SQLite migrations,
repositories, notifier and outbox; no system mocks. These are unit contracts, NOT
live engine/native acceptance. Implementer mandate: pass these unchanged checks.
Independent verifier: parent can run checks read-only against source/artifact.
Full owner CLI, persistent workstream aggregation and visible native ACK require
additional qualification; none inferred from these tests.

## Phase 1 (bounded source slice)
Inspected notifier whole file, router, real bridge dispatcher/projection/job schema,
approval repository, server terminal-observer composition and prior shipping run.
GitNexus primary Rhythm index differs from c74 worktree: dependency hints only.
executeHermesToRhythm LOW: one direct caller (dispatchFromHermes), one module, no
indexed process; approval create LOW: two direct/five total, one service module,
no indexed process. HermesNotifyService UNKNOWN/unindexed, manually traced.
Changes permitted: those source internals, additive publication event, tests/dev
tools and this note. No graph HIGH finding for this slice; do not claim persistent
coordinator review complete until its actual modified member has been analyzed.

## Files / actual implementation
- apps/api_server/src/services/hermes_notify_service.ts: additive bridge-origin
  journal referencing existing broker job + original outbox anchor; V2 payload
  shape remains exact (no new sourceKind). Owner, child, original parent projection,
  sessionKey/profile/generation rechecked for every read/ACK. No inference of remote
  chat IDs. Immutable tuple, foreign ACK denial and NULL-owner revocation. Broker
  terminal state, not idle, projects bridge lifecycle. This is ONE bridge job,
  **not persistent-workstream aggregate qualification**.
  Pending canonical cards recover from durable agent_approvals and journal card ID
  only, without preview/prose/nonce/payload or execution authority. Engine permission
  IDs and Recipe pending occurrence IDs no longer become new approval references.
- apps/api_server/src/repositories/agent_approvals_repository.ts: pending publication
  observation event after canonical create. No approval/signature/consumption guard
  or returned card fields removed. Notification callback catches persistence errors;
  durable state is replay source. Notification listener has stop/reconnect cleanup.
- apps/api_server/src/shared_agents/delegation_coordinator.ts: existing broker
  onSessionCreated records child, then attempts trusted origin publication before
  engine call. A failed notification projection withholds origin and logs a generic
  warning; it does not invent a grant or change authorized broker execution outcome.
- apps/api_server/src/shared_agents/delegation_jobs_repository.ts: type-only optional
  runner sessionId accepted in completeFromRunner input; it is never binding authority.
- apps/api_server/src/__tests__/hermes_source_contract.test.ts: three frozen checks,
  unmocked repositories/SQLite/outbox. No assertion or test edits after RED.
- tools/dev/hermes_shipping_workstreams_acceptance.mjs: env-gated actual HTTP
  workstream authentication and Recipe default-off checks. BOTH already PASS before
  any test-config edits; the current supported registry is available. No wrapper,
  sandbox sanitizer or Recipe flag change was needed/made. This was a capability
  validation, NOT a newly failing feature contract.
- This dedicated run note. All other dirty paths were present on entry; preserved.

## Checks / repair loop (two attempts, no assertions weakened)
1. `./node_modules/.bin/vitest run src/__tests__/hermes_source_contract.test.ts src/__tests__/hermes_approvals.test.ts --no-file-parallelism && npm run build`:
   unit8 PASS; strict build FAILED: frozen test supplied runner sessionId to narrow
   repository input type; workflow reference expression compared unreachable kind.
   Repair1: optional existing-runner result metadata type, null occurrence reference.
   GitNexus completeFromRunner LOW: two direct/four total, one shared-agents module,
   no indexed processes. Callers executeHermesToRhythm and dispatchFromRhythm retain
   durable binding authority. No HIGH found.
2. `npm run build && ./node_modules/.bin/vitest run src/__tests__/hermes_source_contract.test.ts src/__tests__/hermes_approvals.test.ts src/__tests__/shared_agents_delegation.test.ts --no-file-parallelism`:
   strict build PASS;20 PASS/1 FAIL: old injected runner supplies nonexistent child
   and notification schema is absent, so notification failure replaced successful
   broker outcome. Repair2: notification observation failure cannot fail broker
   execution; missing provenance still cannot activate an origin. Existing regression
   mocks are preserved; new source contract does not mock the system under test.
3. Final command (API package):
   `./node_modules/.bin/vitest run src/__tests__/hermes_source_contract.test.ts src/__tests__/hermes_approvals.test.ts src/__tests__/shared_agents_delegation.test.ts src/__tests__/human_approval_signature.test.ts src/__tests__/expired_approval_decide.test.ts src/__tests__/coordinator_goal_approval_resume.test.ts src/__tests__/approval_not_required_on_clean_session.test.ts src/__tests__/issue_1134_external_content_security.test.ts --no-file-parallelism && npm run build`:
   exit0;8 files/120 tests PASS,21.14s; strict build/postbuild PASS. This includes the
   prior104 API tests and adds3 source contract +13 preserved bridge regressions.
4. Canonical lifecycle command (shipping root):
   `bash tools/dev/hermes_shipping_checks.sh up && bash tools/dev/hermes_shipping_checks.sh status && bash tools/dev/hermes_shipping_checks.sh acceptance`:
   exit0, rebuilt API+MCP; API42316 on4898/gateway4899, engine42456 on4897; actual
   API and engine health200;2 frozen auth surface contracts PASS,99.12ms.
   Installed verified unchanged engine copy retained under prior authorized runtime
   procedure, no fork changes or old Recipe engine substitution.
5. `env RHYTHM_LIVE_E2E=1 tools/dev/.hermes-shipping-runtime/node/bin/node --test tools/dev/hermes_shipping_workstreams_acceptance.mjs`:
   exit0;2 PASS/0fail,103.69ms. Workstream GET401 (not missing route404); Recipe
   POST409,error=disabled. No dispatch/provider/auth owner request occurred.
6. `env RHYTHM_LIVE_E2E=1 tools/dev/.hermes-shipping-runtime/node/bin/node tools/dev/hermes_shipping_mcp.mjs`:
   exit0; actual112 tools/baseline109/additive3; unauthorizedRead=DENIED;
   decisions0/providerRequests0. NOT owner get/decision/engine action-gate proof.
7. MCP package `./node_modules/.bin/vitest run src/__tests__/mcp_capabilities_and_tool_registration.test.ts src/security/__tests__/external_content_role_graph.test.ts && npm run typecheck && ./node_modules/.bin/tsc -p tsconfig.json`:
   exit0;2 files/9 PASS,547ms; strict typecheck/emit PASS. Expected scanner denials
   exercised; no removed shipping tools. Total focused unit129 PASS.
8. `bash tools/dev/hermes_shipping_checks.sh down && git diff --check`:
   exit0. Only owned canonical sandbox stopped; sanitized diagnostics retained at
   /private/tmp/hermes-shipping-rollout-20261014-sandbox.evidence.E8mnzF.
   No live server, installed app or Pi restarted/stopped. No new dependencies.

## Qualified handoff — FULL-SCOPE FAIL, NOT READY_FOR_VERIFICATION
Source slice is implemented/tested, not another docs-only result. Exact unmet
criteria: protected default-DRYRUN/--execute-owned-fixture operator CLI, authenticated
HTTP fixture creation/dispatch with auth-me-derived owner, transactional current-owner
receiver.link (new receiver DB, no chat adoption), cross-JSON/SQLite crash recovery,
current persistent coordinator child aggregation + durable questions, and current
shipping API -> actual MCP owner list/get/fixture-decide -> engine action gate ->
SSE/subscriber -> copied WebUI -> unobscured Chromium visible receipt -> actual ACK.
No full live fixture run or native visible ACK was executed here. Earlier independent
native ACK evidence is on a different build/source and is NOT carried forward as
current proof. No SQLite provisioning forgery or automatic card decision used.

Do not equate bridge terminal with aggregate all-pass: outstanding native workstream
jobs, waiting/wakeerrors, current-attempt aggregation and legacy raw notification
history reconciliation remain unqualified. Bridge questions are withheld rather than
pretending raw engine IDs are durable queue IDs; legacy/Recipe question qualification
is still pending. No persistent_workstream_coordinator or server observer edits were
made. Full current-owner/profile/expiry/replay/actor/revision acceptance remains
pending beyond the executed card-unit security checks.

Parent must continue within the SAME approved scope/exclusions, not request scope
approval again. Live execution needs exact protected credential FILE reference,
disposable native fixture chat/provenance and upstream deterministic provider-harness
inputs; none were invented or sourced from live secrets. Operator-selected production
provider remains pending, not defaulted. Finish source/E2E before parent repackages.

**Existing signed candidate/archive/source identity manifests are STALE after these
source changes.** They were not edited/re-staged/re-signed/re-notarized/re-archived.
Parent owns the single integration boundary/repackage and later fresh AJ restart
request. No commit/push. Primary graph index was not rebuilt or used to claim that
untracked notifier code has zero blast radius. Run verification commands above
independently; no deployment readiness or native ACK milestone is claimed.
