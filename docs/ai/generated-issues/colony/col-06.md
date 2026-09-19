## Goal

Make Colony menu actions open the exact intended task and use consistent Rhythm labels, keyboard behavior and failure feedback.

Parent: {{EPIC}}  
Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)  
Milestone: Colony M2 — Rhythm-native UI and menus

## Dependencies

{{COL-03}}, {{COL-05}}

## Likely files

- apps/web/src/pages/colony/ action menus and inspector
- apps/web/src/store.tsx and agentSessionLink.ts
- Proposed apps/electron/src/colony-actions.mjs, policy and preload methods
- Adopted harness native-opening adapters and capability descriptors
- Native session-opening and Colony action smoke tests

## Requirements

- Prerequisite: reviewed codex/electron-session-opening companion receiver. Reuse the existing local-ID selection path for Rhythm; opening in the same app must not reload the renderer or sign the user out.
- Use opaque inventory references. Resolve and validate known harness/task/checkout targets in privileged code; reject arbitrary commands, executable paths, URLs and stale/foreign refs.
- Implement approved task and View menus with checked/disabled state, primary labels and focus restoration. Only qualified actions appear: exact open, parent inspection, local viewed/archive, Finder/copy path and user-triggered screenshot/view controls.
- A Rhythm SDK-only child must resolve through its verified parent/child navigation contract or show an unavailable reason; never substitute an SDK ID for a local session ID or choose the first task.

## Acceptance criteria

- [ ] **COL-06-AC1:** From actual Colony controls, a Rhythm task outside the first page and a supported worker/parent open the requested visible identity while preserving authentication and the existing app/API/engine processes.
- [ ] **COL-06-AC2:** An installed supported external app opens the exact requested task; a missing app, stale task/ref or nonzero OS dispatch produces an actionable error with no success toast and no unrelated selection.
- [ ] **COL-06-AC3:** Malformed or injected refs/paths/URLs cause zero launches and writes. Opening/inspecting does not resume an agent turn, create a task or mutate the source harness.
- [ ] **COL-06-AC4:** Menus follow the approved mapping, keyboard navigation, checked states, Escape and focus return; shortcuts do not intercept typing in search, chat or terminals. Archive is explicitly local to Colony.

## Required tests / evaluation

- HTTP/IPC action contracts plus real native task identity receipts; use synthetic IDs in committed evidence.
- Exercise a known-working sibling route as a control and repeat switching without reload; test unsupported SDK-only children explicitly.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
