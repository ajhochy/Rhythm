---
date: 2026-08-11
repo: Rhythm
branch: mega-ws/chat-ui
pr: null
issues: [1340, 1348, 1323]
status: blocked-commit
tags: [run, Rhythm]
---

# Chat UI full-suite regression repair

## Files

- `apps/api_server/src/repositories/agent_sessions_repository.ts` — separated implicit internal child-session scans from explicit root-only Chats scope.
- `apps/api_server/src/__tests__/delegated_session_isolation.test.ts` — reconciled c3 with #1348 while preserving Chat classification and internal visibility assertions.
- `apps/desktop_flutter/lib/features/agents/views/_session_list_body.dart` — excluded the visible waiting badge from child semantics because the row already supplies the complete accessible label.
- `apps/desktop_flutter/test/features/agents/issue_1043_permission_always_deny_reason_test.dart` — updated wire-level expectations from legacy `accept`/`deny` to `once`/`reject`.

## Checks

- `npx vitest run src/__tests__/delegated_session_isolation.test.ts src/__tests__/issue_751_session_mapping.test.ts src/__tests__/workflow_failure_signal_extractor.test.ts src/services/__tests__/org_audit_service.test.ts` — PASS, 44/44.
- `npx vitest run src/__tests__/issue_743_child_session_persistence.test.ts -t 'is idempotent: second call'` — PASS.
- `npx vitest run src/repositories/agent_sessions_repository.test.ts -t 'issue-1348-c1|no scope === scope:chats'` — PASS, 2/2 selected.
- `npm run build` — PASS.
- Cached Dart formatter with `--output=none --set-exit-if-changed` — PASS, 0 changed on the final run.
- Cached Flutter tools snapshot `analyze --no-fatal-infos --no-pub` — PASS, 297 pre-existing infos and no warnings/errors.
- Full targeted six-file Vitest command — environment failure: `background_status.test.ts` and `issue_743_child_session_persistence.test.ts` both call `startTestServer`; binding `0.0.0.0:0` fails with `EPERM`. This disproves the claim that every listed API file is DB-only.
- Flutter widget tests — not run, per sandbox restriction. The supplied full-run log contains no `[E]` for markdown, Changes default-scope, or mounted-side-panel tests; those were concurrent progress lines, not failures.

## Notes

- Permission-card production code correctly sends the #1340 engine contract (`once`, `always`, `reject`); the four old expectations were stale and were updated without weakening assertions.
- The waiting-row failure is attributed to duplicate semantics: the row label already said `Waiting on you`, and the new visible badge added a second semantic text node. `ExcludeSemantics` keeps the visual badge while making the row label authoritative.
- `MarkdownMessageBody`, `ChangesTab` default scope, and `SessionSidePanel` mount logic were unchanged by this repair because the supplied evidence shows those tests completed without errors.
- Commit creation is blocked: Git attempts to create `/Users/ajhochhalter/Documents/Rhythm/.git/worktrees/ws-chat-ui/index.lock`, outside the writable sandbox root, and fails with `Operation not permitted`. Nothing was pushed.
