---
date: 2026-07-24
repo: Rhythm
branch: codex/1132-fork-sdk
pr: null
issues: [1132]
status: awaiting-live-smoke
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
- Fork session suite: 364 pass, 4 skip, 1 todo, 2 fail. Both failures are in
  untouched base tests (`prompt.test.ts` interrupted-bash timing and
  `snapshot-tool-race.test.ts` snapshot timing).
- Fork-wide typecheck: BLOCKED by untouched base errors:
  `GlobalBusEmitter.emit` override plus three calls to the missing base
  `AppFileSystem.containsReal`. No #1132 engine source changed.
- `git diff --check`: PASS.
- Workflow YAML parse: PASS.
- GitNexus `detect_changes(scope=all)`: LOW risk, 23 indexed files / 40
  symbols, zero affected execution flows. The required compare-to-main scan
  reported MEDIUM because current `main` moved beyond this worktree base and
  included 106 unrelated files.
- Live smoke:
  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:<sandbox-port> DB_PATH=<temp-db> ./node_modules/.bin/vitest run src/__tests__/live_e2e_1132_built_sdk_events.test.ts`
  — pending coordinator-owned sandbox; this worktree intentionally did not
  start or stop a shared API/engine process.

## Notes

- No engine runtime behavior changed. The OpenAPI build patches only the two
  explicit-null allowlist schema properties because Effect's emitter drops the
  engine's `Schema.NullOr` object-property semantics.
- The prior interim declaration decision is marked superseded. The canonical
  fork vendoring decision now documents the one-command rebuild.
- Acceptance criteria 1–5 are recorded `pass`; criterion 6 remains `pending`
  until the coordinator executes the isolated live smoke against the built
  engine.
