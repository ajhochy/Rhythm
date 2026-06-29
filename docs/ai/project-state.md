# Project State

## Current focus

Nine open pull requests are consolidated on
`codex/mega-open-prs-2026-06-28` for one full-stack local smoke.

## Active branch / PR

- Integration branch: `codex/mega-open-prs-2026-06-28`, based on current
  `origin/main`.
- Included source PRs: #754, #757, #758, #790, #799, #800, #809, #810, and
  #811.
- Mega PR: pending.

## In progress

- Commit the integration-only #808 smoke correction.
- Push and open one draft mega PR against `main`.
- Relaunch the rebuilt debug app with the rebuilt API source and staged fork
  engine for human smoke.

## Risks / known issues

- #758 is defense-in-depth; the bundled-fork event-stream regression remains a
  separate concern tracked by #759.
- Source PRs remain open until the mega PR is created and can supersede them.
- `npm install` reports 12 dependency audit findings (1 low, 8 moderate, 3
  high); no dependency versions were changed in this integration run.

## Test status

- All nine source PR heads are ancestors of the integration branch.
- `ai-workflow checks --level issue`: pass.
- `ai-workflow checks --level pr`: pass.
- api_server TypeScript production build: pass.
- Flutter debug macOS build: pass.
- Fork engine build: pass; version
  `0.0.0-codex/mega-open-prs-2026-06-28-202606290201`.
- Memory vault authority drop/rebuild smoke: pass after correcting its stale
  vault-relative path assertion.
- MCP allowlist, skill allowlist, MCP alignment, and skill alignment built-fork
  smokes: pass.
- GitNexus compare against `main`: MEDIUM risk, 121 files / 531 symbols, one
  affected execution flow.

## Next step

Open the mega draft PR, close the superseded source PRs, relaunch the rebuilt
app, and hand off the manual smoke checklist.
