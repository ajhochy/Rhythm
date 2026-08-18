# Slice 7 Electron unsigned macOS package contract

**Date:** 2026-08-15
**Test command:** `node --test test/electron-unsigned-package.test.mjs` (from `apps/electron`)
**Package command reserved by this contract:** `npm run package:mac` (from `apps/electron`)
**Artifact reserved by this contract:** `apps/electron/dist/Rhythm.app`

| ID | Criterion | Test | Current status |
| --- | --- | --- | --- |
| slice-7-c1 | One repeatable command produces an unsigned macOS `.app` without Developer ID signing, notarization, or Apple credentials. | Package-script invocation and bundle/binary assertions | pending (RED) |
| slice-7-c2 | Every packaged web asset byte-matches `apps/web/dist` by relative path and SHA-256. | Source/package per-file hash manifest equality | pending (RED) |
| slice-7-c3 | The packaged binary registers `rhythm` before ready and loads the agents route with Slice 5's hardened BrowserWindow options. | Packaged-binary smoke receipt | pending (RED) |
| slice-7-c4 | The packaged app reaches `Live` against sandbox ports 4098/4097 and observes HTTP 200 from a real sessions/tasks gateway read without fixture fallback. | Packaged live smoke receipt | pending (RED) |
| slice-7-c5 | Renderer isolation, the frozen versioned preload surface, and every fail-closed policy hold in the packaged app. | Packaged-binary security receipt | pending (RED) |
| slice-7-c6 | Output is ignored and deterministic, and packaged smoke leaves no disposable rows, listeners, worktrees, or branches. | Git-ignore, artifact manifest, repository-state, and cleanup receipt assertions | pending (RED) |

## Test contract

The tests intentionally target the package, never `electron .` from source. The package layout is `dist/Rhythm.app`, with its executable at `Contents/MacOS/Rhythm` and the authoritative renderer at `Contents/Resources/app/web/dist`. Packaged code may live beside that renderer under `Contents/Resources/app/electron`; no second renderer tree is allowed.

The packaged smoke emits one JSON receipt on stdout. The tests require that receipt to distinguish protocol registration timing, loaded URL, effective BrowserWindow security options, preload surface, renderer Node exposure, fail-closed outcomes, selected environment, live-read URL/status/fallback, and cleanup counts. This makes the green gate observable at the packaged-binary boundary rather than by source inspection or mocks.

Before packaging exists, all six tests fail on explicit assertions naming their criterion. None skip, and missing artifacts are checked before any attempted process spawn so absence cannot become a harness-level `ENOENT` error.

## Notes for the implementing unit

- Prefer **no new dependency**. `apps/electron` currently has only `@types/node`, `electron`, and `typescript`. A minimal package script can copy `node_modules/electron/dist/Electron.app`, rename it, and place the app source plus `apps/web/dist` under `Contents/Resources/app/`. That is essentially what `electron-packager` does. Only reach for `electron-builder` or `electron-packager` if the hand-rolled path proves genuinely insufficient, and justify the dependency if so.
- Known macOS trap: copying and modifying `Electron.app` invalidates its signature, and on Apple Silicon the result will not launch until it is ad-hoc re-signed with `codesign --force --deep -s -`. “Unsigned” here means no Developer ID signature and no notarization; an ad-hoc signature is expected and allowed.
- The package command must not require, read, or infer Apple credentials. It may apply only the allowed ad-hoc signature needed to launch locally.
- The live smoke must use API `http://127.0.0.1:4098` and engine `http://127.0.0.1:4097`. It must not contact or manage ports 4001/4096, and fixture data cannot satisfy the HTTP receipt.
- The implementing unit starts by rerunning the RED command recorded in `docs/ai/runs/2026-08-15-electron-unsigned-package.md` and ends only when these unchanged tests are green.
