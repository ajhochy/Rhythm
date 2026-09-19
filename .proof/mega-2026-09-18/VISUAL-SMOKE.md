# Rhythm Electron mega build visual smoke

- Date: 2026-09-18
- Branch under test: `mega/2026-09-18-mobile-electron-hermes`
- Runtime target: existing Electron window titled `Rhythm`, live API `https://api.vcrcapps.com`, `RHYTHM_HERMES_ENABLED=1`
- Safety: no credentials entered; no pre-existing data modified; Flutter Rhythm and Hermes Desktop left untouched.

| Step | Expected (from issue) | Observed | Result | Screenshot |
| --- | --- | --- | --- | --- |
| 01 | #1513/#1515-#1519/#1521/#1514: Tasks-reference compact list + full inspector across Facilities, Messages, Projects, Automations, Integrations, Settings, every Agents Tool, and Agents Settings; row/keyboard/deep-link/reload/long-title states work. | The control inventory showed the existing Electron process, but selecting it returned `Computer Use was not approved to use Electron`; no page, selection, reload, URL, or keyboard state could be observed. | BLOCKED | Not captured: app-control permission denied. |
| 02 | #1511: one View options control offers archived sessions and row spacing; archived view shows a return chip; standalone checkbox rows are gone. | Same Electron control denial prevented inspection or changing the archive/density view. | BLOCKED | Not captured: app-control permission denied. |
| 03 | #1512: child loading is a compact indented Load subagents row and long parent titles do not enlarge it. | Same Electron control denial prevented finding a parent with unloaded children. | BLOCKED | Not captured: app-control permission denied. |
| 04 | #1522/#1496: Add project opens the native macOS folder picker; the named temporary project appears and is selectable, then is removed before finish. | Same Electron control denial prevented opening Add project or the native picker. No project row was created, so no cleanup was required. | BLOCKED | Not captured: app-control permission denied. |
| 05 | #1523: Profiles retains list + inspector; editor has grouped Identity, Provider & model, Delegation, Availability, Capabilities, and Permissions sections plus Advanced JSON and unobscuring sticky Save/Cancel. | Same Electron control denial prevented opening Profiles. No existing profile was changed. | BLOCKED | Not captured: app-control permission denied. |
| 06 | #1509: Tasks and Agents chat are calmer/readable in dark mode without increasing chat width; light/dark evidence captured and original appearance restored. | Same Electron control denial prevented theme switching and matched light/dark capture. Appearance was not changed. | BLOCKED | Not captured: app-control permission denied. |
| 07 | #1524: nav/content, Agents rail/inspector, and an inner list/inspector divider drag with resize cursors, persist after reload, and Reset layout exists in Appearance. | Same Electron control denial prevented dragging, cursor inspection, reload persistence, and Reset layout inspection. | BLOCKED | Not captured: app-control permission denied. |
| 08 | #1541/#1542/#1543: Hermes sidebar entry shows starting to ready, embeds the themed dashboard, and Ask Hermes opens a draft without sending; honest absent/failed state otherwise. | Same Electron control denial prevented observing Hermes lifecycle, embedded dashboard/theme, or draft-only behavior. Hermes Desktop was not touched. | BLOCKED | Not captured: app-control permission denied. |
| 09 | #1520: packaged `Rhythm.app` has the Rhythm icon in Finder and Get Info, not the generic Electron atom. | Selecting Finder returned `Computer Use was not approved to use Finder`, so Finder/Get Info association is unverified. Supporting static evidence: `Contents/Info.plist` sets `CFBundleIconFile` to `Rhythm`, `Contents/Resources/Rhythm.icns` exists, and extraction visibly shows the green Rhythm mark rather than the Electron atom. Static evidence is not promoted to a visual-smoke pass. | BLOCKED | [09-packaged-icon-static.png](09-packaged-icon-static.png) (supporting file, not Finder/Get Info screenshot) |
| 10 | At 200% zoom, a list-inspector page and Agents rail remain usable; zoom is restored with Cmd+0. | Same Electron control denial prevented changing or restoring zoom. The app was not modified. | BLOCKED | Not captured: app-control permission denied. |

## Summary

- PASS: 0
- FAIL: 0
- BLOCKED: 10 (counts as a failed verification run)
- Rows left behind: none
- Needs AJ: grant this Codex computer-use session access to the running Electron process and Finder, then rerun the ordered smoke. No sign-in screen was reached.
- Top contradictions: no product contradiction could be established because every interactive criterion was blocked before the first UI observation. The five highest-risk unverified claims are (1) shared list/inspector behavior and stale-ID handling, (2) native Add project picker plus cleanup, (3) persistent app-wide resizing, (4) embedded Hermes ready/theme/draft-only behavior, and (5) matched theme/zoom readability with bounded chat width.

## Control-boundary evidence

- `cua.getState()` listed `Electron` as running.
- Selecting the app by display name returned: `Computer Use was not approved to use Electron`.
- Selecting the running Electron bundle path returned the same denial.
- Selecting Finder returned: `Computer Use was not approved to use Finder`.
- No fallback GUI automation was used, no credentials were entered, no project/profile/task row was created, and neither Flutter Rhythm nor Hermes Desktop was touched.
