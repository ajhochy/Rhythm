---
date: 2026-10-01
repo: Rhythm
branch: codex/opencode-memory-recovery
pr: null
issues: []
status: unverified
tags: [run, Rhythm]
---

### E1 real browser queue-read failure and CORS repair

- The first combined-sandbox Playwright run created a synthetic global approval and two bound approvals through real POST routes but timed out waiting for the global card. The saved UI error was "Approval service unavailable"; the browser rendered no pending rows. The running sandbox's authenticated GET `/agent-approvals?status=pending` returned HTTP 200 with all three pending synthetic rows, so creation and list authorization worked.
- The same sandbox's `OPTIONS /agent-approvals?status=pending` from approved renderer origin `http://127.0.0.1:4175` returned 204 and allowed that origin, but its `Access-Control-Allow-Headers` omitted `X-Rhythm-Human-Approval`. The browser's approval GET sends this required header, making the preflight fail before the GET. `apps/api_server/src/app.ts:138` held the fixed allow-header list.
- GitNexus `impact(createApp, upstream)` returned LOW, 0 indexed dependents/processes, with an index-staleness warning (six commits behind). A focused ephemeral-server test, `apps/api_server/src/__tests__/e1_approval_cors.test.ts`, reproduced red: preflight did not include `x-rhythm-human-approval`. Adding only that existing required header to the CORS allow list made the test pass 1/1. API `tsc --noEmit` exited 0.
- No running API/engine was restarted by this repair. The first live browser failure is retained as red evidence. Root owns the controlled sandbox restart, subsequent live browser rerun, and final exact-head API suite/CI.
