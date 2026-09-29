---
date: 2026-09-28
repo: Rhythm
branch: mobile/chat-list-compact-project-create
pr: 1585
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
- `apps/mobile/components/chat/chat-content.tsx`
- `apps/mobile/tests/chat/chat-list.test.tsx`
- `apps/mobile/tests/chat/chat-content-scroll.test.tsx`
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
- `npm test` — 239 passed / 4 failed; all 4 are unchanged base-red issue-1387 failures:
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
- Auto-scroll pre-implementation contract: `npx jest tests/chat/chat-content-scroll.test.tsx --runInBand` — EXPECTED FAIL. The initial run failed the early-offset-zero case (1 failed / 6 passed). After strengthening tab return to first place the reader far from bottom, the same command failed both regressions (2 failed / 5 passed): each observed zero `scrollToEnd` calls. Existing session-switch, near-bottom, far-from-bottom, and anchor-preservation checks passed.
- Auto-scroll GitNexus upstream impact for `ChatContent` in `apps/mobile/components/chat/chat-content.tsx` — unavailable (`Not connected`) before implementation. Exact-reference fallback found one production render site in `chat-view.tsx` plus the owned focused test file; no HIGH/CRITICAL result was available.
- Auto-scroll focused verification: `npx jest tests/chat/chat-content-scroll.test.tsx --runInBand` — PASS, 7/7 tests.
- Final combined contract: `npx jest tests/chat/chat-list.test.tsx tests/chat/session-configuration-sheet.test.tsx tests/chat/chat-content-scroll.test.tsx --runInBand` — PASS, 57/57 tests.
- Auto-scroll `npm run lint` — PASS with the same 3 warnings outside owned files and 0 errors.
- Auto-scroll `npm run typecheck` — PASS.
- Auto-scroll `git diff --check` — PASS; `git status --short` listed only the four assigned files.
- Auto-scroll final `gitnexus_detect_changes` (`scope: all`, this worktree) — unavailable (`Not connected`).
- Prepend review contract: `npx jest tests/chat/chat-content-scroll.test.tsx --runInBand` — EXPECTED FAIL, 1 failed / 7 passed. With a prior transcript height of 250 inside a 300 point viewport, prepending one older entry caused one unexpected `scrollToEnd({ animated: false })` call.
- Prepend review GitNexus upstream impact for `ChatContent` — unavailable (`Not connected`) before implementation. Exact-reference fallback again found one production render site in `chat-view.tsx`, the focused test, and one unrelated test mock; no HIGH/CRITICAL result was available.
- Prepend review focused verification: `npx jest tests/chat/chat-content-scroll.test.tsx --runInBand` — PASS, 8/8 tests.
- Prepend review combined contract: `npx jest tests/chat/chat-list.test.tsx tests/chat/session-configuration-sheet.test.tsx tests/chat/chat-content-scroll.test.tsx --runInBand` — PASS, 58/58 tests; one existing asynchronous `VirtualizedList` act warning was emitted.
- Prepend review `npm run lint` — PASS with the same 3 warnings outside owned files and 0 errors.
- Prepend review `npm run typecheck` — PASS.
- Prepend review `git diff --check` — PASS; `git diff --name-only` listed only the four assigned files.
- Prepend review final `gitnexus_detect_changes` (`scope: all`, this worktree) — unavailable (`Not connected`).

## Notes

- Project-header creation stores the explicit project path, loads profiles for it, uses it for `createChat`, and clears it on dismissal or focus loss. Toolbar creation retains the existing filter/active-project fallback.
- Project headers and session rows now match the compact desktop rail while preserving 44 point minimum touch targets and existing accessibility/test labels.
- Search owns a full-width row; sort and New chat use a separate action row. The Chats title is 22 points with reduced header padding.
- The configuration summary uses compact Profile/Model `List.Item` rows and tighter Reasoning/Approval controls; create/edit behavior and the hidden-sheet guard remain intact.
- Criterion 4 visual confirmation: manual smoke remains at 375–430 point widths.
- Criterion 5 visual confirmation: manual smoke remains at an 844 point viewport.
- Orchestration started the required isolated synthetic sandbox on API `:4098`; no live service was touched. No commit was created.
- UI review repair binds both global and project-header creation to the exact resolved target. A request generation ignores stale successes/errors; close and focus loss also invalidate pending loads while preserving their cleanup.
- Auto-scroll now reliably opens existing chats at the bottom and repositions on tab/session return. Near-bottom responses auto-follow; readers viewing history are not yanked. Prepending older messages retains the reader's anchor through `maintainVisibleContentPosition`.

## Handoff

`PASS`: lint/typecheck, 50 focused tests, and 8 accessibility tests are green.
The four issue-1387 failures are unchanged on base and were not caused by this
slice. Manual smoke remains for the header/search widths and sheet fit.

Auto-scroll follow-up: `PASS`; focused 8/8, combined chat contracts 58/58,
accessibility 8/8, lint/typecheck, and full-suite verification pass aside from
the same four base-red issue-1387 failures. Draft PR #1585 exists; the
auto-scroll changes are not yet committed or pushed. Manual native timing/layout
smoke remains.

## Failure triage

- Working tree: `npx jest tests/contract/issue-1387-offline-sessions-state.test.tsx tests/contract/issue-1387-offline-cold-relaunch.test.tsx --runInBand` — FAIL, the same four assertions reported by the full suite.
- Clean detached base `mega/2026-09-18-mobile-electron-hermes` at `3c520d5616c757a49f7c3fafe6ad285168575ed4`, using the same installed dependency tree: the identical focused command — FAIL, 4/4 with the same rendered states (`0 active, collapsed` and `Chat status: Chat`).
- The cold-relaunch failure is outside this slice: `chat-header.tsx` and its status inputs were not changed. Its current fallback is `presentationStatus || idleSubtitle || 'Chat'`, so the contract harness, which supplies only `connectionStatus`, renders `Chat`.
- The offline-catalog failure also predates this slice. Base and working tree both classify the cached `status: 'idle'` session as completed, report zero active, and leave the all-lifecycle project group collapsed. This slice changed project-header presentation/create controls, not lifecycle classification or expansion state.
- Recommended gate handling: accept the slice with focused lint/typecheck, 50/50 focused tests, and 8 accessibility tests; record these four tests as a base-red exclusion/follow-up for issue-1387 rather than repairing unrelated offline behavior in this UI slice. Re-run the full mobile suite after that separate repair.

## NC-1 + NC-2 performance repair

WAIVED: verification-only test and documentation evidence repair with no intended product behavior change; verification is the five direct regression assertions plus focused/combined Jest, lint, typecheck, and diff checks.

WAIVED: final baseline-harness evidence repair changes tests and documentation only, not product behavior; verification is an actual `d2048dda` provider/create/open run and the current provider run through equivalent public entry points, repeated focused NC tests, combined chat tests, lint, typecheck, and diff checks.

### Files

- `apps/mobile/providers/agent-chat-provider.tsx`
- `apps/mobile/providers/opencode-provider.tsx`
- `apps/mobile/tests/chat/create-chat-fast-path.test.tsx`
- `apps/mobile/tests/chat/create-chat-provider-cache.test.tsx`
- `docs/ai/contracts/mobile-chat-list-polish.json`
- `docs/ai/current-plan.md`
- `docs/ai/current-plan-1585-regressions.md`
- `docs/ai/runs/2026-09-28-mobile-chat-list-polish.md`

### Acceptance-contract baseline

- Approved pre-change SHA: `d2048ddaba7d69315f4f12b02f22a970d5b051fd`.
- `npx jest tests/chat/create-chat-fast-path.test.tsx --runInBand` — EXPECTED FAIL, 2/2. The pending catalog sweep won the critical-path race (`still-blocked`), and the background-failure scenario timed out at 5,005 ms because `createChat` still awaited the rejected sweep.
- `npx jest tests/chat/create-chat-provider-cache.test.tsx --runInBand` — EXPECTED FAIL. Identical request-log scenario recorded 2 target profile-catalog GETs and 2 blocking cold-open GETs (exact-session + messages). The test stopped on `Expected length: 1; Received length: 2` for the profile catalog.

### Post-change performance

| Metric | Baseline | Post-change |
|---|---:|---:|
| Target profile-catalog GETs | 2 | 1 |
| Blocking just-created cold-open GETs | 2 (exact + messages) | 0 |
| Awaited Create-to-navigation network phases | 6 (create, duplicate profile, preference PATCH, sweep, exact, messages) | 2 (create + preference PATCH) |
| Added latency from deterministic 500 ms sweep | 500 ms minimum | 0.0–1.0 ms observed before return |

The seeded fast open schedules an authoritative messages reconciliation after
the composer is ready. An unseeded direct/deep-link open still records exactly
1 exact-session GET and 1 messages GET. A failed required preference PATCH
rejects create and leaves no seeded fast-open entry.

Verification-evidence repair added direct assertions for all five review gaps:
the baseline and post-change provider use the same mocked network boundaries
and public provider entry points and assert awaited phases exactly `6 → 2`;
the baseline asserts exact-session plus messages GETs exactly `2`; a rejected durable create
POST rejects before preference PATCH, list publication, or fast-open seeding;
and a rejected lower-level background `refreshSessions` call is observed with
an installed `unhandledRejection` listener and produces zero events. The plan
now records AJ approval only for NC-1/NC-2; NC-3/ST-1 remain unapproved.

### Final real-source baseline evidence repair

- Removed the hand-authored six-call baseline helper. The replacement renders
  real `OpencodeProvider` and `AgentChatProvider`, calls public
  `loadSessionProfiles` → `createChat` → `openProjectSession`, and uses a generic
  deferred-boundary queue that releases whichever request the unresolved public
  promise actually needs next. It does not encode the expected operation order.
- Baseline source came from detached isolated worktree
  `/private/tmp/rhythm-nc-baseline` at exact SHA
  `d2048ddaba7d69315f4f12b02f22a970d5b051fd`. The baseline checkout contained
  only a temporary one-line test wrapper importing the identical maintained
  harness; Jest's baseline `rootDir` resolved provider aliases to baseline source.
- Baseline command:
  `NODE_PATH=/private/tmp/rhythm-mobile-list-polish/apps/mobile/node_modules NC_PROVIDER_REVISION=baseline /private/tmp/rhythm-mobile-list-polish/apps/mobile/node_modules/.bin/jest --config /private/tmp/rhythm-nc-baseline/apps/mobile/jest.config.js tests/chat/create-chat-provider-cache.test.tsx --runInBand -t "awaited network phases"`
  — PASS 1/1; observed `awaited=6, profiles=2, blocking-open=2`.
- Post-change command:
  `npx jest tests/chat/create-chat-provider-cache.test.tsx --runInBand -t "awaited network phases"`
  — PASS 1/1; observed `awaited=2, profiles=1, blocking-open=0`.
- An initial unfiltered baseline command also ran the six post-change-only
  regression cases: the comparison case passed, while three expected NC repair
  assertions failed against old source. The evidence command was then correctly
  narrowed to the shared comparison case; no count or expectation was loosened.
- Both baseline and post runs emitted React `act(...)` warnings during
  `openProjectSession` state publication and Jest's existing open-handle notice;
  neither warning changed exit status or the observed/asserted metrics.

### Checks

- Verification repair first focused run: `npx jest tests/chat/create-chat-fast-path.test.tsx tests/chat/create-chat-provider-cache.test.tsx --runInBand` — FAIL, 2 assertions in the new evidence harness; the capture included a started-but-not-awaited background messages read, and the no-seed check over-constrained background messages to one call. No product defect was found.
- Focused NC rerun after repairing only those assertions: `npx jest tests/chat/create-chat-fast-path.test.tsx tests/chat/create-chat-provider-cache.test.tsx --runInBand` — PASS, 10/10.
- Final focused NC stability run, same command with `--silent`, repeated three times — PASS 10/10 on all three runs (1.302s, 0.918s, 0.918s); each retained Jest's existing open-handle notice.
- Combined contract: `npx jest tests/chat/create-chat-fast-path.test.tsx tests/chat/create-chat-provider-cache.test.tsx tests/chat/chat-list.test.tsx tests/chat/session-configuration-sheet.test.tsx tests/chat/chat-content-scroll.test.tsx --runInBand` — PASS, 68/68.
- Final combined rerun with the same files and `--silent` — PASS, 68/68 in 7.545s.
- `npm run lint` — PASS with 0 errors and the same 3 warnings outside owned files.
- `npm run typecheck` — PASS.
- `git diff --check` — PASS.
- Sandbox listener check: API `127.0.0.1:4098`, fork engine `127.0.0.1:4097`, and gateway `127.0.0.1:4099` were all listening. `tools/dev/sandbox.sh status` could not identify the manager-owned non-default sandbox directory, so it was not restarted or stopped.
- GitNexus upstream impact for `createChat`, `persistSessionPreferences`, `createSession`, and `openFromCache` — unavailable (`Not connected`) before edits. Exact-reference fallback found the ChatList controller/UI create chain, three production `createSession` callers, four in-provider preference-persistence callers, and the existing controller cache consumer. No HIGH/CRITICAL result was available.
- Final `gitnexus_detect_changes` (`scope: all`, this worktree) — unavailable (`Not connected`). Owned-file diff review and `git diff --check` passed; no product file was changed during this evidence repair.

### Handoff

`PASS`: NC-1 + NC-2 are verified without ST-1/streaming changes. Actual baseline/current
provider flows measure awaited phases `6 → 2`, profile GETs `2 → 1`, and blocking
newly-created exact/messages reads `2 → 0`. Focused NC verification is 10/10 on
repeated runs; combined chat contracts are 68/68; lint and typecheck pass. The
new-chat repair remains uncommitted and unpushed. Manual native timing/layout smoke
remains, and ST-1/streaming is next as a separate stacked PR. Broader mega integration
context and manual-smoke boundaries remain unchanged. No commit, push, merge,
deployment, sandbox restart, or sandbox teardown was performed.
