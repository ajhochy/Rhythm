---
date: 2026-09-24
repo: Rhythm
branch: codex/facilities
pr: 1544
issues: [1545]
status: partial
tags: [run, rhythm]
---

# Facilities UI parity proposal

## Evidence boundary

This proposal compares the live Facilities source at base `58409f4f` with the established Agents → Tasks `ListInspector` pattern. The capture spec writes only to `/private/tmp/rhythm-issue-1545-facilities-captures` and attaches Facilities plus Agents → Tasks screenshots at 1440, 1100, and 390 pixels in light and dark themes. Chromium and Electron launch are prohibited in this implementer lane, so the screenshots remain pending for the parent runner; no image is tracked in the repository.

Expected attachment pairs for every item below are `facilities-{1440|1100|390}-{light|dark}.png` and `agents-tasks-{1440|1100|390}-{light|dark}.png` from `apps/web/tests/issue-1545-facilities-capture.spec.ts`.

## Proposed and applied parity changes

| Change | Before state at `58409f4f` | Agents → Tasks pattern | Existing Rhythm mapping | Risk | Decision |
|---|---|---|---|---|---|
| Compact the page header | `live.tsx:327-329` used an eyebrow, large heading, and marketing description above the workspace. | Tasks keeps its title/description compact and makes the list-and-inspector the working surface. | Existing `facilities-header`, `facilities-heading`, spacing, foreground, and muted tokens. | Low-risk visual parity | Applied: removed the eyebrow, shortened the description, and reduced header height. |
| Move range/building filters into the rail | `live.tsx:332` placed a full-width filter band above the list. | List-specific controls live in the `ListInspector` toolbar/rail. | `ListInspector.toolbar`, existing form controls, `--border-soft`, `--muted`, and shared focus styles. | Low-risk layout parity; request semantics must remain exact | Applied with stable test IDs; start, end, and building still feed the existing reservations/groups query. |
| Replace empty room filler with useful metadata | `live.tsx:311` displayed the literal “No room description”. | Task rows reserve their one subtitle line for useful status/metadata. | `ListInspectorItem.subtitle`; existing facility capacity and loaded reservation count. | Low-risk content parity | Applied: description/location wins, then capacity, then reservation count. |
| Compact reservation time in the rail | `live.tsx:318` concatenated two full formatted timestamps. | Task rows expose one short metadata line; details remain in the inspector. | `ListInspectorItem.subtitle`, existing wall-clock parsing, and `Timestamp` for full accessible inspector values. | Low-risk content parity | Applied: same-day ranges use `Sep 13, 9:00–10:00 AM`; full start/end values remain in the inspector. |
| Consolidate room actions | `live.tsx:374-376` split room actions across two rows. | Item actions stay together in the inspector header and wrap responsively. | Existing `facilities-detail-actions` plus shared primary, secondary, compact, and danger buttons. | Low-risk interaction parity; confirmations and permissions must remain unchanged | Applied: reserve, edit, recurrence, automation preview/removal, and delete share one wrapping action group. |

## Structural decision

| Candidate | Rationale | Risk | Decision |
|---|---|---|---|
| Split rooms and reservations into separate lists | It could reduce mixed-list density, but it would introduce a second selection model and weaken the current room-scoped reservation context. The shared component already provides building groups plus a selected-room reservation group. | Structural: deep-link restoration, keyboard order, narrow-pane transitions, and group/series context would all need a separate interaction design and expanded acceptance coverage. | Deferred. Keep one grouped list for this parity pass; revisit only after AJ reviews the combined smoke. |

## Checks for parent qualification

- Run the capture spec with the live e15 server configuration and review all 12 attachments side by side.
- Exercise room/reservation create, edit, delete, recurrence/group, conflict, automation preview/removal, keyboard selection, and read-only behavior in packaged Electron with disposable data.
- Confirm axe, visible focus, long names, no horizontal overflow at 390 pixels, and both themes.
