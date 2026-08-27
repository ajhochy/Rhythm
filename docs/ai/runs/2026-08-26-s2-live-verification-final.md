---
date: 2026-08-26
repo: Rhythm
branch: fix/bridge-stream-reliability-repair
pr: null
issues: [1325, 1455, 1456, 1457, 1458]
status: verified
tags: [run, Rhythm]
---

# S2 live verification final evidence

## Scope

- Worktree: `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-s2-verify`
- Verified HEAD: `4976985d`
- Administrative evidence finalization only; no code, test, server, sandbox, or port changes in this run.
- Earlier repair logs are preserved unchanged.

WAIVED: docs-only evidence finalization with no behavior or test changes; verification is JSON parsing, documentation diff review, staged-file scope, and clean post-commit status.

## Observed commands and counts

Commands were run from `apps/api_server` with the assigned isolated sandbox environment (`RHYTHM_LIVE_E2E=1`, `RHYTHM_LIVE_E2E_ISOLATED=1`, sandbox DB/directory, API `:4098`, engine `:4097`) for live files.

- `npx vitest run src/contract/issue_1455_1456_idle_finalization.test.ts --no-file-parallelism` — **PASS: 20 passed**.
- `npx vitest run src/contract/issue_1457_global_stream_retry.test.ts src/contract/issue_1458_bypass_engine_permission.test.ts src/contract/issue_1455_1456_idle_finalization.test.ts src/contract/issue_1325_engine_respawn.test.ts src/contract/issue_1457_1325_restart_harness.test.ts src/__tests__/opencode_stream_bridge.test.ts src/__tests__/opencode_client_service.test.ts src/__tests__/issue_1379_bridge_hub_publish.test.ts src/__tests__/agent_sessions.test.ts src/__tests__/issue_1325_live_e2e.test.ts src/__tests__/issue_1457_global_stream_retry_live_e2e.test.ts src/__tests__/issue_1458_bypass_engine_permission_live_e2e.test.ts src/__tests__/issue_1455_1456_idle_finalization_live_e2e.test.ts` — **PASS: 161 passed, 6 skipped**.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 npx vitest run src/__tests__/issue_1458_bypass_engine_permission_live_e2e.test.ts --no-file-parallelism` — **PASS: 1 passed**.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 npx vitest run src/__tests__/issue_1457_global_stream_retry_live_e2e.test.ts --no-file-parallelism` — **PASS: 1 passed**.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 npx vitest run src/__tests__/issue_1455_1456_idle_finalization_live_e2e.test.ts --no-file-parallelism` — **PASS: 2 passed**.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 npx vitest run src/__tests__/issue_1325_live_e2e.test.ts --no-file-parallelism` — **PASS: 2 passed**.
- `node_modules/.bin/tsc --noEmit` — **PASS**.
- `npm run build` — **PASS** (`tsc -p tsconfig.json` and postbuild).

## Live evidence

- **#1458 (1/1):** engine-side wildcard was present before bridge handling; controlled real `read`, `bash`, and `edit` calls completed; no permission asks remained. This does not claim a physical global-stream outage. Listener independence remains the separate c4 unit proof.
- **#1457 (1/1):** degraded/retrying bridge state was observed; API PID `57023` remained unchanged; engine PID and boot identity changed; bridge health recovered; the post-recovery WebSocket child event was observed and the child persisted through the public sessions API.
- **#1455/#1456 (2/2 full file):** controlled provider/profile bindings were proven before behavior assertions. #1455 produced actionable `content-filter` output with zero assistant text and exactly one persisted structured output. #1456 produced `transcript.append`, updated preview, exactly one structured output, and no duplicate legacy row.
- **#1325 (2/2):** engine PID and boot identity changed while the API PID remained unchanged, then bridge health returned live.
- Cleanup completed. Fixture hashes and protected PID invariants were proven by the gate; generated sessions, profiles, provider/config changes, and sandbox-owned resources were cleaned without touching protected processes.

## GitNexus limitation

- Required `detect_changes(scope: "compare", base_ref: "main", worktree: "/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-s2-verify")` was attempted against this exact worktree.
- It failed before analysis: `Trying to read a database file with a different version. Database file version: 42, Current build storage version: 41`.
- No HIGH/CRITICAL result was produced. This is a tooling limitation, not a passed impact gate.

## Final status

All previously pending live criteria now have observed passing evidence.

Administrative checks from the worktree root:

- `node -e 'const fs=require("node:fs"); for(const f of process.argv.slice(1)){const c=JSON.parse(fs.readFileSync(f,"utf8")); const bad=c.criteria.filter(x=>x.status!=="pass"&&!c.not_tested.includes(x.criterion_id)); if(bad.length) throw new Error(`${f}: ${bad.map(x=>x.criterion_id).join(",")}`); console.log(`${f}: ${c.criteria.length} pass, ${c.not_tested.length} not_tested`)}' docs/ai/contracts/issue-1325.json docs/ai/contracts/issue-1455.json docs/ai/contracts/issue-1456.json docs/ai/contracts/issue-1457.json docs/ai/contracts/issue-1458.json` — **PASS:** all five parsed; 33/33 criteria are `pass`; every `not_tested` list is empty.
- `git diff --check` — **PASS**, no output.
- Documentation diff review — **PASS:** only the five requested contracts and this final run note changed; no code or test file changed.
- Final handoff target: commit only those six files, confirm a clean branch, and report safe-to-push without pushing or opening a PR.
