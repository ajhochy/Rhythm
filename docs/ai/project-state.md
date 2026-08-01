# Project State

## Current focus

Issue #1285 bidirectional synchronization for exact-owner projectless desktop
chats. Mobile-originated turns converge to desktop, but desktop-originated turns
still require a mobile refresh after the c21 server-side correction.

## Active branch / PR

- Branch: `codex/mobile-fixes-rollup`
- Base: `origin/codex/fix-session-isolation-runtime-performance`
- PR: [#1284](https://github.com/ajhochy/Rhythm/pull/1284) (draft)
- Current pushed commit: `cdd0bb465` (`fix(mobile): stream projectless desktop updates`).
- Merge remains a manual human action after review and physical-device smoke.

## In progress

- Diagnose the remaining device-only gap across gateway delivery, mobile EventSource receipt, session-ID matching, refresh scheduling, and React state commit.
- Keep issue #1287 as the follow-up tracker; do not duplicate it.

## Risks / known issues

- The exact-owner and selected-project-or-projectless checks remain strict; the SSE exception additionally requires the event directory to canonicalize to the catalog session's stored working directory.
- Branch-vs-`main` GitNexus scope is CRITICAL because this integration rollup already contains 1,206 files; the c21 unstaged delta itself is LOW risk (six files, two indexed symbols, no additional affected processes).
- Push Mobile CI passed on commit `786c404d7`; the duplicate PR-triggered Mobile CI remains flaky across unrelated legacy Playwright cases.
- User-owned `.proof/` image modifications remain excluded from commits.
- The corrected server-side live test is insufficient: it proves the authenticated gateway emits a raw projectless engine event, but not that the physical mobile client consumes that event and commits refreshed transcript state.

## Test status

- c21 deterministic SSE regression: PASS; projectless exact-owner event delivered, directory pseudonymized, other-owner event denied.
- Focused realtime/security/API set: PASS, 3 files / 21 tests.
- API build: PASS.
- Fresh fork standalone build and binary smoke: PASS.
- Isolated live API + fork c21 test: PASS, 1/1 in 3.31 seconds; raw engine and authenticated mobile gateway delivered the same projectless desktop transcript marker.
- `ai-workflow checks --level issue`: PASS.
- `ai-workflow checks --level pr`: PASS across Flutter, API, MCP, fork, mobile static/contracts/fake-server, and mobile web E2E.
- Running desktop API `/health` and `/opencode/health`: HTTP 200 with `ok` / `ready`.
- Physical-iPhone retry on commit `cdd0bb465`: FAIL; the exact PR desktop app and existing Metro client were running, but desktop-authored turns still did not update the open mobile transcript live.

## Next step

Instrument a unique desktop turn end-to-end at the raw engine SSE, authenticated
gateway SSE, mobile EventSource callback, session match, refresh invocation, and
React transcript update. Reproduce on the existing physical-iPhone dev client
before changing code, then add a client-inclusive regression test.
