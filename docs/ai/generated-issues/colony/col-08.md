## Goal

Keep Colony responsive and usable with large inventories, hidden tabs, limited GPUs and failed local sources.

Parent: {{EPIC}}  
Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)  
Milestone: Colony M2 — Rhythm-native UI and menus

## Dependencies

{{COL-05}}, {{COL-06}}, {{COL-07}}

## Likely files

- apps/colony/src/core/engine.js, audio and scene lifecycle
- apps/web/src/pages/colony/ loading/error/list views
- Electron Colony scanner/bridge cancellation and telemetry counters
- Proposed native performance/accessibility fixtures and smoke documentation

## Requirements

- Pause animation/audio and scheduled scanning when the tab is hidden or app minimized; keep state for a quick return and refresh stale results on re-entry.
- Render shell/progress immediately, use paged inventory and cached snapshots, expose freshness and cancel/retry. Preserve healthy-source results during partial failures.
- Make all essential selection/filter/open/archive actions available in a semantic list when WebGL fails. Respect reduced motion, muted audio defaults, dark/light contrast and existing keyboard conventions.

## Acceptance criteria

- [ ] **COL-08-AC1:** Within one second of hiding/minimizing Colony, scene animation/audio and scheduled scans stop; returning restores the camera/selection and refreshes without creating a second scanner.
- [ ] **COL-08-AC2:** Across twenty tab switches there is no growing count of workers, WebGL contexts or listeners; scanner crash/retry never affects chat/API/engine usability.
- [ ] **COL-08-AC3:** On recorded reference hardware, cached 15,000-session inventory is usable within two seconds; cold work shows progress by one second and a bounded stale/cancel/retry state at sixty seconds. A 100-task low-preset scene meets the proposed 30 FPS budget on both reference Macs, or the issue remains open with a reviewed budget adjustment.
- [ ] **COL-08-AC4:** Keyboard-only and screen-reader users can select/filter/open/restore tasks through the list; WebGL loss, reduced motion, empty/disabled sources and missing native apps remain actionable without color-only cues.

## Required tests / evaluation

- Instrument actual native renderer visibility/counters and process counts, not just CSS hidden state.
- Run large synthetic fixtures, keyboard/accessibility checks and a bounded native visual pass over failure/empty states.
- Record hardware, OS, scene size, timings and limitations; do not use cold/warm measurements from a different app build as proof.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
