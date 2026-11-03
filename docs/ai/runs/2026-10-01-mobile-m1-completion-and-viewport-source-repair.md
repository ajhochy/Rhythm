---
date: 2026-10-01
repo: Rhythm
branch: opencode/delivery-mobile-m1-continued-20261001
pr: 1598
issues: [M1-bugs2, M1-bug4]
status: source-and-synthetic-browser-pass-live-and-device-unverified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# M1 completion and viewport source repair

Index: [[Rhythm]]

## Files

- `apps/mobile/providers/opencode-provider.tsx`, `opencode-provider-types.ts`: completion-specific six-read/120ms retry for an idle session, session-scoped syncing/retry state, a manual retry action, and protection against early empty or shorter unfinished GETs replacing richer streamed text. Only an assistant record marked `time.completed` (or carrying an explicit error) ends retry; a completed tool-only assistant outcome also qualifies. New work or session error cancels the pending retry; project switch and unmount clear timers.
- `apps/mobile/components/chat/chat-view.tsx`, `chat-content.tsx`: visible completion sync/retry in the transcript. Existing M1 viewport patch now holds its prepend anchor through staged row layouts and final measured size, then releases it.
- `apps/mobile/tests/chat/transcript-streaming-provider.test.tsx`, `chat-content-scroll.test.tsx`, `tests/e2e/m1-newest-viewport.spec.mjs`: deterministic late same-ID completion, incomplete nonempty same-ID snapshot then completed final, bounded retry/manual action, stale empty GET, terminal tool-only outcome, visible retry control, and rendered newest/prepend/stream/resize checks. Browser fixture uses `session.directory`, matching the event envelope routing.

## Checks

- Before production edits, `m1-c1` provider test failed after the 1-second bound with empty final text; rendered Chromium spec failed older prepend by 2280px. The browser event fixture's project ID/directory mismatch was separately confirmed from the fake server routing.
- `cd apps/mobile && HOME="$PWD/.m1-test-home" npm test -- --runInBand tests/chat/transcript-streaming-provider.test.tsx tests/chat/chat-content-scroll.test.tsx`: **20 passed / 20**, exit 0. Existing ST-1 synthetic stream recorded 106ms first visible, one pre-idle commit, zero pre-idle message GETs after initial reads settled.
- `cd apps/mobile && HOME="$PWD/.m1-test-home" npm run typecheck`: exit 0.
- `cd apps/mobile && HOME="$PWD/.m1-test-home" npm run lint -- --ignore-pattern '.m1-test-home/**'`: exit 0, three pre-existing warnings in unrelated files.
- `cd apps/mobile && HOME="$PWD/.m1-test-home" PLAYWRIGHT_FAKE_PORT=44136 PLAYWRIGHT_WEB_PORT=19136 npm run test:e2e:web -- tests/e2e/m1-newest-viewport.spec.mjs`: **1 passed / 1**, exit 0. Assertions retain first visible bottom gap <=2px, bounded newest GET, prepend anchor <=2px, upward-reader jump, and composer resize. Synthetic screenshots remain in the source worktree and were excluded from integration.

## Notes

- The branch starts at old Mega head `c1b7e023`; current Mega #1598 is `18705742`. Integrate only the M1 behavioral hunks and preserve newer Mega mobile composer/empty-state polish in overlapping files.
- The actual engine + api_server completion/relay/GET/render test, native device matrix, attachment normalization adapter, packaged install, and TestFlight are **not run** here. This is source and isolated synthetic-browser evidence only; M1 whole-issue acceptance remains **UNVERIFIED** until root runs the live sandbox and device gates.
- No commit, push, merge, production database/config change, or Rhythm server launch was made in this lane.
