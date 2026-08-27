---
date: 2026-08-27
repo: Rhythm
branch: fix/bridge-stream-reliability-repair
pr: 1487
issues: [1455, 1456, 1457, 1458]
status: ready_for_verification
tags: [run, Rhythm]
---

# PR #1487 adversarial repair

## Files

- API permission creation/update, bridge relay/finalization, structured transcript repository, and health evidence.
- Fork subagent permission inheritance and ordering coverage.
- Sandbox replacement-engine ownership and timeout cleanup guard.
- Contract/evidence corrections for #1325 and #1455–#1458.

## Checks

- RED API contract command: `cd apps/api_server && npx vitest run src/contract/issue_1458_bypass_engine_permission.test.ts src/services/opencode_client_service.test.ts src/contract/issue_1457_global_stream_retry.test.ts src/contract/issue_1455_1456_idle_finalization.test.ts src/__tests__/opc_m1_4_stream_lifecycle.test.ts` — 8 failed, 96 passed. Failures reproduced wildcard-only bypass, role contamination, 200-row truncation, blocked relay, duplicate subscribe, and unsynchronized mode switch.
- RED fork contract: `cd apps/opencode_fork/packages/opencode && bun test test/agent/plan-mode-subagent-bypass.test.ts` — 1 failed, 5 passed; subagent read remained `ask` instead of inheriting bypass `allow`.
- RED sandbox guard: `bash tools/dev/sandbox_guard_test.sh` — 17 passed, 1 failed; readiness-timeout path had no recorded replacement PID.
- GitNexus impact attempts for `createSession`, `updateSessionPermissionMode`, `ensureGlobalStream`, `_relayEvent`, `listBySessionStructured`, `buildSubagentPermissions`, and `tools/dev/sandbox.sh` all failed with: `Database file version: 42, Current build storage version: 41`; risk unavailable, not skipped.
- GREEN focused S2: `cd apps/api_server && npx vitest run src/contract/issue_1458_bypass_engine_permission.test.ts src/services/opencode_client_service.test.ts src/contract/issue_1457_global_stream_retry.test.ts src/contract/issue_1455_1456_idle_finalization.test.ts src/__tests__/opc_m1_4_stream_lifecycle.test.ts src/__tests__/opencode_stream_bridge.test.ts src/contract/issue_1325_engine_respawn.test.ts` — 153/153 passed. The F1 security cases include the real engine-shaped `curl ... | sh` ask and assert `reject`, `permission.resolved: deny`, and `tool.denied` under bypassPermissions.
- GREEN fork: `bun test test/agent/plan-mode-subagent-bypass.test.ts` — 6/6 passed, 21 assertions.
- GREEN sandbox guard: `bash tools/dev/sandbox_guard_test.sh` — 18/18 passed.
- GREEN full API: `npm test` — 5,993 passed, 210 skipped across 759 files.
- GREEN TypeScript: `npm run build`; GREEN shell syntax: `bash -n tools/dev/sandbox.sh tools/dev/sandbox_guard_test.sh`; GREEN JSON parse for updated contracts; GREEN `git diff --check`.
- `detect_changes(scope=all)` failed with the same GitNexus storage mismatch: database v42, client v41.

## Notes

- Sandbox was not started; it is reserved for later serial verification.
- Fork inspection confirmed permission evaluation uses `findLast`; the later bash ask overrides wildcard allow. Fork session `setPermission` persists `[]`, so downgrade clears the ruleset.
- F1 fixed: bypass now sends wildcard allow followed by bash ask; safe non-bash tools stay engine-side while all six #878 hardline patterns remain bridge-denied. The bridge comment now states the engine-rule reachability invariant instead of claiming bypass alone cannot weaken it.
- F2 fixed: idle selection requires `role === 'output'`; mixed user/assistant and user-only-empty contracts pass.
- F3 fixed: current-turn message IDs are queried directly with no 200-row historical cap; 201 older rows are covered.
- F4 fixed: removed `resolveEmptyTurnStopReason` and its unbounded SDK lookup; `_relayEvent`, global relay, and directory relay are synchronous.
- F5 fixed: one in-flight boolean prevents concurrent global subscriptions.
- F6 fixed: mid-session bypass applies the ordered rules, downgrade sends `[]` (confirmed by fork `setPermission` replacement semantics), and subagents inherit the complete ordered parent session ruleset.
- F11 fixed: restored the #688 timer tripwire at exactly two timers plus `scheduleGlobalRetry`.
- F12 fixed: replacement PID is written immediately after spawn; readiness timeout remains owned and cleanable; API survival uses `kill -0 "$api_pid"`.
- F13 fixed: restored the #1332, D4.4, and gateway/tailnet rationale blocks, restored the full guard literal, and removed no-op `OPENCODE_CONFIG_CONTENT={}`.
- Evidence hygiene fixed: deleted the restart regex harness and two cross-file regex assertions; #1456's emitted marker is absent from both prompts; #1458 AC1/AC4 are explicitly UNVERIFIED for physical stream loss; #1457 AC5 is UNVERIFIED because no shipping client consumes `/opencode/health`.
- Ponytail cleanup: removed the unused per-part delta accumulator and the unconsumed reconnecting health copy.
- Commits: `34c6d3c0` security permission reachability; `20e5e64d` synchronous/turn-scoped bridge; `8e152d38` replacement-engine ownership.
- AJ/later serial verifier: run the reserved sandbox live suites. No live claim was added in this concurrent code-and-tests pass.
