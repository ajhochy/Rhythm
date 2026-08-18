# Current plan

## Request

All inspectors on Planner, Tasks, Rhythms, Projects, Facilities, Automations, and Integrations should open in edit mode.

## Goal

Selecting an editable row or record exposes editable fields immediately in its existing detail inspector, with no intermediate Edit action or second editor dialog.

## Non-goals

- Do not relax read-only, forbidden, prerequisite, ownership, or source-owned restrictions.
- Do not redesign page layout, fields, fixture data, or endpoint semantics.
- Do not change create flows.

## Validation

- Assert direct field availability after selection on each surface.
- Assert read-only variants remain disabled or descriptive.
- Run typecheck, build, targeted page tests when the browser can launch, and dist smoke.

