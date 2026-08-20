---
date: 2026-08-20
repo: Rhythm
branch: agent-stack/si-d2-post-apply-lifecycle
pr: 1454
issues: []
status: ready-for-verification
tags: [run, Rhythm]
---

## Contract

- `docs/ai/contracts/task-post-apply-regression-signals.json`
- Red confirmed: focused Vitest run had 3 expected failures because diagnosis received no signal, no-evidence consumed an attempt, and the category was not diagnosable.

## Files changed

- `apps/api_server/src/services/workflow_failure_signal_extractor.ts`
- `apps/api_server/src/services/generators/workflow_signal_generator.ts`
- `apps/api_server/src/services/auto_repair_service.ts`
- `apps/api_server/src/services/__tests__/auto_repair_service.test.ts`
- `apps/api_server/src/services/generators/__tests__/workflow_signal_generator.test.ts`
- `docs/ai/contracts/task-post-apply-regression-signals.json`

## Checks run

- `npx vitest run src/services/__tests__/auto_repair_service.test.ts src/services/generators/__tests__/workflow_signal_generator.test.ts` — 34/34 passed.
- `./node_modules/.bin/tsc -p tsconfig.json --noEmit` — passed.
- `npm run build` — passed, including postbuild.
- `git diff --check` — passed.
- `gitnexus_detect_changes(scope=all)` — low risk, but stale worktree index reported 0 changed symbols across 26 changed files.

## Notes

- Existing durable attempt recovery remains ahead of all evidence reads.
- No sandbox or full suite was run, per dispatch.
