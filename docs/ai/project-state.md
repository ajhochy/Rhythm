# Project State

## Current focus

Land the live-verified MEM-OKF memory format, lifecycle, trust, provenance,
navigation, links, and audit-history work for issues #1187–#1196, then release.

## Active branch / PR

- Branch: `codex/mem-okf`.
- PR: [#1205](https://github.com/ajhochy/Rhythm/pull/1205).
- Release guard #1185, Quick Add fix #1203, and sandbox fix #1204 are merged.
- WIP PR #1165 is excluded because it is explicitly unfinished and conflicted.

## In progress

- Main is merged into #1205; the only conflict was this canonical state
  snapshot.
- Revalidate the integrated API/MCP gates and required GitHub checks on the
  exact updated head.
- Dispatch the next desktop patch release from the resulting main commit.

## Risks / known issues

- `buildMemoryPreface` and the audit enqueue path have broad upstream blast
  radii; targeted, full-memory, full-API, and live sandbox gates passed.
- Mechanical consolidation/revert has no public HTTP, WebSocket, or MCP trigger,
  so those behaviors are real-filesystem/SQLite integration-tested.
- The host Flutter SDK is older than the current desktop dependency
  requirement; GitHub release runners install current stable Flutter.
- API image publication updates GHCR only; Synology deployment remains a
  separate manual pull and compose restart.
- Human post-release verification remains required for the signed macOS build.

## Test status

- #1185 focused release-smoke parity test: PASS, 9/9; merged.
- #1203 focused updated-head rollover suite: PASS; prior live sandbox PASS;
  merged.
- #1204 focused updated-head process suite: PASS, 7/7; fresh Server CI PASS;
  merged.
- #1205 API TypeScript build/typecheck: PASS.
- #1205 updated-head full API suite: PASS, 3,388 tests; MCP: PASS, 101 tests.
- #1205 combined live sandbox: PASS three times, 5/5 through real HTTP, WebSocket,
  built MCP stdio, copied SQLite, sandbox vault, and fork engine.
- #1205 previous required GitHub CI: PASS.

## Next step

Merge #1205 after its exact updated-head local and GitHub gates, then trigger
and monitor the next desktop patch release from final `main`.
