# M1-5 — Flutter: sidebar rail + project panel with VCS chip

**Milestone:** M1 — Sessions ↔ Projects
**Branch:** `m1-projects`
**Depends on:** M1-2, M1-4

## Summary

Replace the existing flat session list in the Agents view with a two-pane layout: a 64px **project rail** (icons stacked top-to-bottom, click to switch) and a **session panel** scoped to the selected project. Above the panel, a header chip shows the selected project's git branch and a dirty indicator (hidden for non-git projects). An "All sessions" pseudo-project at the top of the rail shows the unassigned bucket.

## Motivation

The data layer (M1-1..M1-4) is invisible until the rail exists. This is the first visible change of M1 — switching projects must filter sessions, and the VCS chip must reflect M1-1's probe so the Q1 decision (cwd + VCS in M1) is observable.

## Likely files

- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` — replace `_SessionListPanel` (or its equivalent) with the new two-pane layout
- `apps/desktop_flutter/lib/features/agents/views/_projects_rail.dart` — **NEW**
- `apps/desktop_flutter/lib/features/agents/views/_project_vcs_chip.dart` — **NEW**
- `apps/desktop_flutter/lib/features/agents/controllers/agent_sessions_controller.dart` — extend to filter `_sessions` by `projectId` (mirror server filter; query string already supported)
- `apps/desktop_flutter/lib/features/agents/data/agent_sessions_remote_data_source.dart` — accept optional `projectId` in `list(...)`
- `apps/desktop_flutter/test/features/agents/projects_rail_test.dart` — **NEW** (widget test)
- `apps/desktop_flutter/test/features/agents/project_vcs_chip_test.dart` — **NEW**

## Layout

```
┌───────┬─────────────────────────┬──────────────────────┐
│ rail  │  session panel          │  chat thread (main)  │
│ 64px  │  (≈280px, existing)     │  (existing)          │
│       │                         │                      │
│ [⭐]  │  [branch · dirty?] chip │                      │
│ ─     │  ─────                  │                      │
│ [🛠]  │  session-1              │                      │
│ [📦]  │  session-2              │                      │
│ [+]   │  session-3              │                      │
└───────┴─────────────────────────┴──────────────────────┘
```

- Rail width: 64px. Icons rendered 40×40 with 12px vertical gap. Selected item gets the `primary tint` background per the theme tokens (`Color(0x144F6AF5)`).
- First rail item is the "All sessions" pseudo-project (icon: ⭐ or similar). `selectedProjectId == null` selects it.
- Last rail item is a `+` button → opens M1-6's new-project dialog.
- Session panel only renders sessions where `session.projectId == selectedProjectId` (or all when null is selected).
- New-session button (already present) pre-fills cwd from the selected project's cwd. When "All sessions" is selected, cwd defaults to the existing fallback (current behavior, e.g. user home).

## VCS chip

`_ProjectVcsChip`:
- Hidden entirely when `project.vcsRoot == null`.
- Otherwise: rounded chip showing `<branch> · ●` where the ● is a small dirty-indicator dot (filled if `vcsDirty`, outline if clean).
- Tooltip on hover: `Branch: <branch>\nRoot: <vcsRoot>\nLast checked: <relative time from vcsCheckedAt>`.
- Tap calls `controller.refreshVcs(project.id)`; brief loading state until the response lands.

## Acceptance criteria

1. Rail renders projects from `AgentProjectsController.projects` plus the "All sessions" pseudo-entry at top and the `+` button at bottom.
2. Tapping a rail item switches `selectedProjectId` and the session panel re-filters within one frame.
3. Tapping the `+` opens the M1-6 dialog (no-op stub if M1-6 hasn't landed yet — guard with a `// TODO(M1-6)` placeholder dialog).
4. For a project pointing at a git repo, the VCS chip is visible and shows the correct branch + dirty state.
5. For a project pointing at a non-git folder, the VCS chip is NOT rendered.
6. Tapping the VCS chip calls `refreshVcs` and the chip updates without a full reload.
7. Sessions created from inside a project default to that project's cwd (visible in the create-session form).
8. Existing sessions (NULL `project_id`) appear under "All sessions" and only there.
9. `flutter analyze --no-fatal-infos` clean.
10. `dart format --set-exit-if-changed` clean.
11. `flutter test` passes; new widget tests included.
12. `ai-workflow checks --level pr` exits 0.

## Required tests

`projects_rail_test.dart`:
- Renders one icon per project plus All-sessions + `+` button.
- Tapping a project icon notifies `AgentProjectsController.select(id)` with the right id.
- Tapping the All-sessions icon calls `select(null)`.
- Selected item has the primary-tint background.

`project_vcs_chip_test.dart`:
- Hidden when `vcsRoot == null`.
- Shows branch text when `vcsRoot != null`.
- Dirty dot filled when `vcsDirty == true`.
- Tapping calls the supplied `onRefresh` callback.

Optional smoke addition to `manual-smoke.md` (extend in this PR):
- Create two projects, one git one non-git; verify chip behavior.
- Create a session in each, switch rails, verify session panel filters.

## Data safety / out of scope

- Edit / new-project dialog UI is M1-6; this issue only wires the `+` button as a no-op or placeholder.
- Do NOT migrate existing sessions to a project as part of rail-switching — they stay NULL under All-sessions.
- Do NOT add VCS-aware UI to the chat thread or session-create form beyond cwd pre-fill (that's M3 territory).
- No theme token violations — all colors via the existing theme tokens from CLAUDE.md (`primary`, `primary tint`, `card border`, etc.).

## Notes

- Reference layout from Opencode Desktop: `/tmp/opencode-ref/packages/app/src/pages/layout.tsx` — the sidebar rail + panel pattern.
- The rail uses `LayoutBuilder` for tight width; the panel is the existing list with one extra `where(p => p.projectId == selectedProjectId)` clause.
- If a session is open in the main thread when the user switches projects, do NOT close it — selecting a different project just filters the list panel. The currently-streaming session stays open until the user manually switches.
