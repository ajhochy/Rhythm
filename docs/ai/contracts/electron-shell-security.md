# Slice 5 Electron shell security contract

**Date:** 2026-08-14
**Test command:** `npm test` (from `apps/electron`)

| ID | Criterion | Test | Current status |
| --- | --- | --- | --- |
| slice-5-c1 | The standalone shell consumes only `../web/dist`, without a renderer copy. | `electron-shell.test.mjs` local asset test | pass |
| slice-5-c2 | `rhythm://app` accepts only safe local GET assets and rejects traversal, unknown hosts, missing assets, unsupported methods, and malformed paths. | `electron-shell.test.mjs` protocol policy test | pass |
| slice-5-c3 | Electron registers `rhythm` before ready and loads `rhythm://app/index.html#/agents` with hardened BrowserWindow options. | `electron-shell.test.mjs` actual launch test | pass |
| slice-5-c4 | Preload publishes only a frozen, versioned lifecycle metadata object; Node and generic capabilities remain unavailable. | `electron-shell.test.mjs` actual preload test | pass |
| slice-5-c5 | Navigation, popups, permissions, downloads, malformed protocol requests, and missing `web/dist` fail closed. | `electron-shell.test.mjs` actual launch and policy tests | pass |

Manual smoke target: the actual launch records screenshot dimensions and SHA-256 when the display environment permits capture. No packaged artifact is claimed.

## Continuation evidence

The interrupted slice already contained its contract tests and implementation. No recorded red-test transcript was present, and the existing tests were green on inspection; no red result is fabricated. The continuation reran the unchanged contract command after rebuilding `apps/web`, and all five criteria passed. See `docs/ai/runs/2026-08-14-electron-m1-shell.md`.
