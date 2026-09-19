## Goal

Implement the approved Colony workspace inside Rhythm using existing React UI conventions and the embedded scene contract.

Parent: {{EPIC}}  
Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)  
Milestone: Colony M2 — Rhythm-native UI and menus

## Dependencies

{{COL-02}}, {{COL-04}}

## Likely files

- apps/web/src/App.tsx and components/Shell.tsx
- Proposed apps/web/src/pages/colony/
- apps/web/src/styles.css and reusable pane/menu components where necessary
- apps/colony/src/main.js and embedded scene/HUD mode
- Proposed apps/web/tests/colony/ rendered tests

## Requirements

- Add the Colony route and existing navigation/overflow integration behind the local feature setting. Keep standalone Bot UI intact; suppress duplicate embedded controls.
- Implement the approved searchable repository/task rail, central scene and inspector with shared filter/selection state, honest status/freshness and distinct repository/workspace/historical categories.
- Use keyboard-adjustable, bounded, persistent splitters and preserve selection/camera when navigating away and back. Native UI owns controls; the scene communicates typed selection/focus intents.

## Acceptance criteria

- [ ] **COL-05-AC1:** Real clicks on a bot and its matching list row select the same unique task and inspector; changing a filter updates scene and list together, and removed/filtered selections do not show an unrelated task.
- [ ] **COL-05-AC2:** Historical locations are excluded by default and appear only when enabled; missing paths and unknown activity are labeled honestly, without inflated active-project or blocked-task counts.
- [ ] **COL-05-AC3:** At all three approved window sizes and 200% text zoom, path/branch details and action labels remain usable with no overlapping controls; dark/light views use the current Rhythm tokens.
- [ ] **COL-05-AC4:** Repeated navigation preserves camera/selection/pane widths; splitters support keyboard adjustment and reset. A disabled direct route renders the enablement explanation without scanning.

## Required tests / evaluation

- Rendered click/keyboard tests using the actual route and scene message path, including parent/worker, long-label and empty/filter fixtures.
- Batch native Electron screenshots for desktop/narrow/dark/light states and compare against COL-04; fix material findings in a bounded pass.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
