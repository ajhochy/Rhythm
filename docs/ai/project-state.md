# Project State

## Current focus

Consolidating every open pull request into `codex/mega-open-prs-2026-06-28`
for one full-stack local smoke build.

## Active branch / PR

- Integration branch: `codex/mega-open-prs-2026-06-28`, based on current
  `origin/main`.
- Source PRs being composed: #754, #757, #758, #790, #799, #800, #809, #810,
  and #811.
- Mega PR: not opened yet.

## In progress

- Merge all source PR heads while preserving their individual commits.
- Resolve integration-only conflicts.
- Rebuild api_server, opencode fork binary, and the macOS Flutter app from the
  resulting branch.

## Risks / known issues

- #758 is defense-in-depth; the bundled-fork event-stream regression remains a
  separate concern tracked by #759.
- The combined branch touches shared API startup, schema, memory, MCP, skill,
  and Flutter surfaces, so full PR checks and live health probes are required.
- Source PRs remain open as provenance until the mega branch is reviewed.

## Test status

- Not yet run on the integration branch.

## Next step

Finish merging all nine source PRs, then run full build and smoke verification.
