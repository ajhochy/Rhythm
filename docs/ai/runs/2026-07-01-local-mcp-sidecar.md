---
date: 2026-07-01
repo: Rhythm
branch: codex/local-mcp-sidecar
pr: 835
issues: []
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Local MCP sidecar

## Files changed

- Added a gitignored local MCP server sidecar path.
- Added a validated, fail-soft sidecar loader and runtime path override.
- Added focused loader and path-resolution tests.

## Checks run

- Focused Vitest: 6 tests passed.
- `ai-workflow checks --level pr`: pass.
- Full API Vitest: 178 files / 1,526 tests passed.
- API production TypeScript build: pass.
- Compiled-loader smoke: pass.

## Notes

- PR #812 was merged into `main` before this branch was created.
- Ollama commits remain local on `codex/local-ollama-wip-2026-07-01`.
- The actual machine-local JSON file remains untracked and may contain secrets.
