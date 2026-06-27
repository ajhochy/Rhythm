---
date: 2026-06-26
repo: Rhythm
branch: workflow/run-2026-06-25-agent-fixes
pr: 749
issues: [734, 749]
status: analysis-complete
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Skill progression map

Reviewed recent PRs, run logs, and postmortems to identify the next skills worth
deepening based on repeated failure modes and review pressure.

## Files

- `docs/ai/project-state.md`
- `docs/ai/runs/2026-06-26-skill-progression-map.md`
- `$CODEX_HOME/automations/skill-progression-map/memory.md`

## Checks

- `git log --oneline --decorate -n 12`
- `gh pr list --state all --limit 8 --json ...`
- `gh pr view 749 --json ...`
- `gh pr view 734 --json ...`
- Reviewed recent `.agent-stack/postmortems/*.json`
- Reviewed `docs/ai/project-state.md`

## Notes

- The strongest recurring patterns were verification gaps at real runtime
  boundaries, workflow-boundary violations by coding subagents, and production
  environment drift (especially Postgres and packaged runtime behavior).
- PR #749 had no external review comments yet, so the evidence base came mostly
  from PR scope plus the run postmortems attached to the same work.
