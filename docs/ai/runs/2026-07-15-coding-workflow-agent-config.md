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

# Coding workflow agent configuration

## Files changed

- `~/.config/opencode/skills/workflow-orchestrator/SKILL.md` — added async delegation, single-owner repair loops, handoff continuity, loop budget, and ownership checks.
- `~/.config/opencode/skills/coding-agent/SKILL.md` — added focused repair ownership, real dependency/live-test contracts, run-note sequencing, and diff ownership checks.
- `~/.config/opencode/skills/planning-agent/SKILL.md` — added real dependency and live-test lifecycle requirements, including isolated Engraph testing.
- `~/.config/opencode/skills/failure-triage/SKILL.md` — narrowed triage use and added failure classification and loop limits.
- `~/.config/opencode/skills/verification-gate/SKILL.md` — added entry prerequisites, consolidated failure reporting, and production-code-only full reruns.
- `~/.config/opencode/skills/project-state-updater/SKILL.md` — aligned updates with pre-verification run notes and docs-only PR status follow-ups.
- `~/.config/opencode/opencode.json` — removed retired/nonexistent skill paths while preserving global `RULES.md` instructions.
- Rhythm `coding-agent` profile — updated through the REST API and resynced; routine cross-repo work is non-interactive while destructive/remote commands remain denied.

## Checks run

- `jq empty ~/.config/opencode/opencode.json` — passed.
- UTF-8 Ruby YAML parsing for all six modified skills and the projected `coding-agent.md` — passed.
- `POST /agent-configs/coding-agent/resync-agent-file` — succeeded.
- `POST /system/refresh` — refreshed skills and agent profiles.
- Live API inspection confirmed MCP scope, skill grants, delegates, and model were unchanged.

## Notes

- A scalar `external_directory: allow` initially collided with existing nested projection data and produced invalid YAML. Replaced it with `external_directory: {"*": "allow"}`, resynced, and revalidated.
- Cross-repository access is necessary because coding-workflow agents operate outside Rhythm. Exact file/process ownership is enforced in dispatch instructions and checked with `git diff --name-only`; static permissions continue to deny push, merge, branch-changing/destructive Git operations, PR/issue creation, `sudo`, and direct recursive deletion.
- Engraph semantic retrieval remains blocked for prompt use until persistent HTTP memory queries meet p95 ≤1s.
- No Rhythm application source, dependency files, database rows, MCP scope, skill grants, model assignments, merge permissions, or deploy permissions changed.
