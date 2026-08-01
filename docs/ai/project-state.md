# Project State

## Current focus

Issue #1285 bidirectional synchronization for exact-owner projectless desktop
chats. Mobile-originated turns already converge to desktop; the c21 correction
allows matching desktop-originated engine events to refresh an open mobile chat.

## Active branch / PR

- Branch: `codex/mobile-fixes-rollup`
- Base: `origin/codex/fix-session-isolation-runtime-performance`
- PR: [#1284](https://github.com/ajhochy/Rhythm/pull/1284) (draft)
- Current pushed commit: `786c404d7337774c5aa2bbba451d5a9cfc29ebaf`; the c21 corrective delta is local pending commit/push.
- Merge remains a manual human action after review and physical-device smoke.

## In progress

- Commit and push c21, then restart only the existing PR desktop app/API.
- Re-smoke a desktop-authored message in the already-open projectless mobile chat and confirm it appears without manual refresh.

## Risks / known issues

- The exact-owner and selected-project-or-projectless checks remain strict; the SSE exception additionally requires the event directory to canonicalize to the catalog session's stored working directory.
- Branch-vs-`main` GitNexus scope is CRITICAL because this integration rollup already contains 1,206 files; the c21 unstaged delta itself is LOW risk (six files, two indexed symbols, no additional affected processes).
- Push Mobile CI passed on commit `786c404d7`; the duplicate PR-triggered Mobile CI remains flaky across unrelated legacy Playwright cases.
- User-owned `.proof/` image modifications remain excluded from commits.

## Test status

- c21 deterministic SSE regression: PASS; projectless exact-owner event delivered, directory pseudonymized, other-owner event denied.
- Focused realtime/security/API set: PASS, 3 files / 21 tests.
- API build: PASS.
- Fresh fork standalone build and binary smoke: PASS.
- Isolated live API + fork c21 test: PASS, 1/1 in 3.31 seconds; raw engine and authenticated mobile gateway delivered the same projectless desktop transcript marker.
- `ai-workflow checks --level issue`: PASS.
- `ai-workflow checks --level pr`: PASS across Flutter, API, MCP, fork, mobile static/contracts/fake-server, and mobile web E2E.
- Running desktop API `/health` and `/opencode/health`: HTTP 200 with `ok` / `ready`.

## Next step

Commit/push the c21 correction, restart the existing PR desktop app/API, reload the
already-installed dev client through Metro, and repeat the physical-iPhone
desktop-to-mobile live-update smoke without installing another app.
