---
date: 2026-09-28
repo: Rhythm
branch: mobile/chat-list-compact-project-create
pr: null
issues: [mobile-chat-list-polish]
status: pass
tags: [run, Rhythm]
---

# Mobile chat list polish

## Files

- `apps/mobile/app/(tabs)/agents.tsx`
- `apps/mobile/components/chat/chat-list.tsx`
- `apps/mobile/components/chat/chat-list-controller.ts`
- `apps/mobile/components/chat/session-configuration-sheet.tsx`
- `apps/mobile/tests/chat/chat-list.test.tsx`
- `apps/mobile/tests/chat/session-configuration-sheet.test.tsx`
- `docs/ai/contracts/mobile-chat-list-polish.json`
- `docs/ai/runs/2026-09-28-mobile-chat-list-polish.md`

## Checks

- `npm install` — PASS; 1,167 packages installed. npm reported 37 dependency audit findings. Its generated lockfile-only `license` line was removed so the install did not alter the owned scope.
- Pre-implementation contract: `npx jest tests/chat/chat-list.test.tsx tests/chat/session-configuration-sheet.test.tsx` — EXPECTED FAIL. Five contract failures included the surface-card header color, 72 point session row, squeezed `flexBasis: 140` search, missing project create action, and missing compact sheet content marker.
- Focused verification — PASS, 50 tests.
- Accessibility verification — PASS, 8 tests.
- `npm run lint` — PASS with 3 pre-existing warnings outside owned files and 0 errors.
- `npm run typecheck` — PASS.
- `npm test` — 236 passed / 4 failed; all 4 are unchanged base-red issue-1387 failures:
  - `tests/contract/issue-1387-offline-sessions-state.test.tsx`: c26 and c27 cannot find `Mirrored offline session`; rendered project group reports 0 active and remains collapsed.
  - `tests/contract/issue-1387-offline-cold-relaunch.test.tsx`: c22 and c24 expect Offline/Connected but render `Chat status: Chat`.
- `git diff --check` — PASS.
- GitNexus impact for `useChatListController`, `ChatList`, `SessionConfigurationSheet`, and `AgentsScreen` — unavailable (`Connection closed`). Exact-reference fallback found 1 production caller for the controller, 1 for `ChatList`, 4 render sites for `SessionConfigurationSheet`, and the routed `AgentsScreen` plus its contract test. No HIGH/CRITICAL result was available; `gitnexus_detect_changes` also returned `Not connected`.
- UI review repair pre-implementation contract: `npx jest tests/chat/chat-list.test.tsx --runInBand --testNamePattern='task-mobile-chat-list-polish-race'` — EXPECTED FAIL, 2 tests. A's late success replaced B's profiles; A's late error surfaced stale feedback.
- UI review repair focused contract: `npx jest tests/chat/chat-list.test.tsx --runInBand` — PASS, 45 tests.
- UI review repair `npm run lint` — PASS with the same 3 warnings outside owned files and 0 errors.
- UI review repair `npm run typecheck` — PASS.
- UI review repair GitNexus upstream impact for `useChatListController` — unavailable (`Not connected`) before the controller edit.
- UI review repair final `gitnexus_detect_changes` (`scope: all`, this worktree) — unavailable (`Not connected`).
- UI review repair `git diff --check` — PASS.

## Notes

- Project-header creation stores the explicit project path, loads profiles for it, uses it for `createChat`, and clears it on dismissal or focus loss. Toolbar creation retains the existing filter/active-project fallback.
- Project headers and session rows now match the compact desktop rail while preserving 44 point minimum touch targets and existing accessibility/test labels.
- Search owns a full-width row; sort and New chat use a separate action row. The Chats title is 22 points with reduced header padding.
- The configuration summary uses compact Profile/Model `List.Item` rows and tighter Reasoning/Approval controls; create/edit behavior and the hidden-sheet guard remain intact.
- Criterion 4 visual confirmation: manual smoke remains at 375–430 point widths.
- Criterion 5 visual confirmation: manual smoke remains at an 844 point viewport.
- Orchestration started the required isolated synthetic sandbox on API `:4098`; no live service was touched. No commit was created.
- UI review repair binds both global and project-header creation to the exact resolved target. A request generation ignores stale successes/errors; close and focus loss also invalidate pending loads while preserving their cleanup.

## Handoff

`PASS`: lint/typecheck, 50 focused tests, and 8 accessibility tests are green.
The four issue-1387 failures are unchanged on base and were not caused by this
slice. Manual smoke remains for the header/search widths and sheet fit.

## Failure triage

- Working tree: `npx jest tests/contract/issue-1387-offline-sessions-state.test.tsx tests/contract/issue-1387-offline-cold-relaunch.test.tsx --runInBand` — FAIL, the same four assertions reported by the full suite.
- Clean detached base `mega/2026-09-18-mobile-electron-hermes` at `3c520d5616c757a49f7c3fafe6ad285168575ed4`, using the same installed dependency tree: the identical focused command — FAIL, 4/4 with the same rendered states (`0 active, collapsed` and `Chat status: Chat`).
- The cold-relaunch failure is outside this slice: `chat-header.tsx` and its status inputs were not changed. Its current fallback is `presentationStatus || idleSubtitle || 'Chat'`, so the contract harness, which supplies only `connectionStatus`, renders `Chat`.
- The offline-catalog failure also predates this slice. Base and working tree both classify the cached `status: 'idle'` session as completed, report zero active, and leave the all-lifecycle project group collapsed. This slice changed project-header presentation/create controls, not lifecycle classification or expansion state.
- Recommended gate handling: accept the slice with focused lint/typecheck, 50/50 focused tests, and 8 accessibility tests; record these four tests as a base-red exclusion/follow-up for issue-1387 rather than repairing unrelated offline behavior in this UI slice. Re-run the full mobile suite after that separate repair.
