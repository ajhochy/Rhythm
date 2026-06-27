# A2 — Fold projects rail into "By Project" selector at top of CHATS

**Labels:** `feature`, `flutter`, `phase-a`
**Depends on:** A1

## Context

The 64px `ProjectsRail` (project icon strip) currently lives as a separate child of `_buildWorkspace`. This issue folds it into the nav column: a "By Project" dropdown selector sits at the top of the CHATS list, defaulting to "All". Selecting a project drives the existing `AgentProjectsController.select(id)` / `selectedProjectId` filter on the session list. The add-project action is preserved. The profiles section of the retired rail is NOT moved here — that goes to A5.

## Likely files

- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart`
- `apps/desktop_flutter/lib/features/agents/views/_projects_rail.dart` (remove/retire)
- `apps/desktop_flutter/lib/features/agent_projects/controllers/agent_projects_controller.dart` (reuse `select`/`selectedProjectId`)
- `apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart`

## Acceptance criteria

- [ ] `_ProjectsRail` widget is no longer rendered anywhere in the Agents screen.
- [ ] At the top of the CHATS section (below the section label, above the session list) there is a "By Project" dropdown control showing the project name or "All".
- [ ] The dropdown lists all projects from `AgentProjectsController.projects` plus an "All Sessions" option at the top.
- [ ] Selecting a project calls `AgentProjectsController.select(project.id)` and the CHATS session list filters to only that project's sessions.
- [ ] Selecting "All Sessions" calls `AgentProjectsController.select(null)` and the list shows all sessions.
- [ ] An "Add project" (＋) affordance is accessible from the CHATS area (e.g., trailing icon in the dropdown row or a small button below the dropdown).
- [ ] The profiles section previously rendered inside `_ProjectsRail` is NOT shown in this component (left for A5).
- [ ] `dart format` and `flutter analyze --no-fatal-infos` pass with zero new errors.

## Widget test requirement (real-mounted surface)

Pump the REAL mounted Agents surface:
- Assert the "By Project" selector renders.
- Simulate selecting a project and assert the session list filters accordingly.
- Simulate selecting "All Sessions" and assert the full list is restored.

## Required validation commands

```bash
cd apps/desktop_flutter && dart format . && flutter analyze --no-fatal-infos && flutter test
```

## Safety notes

- Retire `_projects_rail.dart` only — do not delete the `agent_projects` feature directory, controller, or repository.
- Do NOT move the profile-sheet entry point (A5 handles Profiles).
- No backend changes in this issue.

## Data-safety out-of-scope

No API calls, no new tables, no schema changes in this issue.
