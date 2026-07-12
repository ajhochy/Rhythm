# Project State

## Current focus

**USO epic + follow-ups shipped (2026-07-12)** — unified session observability
(PR #1036) plus the background-agent execution fixes and live streaming
(PR #1077, stacked). All live-verified on the running app. See
`docs/ai/runs/2026-07-12-uso-followups-live-verified.md`.

## Active branch / PR

- **PR #1036** `workflow/uso-epic-2026-07-11` — USO epic (#1002, #1023–#1034).
  CI green, manual smoke 5/5 PASS. Merge FIRST.
- **PR #1077** `uso/agent-followups` (stacked on #1036) — #1039 (3 root causes,
  live-verified) + #1040 (live streaming) + uniform-chat UX. Awaiting CI +
  final user smoke (watch a scheduled run stream live). Merge after #1036,
  then retarget/merge.

## In progress

- User smoke of live streaming (open a running scheduled session — parts
  should render as they happen).

## Risks / known issues

1. #1023 release-build acceptance still needs a real `workflow_dispatch` build.
2. Profile promotions must go through the API (PATCH /agent-configs) — raw
   SQL edits get reverted by profile sync.
3. Open follow-ups: #1038 (Projects dark mode), #1041 (workflow-prompt-fix ref
   resolver). Feature ask not yet filed: async delegation + completion notify.
4. Org-optimizer cron stays OFF pending safety review (unchanged).

## Test status

- api_server tsc clean; full vitest 2692 passed / 0 failed.
- Flutter analyze clean; 861 tests passed.
- Live e2e: 3 scopes; headless runs produce output past 5 min; mid-flight
  promote works; streamed multi-step transcripts dedupe cleanly.

## Next step

1. CI green on #1077 → user merges #1036 then #1077 → release build (#1023
   acceptance).
2. File the async-delegation + completion-notify feature issue if wanted.
