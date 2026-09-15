---
date: 2026-09-15
repo: Rhythm
branch: codex/agent-server-memory-fix
pr: null
issues: []
status: pass
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Agent-server memory and recovery fix

## Files changed

- `apps/api_server/src/services/skill_usage_tracker.ts`: metadata-only SQLite usage extraction with exact mutable-history eligibility semantics.
- `apps/api_server/src/services/harvested_skill_evaluator.ts`: no-draft scan avoidance and non-overlapping/coalesced evaluation.
- `apps/desktop_flutter/lib/app/core/server/api_server_service.dart`: owned-process identity and bounded native stderr persistence.
- `apps/desktop_flutter/lib/app/core/agents/agent_server_controller.dart`: bounded owned-child recovery, generation guards, and manual retry behavior.
- Focused/live API, evaluator, low-heap, Flutter lifecycle, and macOS integration tests were added or updated by the implementation workers.

## Checks run

- `ai-workflow checks --level pr` (Flutter/Node/Bun available on PATH) — exit 0; all 16 checks passed, including API serial suite/build, MCP tests/build, fork typecheck/session tests, and mobile e2e. Full output: `/private/tmp/rhythm-memory-fix-pr-gate.log`.
- `ai-workflow checks --level issue` after late Flutter review repairs — exit 0.
- `flutter test integration_test/agent_server_recovery_macos_test.dart -d macos` — exit 0; actual macOS app/helper process recovery and durable log assertions exercised.
- `flutter test` — 1,319 passed. The final same-token Retry adjustment was separately verified by 54 focused recovery/controller/MCP tests and scoped analysis; native integration rebuilt after that adjustment.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:5198 RHYTHM_MEMORY_TEST_SANDBOX=/private/tmp/rhythm-memory-fix-sandbox DB_PATH=/private/tmp/rhythm-memory-fix-sandbox/rhythm.db npm test -- --run src/__tests__/agent_server_memory_live.test.ts --no-file-parallelism` from `apps/api_server` — exit 0 with 338 MiB synthetic history (including one approximately 130 MiB unrelated row), exact counts through edits/deletes, and same-process health under a 256 MiB V8 cap.
- `node --max-old-space-size=256 /private/tmp/rhythm-memory-fix-full-history-probe.cjs` — exit 0; all 170 skill counts match SHA-256 `3075d308564d88ffa31e4021efb3da37c9d4df9e64d90c4bcf9f127ac430f4b1`; 20.513 s, 8.18 MB post-run V8 heap, 996,992 KiB maximum RSS.

- GitNexus staged scope check: exit 0; 21 intended files, 41 indexed symbols, 0 affected processes, LOW aggregate risk. Symbol impacts were LOW/MEDIUM; no HIGH/CRITICAL result. `git diff --cached --check` passed.

## Notes

- Initial default tool-sandbox real-server reproduction failed with `EPERM`/listen restrictions and caused timeouts. The corrected isolated reproduction with escalation exited 0; this was an environment limitation.
- API/MCP/fork subset evidence is summarized in `/private/tmp/rhythm-memory-fix-api-gate.md`; the draft handoff report is `/private/tmp/rhythm-memory-fix-run-draft.md`.
- API typecheck/lint, MCP typecheck/tests/build, and fork typecheck/session tests were independently captured. The canonical PR gate owns the final API build and corrected full serial API run.
- API/evaluator review found no issues. Flutter review fixes covered generation/stale-callback guards, installer reset, pipe draining, and owned manual retry/MCP reset. No UI view surfaces changed.
- The four production files were identical between `origin/main` and installed v0.18.63 before this patch.
- The repair preserves full history and Postgres no-op behavior. It does not delete/archive data, increase heap, disable learning, add a stale cache, deploy, or restart the installed app.
- Full-history counting remains synchronous with non-constant native RSS and possible brief health delay. Recovery may interrupt an in-flight engine turn; manual packaged chat/history smoke is still a release gate.
- Handoff: draft PR only; no associated numbered GitHub issue, merge, deployment, or installed-app restart. Branch and PR linkage record the final commit.
- Retrospective captured in `.agent-stack/postmortems/2026-09-15-retro-agent-server-memory.json`; canonical pattern miner ran successfully. Its regenerated historical summary was excluded from this scoped patch.
- The native test could not foreground its helper window (`open returned 1`) but executed all assertions successfully and exited zero. It does not claim a visual UI check.
