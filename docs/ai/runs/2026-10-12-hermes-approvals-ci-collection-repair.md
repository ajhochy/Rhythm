---
date: 2026-10-12
repo: Rhythm
branch: feat/hermes-authenticated-approvals-20261012
pr: 1615
issues: []
status: READY_FOR_VERIFICATION
tags: [run, Rhythm, hermes, ci]
---

# CI collection repair

## Scope / approvals
Explicit parent-authorized same-workflow repair; sole writer in approval worktree at HEAD0226227f. Parent owns commits/push and independent read-only verification. Notification PR1616/a09d5448 untouched. Permitted writes: three Hermes live test setup paths, smallest runnable collection fixture, this dedicated run and project-state. No production logic, source guard, dependency/workflow/manifest changes, installs through symlinks, shared module deletion/rename, live4001/4096, production/cards, Pi/Hermes/network actions, commits/push/merge/deploy.

## Phase 0 — acceptance contract
Loaded acceptance-contract then coding-agent; read AGENTS/project-state/current-plan. Check `tools/dev/hermes_approvals_collection_check.cjs` runs real Vitest collection with a child-process-only resolution guard throwing MODULE_NOT_FOUND for SDK requests, while RHYTHM_LIVE_E2E=0. Expected: exit0,17 skipped, no SDK load attempt. Shared dependencies remain untouched; no SUT mock. Freeze check before implementation; mandate is make it pass without altering assertions. Parent verifier can rerun without source writes.

RED22:55:57: three failed suites, no tests, each `API_ONLY_SDK_UNAVAILABLE: @modelcontextprotocol/sdk/client/index.js` at eager module require; wrapper assertion1!==0. Before implementation normalized ANSI output for portable summary assertion. This is the assigned harness defect, not product evidence.

All commands use this exact root environment (E):
```sh
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-approvals-20261012-fixture RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-approvals-20261012-fixture/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-approvals-20261012-fixture/opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/hermes-approvals-20261012-sandbox RHYTHM_SANDBOX_API_PORT=4198 RHYTHM_SANDBOX_ENGINE_PORT=4197 RHYTHM_SANDBOX_GATEWAY_PORT=4199 DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1 OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1
```
RED command under E, root:
```sh
/bin/bash -c 'source tools/dev/sandbox.sh; up; status; env -i "${runtime_env[@]}" "$NODE_BIN" tools/dev/hermes_approvals_collection_check.cjs'
```
API/MCP builds exit0; sandbox ready34268/34363, gateway34268. Read-only original fixture reused; unchanged locally built fork reused through approved launcher skip-build seam. No dependency mutation.

## Phase 1 — bounded impact review
GitNexus upstream impact/includeTests on all three exact test filenames: target not found, risk UNKNOWN. No indexed direct-call/process result available; not proof of zero risk. Full three files read: collection executes eager requires even when describe.skipIf disables hooks/tests. Client/transport references are local connect/setup/test closures only. Move requires after assertLiveE2EIsolation in beforeAll (two suites) and inside live execution test (one suite). No catch/fallback: LIVE-enabled missing SDK still throws. Preserve owner/hash/nonce/expiry/desktop/engine assertions and launcher lifecycle. Consequential risk is accidentally skipping live proof: proportionate validation reruns all17 against real SDK/built MCP/API/fork, repair9 separately then standard8. Existing independent passes are historical after harness modification. Scope approved; no renewed authorization needed.

## Phase 2 — complete / Checks
Attempt1: deferred SDK requires only. Execution suite loads in its live test; repair suite loads in its live beforeAll; original suite's Client/transport bindings are assigned in live beforeAll for connect closure. No assertions changed, no SDK fallback/catch, no product edits. One implementation attempt; no second code repair needed. Final diff reviewed in full.

### Collection RED → GREEN
Frozen normalized check repeated before implementation22:56:48:3 failed/no tests, identical three missing-SDK errors and wrapper assertion. Under E/root:
```sh
/bin/bash -c 'source tools/dev/sandbox.sh; env -i "${runtime_env[@]}" "$NODE_BIN" tools/dev/hermes_approvals_collection_check.cjs'
```
Same command after repair22:57:42: exit0,3 skipped files/17 skipped tests,436ms; then launcher `down`, evidence `.13jp1W`. Final repeat23:03:37 exit0,3/17 skipped,443ms. Check unchanged after freeze.

### Live9 — self-owned launcher, separate
Under E/from apps/api_server:
```sh
/bin/bash -c 'source ../../tools/dev/sandbox.sh; down; env -i "${runtime_env[@]}" TMPDIR=/private/tmp RHYTHM_SANDBOX_DIR="$SB" RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4198 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4197 "$NODE_BIN" node_modules/vitest/vitest.mjs run src/__tests__/hermes_approvals_repair_live_e2e.test.ts --no-file-parallelism --reporter=verbose'
```
22:58:57: **9 passed**,19.36s. API/MCP builds exit0; API58331/engine58426/gateway58331. Real expiry read/list/exact-hash/decision predicates pass; malformed explicit values preserve pending actor/nonce/continuation. Mixed approved-desktop vs rejected-relay observed **Hermes winner**; opposite race **desktop winner**. Each immutable audit, one real engine continuation/provider request, replay refused. Synthetic upstream model input only; SDK/MCP/API/engine/security real. Self teardown passed, evidence `.RECVws`.

Two command/setup failures before this successful run, not hidden or product repair attempts:
1.22:58:00 from root used `npm --prefix apps/api_server exec -- vitest run src/__tests__/hermes_approvals_repair_live_e2e.test.ts --no-file-parallelism --reporter=verbose` under same env-i/runtime+four fixture+live env. npm kept root cwd;1 suite failed/9 skipped, real LIVE SDK require MODULE_NOT_FOUND resolving `/Rhythm-pr-worktrees/mcp_server/package.json`. No launch. npm created inert `$SB/npm-cache`/`tmp` after teardown.
2.22:58:19 corrected cwd/direct node command (successful block above without initial `down` and TMPDIR override, plus explicit four fixture vars). SDK resolved but guard refused existing inert sandbox:1 suite failed/9 skipped. No launch. Read directory confirmed only npm-cache/tmp. Canonical `down` removed inert owned directory (evidence `.PlMWdp`); no hand deletion. TMPDIR override avoids precreating the self-owned launch directory. No assertion or source change for either failure. Original max-two implementation repair budget preserved (one code attempt).

### Standard launcher / frozen live8
Under E/from apps/api_server:
```sh
/bin/bash -c 'source ../../tools/dev/sandbox.sh; up; status; env -i "${runtime_env[@]}" RHYTHM_SANDBOX_DIR="$SB" RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4198 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4197 "$NODE_BIN" node_modules/vitest/vitest.mjs run src/__tests__/hermes_approvals_live_e2e.test.ts src/__tests__/hermes_approvals_execution_live_e2e.test.ts --no-file-parallelism --reporter=verbose --silent=false'
```
22:59:51: **8 passed**,5.51s,2 files. API/MCP builds exit0; standard sandbox62673/62760/gateway62673. Output: `LIVE HERMES GATE: external SDK→built stdio→real API decisions; real fork signed task calls: one concurrent task/consumption, replay/reject/changed/hash-mismatch/expiry=0 tasks`. All17 live rerun against actual SDK and built MCP/API/unchanged fork, not replaced by collection fixture.

### Focused39 / strict types
Under E/from apps/api_server:
```sh
/bin/bash -c 'source ../../tools/dev/sandbox.sh; env -i "${runtime_env[@]}" "$NODE_BIN" node_modules/vitest/vitest.mjs run src/__tests__/hermes_approvals.test.ts src/__tests__/human_approval_signature.test.ts src/__tests__/issue_895_agent_approvals.test.ts src/__tests__/issue_1382_approval_lanes.test.ts src/__tests__/issue_1134_external_content_security.test.ts src/__tests__/approval_not_required_on_clean_session.test.ts src/__tests__/unattended_scheduled_auto_approve.test.ts src/__tests__/hermes_approvals_live_e2e.test.ts src/__tests__/hermes_approvals_execution_live_e2e.test.ts src/__tests__/hermes_approvals_repair_live_e2e.test.ts --no-file-parallelism --reporter=verbose; env -i "${runtime_env[@]}" "$NODE_BIN" node_modules/typescript/bin/tsc --noEmit'
```
23:00:17:7 passed/3 skipped files,**39 passed/17 skipped**,6.56s. API strict tsc exit0/no output. MCP/from apps/mcp_server:
```sh
/bin/bash -c 'source ../../tools/dev/sandbox.sh; env -i "${runtime_env[@]}" RHYTHM_API_URL=http://127.0.0.1:4198 npm run typecheck'
```
MCP strict tsc exit0. MCP full suite not rerun in this harness-only slice (prior191 historical); no current full-MCP pass claim.

### Requested exact full API npm test — FAIL, not resource timeout
Under E/from apps/api_server:
```sh
/bin/bash -c 'source ../../tools/dev/sandbox.sh; env -i "${runtime_env[@]}" RHYTHM_API_URL=http://127.0.0.1:4198 npm test >"$SB/ci-repair-full-api.log" 2>&1'
```
23:00:57: exit1;72.63s; **4 failed/718 passed/151 skipped files;11 failed/6770 passed/302 skipped tests**. All three changed files successfully collected,7+1+9 skipped. Not an all-green API/CI claim. Exact failure groups (no out-of-scope repair):
- issue_655_contract:4 failures, expected default4096 and injected stale command4096 vs explicit sandbox4197.
- opc_rhythm_mcp_ensure:3 failures, hardcoded localhost4001 expected vs sandbox127.0.0.1:4198 (including no-op comparison).
- tailscale_serve_service:3 failures, injected normalized target vs sandbox gateway4199 produces wrongTarget (including undefined injected response on extra configure). No real network configuration performed by this mocked boundary suite.
- native_runtime_guard:1 failure, shared installed better-sqlite3 reports12.8.0 but test expects13.x to permit synthetic Node24.21.0. Actual runtime Node22.23.0. No dependency install/mutation authorized or attempted.
These failures are outside changed test setup and reflect isolation/default/dependency conditions, not the assigned SDK collection defect. No baseline run was made, so do not claim independently proven pre-existing full-suite failures. Original CI run38352830639/job115148889813 triage reported3 collection fails/721 passed/149 skipped files,6780 passed/286 skipped tests; subsequent CI build/advisory/API/optimizer smoke were **SKIPPED**, not passed. New-head CI still pending parent push.

### LIVE missing SDK still fails
Under E/from apps/api_server:
```sh
/bin/bash -c 'source ../../tools/dev/sandbox.sh; set +e; env -i "${runtime_env[@]}" RHYTHM_SANDBOX_DIR="$SB" RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4198 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4197 HERMES_API_ONLY_COLLECTION=1 NODE_OPTIONS="--require=$ROOT/tools/dev/hermes_approvals_collection_check.cjs" "$NODE_BIN" node_modules/vitest/vitest.mjs run src/__tests__/hermes_approvals_execution_live_e2e.test.ts --no-file-parallelism; result=$?; test "$result" = 1'
```
23:03:16: Vitest1 failed test/1 failed file,242ms,API_ONLY_SDK_UNAVAILABLE at live guarded require. Shell expectation exit0. No skip/fallback, no external action. Guard used only for dependency-resolution qualification, never in real live17 runs.

## Files / final scope / teardown
Exactly six written paths:
- apps/api_server/src/__tests__/hermes_approvals_live_e2e.test.ts
- apps/api_server/src/__tests__/hermes_approvals_execution_live_e2e.test.ts
- apps/api_server/src/__tests__/hermes_approvals_repair_live_e2e.test.ts
- tools/dev/hermes_approvals_collection_check.cjs (new)
- docs/ai/runs/2026-10-12-hermes-approvals-ci-collection-repair.md (new)
- docs/ai/project-state.md

`git diff --check` exit0; full test diff shows only loading location/bindings/comment, all existing behavioral assertions unchanged. No production/workflow/manifest/source guard/shared dependencies changed. Under E/root final:
```sh
/bin/bash -c 'source tools/dev/sandbox.sh; status; curl --fail --silent http://127.0.0.1:4198/opencode/health; env -i "${runtime_env[@]}" "$NODE_BIN" tools/dev/hermes_approvals_collection_check.cjs; down'
test ! -e /private/tmp/hermes-approvals-20261012-sandbox
(lsof -nP -iTCP:4198 -iTCP:4197 -iTCP:4199 -sTCP:LISTEN || test "$?" = 1)
```
Exit0; engine health ready/bridgeLive true; final collection17 skips; canonical teardown removed owned sandbox; all4198/4197/4199 free. Sanitized full API log retained in `/private/tmp/hermes-approvals-20261012-sandbox.evidence.QPbK6i/ci-repair-full-api.log`. Read-only fixture preserved; notification worktree untouched. No commits/push by implementer; HEAD0226227f unchanged.

## Handoff
Post-documentation final guard command: `git diff --check && git branch --show-current && git rev-parse --short HEAD && git status --short && git diff --exit-code HEAD -- apps/api_server/src/controllers apps/api_server/src/security apps/api_server/src/services apps/api_server/src/repositories apps/api_server/src/routes apps/api_server/src/__tests__/_live_e2e_guard.ts apps/api_server/package.json apps/mcp_server .github tools/dev/sandbox.sh apps/opencode_fork && test ! -e /private/tmp/hermes-approvals-20261012-sandbox && (lsof -nP -iTCP:4198 -iTCP:4197 -iTCP:4199 -sTCP:LISTEN || test "$?" = 1)` exit0; exactly six-file inventory above, assigned branch/HEAD0226227f. No protected source/workflow/dependency/launcher/fork diff.

**READY_FOR_VERIFICATION** = bounded CI collection repair ready for independent parent re-gate, NOT full CI/API/product acceptance. Parent independently reruns frozen collection fixture, self-owned repair9 separately, then standard live8/focused/typechecks; inspect unchanged assertions and full failure receipt. Prior independent feature pass remains historical, not certification of this modified harness. Parent owns commit/push/new-head CI; original downstream skipped stages must genuinely run before pass claims. Actual Hermes chat UX/Keychain/Pi/production/notification integration remain UNCLAIMED. Approved same-workflow scope/exclusions retained; no renewed AJ permission required for unchanged repair. No broader defect repair authorized here.

## Parent independent harness re-gate

Verifier `dfd581f1-a918-45bb-965b-34453e7c5f25` returned **qualified PASS-harness**, full API gate **FAIL / UNRESOLVED**. Pre-checkpoint six-file fingerprint `ee12aec41f973652cfb436451504732ca6e84f5a09243d434ba2e23706125332`; this documentation append changes it. Independent comparison confirmed all non-SDK-setup lines unchanged against0226227f. Production paths, isolation guard, manifests/workflows/launcher/MCP/fork unchanged. Nine documentation links resolved.

Independent exact run commands above: collection guard3files/17tests skipped with no SDK resolution error; self-owned live9passed18.84s; standard live8passed5.31s; focused39passed/17skipped6.73s; API/MCP strict typechecks exit0. Missing SDK with live enabled failed1test with API_ONLY_SDK_UNAVAILABLE after isolation, as required. Actual real-engine MCP gate output remained one safe task/consumption and zero effects for replay/reject/changed/hash mismatch/expiry. Only upstream model input synthetic.

Retained full-suite log independently inspected:4failed/718passed/151skipped files,11failed/6770passed/302skipped tests. Failures remain UNRESOLVED without a baseline: issue_655_contract(default4096 versus4197), opc_rhythm_mcp_ensure(default4001 versus4198), tailscale_serve_service(injected target versus sandbox gateway), native_runtime_guard(installed12.8.0 versus syntheticNode24 requiring13.x). These are not waived or claimed pre-existing. All three changed suites collected and skipped successfully. New-head GitHub CI mandatory; subsequent failed-job stages are not passes.

Owned teardown succeeded; sandbox absent4198/4197/4199 free. Diagnostics .evidence.CbURtF, .B2QPYY, .yUPp9Z retained. No source changes or environment repairs by verifier. Parent may now commit/push the narrow harness repair; actual Hermes UX/Keychain/Pi/notification/deployment remain unclaimed.
