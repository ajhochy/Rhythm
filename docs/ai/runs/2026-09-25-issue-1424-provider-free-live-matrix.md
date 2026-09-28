---
date: 2026-09-25
repo: Rhythm
branch: codex/live-1424
pr: 1544
issues: [1424, 1579]
status: partial
tags: [run, Rhythm]
---

# #1424 provider-free live matrix and #1579 receipt seam

Commit tested: `9c255b6480bef901a848f852dd9dd13b2cad5480`. api_server and Electron package versions: `0.1.0`.

## Files

- Added env-gated live coverage for real file search/read, Git state/diffs, shell `pwd`, project init, command reload, busy-turn queuing, multi-select question answers, and permission-rejection feedback.
- Added a loopback-only scripted OpenAI-compatible provider fixture.
- Added the smoke-only Electron notification JSONL receipt seam and VM contracts.

## Checks

- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:7470 RHYTHM_ENGINE_URL=http://127.0.0.1:7471 RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-live-1424-sandbox-20260925 npx vitest run src/__tests__/live_e2e_1424_files_vcs.test.ts --no-file-parallelism` — PASS, 4/4. A disposable real repository proved file search/read, branch and dirty refresh, structured/raw diff, shell cwd, and project-init `.git` state.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:7470 RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-live-1424-sandbox-20260925 npx vitest run src/__tests__/live_e2e_1424_command_reload.test.ts --no-file-parallelism` — FAIL, 0/1. The command file was written and the engine PID did not change, but the engine command list stayed stale.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:7473 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:7474 RHYTHM_1424_PROVIDER_PORT=7476 RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-live-1424-turn-sandbox-20260925 DB_PATH=/private/tmp/rhythm-live-1424-turn-sandbox-20260925/rhythm.db npx vitest run src/__tests__/live_e2e_1424_turn_queue.test.ts --no-file-parallelism` — PARTIAL, 2/3. Multi-select labels and permission rejection feedback reached the next provider request. Busy prompts arrived as `QUEUE-1`, `QUEUE-3`; `QUEUE-2` was lost.
- `npx vitest run src/__tests__/live_e2e_1424_files_vcs.test.ts src/__tests__/live_e2e_1424_command_reload.test.ts src/__tests__/live_e2e_1424_turn_queue.test.ts` — PASS, 3 files and 8 tests skipped without `RHYTHM_LIVE_E2E`.
- `npx vitest run src/__tests__/issue_1060_file_find_proxy.test.ts src/__tests__/issue_1063_1066_vcs_shell_init.test.ts src/__tests__/opencode_commands_routes.test.ts src/__tests__/opc_question_handshake.test.ts src/__tests__/opc_question_recovery.test.ts src/__tests__/opc_permission_updated_contract.test.ts` — PASS, 37/37.
- `npx tsc -p tsconfig.json --noEmit` in api_server — PASS.
- `node --experimental-vm-modules --test test/issue-1579-contract.test.mjs test/e12a-auth-boundary.test.mjs test/post-m1-phase-7-native-notifications.test.mjs test/post-m1-phase-7-packaged-notifications.test.mjs` in Electron — PASS, 57/57.
- `npm run typecheck` in Electron — PASS.
- Both sandboxes were stopped with the same environment used for startup. Ports 7470–7479 were confirmed clear.

### Defect repair rerun

- `cd apps/opencode_fork/packages/opencode && bun test test/server/httpapi-config.test.ts --timeout 30000` — PASS, 3/3. The real `/config/reload` handler now invalidates the directory-scoped command instance as well as config/agent state.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:7470 RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-live-1424-fix-command-sandbox-20260925 npx vitest run src/__tests__/live_e2e_1424_command_reload.test.ts --no-file-parallelism` — PASS, 1/1. The command written through the API appeared in the engine-backed list without an engine restart.
- `cd apps/opencode_fork/packages/opencode && bun test test/session/prompt.test.ts --timeout 60000 --test-name-pattern '1424:fix-busy-queue'` — PASS, 1/1. Three user messages persisted while turn one was held open and produced three distinct provider requests in order.
- `cd apps/api_server && npx vitest run src/__tests__/agents_ws_e2e.test.ts -t '1424:fix-busy-queue' --no-file-parallelism` — PASS, 1/1. While the first handler was blocked, later frames remained behind it and reached the engine in receive order.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 DB_PATH=/private/tmp/rhythm-live-1424-turn-fix-sandbox-20260925/rhythm.db RHYTHM_LIVE_URL=http://127.0.0.1:7470 RHYTHM_1424_PROVIDER_PORT=7476 RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-live-1424-turn-fix-sandbox-20260925 RHYTHM_MANAGED_SKILLS_DIR=/private/tmp/rhythm-live-1424-turn-fix-sandbox-20260925/home/.config/opencode/skills npx vitest run src/__tests__/live_e2e_1424_turn_queue.test.ts --no-file-parallelism` — PASS, 3/3. The provider observed `QUEUE-1`, `QUEUE-2`, `QUEUE-3`; the question and rejection scenarios stayed green.
- `MODELS_DEV_API_JSON=/private/tmp/rhythm-live-1424/apps/opencode_fork/packages/opencode/test/tool/fixtures/models-api.json bun run build --single --skip-install --skip-embed-web-ui` — PASS; the rebuilt `opencode-darwin-arm64` binary passed its version smoke.
- `cd apps/api_server && npx vitest run src/__tests__/agents_ws_e2e.test.ts src/__tests__/opc_agent_session_routes.test.ts src/controllers/__tests__/agent_sessions_listAgents.test.ts src/controllers/__tests__/agent_sessions_permissions.test.ts src/__tests__/opencode_commands_routes.test.ts src/__tests__/issue_631_contract.test.ts src/services/opencode_client_service.test.ts --no-file-parallelism` — PASS, 7 files and 104 tests.
- `cd apps/opencode_fork/packages/opencode && bun test test/session/prompt.test.ts --timeout 60000` — PASS, 57/57 and 224 assertions.
- `python3 -m unittest tools.dev.sandbox_bootstrap_test && bash tools/dev/sandbox_guard_test.sh` — PASS, 5 Python tests and 19 shell checks.
- `cd apps/api_server && npx tsc -p tsconfig.json --noEmit` and `cd apps/opencode_fork/packages/opencode && bun run typecheck` — PASS.
- The repair sandbox was stopped through its foreground owner and then `tools/dev/sandbox.sh down` with the identical environment. Ports 7470–7479 were confirmed clear.

## Notes

- The Files and VCS matrix row now has provider-free live evidence.
- The provider-free turn-lifecycle row now passes for busy-send ordering, multi-select answers, and permission-rejection feedback.
- The command-reload defect is repaired and proved without an engine restart.
- Real-provider, installed/notarized-app, Notification Center banner/sound/click, and physical-device rows remain unproven.
- Full raw receipt: orchestration evidence job `2026-09-24-resume5/jobs/live-1424/RUN.md`.
