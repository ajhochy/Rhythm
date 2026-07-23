---
date: 2026-07-15
repo: Rhythm
branch: feat/1093-hybrid-engraph-memory-retrieval
pr: 1095
issues: [1093]
status: complete
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Disable Engraph for agent profiles

## Files and profiles changed

- `~/.config/opencode/opencode.json` — retained the read-only Engraph definition but set `mcp.engraph.enabled` to `false`.
- Removed `engraph` from MCP allowlists for `coding-agent`, `failure-triage`, `planning-agent`, `secretary`, `theologian`, and `Theological-Researcher`.
- Removed stale Engraph usage instructions from `secretary`, `theologian`, `Theological-Researcher`, `AI-Trend-Researcher`, `librarian`, and disabled `research` profile prompts.
- Resynced all affected projected OpenCode agent files through Rhythm's REST API; no generated files were edited directly.

## Checks run

- Live profile query returned zero MCP allowlists containing `engraph`.
- Live profile query returned zero system prompts containing `engraph`.
- Checked enabled profiles with unrestricted MCP scope and found four CLI profiles (`claude-code`, `codex`, `gemini-cli`, `opencode`); global disable prevents those profiles from inheriting Engraph.
- `jq empty ~/.config/opencode/opencode.json` — passed.
- `POST /system/refresh` — refreshed skills and agent profiles after profile updates.

## Notes

- Existing sessions may retain already-loaded MCP configuration. Start a new session after restarting Rhythm/OpenCode for the global `enabled: false` setting to apply.
- Engraph remains installed and configured read-only for easy re-enablement after persistent HTTP memory-query latency meets the p95 ≤1s requirement.
- No other MCP grants, skills, permissions, delegates, models, picker visibility, application source, merge authority, or deploy authority changed.
