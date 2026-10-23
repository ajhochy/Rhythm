---
date: 2026-10-06
repo: Rhythm
branch: codex/memory-search-cloud-auth-20261005
pr: null
issues: []
status: unverified
tags: [run, rhythm]
---

### Interactive async delegation permission scope

Owner: Astra task `01a10e57-1288-7565-a84f-fb7afdff6024`, narrow dispatch and permission-decision ownership agreed with builder `01a0fabb-ceb0-75fd-ac7a-6e6be2cb1009`. Base installed source `5da2f764b5f240bb9650c58ce558a32aac2381e1`. Other stream-bridge completion hooks remain the existing core owner's responsibility.

Files: `agent_delegation_service.ts` passes the caller's selected permission mode into native session creation, durable child state and dispatch options. It rechecks owner/mode before creation, after creation and after stream subscription. A concurrent mode change refuses the prompt; a persisted delegation records failure. Target-profile tool/model/skill selection remains unchanged. Existing explicit parent bypass is inherited, never synthesized for ordinary parents. `opencode_stream_bridge.ts` identifies durable interactive async delegates and preserves their permission requests instead of treating all children as unattended. Provenance-read failure leaves approval pending. Plan mode denies permission requests, including bash commands classified as ask. Existing unrecorded legacy task and scheduled behavior remains unchanged.

New tests: `async_delegation_permission_scope.test.ts` exercises the actual native-create request builder with a captured SDK boundary, stored child mode, explicit bypass and mode-change races. `async_delegation_permission_gate.test.ts` exercises actual permission-event decisions and durable async rows with boundary reply spies: default approval remains pending, plan denies, acceptEdits stays narrow, explicit bypass remains and provenance failure stays pending. Existing issue1123 and issue1575 contract assertions were updated for the intentional default-mode propagation.

Regression: dispatch suite failed6/6 before implementation. Permission-event suite failed4/8 before implementation. Final focused command: `node node_modules/vitest/vitest.mjs run src/__tests__/async_delegation_permission_scope.test.ts src/__tests__/async_delegation_permission_gate.test.ts src/__tests__/issue_1156_delegated_permission_gate.test.ts src/__tests__/issue_1123_contract.test.ts src/__tests__/issue_1575_async_delegation_worktree.test.ts src/__tests__/async_delegation_wake_fence.test.ts src/contract/issue_1175_security_review.test.ts --no-file-parallelism` — 7 files / 47 tests passed in9.94s. TypeScript noEmit and emitting build both exit0. Logs are task-4 `async-permission-{red,gate-red,validation,typecheck,build}.log`.

GitNexus: this checkout has no `.gitnexus/run.cjs`; graph tooling is unavailable. Manual affected-path review covered async creation, durable child provenance and permission-event resolution. No global reindex or second runtime was started.

NOT installed or live-proven. Builder owns composition, existing isolated engine/API fixture, signing/activation and normal-app acceptance. Before accepting live coding delegation, verify the stored child mode AND native child permission rules, then exercise a harmless denied action in the permitted test fixture and prove it was not executed. An unsupported prompt option is not proof of engine enforcement. Verify the existing root completion callback separately. No credentials, saved profiles, grants or live sessions were changed by this patch.
