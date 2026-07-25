---
date: 2026-07-25
repo: Rhythm
branch: codex/1137-any-file-reader-discovery
pr: null
issues: [1137]
status: verified
tags: [run, Rhythm]
---

# Issue #1137 — attach any file and discover a reader

## Files

- Removed file-type gates from the shipping Flutter composer and fork web
  picker.
- Kept provider-readable images/PDFs and inline text on their existing paths;
  all other binaries now remain local `file:` references.
- Changed the fork prompt pipeline to actually run Read for arbitrary local
  binaries. When Read reports an unsupported binary, it persists an explicit
  task to inspect available skills, MCP tools/servers, then web search for a
  trusted reader while preserving the exact path/MIME/extension.
- Added real-surface Flutter, fork unit/regression, web picker, and env-gated
  live API+standalone-engine coverage.

## Checks

- `dart format . --set-exit-if-changed` — pass.
- `flutter analyze --no-fatal-infos` — pass; 273 pre-existing infos.
- Focused attachment widget/helper tests — 24/24 pass.
- `flutter test --concurrency=1` — 979/979 pass in 3m08s.
  - The first default-concurrency attempt reached 812 passing tests, then the
    Flutter compiler hit `ENOSPC`. Only reproducible dependency/build caches
    from completed worktrees were removed; the clean serial rerun passed.
- `bun test test/session/prompt.test.ts` — 55/55 pass.
- `bun test src/components/prompt-input/attachments.test.ts` — 8/8 pass.
- `bun run typecheck` in the fork app — pass.
- `npm run build` in `apps/api_server` — pass.
- GitNexus `detect-changes --scope all --repo Rhythm` — 9 files / 15 indexed
  symbols / 0 affected indexed processes / LOW aggregate risk. The prior
  symbol-level `_InputAreaState` impact was HIGH (24 importing files), so the
  complete Flutter suite was required and passed.

## Live behavioral gate

Coordinator SHA `ed6b6a587` included #1137 plus #1132's reviewed
compiled-runtime fix. The sandbox rebuilt the fork binary and API, then ran:

```text
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:5098 \
DB_PATH=/tmp/rhythm-dev-sandbox-1137-20260725/rhythm.db \
npx vitest run \
  src/__tests__/live_e2e_1137_any_file_reader_discovery.test.ts \
  --reporter=verbose
```

Result: 1/1 pass in 9.39s. A real `application/x-rhythm-fixture` local binary
was sent through `ws://127.0.0.1:5098/ws/agents`. The persisted transcript
contained the exact path, MIME, extension, available-skills path, MCP
tools/servers path, web-search fallback, and the instruction not to ignore,
reject, or guess at the file.

The first invocation failed before setup with `ECONNREFUSED`: the sandbox
launcher reached health and its detached process was reaped when the tool shell
exited. The same built API was relaunched in the foreground on the same isolated
DB/ports; the exact test then passed. This is recorded as a harness lifecycle
issue, not hidden as a successful first attempt.

Cleanup assertions:

- `agent_configs WHERE id LIKE 'live1137reader%'` = 0.
- `agent_sessions WHERE name LIKE 'Live 1137 reader %'` = 0.
- no `rhythm-live-1137-*` scratch directory remained.
- sandbox directory removed; ports 5098/5097 had no listeners.

## Notes

- Contract `docs/ai/contracts/issue-1137.json`: c1-c2 pass,
  `not_tested: []`.
- No production database or installed app port was touched.

## Independent review correction

The initial `verified` verdict above was invalidated by independent review.
The first gate proved only that picker filters were empty and that a synthetic
instruction was persisted. It missed two real defects:

- the fork browser consumer still rejected arbitrary binaries after selection;
- Flutter binary `@` mentions skipped the content proxy's `containsReal`
  validation and constructed a path from `cwd + relPath`.

The corrective slice was built regression-first:

- `createPromptAttachments` now consumes arbitrary browser binaries; the
  engine materializes them mode `0600`, runs the real Read path, surfaces
  permission-filtered matching skill/MCP candidates, and deletes temporary
  attachment directories when their session is removed;
- Electron native selection uses unrestricted native paths;
- Flutter native classification samples only 4 KB before deciding to use a
  local reference, reports read errors, and has direct picker-channel coverage;
- Flutter `@` mentions always call the contained file proxy and accept only its
  canonical `resolvedPath`; traversal-shaped results create no prompt part;
- the live test now covers a native path, a browser data URL, an actually
  installed `rhythmfixture-reader` skill surfaced in the transcript, and an
  external symlink rejected before the WebSocket prompt.

Corrective pre-integration checks:

- fork app picker/request tests: 21/21 pass; app typecheck pass;
- fork prompt suite: 56/56 pass; binary data/cleanup and data-URL tests pass;
- API file proxy: 10/10 pass;
- Flutter focused attachment/mention suite: 32/32 pass;
- Flutter format and analyze: pass, 273 pre-existing infos.

The old issue worktree's aggregate API/fork typechecks use shared dependencies
whose workspace links target the coordinator and therefore report known
cross-worktree type identities plus pre-#1161 `ws_gateway` errors. The
authoritative built/type/live gate must run after this corrective commit lands
on the coordinator's reviewed dependency lineage.
