# Project State

## Current focus

Land issue #418's verified legacy mobile Quick Add midnight rollover fix as the
second change in the post-`v0.18.51` release train.

## Active branch / PR

- Branch: `codex/418-quick-add-rollover`.
- PR: [#1203](https://github.com/ajhochy/Rhythm/pull/1203).
- Release guard #1185 is merged.
- Queued after it: #1204 and #1205.
- WIP PR #1165 is excluded because it is explicitly unfinished and conflicted.

## In progress

- Main is merged into #1203; the only conflict was this canonical state
  snapshot.
- Revalidate the focused rollover behavior, then merge sequentially.
- Dispatch the next desktop patch release from the final main commit.

## Risks / known issues

- This code is in `apps/mobile_flutter`, the legacy mobile client rather than
  the shipping desktop Flutter client.
- The host Flutter SDK is older than the current desktop dependency
  requirement. The focused legacy mobile tests pass; GitHub release runners
  install current stable Flutter.
- API image publication updates GHCR only; Synology deployment remains a
  separate manual pull and compose restart.
- Human post-release verification remains required for the signed macOS build.

## Test status

- #1185 focused release-smoke parity test: PASS, 9/9; merged.
- #1203 full mobile suite: PASS, 4 passed and 1 gated live test skipped.
- #1203 focused rollover suite: PASS, 3 passed and 1 gated live test skipped.
- #1203 live isolated sandbox: PASS, 1/1 with persisted rolled-over due date.
- #1203 formatting and API typecheck: PASS.
- #1204 sandbox behavioral gate and Server CI: PASS.
- #1205 full API/MCP/live sandbox gates and required CI: PASS.

## Next step

Merge #1203 after its updated-head checks, then revalidate and merge #1204 and
#1205. Trigger the next desktop patch release only from the resulting main
commit.
