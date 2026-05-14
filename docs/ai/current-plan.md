# Current Plan

## Status
No active multi-step plan. Work is currently issue-driven against the
Opencode engine migration (PR #574) and its follow-up cleanups.

## Active workstream
**Opencode engine migration** — `opencode-engine-issue-564` → PR #574 (draft).
Completed issues are listed in `docs/ai/project-state.md`. Recent follow-ups
(#575–#579) are Settings/UI cleanups stacked on the same branch.

## How to start new work
Use the global CLI:

```bash
ai-workflow status                      # context-file health, branch, dirty state
ai-workflow run --issue N[,M,...]       # packed handoff (no extra gh calls)
ai-workflow checks --level issue        # flutter analyze + dart format + tsc
ai-workflow checks --level pr           # adds vitest
ai-workflow start-issue --issue N       # dry-run branch off main
ai-workflow open-pr --title "..."       # dry-run draft PR
```

All commands delegate to `scripts/run_ai_workflow.py`. The script owns the
mechanical work; the agent handles judgment + implementation.

## When to populate this file
Update or replace this file when starting a feature, large bugfix, refactor,
workflow change, or evaluation milestone that needs decomposition into
multiple issues. For one-off issues you can leave this file as-is — the
issue body itself is the plan.
