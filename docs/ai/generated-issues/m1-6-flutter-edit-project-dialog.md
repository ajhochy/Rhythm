# M1-6 — Flutter: edit-project dialog + new-project flow

**Milestone:** M1 — Sessions ↔ Projects
**Branch:** `m1-projects`
**Depends on:** M1-4

## Summary

Add a dialog used for both creating a new project (triggered by the `+` button on the rail in M1-5) and editing an existing one (triggered by long-press / context-menu on a project icon). The dialog has fields for name, cwd (folder picker), and icon (emoji or color). On save, the server auto-probes VCS; the dialog displays the detected branch (or "no git") as a confirmation line before closing.

## Motivation

Without this dialog, the rail's `+` button in M1-5 is a no-op and users can't create projects from the UI. This issue also handles edit (name / cwd / icon) and archive, completing the project-management surface for M1.

## Likely files

- `apps/desktop_flutter/lib/features/agent_projects/views/edit_project_dialog.dart` — **NEW** (same package as M1-4's controller)
- `apps/desktop_flutter/lib/features/agents/views/_projects_rail.dart` — wire `+` button to open the dialog in create mode; wire context-menu on rail items to open in edit mode
- `apps/desktop_flutter/pubspec.yaml` — add `file_picker: ^X.Y` if not already present (folder selection); `emoji_picker_flutter` is optional, fall back to a `TextField` for emoji
- `apps/desktop_flutter/test/features/agent_projects/edit_project_dialog_test.dart` — **NEW** (widget test)

## Dialog

```
┌──────────────────────────────────────────┐
│ New project                          [×] │
├──────────────────────────────────────────┤
│ Name        [_______________________]    │
│ Folder      [/Users/.../Rhythm] [Pick…]  │
│ Icon        [🛠] [Pick…]                 │
│                                          │
│ ── (after save attempt) ─────────────    │
│ ✓ Detected git branch: main              │
│   (or: ⓘ No git repository at this path) │
│                                          │
│            [Cancel]  [Save]              │
└──────────────────────────────────────────┘
```

- **Name** required (`> 0` chars after trim).
- **Folder** required. "Pick…" launches the native folder picker via `file_picker`'s `getDirectoryPath()`. Path is shown as absolute; manual edit allowed.
- **Icon** optional. Default is a generic 📁. Stored as either an emoji codepoint or `#RRGGBB`. Minimal UI: a text field accepting one grapheme cluster, with a color-swatch fallback button if no emoji entered.
- **Save** disabled until name + folder both non-empty.
- After Save, the dialog stays open for 800ms displaying the server's VCS detection result (read from the response's `vcsBranch` / `vcsRoot`), then closes. If the server returns an error, the dialog stays open with an inline red error and re-enables Save.
- **Edit mode** pre-fills all fields and shows an extra **Archive** button bottom-left.
- **Cancel** closes without committing.

## Acceptance criteria

1. New-project flow: `+` button on the rail opens the dialog blank; Save creates the project, shows the VCS confirmation line, closes, and the new project appears in the rail.
2. Edit-project flow: long-press (or right-click) on a rail icon opens the dialog pre-filled; Save updates and the rail re-renders.
3. Archive button in edit mode calls `AgentProjectsController.archive(id)` and closes the dialog; the project disappears from the rail.
4. Folder picker writes the selected absolute path into the Folder field.
5. Save is disabled while either name or folder is empty.
6. Server error (e.g. relative path 400) renders inline; dialog stays open; user can correct and retry.
7. After successful save of a git folder, the VCS confirmation line reads `Detected git branch: <branch>`.
8. After successful save of a non-git folder, the VCS confirmation line reads `No git repository at this path`.
9. `flutter analyze --no-fatal-infos` clean.
10. `dart format --set-exit-if-changed` clean.
11. `flutter test` passes; new widget tests included.
12. `ai-workflow checks --level pr` exits 0.

## Required tests (`edit_project_dialog_test.dart`)

Mock `AgentProjectsController`:
- Renders with empty fields in create mode.
- Renders pre-filled in edit mode.
- Save button disabled when name empty.
- Save button disabled when folder empty.
- Tapping Save in create mode calls `controller.create(...)` with the entered values.
- Tapping Save in edit mode calls `controller.update(id, ...)`.
- Server-returned VCS confirmation line renders for both git and non-git responses.
- Inline server error renders when controller throws.
- Archive button (edit mode only) calls `controller.archive(id)`.

## Data safety / out of scope

- Folder picker MUST NOT remember the previously-picked path inside the app — let the OS handle that. No new shared_preferences keys for it.
- Do NOT auto-create a session inside the new project on save — that's a user action, not a side effect of project creation.
- Do NOT validate that the chosen folder exists on disk in the dialog — server returns 400 if needed; client trusts the picker.
- Emoji picker is optional and out of scope. If `emoji_picker_flutter` is not already in `pubspec.yaml`, ship with a plain text field for icon entry and a small color-swatch fallback. Adding a full emoji picker is a follow-up.
- Do NOT add multi-project bulk operations.
- Theme tokens only — no hex literals.

## Notes

- `file_picker` is widely used in the Flutter desktop ecosystem; check if it's already a transitive dep before adding. If not present, this is a small new dep — minimal blast radius.
- The 800ms confirmation pause is intentional UX, not a server delay. Done with a `Future.delayed` after `notifyListeners` returns.
- Reference: Opencode Desktop `packages/app/src/components/dialog-edit-project.tsx`.
