---
date: 2026-08-26
repo: Rhythm
branch: fix/optimizer-generator-lanes
pr: null
issues: [1480, 1481, 1483, 1484]
status: ready_for_verification
tags: [run, Rhythm]
---

# S4 optimizer generator repair and live coverage

## Files

- `workflow_failure_signal_extractor.ts`: exposes stable retry recurrence identity (`agentConfigId`, tool, full input hash) while retaining raw per-session signals.
- `workflow_signal_generator.ts`: aggregates matching retry signals across sessions for the deterministic recipe lane and defers weak-evidence skill-edit suppression until after diagnosis.
- `external_discovery_{search,generator}.ts`: adds default-preserving loopback origin seams and accepts commit-pinned configured download origins.
- Focused extractor/generator/contracts plus `live_e2e_1480_1481_1483_1484.test.ts`.
- Four contract JSON files remain `UNVERIFIED` pending S3's sandbox run.

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
- Live contract statuses remain `UNVERIFIED` until S3 runs the env-gated suite.
- Pre-edit GitNexus impacts attempted for `isDiagnosableSignal`, `proposeFixFromSignals`, `detectRetryLoopSignals`, and `generateWorkflowSignalProposals`; all returned risk `UNKNOWN` because the index is v42 while the connected reader supports v41. No HIGH/CRITICAL result was returned.
- Additional pre-edit impacts for `searchSkillCandidates`, `buildSkillProvenance`, and `runExternalDiscoveryGenerator` hit the same blocker.
- S3 live prerequisites: sandbox-only `DB_PATH`/`RHYTHM_LIVE_DB_PATH`, `RHYTHM_SANDBOX_DIR`, `RHYTHM_SANDBOX_HOME`, and `RHYTHM_MANAGED_SKILLS_DIR`; loopback `RHYTHM_EXTERNAL_DISCOVERY_SEARCH_URL=<origin>/api/search`, `RHYTHM_EXTERNAL_DISCOVERY_GITHUB_ORIGIN=<origin>`, and `RHYTHM_SKILLS_DOWNLOAD_BASE=<origin>/raw`; configure the sandbox engine's LM Studio-compatible deterministic model at that same origin. Then run `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism` from `apps/api_server`.
