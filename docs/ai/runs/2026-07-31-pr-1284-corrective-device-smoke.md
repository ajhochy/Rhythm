---
date: 2026-07-31
repo: Rhythm
branch: codex/mobile-fixes-rollup
pr: 1284
issues: [1285]
status: corrective-verification-passed
tags: [run, Rhythm]
---

# PR #1284 corrective device-smoke fixes

## Files

- Made the Agents overflow vertically scrollable inside the physical device's
  safe area.
- Moved exact-owner projectless desktop human-chat discovery to an
  authoritative database catalog and allowed transcript reads through the
  session's server-recorded `cwd`.
- Kept owner matching strict and verified that a second owner's projectless
  session remains inaccessible.
- Bounded initial message requests to 20 and reused the loaded page for diff
  derivation instead of downloading the full transcript twice.
- Added focused mobile, API, and live behavioral regressions.

## Checks

- `npm test -- --runInBand tests/chat/agents-overflow.test.tsx tests/session-service.test.ts tests/session-discovery.test.ts` — passed 3 suites / 4 tests.
- `npm run typecheck` in `apps/mobile` — passed.
- Targeted ESLint for changed mobile files — passed.
- `npx vitest run src/__tests__/issue_1285_mobile_chat_discovery.test.ts` — passed 3/3.
- `npx vitest run src/__tests__/issue_1169_mobile_opencode_proxy.test.ts -t 'bounds transcript pages'` — passed 1/1.
- `npm run build` in `apps/api_server` — passed.
- `node --test apps/mobile/tests/contract/issue-1285-device-parity.test.mjs` — passed 6/6.
- Isolated sandbox live test with `RHYTHM_LIVE_E2E=1` against API 4698 and
  engine 4697 — passed 1/1, including projectless exact-owner transcript access
  and cross-owner HTTP 404. The sandbox was stopped and removed afterward.
- `ai-workflow checks --level pr` — passed every configured Flutter, API, MCP,
  fork, mobile static/contract/fake-server, and mobile web E2E stage.

## Notes

- The real failing transcript was approximately 8.95 MB, over the gateway's
  8 MB response cap. The corrected initial load requests only the newest 20
  messages.
- Projectless does not mean ownerless or directoryless. The authorization rule
  is exact owner plus the authoritative desktop catalog row; the gateway never
  accepts a phone-provided directory for this fallback.
- The first physical-device smoke failure is recorded in `smoke-test.md` and
  `.agent-stack/postmortems/2026-07-31-pr-1284-mobile-corrective-device-smoke.json`.
- A second physical-iPhone smoke is still required after installing the new PR
  build.

## Second smoke divergence and repair

- The second physical pass could list projectless desktop chats but the atomic
  opener reported the target missing from the selected project before loading
  transcript data.
- The prior contract covered classification and direct gateway message reads,
  not the mobile discovery → tap/open path. A new #1285 c7 contract first
  reproduced `missing-session`, then passed after the opener gained an
  exact-owner catalog fallback.
- Direct `GET /session/:id` remains intentionally unavailable to mobile. The
  fallback uses the existing approved owner-unscoped catalog with an exact
  session-ID filter, then loads bounded messages/todos through the
  authoritative desktop `cwd` path.
- Final focused verification passed: atomic opener 11/11, mobile service Jest
  4/4, mobile typecheck, API build, and `git diff --check`.
- Rebuilt isolated API/fork live behavior passed 1/1 for exact-owner lookup,
  messages, todos, and cross-owner exclusion. The final rerun used API 4698 and
  engine 4697 with fresh throwaway approval credentials and passed in 3.25
  seconds; the sandbox was then removed.
- A repository-wide PR-gate rerun exposed an unrelated pre-existing real-server
  test-harness timeout in issue #653/#674 contract files. The failure moves
  between old files and reproduces as a `beforeEach`/teardown timeout when those
  files are run alone; the feature-specific checks and live sandbox remain
  green. This is classified out of scope for the transcript-opening repair.
- GitNexus final change detection reports LOW risk: 13 source/test files, 21
  symbols, and zero affected indexed processes.
- Commit/push, GitHub CI, and a third physical-device smoke remain pending.
