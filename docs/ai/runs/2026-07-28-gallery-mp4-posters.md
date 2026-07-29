---
date: 2026-07-28
repo: Rhythm
branch: mega/gallery-1208
pr: null
issues: [1208]
status: blocked
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

## Files changed

- Added an authenticated local MP4 thumbnail route and Quick Look poster cache.
- Updated Gallery cards to preview local MP4 poster routes with the existing MP4 placeholder as the image-error fallback.
- Added API and Flutter acceptance contracts for authorization, path/type boundaries, fallback, remote-content rejection, and original artifact opening.

## Checks run

- Failing first: `npx vitest run src/__tests__/issue_1208_gallery_mp4_thumbnail.test.ts` — 3/3 failed because the thumbnail route/controller did not exist.
- `npx tsc --noEmit` — passed.
- `npx vitest run src/__tests__/issue_1208_gallery_mp4_thumbnail.test.ts` — 3 passed, 1 opt-in platform test skipped.
- `flutter analyze --no-pub --no-fatal-infos` using writable SDK/cache clones — exit 0; 272 pre-existing infos.
- `dart format` for touched Flutter files — passed.
- `git diff --check` — passed.
- `flutter test --no-pub test/features/agent_gallery/issue_1208_mp4_thumbnail_test.dart` — blocked before tests because the execution sandbox denies the runner's `127.0.0.1:0` socket.
- `ai-workflow checks --level issue` — TypeScript and format stages passed; Flutter analyze stage could not reach the pub.dev advisory endpoint.
- `npm test` — started but could not progress under the same socket-denying environment; interrupted after no test output.

## Notes

- Live sandbox command used an isolated throwaway SQLite database and API/engine ports 4121/4122. It stopped before launch because the vendored fork build reported `preload not found "@opentui/solid/preload"`.
- The opt-in real-MP4 platform test generated a valid MP4 with ffmpeg, but `/usr/bin/qlmanage` was denied by the host execution sandbox (`sandbox initialization failed: invalid data type of path filter`).
- No production endpoint, production database, ports 4000/4001, or user database were accessed.
- Remaining manual checkpoint: run the sandbox and desktop app outside this restricted execution sandbox, confirm the real poster PNG response/render, capture the Gallery screenshot, and rerun full Flutter/API suites.
