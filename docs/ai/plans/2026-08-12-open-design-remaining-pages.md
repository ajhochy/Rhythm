# Current Plan — Rhythm remaining-page redesign

## Intent + constraints

**Goal:** Finish the web-only React/Vite Rhythm redesign for every non-Agents top-level page while preserving the verified Agents workflow.

**In scope:** Dashboard, Planner, Tasks, Rhythms, Projects, Messages, Facilities, Automations, and Integrations; Flutter behavior inventory; endpoint-to-control traceability; deterministic fixture states; semantic accessible UI; responsive behavior; Playwright click-through coverage; final Studio/Chrome preview.

**Out of scope:** live-server testing, production API calls, Electron packaging or execution, shipping Flutter changes, api_server changes, commits/PRs, and destructive operations.

**Hard constraints:**

- Work only in the Open Design project file tree under `rhythm-desktop-agents` when implementing.
- Treat `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter` as read-only behavior truth.
- Treat `rhythm-dashboard-redesign.html` as the visual truth.
- Do not start a second Rhythm api_server; live integration is paused.
- Do not launch or install Electron.
- Preserve the existing verified Agents experience and its 58-test fixture baseline.
- Every enabled control must have a visible, testable outcome. Disabled controls must name their prerequisite.

**Design tension:** maximize parallel speed without overlapping writes or degrading visual/behavioral consistency. Resolve this with page-owned directories, lead-owned shared files, and wave-by-wave integration.

**Cheapest proving slice:** restore the fixture baseline, implement Dashboard as the first full non-Agents route, integrate it through the shared shell, and pass its page contract plus the existing Agents suite before starting the next wave.

## Clarification interview

Completed across the current session: target is a polished web app; Flutter is the behavior source; `rhythm-dashboard-redesign.html` is the visual source; deterministic fixtures are allowed; live-server verification is explicitly paused; Electron is deferred; the user wants the remaining pages completed by a delegated overnight swarm.

## Prior art

- The completed Agents specialists proved that isolated file ownership plus an integrator works.
- The Tool-state specialist proved a seven-state deterministic fixture matrix and exact endpoint receipts across 12 routes.
- The responsive/accessibility specialist proved installed-Chrome Playwright at 1024, 768, and 390 widths, 200% text scaling, RTL, forced colors, 44px targets, focus restoration, and keyboard resizing.
- The navigation specialist proved nested navigation, attachment validation, and full click-through checks without Electron.

## Execution waves

| Order | Work packet | Goal | Owned files | Evaluation | Dependencies |
|---:|---|---|---|---|---|
| 0 | Baseline quarantine | Isolate the canceled live-mode partial work and restore the 58-test fixture baseline | lead-owned shared config only | build + 58 existing Playwright tests + dist smoke | none |
| 1 | Dashboard | Replace placeholder with visual-reference dashboard and real Flutter behavior inventory | `src/pages/dashboard/**`, page tests/contracts/inventory | targeted contract + screenshots + a11y | 0 |
| 2 | Planner | Implement the weekly planning flow | `src/pages/planner/**`, page tests/contracts/inventory | targeted contract + responsive click-through | 0 |
| 3 | Tasks | Implement list/Kanban task management flow | `src/pages/tasks/**`, page tests/contracts/inventory | targeted contract + no-dead-control audit | 0 |
| 4 | Rhythms | Implement recurring-rule management | `src/pages/rhythms/**`, page tests/contracts/inventory | targeted contract | wave 1 integration |
| 5 | Projects | Implement templates, instances, steps, milestones | `src/pages/projects/**`, page tests/contracts/inventory | targeted contract | wave 1 integration |
| 6 | Messages | Implement thread list, transcript, compose, read state | `src/pages/messages/**`, page tests/contracts/inventory | targeted contract | wave 1 integration |
| 7 | Facilities | Implement facilities, rooms, reservations, series, conflicts | `src/pages/facilities/**`, page tests/contracts/inventory | targeted contract | wave 2 integration |
| 8 | Automations | Implement rules, catalog-driven builder, preview, resync | `src/pages/automations/**`, page tests/contracts/inventory | targeted contract | wave 2 integration |
| 9 | Integrations | Implement account cards, connect/settings/sync flows | `src/pages/integrations/**`, page tests/contracts/inventory | targeted contract | wave 2 integration |
| 10 | Integration/verification | Wire routes, normalize shared patterns, run aggregate gates, open Studio | lead-owned App/Shell/global config/README | build + all Playwright + dist smoke + manual browser smoke | 1–9 |

## Known ambiguities

- Page-specific secondary controls must be resolved from the current Flutter view/controller/data-source before each contract is finalized. Seed criteria in the overnight handoff are directional, not permission to invent behavior.
- The exact final Playwright count is not predetermined; it must exceed the verified 58-test baseline and every page contract must be represented.

## Data and safety

- Fixture-only overnight run: intercept or fail any accidental production/local API request.
- Never write to the shipping Rhythm application code.
- Preserve the paused live contract as documentation, but exclude it from ordinary fixture verification.
- Do not persist tokens, cookies, live responses, personal data, or database content in fixtures or screenshots.
