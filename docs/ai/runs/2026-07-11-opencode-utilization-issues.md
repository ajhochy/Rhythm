---
date: 2026-07-11
repo: Rhythm
branch: uso/agent-followups (no code changes — planning only)
pr: none
issues: [1042, 1043, 1044, 1045, 1046, 1047, 1048, 1049, 1050, 1051, 1052, 1053, 1054, 1055, 1056, 1057, 1058, 1059, 1060, 1061, 1062, 1063, 1064, 1065, 1066, 1067, 1068, 1069, 1070, 1071, 1072, 1073, 1074, 1075, 1076]
status: complete
tags: [run, Rhythm, planning, opencode-utilization]
index: "[[Rhythm]]"
---

# Opencode Utilization epic — milestones + 35 issues filed

Converted the 2026-07-11 opencode feature audit
(`docs/ai/runs/2026-07-11-opencode-feature-audit.md`) into a full implementation
plan and filed it on GitHub.

## Files changed

- `docs/ai/current-plan-opencode-utilization.md` (new) — epic plan: 7 milestones,
  35-issue table with dependencies + validation strategy, cross-referenced with
  real issue numbers.
- `docs/ai/generated-issues/opencode-utilization/ocu-01..35-*.md` (new, 35 files)
  — full issue bodies (summary/scope/non-goals/likely files/AC/tests/deps),
  frontmatter stamped with created issue numbers.
- `docs/ai/project-state.md` — epic recorded under Current focus + Next step.

## GitHub state created

- Milestones **#91–#97**: Interaction Polish · Playbooks · Org Skill Library ·
  Worktree Isolation · Files & VCS Context · Platform & SDK · Hygiene & Watch List.
- Issues **#1042–#1076** (OCU-01..35), each labeled `opencode-utilization` +
  `enhancement` + backend/frontend/infrastructure, assigned to its milestone,
  bodies cross-linked (`OCU-NN (#issue)`).
- New label `opencode-utilization` (#0E7490).

## Dependency spine (implementation order constraints)

- #1042 → #1043, #1044 (permission reply before UI/rehydration)
- #1050 → #1051, #1052 (commands CRUD before playbooks UI/popover)
- #1053 → #1054 → #1055; #1053 → #1056 (org skill index first)
- #1057 → #1058 → #1059 (worktree API → session option → UI)
- #1060 → #1061, #1062 (file proxy before mentions/Files tab)
- #1067 → #1068 (fork SDK regen before adoption)
- #1073 → #1074 (writer permission keys before matrix UI)
- Everything else parallel-safe.

## Notes

- Method: workflow-orchestrator → plan doc → issue-writer (4 parallel Tier-3
  writer agents, fully-specified per-issue content) → gh milestones + issues +
  cross-link pass. Remote creation explicitly requested by the user.
- Watch-list items (v2 API, workspaces/sync, share) got a tracking issue
  (#1076), not implementation issues, per audit recommendation.
- No code changed; no verification-gate applicable (planning artifact run).
