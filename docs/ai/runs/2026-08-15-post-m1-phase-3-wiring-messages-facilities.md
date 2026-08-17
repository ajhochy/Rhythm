---
date: 2026-08-15
repo: rhythm-react-electron-live-suite
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-3]
status: partial
tags: [run, rhythm-react-electron-live-suite]
---

# Unit AH — wire Messages and Facilities to the live domain gateways

Scope: `apps/web/src/pages/messages/**` and `apps/web/src/pages/facilities/**` only. No edits to
`apps/web/src/gateway/**`, `apps/api_server/**`, `apps/electron/**`, `tools/**`, `apps/web/SHA256SUMS`,
or `apps/web/PROVENANCE.md`.

## Files

- `apps/web/src/pages/messages/live.tsx` — new. Live-mode Messages component.
- `apps/web/src/pages/messages/index.tsx` — modified. `MessagesPage` now branches on
  `useGateway().mode`; the untouched original component was renamed to `FixtureMessagesPage` and its
  body is byte-identical logic (no behavior change).
- `apps/web/src/pages/facilities/live.tsx` — new. Live-mode Facilities component.
- `apps/web/src/pages/facilities/index.tsx` — modified. `FacilitiesPage` now branches on
  `useGateway().mode`; the untouched original component was renamed to `FixtureFacilitiesPage`.

## What's live now

### Messages (`apps/web/src/pages/messages/live.tsx`)

- List authorized threads — `GET /message-threads` via `gateway.threads()`.
- Open a thread — `GET /message-threads/:id/messages` then `POST /message-threads/:id/read`.
- Mark read/unread — `POST /message-threads/:id/read` / `.../unread`.
- Send a reply — `POST /message-threads/:id/messages` with `{ body }`; the returned `Message` (server
  `id`) is adopted directly, never invented.
- Create a thread — `POST /message-threads` with `{ participantIds, threadType, title }`; participant
  picker is populated from `GET /users` (bearer-authenticated, same live token) since no numeric-ID
  workspace directory is otherwise available to this page.
- Everything uses the gateway's numeric `MessageThread.id` / `Message.id` types directly — no
  stringified IDs anywhere in the live path (fixture mode still uses its own string IDs, untouched).
- Rename/delete are intentionally **not** implemented in live mode: the inventory confirms
  `apps/api_server/src/routes/messages_routes.ts:8-14` has no matching routes, so they are not
  persisted capabilities and must not be presented as if they were.

### Facilities (`apps/web/src/pages/facilities/live.tsx`)

- List facilities — `GET /facilities`. Create / delete facility.
- List all reservations — `GET /facilities/reservations` (unfiltered) on load, plus per-facility
  filtering client-side by `facilityId`.
- Create / delete a reservation for the selected facility.
- Create a recurring reservation series (`recurrence_type` weekly/biweekly/monthly/custom) —
  `POST /facilities/:id/reservation-series`.
- Preview and remove automation-created reservations —
  `GET /facilities/automation-reservations/preview`, `DELETE /facilities/automation-reservations`.
- Response fields are rendered exactly as the gateway returns them (`startTime`, `endTime`,
  `isConflicted`, `conflictReason`, …); request DTOs use the gateway's snake_case fields
  (`requester_name`, `start_time`, `end_time`, `recurrence_type`, …). Neither direction is normalized
  into the old fixture vocabulary (`start`/`end`/`creatorId`/`conflicted`/`automation`).

### Not done (deferred, flagged for the orchestrator)

- Grouped multi-room reservation create/edit (`ReservationGroupResult`/`ReservationGroupOverview`) —
  the gateway supports it (`reservationGroups`, `createReservation` returning a group result) but the
  live page only takes the single-reservation branch of `createReservation`'s union return.
- Reservation/series **update** (edit) flows — only create/delete are wired for both reservations and
  series; `updateReservation`/`updateReservationSeries` are unused.
- Reservation conflicts are rendered read-only where already present on a fetched record; there is no
  standalone "check conflicts" step.

## Literals verified against the API (canonical vocabulary)

| Sent/rendered | Canonical source |
|---|---|
| `participantIds`, `threadType: 'direct'\|'group'`, `title`, `taskId` (thread create) | `apps/api_server/src/models/message.ts:1-32`; `createdBy` is derived server-side from the auth bearer, never sent by the client — `apps/api_server/src/controllers/messages_controller.ts:19-38` |
| `{ body }` (message create) | `apps/api_server/src/models/message.ts:34-36` |
| `MessageThread.id: number`, `Message.id: number` | `apps/api_server/src/models/message.ts:6,17` |
| `GET /users` response `{ id, name, email }` | `apps/api_server/src/models/user.ts:1-7`; mounted at `/users` — `apps/api_server/src/app.ts:144` |
| `name`, `building` (facility create) | `apps/web/src/gateway/facilities.ts:15` `CreateFacilityInput`, matching `apps/api_server/src/models/facility.ts` |
| `title`, `requester_name`, `start_time`, `end_time` (reservation create, snake_case) | `apps/api_server/src/models/facility.ts:85-105` |
| `recurrence_type: 'weekly'\|'biweekly'\|'monthly'\|'custom'` | `apps/api_server/src/models/facility.ts:172-185` |
| `startTime`, `endTime`, `isConflicted`, `conflictReason` (response, camelCase) | `apps/api_server/src/models/facility.ts:28-48` |

## Known architectural gap: live token wiring (flagged, not worked around)

`GatewayDomainContracts` (`apps/web/src/gateway/index.ts:4-7`) only has `tasks`/`sessions` slots. The
real per-user session token (from Google Sign-in) is threaded only into those two domains by
`createLiveGateway` in `apps/web/src/gateway/index.ts:64-88` and `apps/web/src/main.tsx:70-71`. Since
this unit may not modify `apps/web/src/gateway/**` (or `main.tsx`, outside the allowed page
directories), Messages and Facilities construct their own gateway instances directly via the exported
`createLiveMessagesGateway`/`createLiveFacilitiesGateway` factories, using:

- `apiBase` hard-coded to `http://127.0.0.1:4098` — the only value `validateLiveBase` in
  `apps/web/src/gateway/index.ts:39-47` ever accepts, so this is not a guess.
- `token` read from `import.meta.env.VITE_RHYTHM_LIVE_TOKEN` — the same "TEST-ONLY override" channel
  `apps/web/src/main.tsx:63-65` already uses for Playwright/dev harnesses.

In a packaged build this env var is neutralized (per the comment at `main.tsx:63-64`), so
`createLiveMessagesGateway`/`createLiveFacilitiesGateway` will throw `Live configuration error: an
explicit … token is required`, which the pages render as a bounded config error
(`data-testid="messages-live-config-error"` / `facilities-live-config-error"`) — not a fixture
fallback. **This satisfies the "never silently show fixture data" requirement, but real production
authentication for these two pages is not wired end-to-end.** Extending `GatewayDomainContracts` and
`createLiveGateway` in `gateway/index.ts` to thread the real session token into `messages`/`facilities`
domains (mirroring how `tasks`/`sessions` already work) is required to close this gap, and is out of
scope for this unit. A sibling unit (Planner) independently arrived at the same
"import the gateway factory directly into the page" pattern, so this is the swarm-wide convention
until `gateway/index.ts` is extended.

## Fixture mode intact

Ran the scoped fixture-mode (default `apps/web/playwright.config.ts`, no live env vars → fixture mode)
suites for these two pages directly — did not run the full 254-test web suite per the guardrail, but
covered every spec file that targets these pages:

```
npx playwright test tests/pages/messages.spec.ts tests/pages/facilities.spec.ts \
  tests/contract/issue-2006-messages.spec.ts tests/contract/issue-2007-facilities.spec.ts --reporter=line
36 passed (42.5s)
```

`FixtureMessagesPage`/`FixtureFacilitiesPage` are the exact original component bodies (renamed only),
so no fixture behavior changed.

## Live verification (Playwright, actually executed — overrides in the task brief permit this)

```
cd apps/web && npx playwright test --config tests/post-m1-phase-3-live-playwright.config.ts --reporter=line
```

Full run: 5 passed / 8 failed. The 8 failures are all in families this unit does not own (c2a Dashboard,
c2b Planner, c2c Tasks, c2i Integrations, c2j quick actions, c3a/c3b/c3c cross-page selection-reload).
Both criteria owned by this unit passed:

```
[1/2] post-m1-p3-c2f: live Messages uses numeric persisted IDs for complete thread/message operations — PASS
[2/2] post-m1-p3-c2g: live Facilities exposes canonical CRUD, recurrence, conflicts, and automation cleanup — PASS
```

Note: this shared worktree has several other units actively editing sibling pages concurrently. Two
interim `npm run typecheck` runs and one interim full-suite Playwright run transiently failed with
errors in `pages/dashboard`, `pages/planner`, `pages/rhythms`, or `pages/projects` (files this unit
never touched) while those units were mid-save; retrying once the tree was quiescent produced the clean
results above. `git status`/`ls -la` timestamps on those files confirm the churn was external.

## Checks run

- `npm run typecheck` (`tsc -b`, whole project) — exit 0, clean.
- `npm run build` (`tsc -b && vite build`) — exit 0, clean; `dist/` produced.
- `npx tsc --noEmit` scoped to just the 4 changed/added files (isolated from concurrent sibling
  breakage) — no errors.
- Fixture Playwright specs for Messages/Facilities — 36/36 passed.
- Live Playwright specs (`post-m1-phase-3-live-playwright.config.ts`) — c2f and c2g both passed, both
  in isolation and inside the full 13-test run.

## Blockers / follow-ups for the orchestrator

1. Real production session-token wiring for Messages/Facilities requires extending
   `GatewayDomainContracts`/`createLiveGateway` in `apps/web/src/gateway/index.ts` (forbidden for this
   unit). Until then, live Messages/Facilities work under the Playwright/dev disposable-token harness
   but render a bounded config error in a packaged build with no token.
2. Grouped multi-room reservations, reservation/series edit, and a standalone conflict-check step are
   not implemented in the live Facilities page (create/delete + series-create + automation
   preview/cleanup are).
