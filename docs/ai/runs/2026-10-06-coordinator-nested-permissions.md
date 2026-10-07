---
date: 2026-10-06
repo: Rhythm
branch: codex/coordinator-response-repair
pr: 1604
issues: []
status: unverified
tags: [run, Rhythm]
---

## Files

- `apps/opencode_fork/packages/opencode/src/tool/task.ts`: retain inherited session policy through Task's production prompt; persist experimental primary-tool denies instead of passing legacy tool switches that replace the complete ruleset.
- `apps/api_server/src/repositories/agent_sessions_repository.ts`: project the canonical parent's valid mode into new native child rows, hold invalid modes, preserve existing child choices, and leave the child's own explicit human bypass marker false.
- New `test/tool/coordinator-task-permissions.test.ts` and `src/__tests__/coordinator_native_child_permission_mode.test.ts`: actual Task/SessionPrompt policy persistence and actual SQLite child-mode regression coverage. The existing Task transport assertion now checks durable primary-tool denies and absence of the destructive prompt switches.
- `apps/api_server/src/__tests__/live_coordinator_nested_permissions.test.ts`: two opt-in actual API/fork/MCP/Task cases, fresh invented read-only fixtures, explicit synthetic fixture-human grants, native permission event evidence, bounded current-work metadata, exact source/binary checks and stock sandbox teardown.

## Checks

External raw logs: `/Users/ajhochhalter/Documents/Codex/2026-10-06/coordinator-nested-permissions/`.

- Genuine pre-repair RED: API child-mode tests 5 failed / 2 passed; Task + production `SessionPrompt.prompt(noReply:true)` 2 failed, expected scoped external-directory allow but received ask. Initial fork missing-service fixture error and the API null-versus-undefined fixture correction are retained separately, without claiming either as behavioral RED.
- API, cwd `apps/api_server`: `./node_modules/.bin/vitest run src/__tests__/coordinator_native_child_permission_mode.test.ts src/__tests__/issue_743_child_session_persistence.test.ts src/__tests__/async_delegation_permission_scope.test.ts src/__tests__/async_delegation_permission_gate.test.ts src/__tests__/issue_1156_delegated_permission_gate.test.ts src/__tests__/mobile_child_session_permissions.test.ts --reporter=verbose` — exit 0, 6 files / 39 tests passed.
- Fork, cwd `apps/opencode_fork/packages/opencode`: `bun test test/tool/coordinator-task-permissions.test.ts test/tool/task.test.ts test/agent/plan-mode-subagent-bypass.test.ts --timeout 30000` — exit 0, 3 files / 34 tests passed.
- API `./node_modules/.bin/tsc --noEmit` and fork `bun run typecheck` — both exit 0.
- Actual API/built fork/MCP depth-3 sandbox behavioral test: **NOT RUN**; pending root-reviewed fixture/harness and explicit live GO. Unit tests invoke the production Task prompt with `noReply` to test SQLite policy persistence, not provider behavior.
- Live-test opt-out registration: `./node_modules/.bin/vitest run src/__tests__/live_coordinator_nested_permissions.test.ts --reporter=verbose` — exit 0, both tests skipped; API `./node_modules/.bin/tsc --noEmit` — exit 0 after test preparation. This is preparation evidence only.

## Notes

Read-only exact-D diagnosis found the mixed hierarchy: Secretary native Task → Workflow Orchestrator named async delegation → Planning Agent native Task → Explore. Native child persistence previously defaulted the local mode even while its engine session retained parent plan restrictions. A subsequent async delegation used the local default. Native Task also derived inherited permission rules at creation, then discarded them when its `tools` map reached the production prompt's legacy ruleset replacement. The captured engine Explore row contained only task/todo denies. No new source change alters central prompt behavior, roster/owner/project/pre-SDK gates, taint consent, or existing child mode choices.

The screenshot's Planning Agent had no configured/persisted vault exception; a default interactive async request deliberately waits for human approval. The later read-only snapshot showed its own explicit bypass choice and no pending engine permission request. The diagnosis does not claim a prior vault grant existed or silently approve that request. The persisted old bundle workspace path is not process-origin evidence.

Fresh GitNexus impacts were reported before edits: parent scope interface CRITICAL (47 direct / 126 total, type graph), both repository methods HIGH (2 direct / 12 total, 4 processes), Task constant LOW with zero indexed callers. Manual callers include the tool registry, hosted builtin dispatch and subtask execution; `setSdkSessionId` pending-child projection and public `upsertChildSession` share the repository path. Root reviewed and authorized the narrow changes after these warnings. Ordinary central `SessionPrompt.prompt` is unchanged.

Older coverage missed the real transition: the plan-subagent tests stopped after the derivation helper; #1156 bridge tests supplied synthetic asks and its live test used one headless parent/child in-CWD glob; #1458 live exercised a root bypass without native/async nesting. Async permission tests manually seeded the child mode rather than testing native child projection. No running app, permission reply, approval, config/profile, live database or provider setting was changed during this repair.

Prepared live command, after root supplies a frozen full source SHA and builds the corresponding API/MCP/fork: `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_SOURCE_SHA=<full-frozen-sha> RHYTHM_COORDINATOR_LIVE_TEST_OUT=/Users/ajhochhalter/Documents/Codex/2026-10-06/coordinator-nested-permissions ./node_modules/.bin/vitest run src/__tests__/live_coordinator_nested_permissions.test.ts --reporter=verbose` from `apps/api_server`. The test uses stock sandbox ports 4197/4198/4199 and compares the normal listeners before/after. It never copies live data or contacts an external authenticated model.

The two explicitly synthetic consent fixtures are a root `task:workflow-orchestrator` allow and, only for the positive case, Planning's exact invented reference-directory allow. Both append the owned SDK session's existing rules; no wildcard bypass, normal permission reply, or copied human marker is used. Negative plan mode omits the directory grant and requires real native denial, no fixture body in the tool response and zero `once`/`always` replies. Native Task result delivery is asserted at its immediate Planning parent; durable async completion is recorded separately from Workflow's initial dispatch acknowledgement. There is no claim that the top Coordinator receives an unsolicited final result, or that arbitrary custom SDK directory grants propagate across async profile changes.

After stock startup, the live test also reads the actual disposable Secretary profile projection, extracts only its generated coding paragraph, and requires the new interactive `rhythm_delegate_async(targetAgentConfigId="workflow-orchestrator")` clause, retained scheduled/headless Task target, and absence of the old unconditional coding Task instruction. Its `generatedSecretaryRoutingConsistent` receipt check proves runtime projection wiring, not a real model's decision to obey it.

Real-model qualification remains **UNVERIFIED**. A subsequent replay could use the same invented fixture/sandbox with an operator-authorized real provider configuration if safely available; it must inspect actual model choices and completion handling rather than use the scripted decisions above. No auth availability is assumed, and no Keychain access or copying of live credentials is authorized by this test preparation.
