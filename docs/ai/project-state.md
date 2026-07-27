# Project State

## Current focus

Land issue #1186's live-verified automation-stable foreground sandbox as the
third change in the post-`v0.18.51` release train.

## Active branch / PR

- Branch: `codex/1186-sandbox-foreground`.
- PR: [#1204](https://github.com/ajhochy/Rhythm/pull/1204).
- Release guard #1185 and Quick Add fix #1203 are merged.
- Queued after it: #1205.
- WIP PR #1165 is excluded because it is explicitly unfinished and conflicted.

## In progress

- Main is merged into #1204; the only conflict was this canonical state
  snapshot.
- Revalidate the focused sandbox process behavior and GitHub checks.
- Dispatch the next desktop patch release after #1205 reaches main.

## Risks / known issues

- Fixed sandbox ports `:4097/:4098` remain a serialized local test resource.
- GitNexus does not index the Bash lifecycle functions; focused process and real
  lifecycle tests cover the behavior.
- The host Flutter SDK is older than the current desktop dependency
  requirement; GitHub release runners install current stable Flutter.
- API image publication updates GHCR only; Synology deployment remains a
  separate manual pull and compose restart.
- Human post-release verification remains required for the signed macOS build.

## Test status

- #1185 focused release-smoke parity test: PASS, 9/9; merged.
- #1203 focused rollover suite after main merge: PASS, 3 tests with the gated
  live test skipped; prior live isolated sandbox gate PASS; merged.
- #1204 Bash syntax and focused process suite: PASS, 7/7.
- #1204 full API suite: PASS, 3,252 tests passed and 57 skipped.
- #1204 live foreground/orphan lifecycle: PASS, 1/1 against the real sandbox.
- #1204 previous Server CI: PASS.
- #1205 full API/MCP/live sandbox gates and required CI: PASS.

## Next step

Merge #1204 after its updated-head checks, then revalidate and merge #1205.
Trigger the next desktop patch release only from the resulting main commit.
