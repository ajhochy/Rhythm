# Summary

Added a shared `Splitter` component and hook with stable local-storage keys, pointer capture, cancellation cleanup, keyboard control, persisted preferred sizes, available-space clamping, accessible separator values, reset support, and window resize notification. Integrated it into the Shell navigation boundary, Agents rail and inspector, the nested SessionRail Tools panel, and `ListInspector`. Added Reset layout to main Settings, a route/tool inventory, and six rendered tests for the requested interaction contract.

The socket-free worker gate succeeded. Rendered Playwright, axe, and Electron interaction runs are pending for the orchestrator because this worker brief forbids socket binding and app launch.
All changes remain uncommitted in `mega/ws-1524-splitter` for the orchestrator.

# Files changed

- `apps/web/src/components/Splitter.tsx` — shared persisted splitter, `useSplitterSize`, and `resetSplitterSizes`.
- `apps/web/src/components/Splitter.css` — 8 px hit areas, resize cursors, and hover/focus/forced-color affordances.
- `apps/web/src/components/AgentsWorkspace.tsx` — replaced rail and inspector resize logic with shared splitters.
- `apps/web/src/components/SessionRail.tsx` — replaced only the Tools panel resize handle and its local drag logic.
- `apps/web/src/components/ListInspector.tsx` — added one label-derived shared list/inspector splitter while preserving the API.
- `apps/web/src/components/ListInspector.css` — added the 8 px splitter grid track and hides it in the existing single-pane container layout.
- `apps/web/src/components/Shell.tsx` — added the current navigation/content boundary and stable Shell layout key.
- `apps/web/src/pages/settings/index.tsx` — added Reset layout under Appearance and keyboard.
- `apps/web/src/styles.css` — adjusted the existing Shell, Agents, Tools, and responsive tracks for the shared 8 px splitter.
- `apps/web/tests/splitter.spec.ts` — added six fixture-mode rendered interaction contracts.
- `apps/web/tests/navigation-validation.spec.ts` — updated the former 12 px Agents expectations to the shared 16 px step.
- `docs/ai/ui-contracts/resizable-panes.md` — documented the universal rule, keys, route/tool inventory, coverage, and follow-ups.
- `docs/ai/runs/2026-09-18-resizable-panes.md` — recorded exact checks and verification limits.
- `docs/ai/project-state.md` — appended the required coding-agent run entry without changing the existing state snapshot.
- `REPORT.md` — worker handoff report.

# Checks run

- `pwd && git rev-parse --abbrev-ref HEAD; echo ok > .write-probe && rm .write-probe` — PASS. Output: `/Users/ajhochhalter/Documents/Rhythm/.mega-wt/ws-1524-splitter`; `mega/ws-1524-splitter`.
- `gitnexus impact <symbol> --direction upstream ...` — PASS for indexed changed symbols. `AgentsWorkspace`, `SessionRail`, `Shell`, `LiveArtifactsShell`, and `SettingsPage` reported LOW risk. `ListInspector` was newer than the index and not found.
- `gitnexus analyze .` — FAIL. Output tail: `libc++abi: terminating due to uncaught exception of type Napi::Error`; the existing Rhythm index remained available for impact and change checks.
- `cd apps/web && git rev-parse --abbrev-ref HEAD && git rev-parse --short HEAD && npm run typecheck && npm run build` — PASS on `mega/ws-1524-splitter` at `5cd2eec7`. Output tail: `✓ 1684 modules transformed`; `✓ built in 10.22s`. Vite emitted its existing large-chunk warning.
- `cd apps/web && npx playwright test tests/splitter.spec.ts --list` — PASS. Output tail: `Total: 6 tests in 1 file`.
- `git diff --check` — PASS with no output.
- `gitnexus detect-changes --scope unstaged --repo /Users/ajhochhalter/Documents/Rhythm --limit 200` — PASS. Output: `Changes: 8 files, 8 symbols`; `Affected processes: 0`; `Risk level: low`. New untracked splitter files are newer than the index.
- Rendered Playwright, axe, screenshots, and Electron smoke — NOT RUN by worker. The brief prohibits binding sockets, Vite/Playwright execution, and Electron launch; the orchestrator runs these checks.

# Acceptance criteria

- Route/tab/screen inventory — **done**. `docs/ai/ui-contracts/resizable-panes.md` covers every `App.tsx` route and Agent Tool slug, marking each boundary covered or follow-up.
- Every adjacent pane/column resizable — **partial**. All exact integration points in this brief are covered. Existing route-owned fixed layouts in Tasks, Rhythms, Projects, Messages, Facilities, Automations, Integrations, Profiles, Planner, and legacy Tool splits are inventoried follow-ups and were outside the permitted integration list.
- One shared implementation with consistent hit area/cursors/focus — **done** in source. Every integrated handle is `Splitter`; CSS supplies an 8 px hit area and visible hover/focus state.
- Useful ranges, reflow, no overlap/overflow — **partial**. Bounds and available-space reconciliation are implemented and the build succeeds; rendered viewport and zoom assertions await the orchestrator.
- Reliable pointer drag across embedded content with complete cleanup — **partial**. Pointer capture plus pointerup, pointercancel, blur, lost-capture, and unmount cleanup are implemented; the rendered cancellation test is written but not run here.
- Persistence across navigation/relaunch and accessible reset — **partial**. Stable `layout.*` keys and Settings > Reset layout are implemented; reload/reset assertions are written but not run here.
- Window/zoom/collapse reconciliation — **partial**. Parent `ResizeObserver`, window resize measurement, and preferred-size restoration are implemented; rendered narrow-window and zoom evaluation awaits the orchestrator.
- Keyboard and separator accessibility — **partial**. 16 px arrows, 64 px Shift arrows, Home/End, Enter/double-click reset, names, orientation, and values are implemented; axe and rendered keyboard execution await the orchestrator.
- Preserve selection, edits, scroll, and session state — **partial**. Integrations update parent CSS sizes without recreating panes or changing domain state; rendered continuity checks await the orchestrator.
- Terminal/editor/calendar/artifact reflow — **partial**. Splitter changes dispatch a window resize event and the artifact iframe remains container-sized; actual Electron behavior awaits smoke testing.
- Shared UI requirement documented — **done**. The contract defines future implementation and review requirements.
- Requested `splitter.spec.ts` coverage — **done** as authored. It covers pointer persistence, keyboard bounds, stored min/max clamp, reset, nested splits, pointercancel cleanup, semantics, and representative Agents/ListInspector exposure; execution is pending.

# Decisions

- Chose to keep persisted preferred size separate from temporary available-space clamping; rejected overwriting the user's wider preference when a window becomes narrow.
- Chose `layout.agents.rail`, `layout.agents.inspector`, `layout.agents.tools`, `layout.shell.navigation`, and label-slugged ListInspector keys; rejected record-specific or generated keys that would not survive navigation.
- Chose a horizontal Shell splitter at the actual current top-navigation/content boundary; rejected redesigning Shell into a side rail within a resizing workstream.
- Chose no `LiveArtifactsShell.tsx` edit because the current artifact surface has no fixed adjacent preview pane; rejected an artificial divider between its toolbar and flexible iframe.
- Chose to inventory route-owned fixed layouts as follow-ups; rejected page-by-page edits outside the brief's exact integration list and parallel worker ownership.
- Chose no new dependency; rejected a third-party split-pane package for behavior already small enough to own locally.

# Follow-ups

- Orchestrator: run `apps/web/tests/splitter.spec.ts`, affected existing suites, axe, screenshots, and actual Electron pointer/iframe smoke.
- Adopt `Splitter` for every fixed route/tool boundary marked Follow-up in `docs/ai/ui-contracts/resizable-panes.md` after the parallel page redesigns merge.
- Refresh GitNexus after its native worker issue is repaired so the new shared files enter the graph.

# Needs a human

None.
