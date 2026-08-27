---
date: 2026-08-27
repo: Rhythm
branch: fix/bridge-stream-reliability-repair
pr: 1487
issues: [1455, 1456, 1457, 1458]
status: pass
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
- Evidence hygiene fixed: deleted the restart regex harness and two cross-file regex assertions; #1456's emitted marker is absent from both prompts; #1458 AC1/AC4 are bound to physical stream loss; #1457 AC5 is bound to the shipping Flutter bridge-status parser/controller/widget.
- Ponytail cleanup: removed the unused per-part delta accumulator and the unconsumed reconnecting health copy.
- Commits: `34c6d3c0` security permission reachability; `20e5e64d` synchronous/turn-scoped bridge; `8e152d38` replacement-engine ownership.
- The reserved serial sandbox verification is recorded below; no product or test source changed during that verification.

## Final serial verification — HEAD `35048c53`

- Worktree started clean on `fix/bridge-stream-reliability-repair`; sandbox used canonical read-only fixture v2 and `/private/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-s2-review-final` with the two live-isolation flags present for the full lifecycle.
- Focused API: 200 passed / 6 skipped; reconnect contracts: 57/57; fork permissions: 6/6; sandbox guards: 18/18; focused hardline denial: 2/2; Flutter bridge banner: 1/1; API build/typecheck, Dart format, Flutter analyze, shell syntax, JSON parse, and `git diff --check` exited zero.
- #1458 physical stream-down: 1/1. The bridge-only suspension produced API `status: unavailable`, `bridgeLive: false`, and one reconnecting transition while engine health remained true. Real read, edit, and external-directory read completed through the engine permission path; the edit reached disk; engine `GET /permission` and bridge permission frames stayed empty. Resume restored ready/live and emitted ready. Static engine-shaped hardline tests kept bash on `ask` and denied `curl … | sh` as `curl-pipe-shell`.
- #1457: 1/1 live engine replacement plus 1/1 shipping Flutter widget. API PID stayed stable across engine replacement; bridge recovery completed; the backend contract emitted one deduplicated reconnecting/ready pair; the production Flutter parser/controller rendered the accessible reconnecting copy without failing sessions and cleared it on ready.
- #1457 visual artifact: `apps/desktop_flutter/test/features/agents/goldens/issue_1457_bridge_reconnecting.png` — 1400x900 PNG, SHA-256 `cc440da5b35eb79c921c45e507d1580b2e574e7cdc24f6d5a28774d0cd24263e`; the normal (non-update) comparator passed at HEAD `b71c69b0`.
- #1455/#1456: 2/2 live; #1325: 2/2 live. Focused contracts separately passed role isolation, a current structured turn behind more than 200 older messages, synchronous no-history relay, one subscription in flight, permission-mode upgrade/downgrade clearing, and inherited fork rules.
- Cleanup: final API/engine health was ready/healthy, engine permission queue empty, sandbox SQLite integrity `ok`, sandbox ports `4097/4098/4099` clear after `down`, and protected live PIDs `3458`/`3496` remained alive on `4001`/`4096`. Source fixture hashes remained DB `132e19c989ff33eda219440ede8a643b15ad28bf5c32c96a097be5ab8e3daa64` and config `d72041ee724d79aa83a9f2261e5429840de63827e36df71a9075336444846e10`.
- GitNexus manager MCP was unavailable in this verification session, so no worktree-local CLI was substituted. Earlier branch attempts consistently failed on index storage v42 versus connected client v41; scope risk remains UNKNOWN.
