---
date: 2026-07-07
repo: Rhythm
branch: codex/mega-open-prs-2026-07-07
pr: 942
issues: [933, 934, 935, 936]
status: passed
tags: [run, Rhythm]
---

# Org Optimizer Workflow Prompt Fix Lane

## Files

- `apps/api_server/src/services/workflow_failure_signal_extractor.ts`
  - Adds W/P category extraction from recent workflow transcript text.
  - Emits workflow-agent run-error signals from errored workflow sessions.
  - Emits workflow-scoped tool-error signals instead of leaving message errors
    as a no-op.
- `apps/api_server/src/services/generators/workflow_signal_generator.ts`
  - Adds high-risk `workflow-prompt-fix` proposals with affected skill,
    category, evidence, proposed guard text, and dedup key.
  - Keeps prompt repair review-gated; no direct skill or AgentFlow edits.
- `apps/api_server/src/services/__tests__/workflow_failure_signal_extractor.test.ts`
  - Covers W5 transcript extraction into a workflow-adherence signal.
- `apps/api_server/src/services/generators/__tests__/workflow_signal_generator.test.ts`
  - Covers workflow-adherence signal -> queued `workflow-prompt-fix` proposal.
- `tools/release/smoke_mega_open_prs_backend.mjs`
  - The live smoke now reports optimizer findings from both `active` and
    `proposed` statuses so high-risk queued findings are visible.

## Checks

- `npx vitest run src/services/__tests__/workflow_failure_signal_extractor.test.ts src/services/generators/__tests__/workflow_signal_generator.test.ts`
  - Red first: 2 failures, expected missing workflow-adherence signal and
    missing `promptFixCreated` result.
- `./node_modules/.bin/tsc --noEmit`
  - Pass.
- `./node_modules/.bin/vitest run src/services/__tests__/workflow_failure_signal_extractor.test.ts src/services/generators/__tests__/workflow_signal_generator.test.ts src/__tests__/org_risk_classifier.test.ts`
  - Pass: 3 files, 20 tests.
- `./node_modules/.bin/vitest run`
  - Pass: 292 files, 2504 passed, 1 skipped.
- `node --check tools/release/smoke_mega_open_prs_backend.mjs`
  - Pass.

## Notes

- The prior live backend org-optimizer run used the already-running app/server,
  before this prompt-fix code existed. It proved the route read live session
  history but only produced scope-hygiene findings.
- A rebuilt/relaunched backend is required before the live endpoint can produce
  `workflow-prompt-fix` rows from this new code path. A second source server was
  not started on a separate port because the opencode engine port is fixed at
  `:4096` and the current desktop app already owns that engine.
