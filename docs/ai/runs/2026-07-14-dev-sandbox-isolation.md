---
date: 2026-07-14
repo: Rhythm
branch: feat/dev-sandbox-isolation
pr: null
issues: []
status: passed
tags: [run, Rhythm, dev-sandbox]
index: "[[Rhythm]]"
---

# Dev sandbox isolation

## Files

- `apps/api_server/src/services/opencode_client_service.ts` — resolve and pass `RHYTHM_OPENCODE_ENGINE_PORT` to the SDK.
- `apps/api_server/src/services/opencode_client_service.test.ts` — module-reset coverage for override, default, invalid value, and PTY URL.
- `tools/dev/sandbox.sh` — isolated `up`, `status`, and `down` lifecycle.
- `docs/ai/testing-guide.md` and `docs/ai/decisions/2026-07-14-dev-sandbox-isolation.md` — canonical usage and boundary decision.

## Checks

- PASS — `npx vitest run src/services/opencode_client_service.test.ts src/__tests__/issue_655_contract.test.ts`: 2 files, 54 tests.
- PASS — `node_modules/.bin/tsc --noEmit` and `npm run build` in `apps/api_server`.
- PASS — `bash -n tools/dev/sandbox.sh`; `status` reported no listeners before launch.
- PASS — live isolation smoke: while live `:4001` PID `96570` and `:4096` PID `96580` were healthy, `tools/dev/sandbox.sh up` built and launched `:4098` / `:4097`. Both sandbox health endpoints passed, copied DB enabled-task count was `0`, and the live PIDs remained unchanged.
- PASS — full verification rerun on commit `a59a759a76d8fecd53d09f4f7d13e87a426dc020`: issue-level workflow checks passed; PR-level workflow checks passed with `MEMORY_VAULT_SUBDIR=memory`; API build passed; focused API contracts passed 54/54; Flutter passed 861/861.
- PASS — authorized lifecycle smoke under supported Node `v22.23.0` (ABI 127): live `:4096` stayed PID `4099`, live `:4001` stayed PID `4089`, sandbox `:4098/health` returned `status: ok`, sandbox `:4098/opencode/health` returned `status: ready`, and engine `:4097` listened on PID `51478`.
- PASS — `tools/dev/sandbox.sh down`: `:4097` and `:4098` were free, the sandbox directory was absent, and live `:4001` / `:4096` remained healthy with their original PIDs.

## Notes

- GitNexus impact was LOW: `OPENCODE_ENGINE_PORT` had no indexed callers; `reclaimStalePortForOpencode` had one direct caller (`_initializeImpl`). The reclaim function was not modified.
- The authorized prior sandbox processes were removed before this rerun. A stale PID file/directory remained; with both sandbox ports free, `sandbox.sh down` safely removed that metadata before the prescribed lifecycle.
- The final lifecycle left no sandbox process or directory. Live services on `:4001` and `:4096` were preserved.

## Failure triage

- `ai-workflow status` was unavailable in this shell; the repository-equivalent
  `python3 scripts/run_ai_workflow.py status` passed (context files present).
- Before rebuilding `better-sqlite3`, `npm test --silent` failed at native ABI
  load (`NODE_MODULE_VERSION 127`, Node 26 requires 147). `npm rebuild
  better-sqlite3` succeeded.
- After rebuild, the unqualified PR command reproducibly failed 18 tests in six
  memory-vault suites. The host had `MEMORY_VAULT_SUBDIR` explicitly set to an
  empty string; this selects the clean layout while those tests construct the
  legacy `<vault>/memory` layout. The six suites pass 47/47 with
  `MEMORY_VAULT_SUBDIR=memory`; the full gate then passes 308 files / 2695
  tests (10 files / 26 tests skipped).
- The reported `recipe_generator`, `workflow_signal_generator`, and
  `opc_mcp_curated_credentials` cluster did not reproduce: its focused command
  passed 3 files / 27 tests, including JSON response, `canva`, and
  `requiredEnv` cases. No current sandbox diff touches those files; classify
  that report as non-reproducible/shared-environment evidence, not a sandbox
  regression.
- TypeScript check and API build passed. The earlier unqualified PR failure was
  environmental; with the documented `MEMORY_VAULT_SUBDIR=memory` test layout,
  the full PR workflow gate passed.
- The first lifecycle attempt used the host command shell's unsupported Node 26
  (ABI 147) against `better-sqlite3` built for ABI 127 and failed before binding
  `:4098`. `apps/api_server/package.json` requires Node `>=20 <25`; selecting the
  existing Node 22 login-shell runtime loaded `better-sqlite3` successfully and
  the complete lifecycle passed. No repository files or dependencies were
  changed for this environment repair.
- Failure postmortem: `.agent-stack/postmortems/2026-07-14-dev-sandbox-isolation.json`.
