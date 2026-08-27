---
date: 2026-08-26
repo: Rhythm
branch: fix/optimizer-generator-lanes
pr: null
issues: [1480, 1481, 1483, 1484]
status: pass
tags: [run, Rhythm]
---

# S4 optimizer generator repair and live coverage

## Files

- `workflow_failure_signal_extractor.ts`: exposes stable retry recurrence identity (`agentConfigId`, tool, full input hash) while retaining raw per-session signals.
- `workflow_signal_generator.ts`: aggregates matching retry signals across sessions for the deterministic recipe lane and defers weak-evidence skill-edit suppression until after diagnosis.
- `external_discovery_{search,generator}.ts`: adds default-preserving loopback origin seams and accepts commit-pinned configured download origins.
- Focused extractor/generator/contracts plus `live_e2e_1480_1481_1483_1484.test.ts`.
- The final isolated sandbox rerun passed all three live cases at `ef7bf436`; the four issue contracts are reconciled.

## Checks

- RED: `cd apps/api_server && npx vitest run src/contract/issue_1481.test.ts src/contract/issue_1480.test.ts src/contract/issue_1483.test.ts src/services/generators/__tests__/workflow_signal_generator.test.ts src/__tests__/workflow_failure_signal_extractor.test.ts`
  - 4 failed, 88 passed.
  - #1481 c2: expected diagnosis once, received zero calls.
  - #1480 recurrence: expected one recipe from two matching per-session signals, received zero.
  - extractor: stable `retryTool` / full `retryInputHash` fields absent.
  - #1483 positive pinned URL/hash persistence test passed without production changes.
- GREEN repair loop: focused extractor/generator/contracts plus unchanged run-quality positive control — 6 files / 96 tests passed.
- Canonical prior S4 focused command — 10 files / 98 tests passed (the prior 95-test baseline plus three required new extractor/generator/contract cases).
- Broader optimizer command — 20 files / 263 tests passed.
- Isolated contracts + run-quality control — 5 files / 22 tests passed.
- Live file normal mode — 1 file / 2 tests skipped.
- Live file with only `RHYTHM_LIVE_E2E=1` — failed closed in `assertLiveE2EIsolation` before either test ran; no server started.
- `npm run build` — passed.
- Contract JSON parse check — passed.
- `git diff --check` — passed.
- `gitnexus_detect_changes(scope=all, worktree=...)` — attempted and blocked by the same v42/v41 LadybugDB mismatch.

## Notes

- S3 owns the sandbox. No server or sandbox command will be run in this pass.
- Live contract statuses were reconciled after the final 3/3 isolated rerun at `ef7bf436`.
- Pre-edit GitNexus impacts attempted for `isDiagnosableSignal`, `proposeFixFromSignals`, `detectRetryLoopSignals`, and `generateWorkflowSignalProposals`; all returned risk `UNKNOWN` because the index is v42 while the connected reader supports v41. No HIGH/CRITICAL result was returned.
- Additional pre-edit impacts for `searchSkillCandidates`, `buildSkillProvenance`, and `runExternalDiscoveryGenerator` hit the same blocker.
- S3 live prerequisites: sandbox-only `DB_PATH`/`RHYTHM_LIVE_DB_PATH`, `RHYTHM_SANDBOX_DIR`, `RHYTHM_SANDBOX_HOME`, and `RHYTHM_MANAGED_SKILLS_DIR`; loopback `RHYTHM_EXTERNAL_DISCOVERY_SEARCH_URL=<origin>/api/search`, `RHYTHM_EXTERNAL_DISCOVERY_GITHUB_ORIGIN=<origin>`, and `RHYTHM_SKILLS_DOWNLOAD_BASE=<origin>/raw`; configure the sandbox engine's LM Studio-compatible deterministic model at that same origin. Then run `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism` from `apps/api_server`.

## S4 live-harness assertion repair

- RED static acceptance command checked for production `profile:${positiveId}` attribution and byte-identical pre-claim rejection; both assertions failed before the two-line repair.
- Changed only the #1481 expected target ref and #1483 full-row digest equality assertion. Cleanup and #1484 setup are unchanged; production-source diff is empty.
- GREEN static acceptance command passed with no output.
- `npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism` — 1 file / 2 tests skipped normally.
- `RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism` — failed closed at `assertLiveE2EIsolation`; no server or sandbox started.
- Four focused contracts — 4 files / 18 tests passed. Broader S4 generator suite — 10 files / 98 tests passed.
- `node_modules/.bin/tsc --noEmit`, `npm run build`, and `git diff --check` passed.
- GitNexus pre-edit impact and final change detection were attempted but unavailable because the index is storage v42 while the connected reader supports v41; risk remained UNKNOWN, with no HIGH/CRITICAL result.
- S2 owns the sandbox; no live sandbox command was run in this repair.

## S4 deterministic diagnosis-provider harness repair

### Files

- `apps/api_server/src/__tests__/live_e2e_1480_1481_1483_1484.test.ts`: registers a unique Anthropic-compatible fixture provider/model in captured engine global config, seeds an exact far-future idle MRU row, serves Anthropic messages SSE, proves the positive evidence/model selection through real engine history, and restores sessions/rows/config/files in provider-safe order.
- `apps/api_server/src/contract/task_s4_diagnosis_provider_harness.test.ts` and `docs/ai/contracts/task-s4-diagnosis-provider-harness.json`: executable static acceptance contract and S3 live handoff state.
- Production-source diff: empty.

### Checks

- RED: `npx vitest run src/contract/task_s4_diagnosis_provider_harness.test.ts` — 1 file / 2 tests failed because the live harness lacked `@ai-sdk/anthropic` registration and `/v1/messages` SSE.
- GREEN: `npx vitest run src/contract/task_s4_diagnosis_provider_harness.test.ts src/contract/issue_1480.test.ts src/contract/issue_1481.test.ts src/contract/issue_1483.test.ts src/contract/issue_1484.test.ts` — 5 files / 20 tests passed.
- Normal live command: `npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism` — 1 file / 2 tests skipped.
- Fail-closed command: `RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism` — rejected by `assertLiveE2EIsolation` before either test; no server started.
- `npx tsc --noEmit` — passed after one repair to make the static contract CommonJS-compatible.
- `npm run build` — passed, including postbuild.
- GitNexus impact (`startFixture`, `seedSession`) and final `detect_changes(scope=all)` were attempted but unavailable because the index is storage v42 while the connected reader supports v41. No HIGH/CRITICAL result was returned.

### Notes

- This repair pass started no server; the later final isolated rerun passed 3/3 at `ef7bf436` and reconciled the live clauses.
- Separate production robustness gap (documented only): `defaultDiagnose()` calls global `resolveRunModel()` without a stable dedicated diagnosis profile, so production diagnosis availability remains coupled to global MRU. No production resolver change is in S4 scope.
- S3 live command must include `RHYTHM_LIVE_ENGINE_URL` in addition to the suite's existing isolated DB/HOME/skills/discovery variables.
