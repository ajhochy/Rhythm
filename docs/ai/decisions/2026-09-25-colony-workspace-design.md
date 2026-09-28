---
date: 2026-09-25
repo: Rhythm
issues: [1529]
status: accepted-for-col-05
tags: [decision, Rhythm, colony, electron, design]
---

# Bot Crossing workspace design decisions

These decisions reconcile [the integration plan](../plans/2026-09-18-electron-colony.md) with [the native receiver plan](../plans/2026-09-24-colony-native-receiver.md) before COL-05. The later receiver plan and the lane’s recorded decisions control where the earlier plan conflicts.

## D1 — Destination label and route

### Context

The integration plan called the destination “Colony”; the receiver plan calls the visible tab “Bot Crossing.” Two names would create a navigation/product mismatch.

### Decision

Use **Bot Crossing** as the destination label, workspace heading, accessibility name, and settings section. Use route `/bot-crossing`; internal artifact/module names may continue to use `colony` where already contractual.

### Alternatives

“Colony” was shorter but obscured the adopted product identity. “Agents map” was rejected because it loses the world metaphor and multi-harness distinction.

### Consequences

COL-05 adds one Bot Crossing destination and no separate Colony destination. The earlier plan language is amended by the packet link and reconciliation note.

## D2 — Visibility before opt-in

### Context

The integration plan hid the destination until enabled. The receiver plan exposes a tab independently of opt-in, and discovery must remain explicitly authorized.

### Decision

The Bot Crossing destination is visible to all desktop users before opt-in. Before enablement it renders the disabled composition, explains local read scope, and links to access review. It does not load the artifact, start the scanner, or inspect harness stores.

### Alternatives

Hiding until enabled reduced chrome but made the capability undiscoverable. Starting a scanner on first navigation was rejected because visiting is not consent.

### Consequences

Navigation and enablement are independent states. Tests must assert that a disabled visit performs no discovery and that enabling is profile-scoped.

## D3 — Departure lifecycle and restoration

### Context

The earlier plan discussed hidden-tab suspension; the receiver plan disposes the native document on departure. Retaining a live WebContentsView complicates ownership, focus, GPU, and privacy.

### Decision

Dispose the native Bot Crossing document on tab departure. Persist camera, selected task ID, rail width, inspector width, filters, and collapsed groups in Colony-owned profile state. On return, create a new document, clamp pane widths to current bounds, restore valid selection/camera, and fall back safely when an item disappeared.

### Alternatives

Keeping the document alive and merely hiding it preserved animation state but retained GPU/process/focus state. Recreating without restoration was simpler but needlessly disruptive.

### Consequences

COL-05 cannot assume DOM continuity. Focus returns to the workspace heading after recreation; no automatic agent turn or scan beyond the enabled policy is triggered.

## D4 — Menus over the native scene

### Context

DOM menus can be occluded by a WebContentsView/native surface. A second menu system inside the embedded artifact would duplicate Rhythm chrome and break focus ownership.

### Decision

Rhythm owns every shell menu. Before a View/task/filter menu or dialog opens over the scene, hide or clip the native view; restore it after the overlay closes. Prefer Electron native popup behavior for cross-native overlays while preserving the incumbent Rhythm `Menu` semantics, checked/disabled state, roving focus, Escape, and trigger focus return.

### Alternatives

A React menu above the native view was rejected because z-index cannot guarantee composition order. Menus inside the artifact were rejected as duplicate chrome.

### Consequences

The scene may briefly pause while an overlay is open. Overlay lifecycle needs one shared owner so nested menus cannot reveal the native view early.

## D5 — Enablement and settings location

### Context

Opt-in needs an understandable place without turning the workspace into a permission wizard or starting discovery accidentally.

### Decision

Put the authoritative toggle and source-scope review at **Settings → Local apps → Bot Crossing**. The disabled workspace has one **Review access** deep link to that section. View → Advanced quality opens the same settings area at its display subsection. No enable toggle is duplicated in the scene or rail.

### Alternatives

An inline enable switch was faster but compressed consent details. A first-run modal was rejected because it interrupts destination exploration and has poor recovery after dismissal.

### Consequences

Enablement remains profile-scoped and auditable. The exact settings subsection label is **pending AJ taste review**, but the single-source location and disabled deep-link behavior are fixed and do not block COL-05.

## D6 — Historical locations default

### Context

Missing/unresolved folders are valuable history but can inflate counts and imply live work. The upstream HUD offers an Include historical locations checkbox.

### Decision

Historical locations are **off by default**. Put the option in the rail filter menu as **Include historical locations**, with a count and “missing or unresolved folders” explanation. When enabled, group them separately; never show them as active, blocked, or safely openable without a current resolved capability.

### Alternatives

Always showing history preserved maximum context but made the default workspace noisy and semantically unsafe. Removing history lost legitimate archive lookup.

### Consequences

Default repository/task counts exclude historical locations. The exact explanatory wording is **pending AJ taste review**; the off-by-default policy, separate grouping, and disabled unsafe actions are fixed for COL-05.

## Outcome

No material design decision remains unresolved before COL-05. AJ still owns visual approval of screenshots and may tune the two labels noted above without changing behavior or architecture.

