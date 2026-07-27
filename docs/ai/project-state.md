# Project State

## Current focus

Prepare the post-`v0.18.51` release train by landing the bundled SQLite smoke
regression guard before the already-verified feature PRs.

## Active branch / PR

- Branch: `codex/fix-desktop-release-sqlite-smoke`.
- Draft PR: [#1185](https://github.com/ajhochy/Rhythm/pull/1185).
- Queued after it: #1203, #1204, and #1205.
- WIP PR #1165 is excluded because it is explicitly unfinished and conflicted.

## In progress

- Main has been merged into #1185; the only conflict was this canonical state
  snapshot.
- Rerun the release-smoke parity test and Server CI on the updated head.
- Merge release-safe PRs sequentially, then dispatch the next desktop patch
  release from the final main commit.

## Risks / known issues

- The host Flutter SDK remains older than the current dependency requirement;
  GitHub release runners install current stable Flutter and are authoritative.
- API image publication updates GHCR only; Synology deployment remains a
  separate manual pull and compose restart.
- Human post-release verification remains required for the signed macOS build.

## Test status

- Previous #1185 Server CI: PASS.
- Desktop release `v0.18.51`: PASS, including packaged SQLite smoke, signing,
  notarization, upload, and publication.
- #1203 live Quick Add rollover gate: PASS.
- #1204 sandbox behavioral gate and Server CI: PASS.
- #1205 full API/MCP/live sandbox gates and required CI: PASS.
- Updated #1185 head checks: pending.

## Next step

Validate and merge #1185, then revalidate and merge #1203, #1204, and #1205.
Trigger the next desktop patch release only from the resulting main commit.
