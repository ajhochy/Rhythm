# Project State

## Current focus

Scheduled agent tasks can now bind to canonical Rhythm agent profiles through
the MCP create tool. Rhythm's projected workflow-orchestrator instructions are
also self-safe and grant file creation.

## Active branch / PR

- Branch: `main`
- PR: none; published directly to `main` by explicit user request.

## In progress

- Implementation and verification are complete locally.
- No live SQLite database was edited directly and no existing scheduled task
  was deleted.

## Risks / known issues

- Branch-vs-main GitNexus comparison is CRITICAL because this long-lived branch
  already contains 236 changed files; this working-tree change set itself is
  LOW risk with no affected execution flows.
- Rhythm intentionally owns its projected agent-file normalization separately
  from the external agent-stack repository.

## Test status

- MCP server: typecheck; 68/68 tests passed.
- api_server: typecheck; 2398 passed, 1 skipped.
- `ai-workflow checks --level issue` and `--level pr`: passed.
- Smoke: isolated create → trigger-now → list retained
  `AI-Trend-Researcher`; live `/health`, `/opencode/health`, and
  `/agents/capabilities` returned healthy after runtime restoration.
- GitNexus `detect_changes --scope all`: LOW risk, 0 affected processes.

## Next step

The next release will include the scheduled-profile and Rhythm agent-writer
changes from `main`.
