---
date: 2026-10-06
repo: Rhythm
branch: codex/chat-only-bounded-workflow
pr: 1604
issues: []
status: repairing
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

## Files

Focused repair of `CoordinatorConversationService.workflowStatus` completion reporting, with additive real SQLite/G2 model-status regressions in `coding_workflow_status_text.test.ts`. The approval, execution, budget, ordinary child-dispatch projection and 3,800-byte status cap remain unchanged.

## Checks

- Frozen candidate `5c36667493a20b2e647316f535bae0f37f8d56bc`, apps tree `1757d39bd4731c3b60d8eed44d9ab8a421aa9660`: fork build exited 0; actual version `0.0.0-rhythm-5c36667493a20b2e647316f535bae0f37f8d56bc`.
- Formal command from `apps/api_server`: `PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_SOURCE_SHA=5c36667493a20b2e647316f535bae0f37f8d56bc RHYTHM_CHAT_LIVE_TEST_OUT=/Users/ajhochhalter/Documents/Codex/2026-10-06/chat-bounded-workflow ./node_modules/.bin/vitest run src/__tests__/live_chat_bounded_workflow.test.ts --reporter=verbose` exited 1. Idle qualified 18/19 behavior checks and 5/5 operational checks; `signed_checked_status` failed. Restart was interrupted by an owned-child signal and remains unqualified, rather than a product failure.
- Both real manager ordinals, checked criteria and independent reviewer completed in the failed idle case. The actual signed response was 2,544 UTF-8 bytes, `authoritative_current_projection`; finite workflow state was completed, but its prose omitted both exact criterion names. `codingWorkflow:[]` correctly represents the separate ordinary `delegate_goal` path. This was not truncation. Dirty restart recon had the same omission; it established observed status, not this formal assertion.
- Idle and interrupted restart receipts recorded stock teardown 0, removed sandbox, all five owned listeners absent, unchanged read-only invented fixtures and source, unchanged normal listeners, and empty evidence/cleanup errors. External receipts remain under `chat-bounded-workflow/rhythm-chat-live-*`.
- GitNexus before edit: `workflowStatus` LOW, one direct caller/two total upstream symbols (`modelStatusText` then `finalStatusText`), no indexed execution flows. `modelStatusText` LOW, one direct caller; it is not modified. The index was built against C5 content before commit; its metadata HEAD predates that commit.
- Independent additive contract RED: focused two-test run exited 1, two failed/11 existing tests skipped. Positive exercised actual manager/reviewer checks through model status; negative completed the same checked workflow, then used real repository `revise` to make its criteria pending while retaining its completed state. Existing assertions were preserved. External exact command/output: `codex-resume-final-state-draft/c5-signed-checked-status-red-receipt.md` and `c5-signed-checked-status-red.txt`.
- C5 issue gate passed 4/4. Its full PR gate passed six stages then was deliberately interrupted during API Vitest; only its integration-owned process tree was stopped. It is not a full green aggregate. Fresh repaired-source full gates and formal idle/restart qualification are required before packaging.
- Implementer regression command from `apps/api_server`: `PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin ./node_modules/.bin/vitest run src/__tests__/coding_workflow_status_text.test.ts src/__tests__/coding_workflow_checked_result.test.ts src/__tests__/coding_workflow_admission.test.ts src/__tests__/coordinator_goal_approval_resume.test.ts src/__tests__/coordinator_calendar_project_context.test.ts --reporter=verbose` exited 0, five files/140 tests passed. `./node_modules/.bin/tsc --noEmit --pretty false` exited 0. Root read the actual output and reviewed the sole completed-status branch; the independent contract file remains unchanged at SHA-256 `4309eba69101c0436c1a2eebe945438e9d3bdbedd2955dc74acab7b30f787d02`. These focused checks do not replace final source qualification.
- Independent verification: `./node_modules/.bin/vitest run src/__tests__/coding_workflow_status_text.test.ts --reporter=verbose` exited 0, all 13 tests passed; `./node_modules/.bin/tsc --noEmit` exited 0. Test hash unchanged; production service hash `5f7a86b6b8cad13a9d5b047c2e817a6d4fa21009bea486684dcf06ce6005bb77`. Output is preserved in `codex-resume-final-state-draft/c5-signed-checked-status-green.txt` and the external red/green receipt.

## Notes

The repair must name both server-checked criteria, report the actual ordinal count and checked stop, and withhold verified completion when the current checkpoint no longer has the exact verified criteria and server receipts. It is read-only reporting, with no refund, regrant, replay or new ordinal. External model responses and ranking hints are synthetic; API, fork, MCP, persistence, membership and server checks are real. Packaging, native UI behavior, physical phone and human merge remain separate gates. No follow-up issue was needed for this bounded in-scope repair.
