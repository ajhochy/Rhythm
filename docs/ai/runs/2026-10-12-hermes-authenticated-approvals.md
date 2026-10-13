---
date: 2026-10-12
repo: Rhythm
branch: feat/hermes-authenticated-approvals-20261012
pr: null
issues: []
status: READY_FOR_REVERIFICATION
tags: [run, Rhythm, security, hermes]
---

# Hermes authenticated approvals

## Scope / authorization

AJ's parent dispatch explicitly authorizes authenticated owner chat-relayed per-card approval/rejection using the existing Rhythm bearer; no second auth step. This implementation owner works only in `Rhythm-pr-worktrees/hermes-authenticated-approvals-20261012`, base `4f915540`. No commits/pushes. Parent independently verifies unchanged acceptance checks before final handoff.

Exclusions: blanket approval, desktop signature forgery, engine-context bypass, profile permission expansion, live/production cards/data/actions, migrations/deployments, network/Tailscale/relay configuration or Hermes restart, primary checkout edits and existing worktree cleanup. Host permission boundaries remain intact irrespective of routine bypass mode.

## Phase 0 — acceptance contract

Loaded acceptance-contract then coding-agent; read AGENTS/project-state/current-plan. Frozen acceptance file: `apps/api_server/src/__tests__/hermes_approvals_live_e2e.test.ts`. Named checks AC1 owner-only list/get and exact binding; AC2 approve/reject/audit identity; AC3 auth/ownership/input, hash/revision/stale/expiry/replay, concurrent winner; AC4 forged engine/desktop failure; AC6 guide. AC5 is the real SDK client → built MCP stdio → running sandbox transport for all behavioral checks; successful execution-gate coverage will be added separately without weakening this contract.

Command from apps/api_server:
```
env RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_SANDBOX_DIR=/private/tmp/hermes-approvals-20261012-sandbox DB_PATH=/private/tmp/hermes-approvals-20261012-sandbox/rhythm.db RHYTHM_LIVE_URL=http://127.0.0.1:4198 node_modules/.bin/vitest run src/__tests__/hermes_approvals_live_e2e.test.ts --no-file-parallelism
```
RED, 21:51:55: `Test Files 1 failed (1); Tests 7 failed (7)`. Six behavioral checks fail `MCP call must succeed: expected true to be false` because relay tools are absent; guide is absent. Prior scaffolding failures (missing cwd and TypeScript unknown-row types) were repaired BEFORE freezing/implementation; they are not RED behavioral evidence.

Sandbox sources created by `node tools/dev/sandbox_fixture.mjs /private/tmp/hermes-approvals-20261012-fixture`; read-only synthetic DB/config, no live sources. Dependency symlinks reuse installed trees read-only, never npm installed. First fork build failed `preload not found @opentui/solid/preload`; linked existing package dependencies, launcher then built fork successfully. API build first caught test row typings; corrected before implementation. All launches/cleanup via owned launcher. Current API4198/engine4197/gateway4199; ports checked free, live4001/4096 untouched. Launcher status: API PID21271, engine PID21365, gateway PID21271, engine-ready. Rebuilds may reuse the fork binary built by this launcher (`RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1`); fork source unchanged.

## Phase 1 — bounded impact review

Inspected approvals repository/controller/routes, P-256 desktop signature/capability, continuation service, external-content consumer/controller and trusted MCP verifier; MCP index/auth/api client/tool wrapper/security context; session owner field; local/cloud bearer middleware; sandbox launcher/fixture/testing guide; both parent receipts. Existing approvals are SQLite-only local execution state. Hosted Postgres does not own these cards. Relay ownership is exact `agent_sessions.owner_user_id`, never admin role, unowned/global fallback, caller-supplied owner/profile/session, or cloud-route replication.

GitNexus query/context/impact before implementation: consumeApproval LOW (one direct caller ExternalContentSecurityController.consume, routes → app transitive, zero indexed processes); agentApprovalsRouter LOW (zero graph consumers); MCP index File LOW (zero graph consumers); AgentApprovalsRepository MEDIUM (5 direct, 16 affected including member traversal). API impact `/agent-approvals`: LOW, one web gateway consumer; graph attributes mount to app rather than controller. Controller-specific route lookup absent; actual middleware and handlers manually read. No HIGH/CRITICAL graph ratings. The shared outbound gate is security-consequential despite LOW graph rating: preserve every existing engine/session/agent/taint/expiry/exact-payload/single-use predicate; add fail-closed relay receipt binding only. Desktop handlers/signatures stay unchanged. Coverage includes existing desktop and unattended/bypass regressions plus successful real engine-signed synthetic task execution. No renewed scope authorization needed.

Implementation surface: new relay security/service/controller and MCP tool file, additive route/index registration, additive consumer receipt assertion, tests and dedicated docs only. Reuse existing actor audit string for a versioned JSON relay receipt and existing atomic decision nonce/continuation machinery; no schema migration or new authentication system. Existing protected token-file setup is an operator wrapper that exports the existing RHYTHM_API_TOKEN, not a new credential or password.

## Files (exact modified paths)

- `apps/api_server/src/controllers/relay_approvals_controller.ts` (new)
- `apps/api_server/src/security/relay_approval_security.ts` (new)
- `apps/api_server/src/routes/agent_approvals_routes.ts`
- `apps/api_server/src/services/external_content_security_service.ts`
- `apps/api_server/src/__tests__/hermes_approvals.test.ts` (new)
- `apps/api_server/src/__tests__/hermes_approvals_live_e2e.test.ts` (new, frozen RED contract)
- `apps/api_server/src/__tests__/hermes_approvals_execution_live_e2e.test.ts` (new supplemental real execution evidence)
- `apps/mcp_server/src/tools/relayApprovals.ts` (new)
- `apps/mcp_server/src/index.ts`
- `apps/mcp_server/src/__tests__/mcp_capabilities_and_tool_registration.test.ts`
- `apps/mcp_server/src/security/__tests__/external_content_role_graph.test.ts`
- `docs/ai/guides/hermes-authenticated-approvals.md` (new)
- `docs/ai/decisions/2026-10-12-hermes-authenticated-chat-approvals.md` (new)
- `docs/ai/project-state.md` (isolated feature checkpoint; prior campaign context preserved)
- `docs/ai/runs/2026-10-12-hermes-authenticated-approvals.md` (this log)

No source edits in fork/desktop/roles/permissions/auth middleware/database migrations. Ignored local dependency symlinks and generated build outputs are verification prerequisites, not source changes. No installs through symlinks.

## Phase 2 — complete: implementation and checks

### Launcher commands and builds

From this worktree root (ports verified free; no live endpoints):
```sh
node tools/dev/sandbox_fixture.mjs /private/tmp/hermes-approvals-20261012-fixture
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-approvals-20261012-fixture
export RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-approvals-20261012-fixture/rhythm.db
export RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-approvals-20261012-fixture/opencode.json
export RHYTHM_SANDBOX_DIR=/private/tmp/hermes-approvals-20261012-sandbox
export RHYTHM_SANDBOX_API_PORT=4198 RHYTHM_SANDBOX_ENGINE_PORT=4197 RHYTHM_SANDBOX_GATEWAY_PORT=4199
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow
export OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1
tools/dev/sandbox.sh up
tools/dev/sandbox.sh status
```
Initial `up` built the unchanged fork through the launcher's `bun run build --single --skip-install --skip-embed-web-ui` after package dependency linking. Subsequent iterations used `export RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1` with this exact locally-built binary, then `tools/dev/sandbox.sh down && tools/dev/sandbox.sh up && tools/dev/sandbox.sh status` under the identical environment. API `tsc -p tsconfig.json` and MCP `tsc -p tsconfig.json --noCheck` both pass in final launcher. Node22.23.0, Bun1.3.14. Final ready output:
```
Sandbox ready: http://127.0.0.1:4198 (engine :4197)
api :4198 listener: 11920
engine :4197 listener: 12014
gateway :4199 listener: 11920
```
The startup polling's initial `curl (7)` precedes readiness, not a failed launch.

### Live MCP + actual execution gate

From apps/api_server:
```sh
env RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_SANDBOX_DIR=/private/tmp/hermes-approvals-20261012-sandbox DB_PATH=/private/tmp/hermes-approvals-20261012-sandbox/rhythm.db RHYTHM_LIVE_URL=http://127.0.0.1:4198 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4197 node_modules/.bin/vitest run src/__tests__/hermes_approvals_live_e2e.test.ts src/__tests__/hermes_approvals_execution_live_e2e.test.ts --no-file-parallelism --reporter=verbose --silent=false
```
Final22:05:20 output:
```
LIVE HERMES GATE: external SDK→built stdio→real API decisions; real fork signed task calls: one concurrent task/consumption, replay/reject/changed/hash-mismatch/expiry=0 tasks
Test Files 2 passed (2)
Tests 8 passed (8)
Duration 17.29s
```
Frozen RED contract passed7/7 on first implementation run21:58:35. Supplemental AC5 passed1/1 on first run22:00:33 (16.83s) and again against final build. Supplemental fixture had one later compile-only unknown JSON type annotation repair; assertion unchanged.

Real evidence: external official SDK Clients spawn this worktree's built `dist/index.js` via stdio; generated in-memory synthetic bearer tokens authenticate real API reads/decisions. Exact owner/non-owner/null-owner, valid approve/reject, audit actual user name/ID/source/assurance, auth missing/bad/expired, malformed input, hash/revision changes, stale taint, expiry/replay and two-client opposite-decision race all exercised against running API. Each race has one winning durable decision.

AC5 then feeds a local deterministic upstream Anthropic-protocol provider fixture into the real running fork. It is synthetic model INPUT, not a mock of the system under test. The real engine advertises/calls `rhythm_rhythm_create_task`, signs ephemeral Ed25519 metadata, invokes real built MCP, and the real HTTP consume gate permits exactly one bound sandbox task out of two simultaneous calls. A fresh engine-signed replay makes no extra task; rejection, altered payload digest/preview after approval, outbound title mismatch and post-decision expiry make zero tasks and leave those approvals unconsumed. No email/PCO/external action/provider network or production fixtures. External client forgery is separately refused even with an approved card.

### API issue-level regressions

From apps/api_server:
```sh
env HOME=/private/tmp/hermes-approvals-20261012-sandbox/home XDG_CONFIG_HOME=/private/tmp/hermes-approvals-20261012-sandbox/home/.config DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=4197 RHYTHM_AGENT_URL=http://127.0.0.1:4198 RHYTHM_API_BASE=http://127.0.0.1:4198 RHYTHM_OPTIMIZER_MODE=shadow node_modules/.bin/vitest run src/__tests__/hermes_approvals.test.ts src/__tests__/human_approval_signature.test.ts src/__tests__/issue_895_agent_approvals.test.ts src/__tests__/issue_1382_approval_lanes.test.ts src/__tests__/issue_1134_external_content_security.test.ts src/__tests__/approval_not_required_on_clean_session.test.ts src/__tests__/unattended_scheduled_auto_approve.test.ts src/__tests__/hermes_approvals_live_e2e.test.ts src/__tests__/hermes_approvals_execution_live_e2e.test.ts --no-file-parallelism --reporter=verbose
node_modules/.bin/tsc --noEmit
```
Final22:06:17: `Test Files 7 passed | 2 skipped (9); Tests 39 passed | 8 skipped (47); Duration 7.87s`. Skips prove live env gate default, NOT unrun live criteria (separately run above). Earlier subset six files31 tests passed22:02:13. Existing signed desktop accept/reject, forgery/status/digest substitutions, auth/capability, session/agent/taint/expiry/exact payload/atomic consume plus intentional unattended behavior pass. New persistence suite uses real migrated in-memory SQLite and no SUT mocks. Existing suites use their own generated test signatures/engine test proofs and embedded test HTTP surface; these are regression checks, not substituted for actual fork evidence. All runtime config/HOME/ports isolated. API typecheck final exit0, no output.

### MCP full suite and bounded repair

From apps/mcp_server:
```sh
env HOME=/private/tmp/hermes-approvals-20261012-sandbox/home RHYTHM_AGENT_URL=http://127.0.0.1:4198 RHYTHM_API_URL=http://127.0.0.1:4198 npm test
npm run typecheck
```
First full22:03:09: `2 failed | 189 passed | 2 skipped (193)`, two files failed because new tools had no security classification and registrar mirror remained25. One repair: additive `authenticatedChatApprovals` category without moving any prior protection; bearer-only relay seam/no signature/no recursive consume assertions; actual registrar and tool presence mirror updated25→26,103→106. GitNexus impact attempted on both test files before edits; tests absent from index (UNKNOWN), manually reviewed whole changed assertions. No frozen acceptance changes/weakening, role files/permissions unchanged.

Re-run22:04:24: `Test Files 33 passed | 2 skipped (35); Tests 191 passed | 2 skipped (193); Duration 3.65s`; MCP typecheck exit0. The two existing live-only skips remain unrelated. Total bounded behavioral repair rounds: one MCP registry/classification repair; no failing implemented live criterion. No lint script is defined in MCP package; no invented lint-pass claim.

### Scope and teardown

`git diff --check` exit0. `gitnexus_detect_changes({repo:Rhythm,scope:all,worktree:<this worktree>})`:5 indexed touched symbols,5 changed tracked files,risk low,zero affected processes. Hunk mapping also labels unchanged neighboring requireInternalAuth/SECURITY_ACTIONS; manual diff confirms their bytes unchanged. Untracked additive files are not modeled by this existing index; manually reviewed/inventoried above, not counted as zero impact.

Under identical launcher environment, ran `tools/dev/sandbox.sh status`, SQLite count-only cleanup query, `curl --fail --silent http://127.0.0.1:4198/opencode/health`, then `tools/dev/sandbox.sh down`. Output:
```
remaining synthetic approvals=0
remaining Hermes fixture tasks=0
{"status":"ready","message":"Opencode SDK ready","bridgeLive":true,"websearchConfigured":false}
sandbox: sanitized diagnostics preserved: /private/tmp/hermes-approvals-20261012-sandbox.evidence.ShPUeB
Sandbox removed: /private/tmp/hermes-approvals-20261012-sandbox
```
Only owned runtime removed by launcher. Canonical read-only fixture and sanitized evidence siblings retained. Other evidence: CKsCGB (first dependency preload failure), SBpow6, Nm522S (pre-contract compile failure), uz7hXT, c7LSvf, ShmFAE (preceding successful iterations). No primary worktree changes/deletions, commits, pushes, real credentials, production data, deployments, permissions or live hardware touched.

## Notes / handoff

Mandate: make named checks pass without editing frozen acceptance assertions. Parent verifier can execute built artifacts/checks independently without source write permission. Successful live-gate evidence must distinguish synthetic provider inputs from mocks of API/MCP/security/engine.

READY_FOR_VERIFICATION is implementation handoff, not deployment/product completion. Parent independently repeats tests/reviews trust boundary and source inventory. Limitations: no actual Hermes container/chat-click UX or packaged Keychain smoke; server cannot prove human choice; cloud identity cache unchanged; local SQLite owner-backed cards only; no full API monorepo/production/Postgres qualification (no hosted schema changed). Safe deployment steps: independent review → draft PR/CI → human synthetic manual smoke → separately authorized API+MCP packaging/deployment together → separately authorized existing protected-token wrapper/client configuration. No migration or transport/network change required. Never deploy or test against production cards on this authorization.

Final scope check after documentation: `git diff --check` exit0; branch still `feat/hermes-authenticated-approvals-20261012`, HEAD still `4f915540`; `lsof -nP -iTCP:4198 -iTCP:4197 -iTCP:4199 -sTCP:LISTEN` returned no listeners (lsof exit1 means no matches, not a failed teardown). Documentation/handoff complete. No product code changed after final live verification.

## Focused repair round1 — independent FAIL

Parent dispatch reports verifier's built official SDK stdio probe accepted DB `expires_at=''` and persisted approved; `not-a-date` and whitespace refused. Candidate fingerprint before repair: `feadc45721ee2888c4d6c23e06f57fb3730977e76332b2fc404a995f032445d0` (15 files). Sole source writer; prior implementer/verifier finished. Prior passes above remain historical, not readiness evidence. Explicit handoff authorizes only shared null/absent-vs-malformed expiry correction and additive synthetic real-HTTP/MCP mixed desktop/relay race regression. Frozen original tests preserved. Max two repair attempts; no broader auth, guards, continuation, migration, transport or permission changes. Parent model/permissions inherited unchanged; parent independent re-gate required; no actual Hermes UX claimed.

Loaded acceptance-contract then coding-agent, read memory; branch/base verified. GitNexus upstream impact on `requireFreshCard` and owning `apps/api_server/src/security/relay_approval_security.ts` both return not found/UNKNOWN because this new candidate file is unindexed, NOT zero risk. Entire file, repository mapping/nonce/continuation and both controllers/routes inspected. Shared caller: pendingRelayCard → listPendingRelayCards and decideRelayCard → relay controller/built MCP. Preserve ordered hash tuple and immediate owner/hash/nonce transaction. Only freshness expiry selection changes. Desktop middleware/signature and durable continuation remain byte-identical. Security-consequential guard warrants real expiry boundary matrix and existing security checks even without graph rating.

### Repair Phase 0 complete — RED before patch

Repair Phase 1 complete: reviewed full intended surface up front (freshness helper/callers, DB row nullish mapping, signed desktop auth/canonical signature/PATCH, shared atomic nonce update and continuation claim/delivery/reconciliation, supplemental real-engine fixture). New regression file impact also UNKNOWN/unindexed. Mixed-race coverage will add two opposite-decision simultaneous real signed PATCH vs official SDK stdio calls, then verify persisted winner audit/nonce, replay immutability and exactly one continuation marker in actual engine transcript on a synthetic idle session using a loopback text-only provider input. No provider/external action/network, real Keychain input, source-auth expansion or changes to continuation code. Necessary internal test scope approved by parent dispatch; no renewed scope approval needed.

Added `apps/api_server/src/__tests__/hermes_approvals_repair_live_e2e.test.ts`. Frozen R1 expiry checks: empty, malformed date, whitespace, expired explicit values refuse read/list/exact-current-hash decision with unchanged pending status/actor/nonce/continuation; valid explicit and absent generic expiry permit all three; absent generic older than ten minutes refuses all three. Other matrix rows already pass because this is a regression repair, not missing functionality. Independent wire-hash construction includes malformed expiry so hash mismatch cannot masquerade as freshness enforcement. Only generated synthetic owner cards/bearers/P256 inputs; no mocks or real secrets.

Exact RED command from apps/api_server:
```sh
env RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_SANDBOX_DIR=/private/tmp/hermes-approvals-20261012-sandbox DB_PATH=/private/tmp/hermes-approvals-20261012-sandbox/rhythm.db RHYTHM_LIVE_URL=http://127.0.0.1:4198 node_modules/.bin/vitest run src/__tests__/hermes_approvals_repair_live_e2e.test.ts --no-file-parallelism --reporter=verbose
```
22:22:05 RED: `Test Files 1 failed (1); Tests 1 failed | 6 passed (7); Duration 16.79s`. Empty-expiry observed `readRefused:false,listOmitted:false,decisionRefused:false,status:approved,noncePreserved:false,continuation:queued`, actor durable Hermes receipt rather than null. This reproduces independent failure, not harness/import failure. API/MCP build passed. Teardown via launcher preserved `sandbox.evidence.zVxXwV` then removed owned runtime.

Test uses canonical `tools/dev/sandbox.sh` documented sourced harness seam: `source tools/dev/sandbox.sh; runtime_env+=("HUMAN_APPROVAL_CAPABILITY_SHA256=$HERMES_TEST_CAPABILITY_SHA256" "HUMAN_APPROVAL_PUBLIC_KEY=$HERMES_TEST_PUBLIC_KEY"); up` then `status`/`down` with identical four fixture vars,4198/4197/4199,sqlite/shadow/offline flags as original run. Only generated digest/public verification inputs added in runtime memory; private P256 key and raw capability remain test memory, not launcher env/output. No launcher source/guard change, no hand-started API. Refuses existing runtime; launcher's free-port/ownership checks retained. Reuses this worktree's unchanged fork (git diff HEAD fork exit0; executable SHA256 `bc4e60c7617f8de58b3b2333cfe037f3d3695dd6b001327ad9c481b19972c7a3`). Frozen original contract SHA256 `7573e6029674f43c774ba8f68b2eb249413912c1d93fb47d4b71358ca19cb3f2`; execution test `da50b744646d60c4fd5d8885b18b21a5cfa259727ab20e8274673f147cb38045`.
### Repair Phase 2 complete — GREEN and handoff

Smallest product repair (attempt1, no second attempt needed): one line in `requireFreshCard`, `approval.expiresAt == null ? createdAt+600_000 : Date.parse(approval.expiresAt)`. Only null/undefined use intended generic fallback. Empty explicit string now parses NaN and fails closed alongside malformed/whitespace; valid explicit and generic missing remain correct. No hash/owner/nonce transaction change, no auth/desktop middleware/continuation error handling changes. Preserved ALL prior implementation/tests/assertions; only additive new repair file. This round's exact four written paths:
- `apps/api_server/src/security/relay_approval_security.ts` (one-line product repair)
- `apps/api_server/src/__tests__/hermes_approvals_repair_live_e2e.test.ts` (new runnable regression)
- `docs/ai/runs/2026-10-12-hermes-authenticated-approvals.md`
- `docs/ai/project-state.md`

Same RED command repeated after patch,22:25:03: `Test Files 1 passed (1); Tests 9 passed (9); Duration 18.35s`. Seven frozen R1 expiry matrix checks pass. Additive mixed race runs real P256 signed HTTP desktop PATCH simultaneously with opposite official SDK → built stdio relay approve/reject; generated throwaway raw capability/private key only in test memory, API gets synthetic digest/public key via launcher seam. Actual middleware proves no capability and forged signature each403, without mutating pending card. Two opposite-decision races observed:
```
MIXED RACE desktop=approved relay=rejected: one durable desktop winner; immutable audit; one engine continuation; replay refused
MIXED RACE desktop=rejected relay=approved: one durable desktop winner; immutable audit; one engine continuation; replay refused
```
Each has exactly one successful transport, winner status/actor/decided_at unchanged after both replay attempts, nonce null, continuation delivered, exactly one matching user continuation marker in real fork transcript and exactly one loopback provider request. Both observed winners were desktop; do NOT claim a relay-winning mixed race was observed. Test assertions support either winner. Existing frozen relay-only opposite race/audit and successful relay→real engine execution repeated below. Synthetic text-only upstream response is model INPUT, not a mock of engine/API/MCP/continuation. No action requested by race provider, no profile permission expansion (throwaway profile explicit deny-all MCP/skills), no real provider/network/Keychain credentials. Runtime teardown via launcher preserved `sandbox.evidence.fhaNIi`. New regression SHA256 `89613f25232d7c2f4e5aa637735f7e5587e46a554dc1355334a110a38602c8ac`.

Relaunched standard sandbox using exact environment in original launcher block above plus `RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1`, `tools/dev/sandbox.sh up && tools/dev/sandbox.sh status`; final API/MCP builds pass, ready PIDs41218/41312, gateway41218. No generated desktop inputs in this standard repeat. From apps/api_server repeated original live command:
```sh
env RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_SANDBOX_DIR=/private/tmp/hermes-approvals-20261012-sandbox DB_PATH=/private/tmp/hermes-approvals-20261012-sandbox/rhythm.db RHYTHM_LIVE_URL=http://127.0.0.1:4198 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4197 node_modules/.bin/vitest run src/__tests__/hermes_approvals_live_e2e.test.ts src/__tests__/hermes_approvals_execution_live_e2e.test.ts --no-file-parallelism --reporter=verbose --silent=false
```
22:26:12 `Test Files 2 passed (2); Tests 8 passed (8); Duration 20.69s`. Same real gate output: `one concurrent task/consumption, replay/reject/changed/hash-mismatch/expiry=0 tasks`. Original frozen contract/execution checks SHA256 still identical to pre-repair values above.

API focused exact command from apps/api_server:
```sh
env HOME=/private/tmp/hermes-approvals-20261012-sandbox/home XDG_CONFIG_HOME=/private/tmp/hermes-approvals-20261012-sandbox/home/.config DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=4197 RHYTHM_AGENT_URL=http://127.0.0.1:4198 RHYTHM_API_BASE=http://127.0.0.1:4198 RHYTHM_OPTIMIZER_MODE=shadow node_modules/.bin/vitest run src/__tests__/hermes_approvals.test.ts src/__tests__/human_approval_signature.test.ts src/__tests__/issue_895_agent_approvals.test.ts src/__tests__/issue_1382_approval_lanes.test.ts src/__tests__/issue_1134_external_content_security.test.ts src/__tests__/approval_not_required_on_clean_session.test.ts src/__tests__/unattended_scheduled_auto_approve.test.ts src/__tests__/hermes_approvals_live_e2e.test.ts src/__tests__/hermes_approvals_execution_live_e2e.test.ts src/__tests__/hermes_approvals_repair_live_e2e.test.ts --no-file-parallelism --reporter=verbose
node_modules/.bin/tsc --noEmit
```
22:27:03 `Test Files 7 passed | 3 skipped (10); Tests 39 passed | 17 skipped (56); Duration 7.58s`. All17 live checks run separately successfully, these skips prove default gate. API strict typecheck exit0/no output. Existing intentional negative-case handled errors are expected assertions, not failures.

MCP exact commands from apps/mcp_server:
```sh
env HOME=/private/tmp/hermes-approvals-20261012-sandbox/home RHYTHM_AGENT_URL=http://127.0.0.1:4198 RHYTHM_API_URL=http://127.0.0.1:4198 npm test
npm run typecheck
```
22:26:12 `Test Files 33 passed | 2 skipped (35); Tests 191 passed | 2 skipped (193); Duration 4.47s`; strict typecheck exit0. No source changes after final checks.

Final scope review: `git diff --check` exit0; GitNexus `detect_changes({repo:Rhythm,scope:all,worktree:<assigned worktree>})` low,10 indexed touched symbols,6 mapped files,zero affected indexed processes; index still omits new untracked repair/helper files. Project-state section/symlink mappings add graph entries; neighboring requireInternalAuth/SECURITY_ACTIONS unchanged. This is graph coverage limitation, not proof of zero impact. Manual inventory confirms round edits only four paths above. Both original acceptance file hashes unchanged. Cleanup count queries: synthetic approvals0, Hermes fixture tasks0; `/opencode/health` ready/bridgeLive true. Standard `tools/dev/sandbox.sh down` under same original full four-vars/ports env succeeds, preserves `/private/tmp/hermes-approvals-20261012-sandbox.evidence.Wmzq09`, removes only owned runtime. Canonical fixture untouched. Live4001/4096 and other workstream4898/4897/4899 never targeted.

READY_FOR_REVERIFICATION, not product completion/deployment. Parent independent verifier must repeat new repair command against stopped/free owned sandbox (the new test owns launcher lifecycle; run it separately, NOT alongside original live files), then original frozen live checks using standard launcher up/status/down. Verifier needs no source write access; no actual Hermes chat/container UX or packaged Keychain qualification claimed. No commits/push/deploy/migrations/network/Tailscale/relay changes, installs, broader auth/guards or existing cleanup. Approved scope/exclusions unchanged, no re-approval needed for same scope.

Final post-documentation command: `git diff --check && git branch --show-current && git rev-parse --short HEAD && git status --short && git diff --exit-code HEAD -- apps/api_server/src/security/human_approval_security.ts apps/api_server/src/controllers/agent_approvals_controller.ts apps/api_server/src/repositories/agent_approvals_repository.ts apps/api_server/src/services/agent_approval_continuation_service.ts tools/dev/sandbox.sh apps/opencode_fork && test ! -e /private/tmp/hermes-approvals-20261012-sandbox && (lsof -nP -iTCP:4198 -iTCP:4197 -iTCP:4199 -sTCP:LISTEN || test "$?" = 1)` exit0; same assigned branch/HEAD4f915540; explicit guarded/security/continuation/launcher/fork paths byte-identical to HEAD; owned sandbox absent and all three ports free. Candidate now16 source/doc files (one additive regression); original15 preserved.

## Final independent verification — PASS (2026-10-12)

Verifier `b4147781-32b4-4303-87c2-2c81930a5cbc` independently passed the repaired candidate on branch `feat/hermes-authenticated-approvals-20261012`, uncommitted HEAD `4f915540`. Current checkpoint status: `independently_verified_API_MCP_candidate`. This final section supersedes earlier readiness labels, including the preserved frontmatter; earlier independent FAIL, RED and implementation receipts remain historical evidence, not erased first-pass claims.

### Independent checks and observations

- Repair live: exact command at line160 above, run separately with its self-owned launcher lifecycle against absent/free sandbox: **9 passed,21.58s**.
- Frozen contract + real execution live: exact command at line182 above using standard launcher: **8 passed,18.88s**.
- Focused API: exact command at line188 above: **39 passed,17 default live skips**; `node_modules/.bin/tsc --noEmit` exit0. These live checks passed separately, not waived.
- MCP: exact command at line195 above: **191 passed,2 unrelated skips**; `npm run typecheck` exit0. API/MCP builds exit0.
- Separate verifier-owned official SDK malformed-expiry probe covered empty string, whitespace and not-a-date. Independently constructed wire hash matched the valid control; exact-current malformed hashes were refused as **EXPIRED**, not hash mismatch. Reads denied, lists omitted; DB status remained pending and actor/nonce/continuation unchanged.
- Both opposite signed-desktop-vs-SDK races produced one durable **desktop** winner each; replay audit immutable; exactly one real engine continuation and one local provider request each. No relay-winning mixed race observed.
- Real fork-signed MCP task gate produced one concurrent task/consumption; reject/replay/changed/hash-mismatch/expiry produced zero tasks. Synthetic upstream model input only; actual MCP/API/engine/signatures/gate were real.

### Verified identity and teardown

The verifier's 16-file code/doc before-and-after fingerprint was `de878cc426cef86b3bc208c35d525785fc18e2a83ffeb5772a3fad1584a211d3`: SHA256 over sorted changed paths, each path + NUL + bytes + NUL. This is **PRE-checkpoint verified identity**, not a new final-candidate fingerprint: this documentation checkpoint changes those bytes.

Verified SHA256 identities:
- Original frozen contract: `7573e6029674f43c774ba8f68b2eb249413912c1d93fb47d4b71358ca19cb3f2`.
- Execution test: `da50b744646d60c4fd5d8885b18b21a5cfa259727ab20e8274673f147cb38045`.
- Repair test: `89613f25232d7c2f4e5aa637735f7e5587e46a554dc1355334a110a38602c8ac`.
- Fork binary: `bc4e60c7617f8de58b3b2333cfe037f3d3695dd6b001327ad9c481b19972c7a3`.

Verifier teardown diagnostics: `/private/tmp/hermes-approvals-20261012-sandbox.evidence.zZXvgI` and `/private/tmp/hermes-approvals-20261012-sandbox.evidence.6nmiyU`. Owned sandbox absent;4198/4197/4199 free. Live4001/4096 and notification4898 untouched. No environment repairs or source writes by verifier. Existing protected desktop security/controller/approvals repository/continuation/launcher/fork remained untouched.

### Boundaries / next handoff

Owner-token relay attestation cannot prove a human click; no new login. Local SQLite owner-backed cards only; cloud identity cache unchanged. Actual Hermes chat UX, Keychain smoke, full notification delivery, production Postgres and deployment remain **UNCLAIMED**. Linked notification branch `feat/hermes-event-notify-20261012` is a separate bounded candidate under active watchdog/schema/cursor repair, actual Hermes/Pi wakeup blocked; no integration claim or edits to that worktree.

Next: parent scoped commit and draft PR/CI, then human synthetic smoke. AJ may push under normal authorized workflow; no merge/deploy. This final checkpoint edits only the project-state feature top section and appends this run section; historical campaign and prior receipts preserved. No product/test source changes, commits/pushes, server launches or test reruns in this documentation slice.
