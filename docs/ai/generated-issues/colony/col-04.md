## Goal

Produce a concrete UI and menu design that makes Colony feel native to Rhythm Electron while retaining the 3D world and multi-harness clarity.

Parent: {{EPIC}}  
Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)  
Milestone: Colony M2 — Rhythm-native UI and menus

## Dependencies

None within this plan.

## Likely files

- docs/ai/plans/2026-09-18-electron-colony.md design brief
- Proposed docs/design/colony/ annotated comps and action inventory
- Visual references: apps/web/src/styles.css, components/Shell.tsx, Tasks and Agents workspaces
- Reference: adopted Colony HUD, task card, filters and scene/view controls

## Requirements

- Use Rhythm Tasks/Agents typography, tokens, icons, panel density, buttons, menus and resize/focus behavior as the visual authority. Preserve the world/characters; remove duplicate global chrome in embedded mode.
- Define one Colony destination; a resizable repository/task rail, central scene and optional inspector; compact search/filters/status; and a native-style View menu for camera/world/sound/quality controls.
- Map every current action to a final location, explicit deferment or removal. Use Open in Rhythm/Open in Codex, Show parent task and Archive from Colony/Restore to Colony. Do not expose unqualified new-session/terminal-resume actions.
- Define dark/light, reduced-motion, keyboard, 200% text zoom, empty/error/stale/disabled states and a useful list fallback without WebGL.

## Acceptance criteria

- [ ] **COL-04-AC1:** The design packet includes annotated 1440x900, 1024x700 and 800x600 compositions, dark/light examples, selected-task and error/empty states, and the action/menu mapping with no unexplained lost action.
- [ ] **COL-04-AC2:** A reviewer can follow enable → filter → select bot/list task → inspect → open exact task, and archive → restore, using the annotated flow without guessing control placement.
- [ ] **COL-04-AC3:** All proposed controls identify an incumbent component/token or a small shared extraction; no duplicate branded header or standalone orange action system is introduced.
- [ ] **COL-04-AC4:** Keyboard order, shortcut conflicts, menu checked/disabled states, focus return, pane bounds and the 200% text-zoom layout are specified. Any unresolved material design decision is recorded before COL-05 begins.

## Required tests / evaluation

- Review side by side with current rendered Rhythm Tasks/Agents; include representative long paths/branches and synthetic parent/worker names.
- Perform a bounded design/accessibility review of the packet; this issue does not claim rendered implementation or release qualification.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
