---
date: 2026-07-24
repo: Rhythm
branch: codex/1132-fork-sdk
pr: null
issues: [1132]
status: verified
tags: [run, Rhythm]
---

# #1132 — complete fork-generated SDK

## Files

- Added `apps/opencode_fork/packages/sdk/js/src/rhythm.ts` as a zero-shape
  compatibility layer over generated legacy/v2 types.
- Added `bun run build:rhythm`, which regenerates the SDK and materializes the
  complete installable artifact at
  `apps/api_server/vendor/opencode-ai-sdk`.
- Switched `api_server` to the vendored `file:` dependency and deleted the
  hand-written ambient `opencode-ai-sdk.d.ts`.
- Converted session MCP/skill allowlist updates plus skill/config reload from
  raw `fetch` calls to generated v2 client methods.
- Updated Docker and macOS release packaging to carry the vendored package.
- Added contract/type tests and a gated live built-engine event smoke.

## Checks

- Initial acceptance contract: 5/5 static criteria failed before
  implementation (vendor package/build command absent, ambient declaration
  present, four fetch shims present).
- `bun run build:rhythm`: PASS; second rebuild produced identical SHA-256
  checksums for the spec, generated v2 files, and all 81 vendor files.
- SDK `bun run typecheck`: PASS.
- Generated artifact/API target suite: PASS, 119 tests.
- API `tsc --noEmit`: PASS.
- API `npm run lint`: PASS.
- API `npm run build`: PASS.
- API full Vitest: PASS, 360 files / 3,184 tests; 31 files / 50 tests skipped.
- API `npm ci --workspaces=false`: PASS from a clean dependency tree.
- API Docker build through the `build` target: PASS, including vendored SDK
  install and TypeScript compilation.
- Fork standalone binary: PASS;
  `bun run build --single` produced a binary whose `--version` smoke passed.
- Independent compiled-runtime review found and fixed a cross-issue #1133
  blocker: Bun's split standalone build omitted the late
  `AppFileSystem.containsReal` namespace member, so a real `bash` call failed
  with `containsReal is not a function` before permission evaluation. The core
  module now exposes a concrete named binding and compiled consumers use it.
- Fork containment suites after that fix: PASS, 32 core tests + 18 opencode
  path-traversal tests. Core typecheck: PASS.
- Fork session suite: 364 pass, 4 skip, 1 todo, 2 fail. Both failures are in
  untouched base tests (`prompt.test.ts` interrupted-bash timing and
  `snapshot-tool-race.test.ts` snapshot timing).
- Fork-wide typecheck: BLOCKED by one untouched base error:
  `GlobalBusEmitter.emit` has an incompatible override signature. The three
  prior `AppFileSystem.containsReal` errors are resolved.
- `git diff --check`: PASS.
- Workflow YAML parse: PASS.
- GitNexus `detect_changes(scope=all)`: LOW risk, 23 indexed files / 40
  symbols, zero affected execution flows. The required compare-to-main scan
  reported MEDIUM because current `main` moved beyond this worktree base and
  included 106 unrelated files.
- Independent API verification after the live-test hardening: PASS —
  `npm run lint`, `tsc --noEmit`, targeted 119-test suite, and
  `npm run build`.
- Live smoke: PASS, 1 test in 11.32s against the rebuilt fork
  `0.0.0-codex/1132-fork-sdk-202607250738` and built API on isolated
  `:4998`/`:4997`:
  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4998 DB_PATH=/tmp/rhythm-dev-sandbox-1132-review-20260725/rhythm.db npx vitest run src/__tests__/live_e2e_1132_built_sdk_events.test.ts --reporter=verbose`.
  Observable assertions covered `question.asked`, reply/reject HTTP 204,
  both `question.resolved` outcomes, reply-session message deltas,
  `permission.asked`, deny HTTP 204, `permission.resolved`, and idle
  completion.

## Notes

- The generated-SDK implementation does not change engine semantics. The
  independent live gate added the minimum compiled-binding repair needed to
  preserve #1133's existing realpath containment semantics in the standalone
  binary.
- The prior interim declaration decision is marked superseded. The canonical
  fork vendoring decision now documents the one-command rebuild.
- The first live fixture used a `#1132 ...` label, exposing the pre-existing
  #1134 YAML quoting bug (`description: #...` parses as null). The final
  fixture uses a YAML-safe label; #1134 must be integrated before the combined
  smoke so arbitrary user labels remain safe.
- The original live fixture also projected a custom agent without binding
  `ocAgent`, which silently exercised built-in `build` permissions. The final
  test binds `ocAgent` to the projected profile and fails immediately if the
  compiled binary returns a bash tool error before the permission event.
- Acceptance criteria 1–6 are recorded `pass`; `not_tested` is empty.
