---
tags: [decision, rhythm]
---

# Use one shared list-and-inspector primitive

## Context

Agents Tasks was selected as the reference interaction for Agent Tools, Agent Settings, Facilities, Messages, Projects, Automations, Integrations, and main Settings. Those surfaces previously used different list widths, row actions, selection state, empty/error handling, and detail layouts. The migrations also had to proceed in parallel without creating page-specific primitives that would drift immediately.

## Decision

Use the shared `ListInspector` component and `useSelectedId` selection contract for every in-scope surface. Rows stay compact and descriptive; details, forms, actions, and destructive controls live in the inspector. Selection is URL-backed where the page has a stable entity key, and unknown or deleted selections use the primitive's not-found state.

Integrate the shared `Splitter` at the primitive and shell boundaries so pane resizing, keyboard behavior, persisted preferred sizes, responsive clamping, and reset behavior are implemented once.

## Alternatives

- Build a separate list/detail layout for each page: rejected because it would duplicate behavior, complicate accessibility verification, and drift across eight parallel workstreams.
- Keep actions inside interactive rows: rejected because it creates nested-interactive risks and makes selection side effects harder to reason about.
- Redesign each domain while migrating its layout: rejected because the campaign's scope was a shared presentation and interaction contract, not domain or API changes.

## Consequences

The in-scope pages now share selection, empty/loading/error, keyboard, focus, responsive, and inspector behavior. Page-specific code remains responsible for permissions, confirmations, persistence, and domain mutations.

Rendered Playwright, axe, zoom, RTL, screenshot, and actual Electron checks remain necessary. Legacy tests that selected retired row-scoped controls must be updated to drive the inspector instead.
