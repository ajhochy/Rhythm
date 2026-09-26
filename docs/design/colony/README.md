# Bot Crossing workspace design packet

Issue: [#1529](https://github.com/ajhochy/Rhythm/issues/1529) · COL-04  
Decision record: [Colony workspace design](../../ai/decisions/2026-09-25-colony-workspace-design.md)  
Action coverage: [Upstream action inventory](action-inventory.md)

This packet defines one Rhythm-native **Bot Crossing** destination. Rhythm owns the destination bar, repository/task rail, optional inspector, menus, focus, and state chrome. The sealed Bot Crossing artifact owns only the preserved 3D world and characters. Embedded mode removes the upstream `Bot Crossing` brand bar and orange action system.

This is a design contract, not rendered, installed, packaged, hosted, or release qualification. The HTML comps are deterministic source artifacts for the orchestrator to screenshot; no browser was launched in this lane.

## Visual authority and annotations

The comps copy the current variables from `apps/web/src/styles.css`: `--bg`, `--surface`, `--surface-warm`, `--surface-raised`, `--fg`, `--fg-2`, `--muted`, `--border`, `--border-soft`, `--accent`, status colors, radii, focus, shadow, and the UI/mono font stacks. Controls use only:

- `ListInspector`: list rows, selected row, list/error/empty behavior, one-pane narrow behavior.
- `Splitter`: 8 px separator, pointer resize, keyboard arrows/Home/End/Enter, persisted preferred widths.
- `Menu`: View and task/repository action menus, roving focus, checked/disabled items, Escape return.
- `Icon`: the incumbent lucide wrapper; icons supplement text and never become a second brand.
- Token annotations such as `--accent` or `--border-soft` where the element is styling rather than an incumbent component.

Numbered callouts in each comp name one of those incumbents or tokens. They are implementation annotations, not shipped labels.

## Composition index

| File | Purpose |
| --- | --- |
| `comps/1440x900-dark.html` / `1440x900-light.html` | Three-pane selected task; dark comp opens View to show native menu placement and scene clipping. |
| `comps/1024x700-dark.html` / `1024x700-light.html` | Bounded rail and inspector around the preserved scene. |
| `comps/800x600-dark.html` / `800x600-light.html` | Narrow two-pane layout; inspector is optional and replaces the rail when opened. |
| `comps/state-selected.html` | Long synthetic repository path, branch, parent, and worker names with exact-task actions. |
| `comps/state-empty.html` | Enabled, scan-complete, no matching locations. |
| `comps/state-error.html` | Scanner/artifact error with Retry and Open settings; list remains independent. |
| `comps/state-no-webgl.html` | Useful list-first fallback with no 3D surface. |
| `comps/state-stale.html` | Cached snapshot, timestamp, generation, and explicit refresh. |
| `comps/state-disabled.html` | Destination visible before opt-in; local read scope and enablement route explained. |

## Workspace anatomy and Pane bounds

The global Rhythm header remains the only header. The workspace below it is one surface:

1. Repository/task rail: `ListInspector` vocabulary, default 304 px, minimum 240 px, maximum 420 px. It groups repositories, then parent/worker tasks. Search is always visible; harness and status filters remain compact. Historical locations are off by default in the filter menu.
2. Scene: minimum 360 px while another pane is beside it. It receives measured insets after any resize and keeps world/characters, status marks, camera, and selection hit targets.
3. Inspector: optional, default 336 px, minimum 288 px, maximum 440 px. It contains task identity, parent link, exact open action, archive/restore, and overflow actions.
4. Both separators use `Splitter`. Preferred widths, camera, and selected task ID are profile-owned state. Actual widths clamp on every return and viewport change.

At 800 px, only rail + scene are simultaneous. Selecting **Inspect** replaces the rail with the inspector and provides **Back to list**. Below 720 CSS px—or at 200% text zoom when effective width crosses that boundary—the workspace is one pane at a time: list → scene → inspector. No horizontal page scroll is allowed; long paths/branches wrap in the inspector and middle-ellipsize in rows.

## Annotated flows

### Enable → filter → select → inspect → open (bot or list task)

1. **Enable:** choose the always-visible **Bot Crossing** destination. The disabled state explains local read scope and offers **Review access**, which deep-links to Settings → Local apps → Bot Crossing. Enablement is never requested by a scene overlay.
2. **Filter:** focus Search, then Harness and Status. Selecting `Needs attention` updates both the list and scene; the status remains announced in the rail.
3. **Select:** choose a bot in the scene or the same task row. Both set one shared selection ID and selected styling; scene selection moves focus only after a keyboard activation, never after pointer selection.
4. **Inspect:** the inspector opens with the exact task, harness, full path, branch, parent, and workers. **Show parent task** changes selection without losing the current filters.
5. **Open:** the primary action is capability-qualified: **Open in Rhythm** for a Rhythm local task or **Open in Codex** for a supported Codex reference. Unsupported harnesses show a disabled item plus the reason; no action opens a nearby or newly-created task.

### Archive → restore

1. Open the selected task’s `Menu` and choose **Archive from Colony**. The confirmation says the harness transcript/source is untouched.
2. Focus returns to the originating task-menu trigger. The row leaves the default list and the next row receives roving focus; an undo toast is offered.
3. Set Status to `Archived`. Select the archived row and choose **Restore to Colony** from the same menu location.
4. The restored row returns to its repository group, remains selected, and the inspector heading receives focus. Archive/restore changes only Colony-owned profile state.

## Keyboard order

Within the workspace, Tab order is: **Search → Harness → Status → filter menu → repository disclosure/rows → task rows → first Splitter → scene toolbar → scene canvas → second Splitter → inspector heading/actions → View trigger**. Arrow keys move within a list/menu and pan the focused scene; they do not unexpectedly tab between panes. `Enter`/`Space` selects rows and activates controls. `Home`/`End` on a Splitter set its bounded extremes; `Enter` resets its default.

When the one-pane layout is active, hidden panes are removed from sequential focus. **Back to list** is first in the inspector. Scene canvas exposes a concise keyboard help description and an adjacent list alternative.

## Escape and focus return

- Escape closes the topmost View/task/filter menu and returns focus to its trigger.
- Escape from the inspector clears selection only when no menu/dialog is open, then returns focus to the selected task row; on narrow layouts it returns to the list with that row focused.
- Escape from a repository drill-in returns to the repository row. It never disables Bot Crossing or departs the destination.
- After archive, focus moves to the next visible row (previous when there is no next row). Undo restores focus to the restored row.
- After Retry, focus stays on Retry until status changes; success moves to the first result only on explicit user navigation.
- Tab departure disposes the native document. On return, focus begins at the workspace heading while camera, selection, and bounded widths are restored.

## Shortcut conflicts

Single-letter upstream shortcuts are not global in Rhythm. They run only when the scene canvas is focused and no editable, menu, dialog, or shell command surface is active.

| Conflict | Resolution |
| --- | --- |
| search | `Cmd/Ctrl+F` stays with the focused browser-style/search field; `/` focuses the Colony search only while the workspace has focus and no editor is active. |
| composer | `Enter`, `A`, `C`, `M`, `N`, `O`, `P`, `S`, `V`, `?`, and `0` never intercept Tasks/Agents composer input. Open uses `Cmd/Ctrl+Enter` from a selected row or its labeled button. |
| terminal | Terminal and terminal-resume shortcuts are absent. `Cmd/Ctrl+\` remains available to Rhythm’s own pane/terminal behavior. |
| destination/shell | `Tab` always advances focus; it never changes planet. Planet is a checked View submenu. Escape closes shell overlays before clearing selection. |

The action inventory records where every upstream shortcut moved or why it was removed.

## View menu contract

`View` is a Rhythm `Menu`, backed by Electron native popup behavior where it crosses the native scene view. Opening any shell overlay first hides/clips the native view, then opens the menu; close restores the view and trigger focus. Items expose checked and disabled states:

- Camera: Reset camera; Follow selected bot (checked, disabled without selection); Orbit (checked); Return to isometric (checked); Project labels (checked).
- World: Planet submenu (one checked); Time of day submenu (one checked); Reduced motion (checked and forced on by OS setting unless explicitly reduced further).
- Sound: Ambient sound (checked); volume controls open Settings rather than becoming tiny menu sliders.
- Quality: Auto / High / Balanced / Low (one checked); Advanced quality opens Settings; Screenshot is disabled without a live WebGL scene.

## State, accessibility, and zoom review

| Check | Design result |
| --- | --- |
| Dark/light | Both use the incumbent token sets; status is dot + text, never color alone. |
| Reduced motion | OS preference suppresses bot bobbing, camera easing, orbit, parallax, and nonessential transitions; selection and status remain legible. |
| Keyboard/focus | Explicit order, roving lists/menus, Splitter keys, Escape stack, and focus return are specified above. |
| 200% text zoom | One-pane breakpoint uses effective CSS width; controls remain at least 44 px; text wraps; no clipped action row or horizontal page scroll. |
| Empty | Search/filter controls remain available and explain whether no sources or no matches caused the result. |
| Error | Error text is selectable; Retry and Settings are ordinary buttons; last safe list snapshot is preserved when available. |
| Stale | Timestamp and generation are visible; cached data is labeled stale and never represented as live. |
| Disabled | Destination stays visible; local access and enablement are explained before any scanner starts. |
| No WebGL | Full searchable list and inspector remain usable; camera/world actions are disabled with reasons. |

Source-side comparison against current Tasks/Agents found no new type scale, radius, button grammar, focus treatment, or branded header. Representative long paths/branches and synthetic parent/worker names are in `state-selected.html`. Rendered side-by-side review remains for the orchestrator/AJ after screenshots; this packet does not claim that visual approval.

## Material decisions before COL-05

D1–D6 are resolved in the decision record. D5’s settings label and D6’s filter wording are marked pending AJ taste review, but their functional defaults are fixed so COL-05 is not blocked.
