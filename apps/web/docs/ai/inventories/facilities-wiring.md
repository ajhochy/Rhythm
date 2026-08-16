# Facilities integration wiring — issue 2007

## Route registration ask

In `src/App.tsx`, import `FacilitiesPage` from `./pages/facilities` and route all Facilities paths to it:

```tsx
else if (route === '/facilities' || route.startsWith('/facilities/')) content = <FacilitiesPage route={route} />;
```

Recommended canonical page-owned routes:

- `#/facilities` — Overview mode, default Week range.
- `#/facilities/rooms` — building-grouped Rooms mode.
- `#/facilities/rooms/:facilityId` — Rooms mode with matching room detail open.
- `#/facilities/reservations/:reservationId` — Overview with matching reservation/group detail open.

Do not add a standalone series route: Flutter exposes series details and whole-series actions only through an occurrence. Invalid ids stay within the Facilities shell and render a recoverable not-found state. Query state follows the hash path, e.g. `#/facilities/rooms?state=readonly`.

## EndpointContract additions

Append these exact objects to `endpointContracts`:

```ts
{ id: 'facilities-list', control: 'Facilities page load / Retry / post-mutation refresh', method: 'GET', route: '/facilities', handler: 'getAll', flutterSource: 'features/facilities/data/facilities_data_source.dart:18-28', test: 'issue-2007-c1,c8,c9' },
{ id: 'facility-create', control: 'Add Space', method: 'POST', route: '/facilities', handler: 'create', flutterSource: 'features/facilities/data/facilities_data_source.dart:30-38', test: 'issue-2007-c8', payload: '{name,description?,building?}' },
{ id: 'facility-update', control: 'Edit room', method: 'PATCH', route: '/facilities/:id', handler: 'update', flutterSource: 'features/facilities/data/facilities_data_source.dart:40-51', test: 'issue-2007-c8', payload: '{name,description,building}' },
{ id: 'facility-delete', control: 'Delete room', method: 'DELETE', route: '/facilities/:id', handler: 'remove', flutterSource: 'features/facilities/data/facilities_data_source.dart:53-59', test: 'issue-2007-c8' },
{ id: 'facility-reservations-list', control: 'Initial room schedules / room detail availability', method: 'GET', route: '/facilities/:id/reservations', handler: 'getReservations', flutterSource: 'features/facilities/data/facilities_data_source.dart:61-71', test: 'issue-2007-c1,c2,c9' },
{ id: 'facilities-reservations-overview', control: 'Overview load / range, building, room filters / Retry', method: 'GET', route: '/facilities/reservations?start=:start&end=:end&facilityId=:facilityId?&building=:building?', handler: 'getAllReservations', flutterSource: 'features/facilities/data/facilities_data_source.dart:73-94', test: 'issue-2007-c1,c2' },
{ id: 'facility-reservation-series-list', control: 'Initial recurring metadata', method: 'GET', route: '/facilities/:id/reservation-series', handler: 'getReservationSeries', flutterSource: 'features/facilities/data/facilities_data_source.dart:96-106', test: 'issue-2007-c1,c6,c7' },
{ id: 'facility-reservation-series-detail', control: 'Open uncached recurring reservation details', method: 'GET', route: '/facilities/:id/reservation-series/:seriesId', handler: 'getReservationSeriesDetail', flutterSource: 'features/facilities/data/facilities_data_source.dart:108-124', test: 'issue-2007-c7' },
{ id: 'facility-reservation-create', control: 'Reserve Space / Reserve this room Submit', method: 'POST', route: '/facilities/:id/reservations', handler: 'createReservation', flutterSource: 'features/facilities/data/facilities_data_source.dart:126-139', test: 'issue-2007-c3,c4', payload: '{title,requester_name,requester_user_id?,facility_ids?,start_time,end_time,notes?}' },
{ id: 'facility-reservation-update', control: 'Save reservation / reservation group', method: 'PATCH', route: '/facilities/:id/reservations/:reservationId', handler: 'updateReservation', flutterSource: 'features/facilities/data/facilities_data_source.dart:174-188', test: 'issue-2007-c4,c5', payload: '{title,requester_name,requester_user_id?,facility_ids?,start_time,end_time,notes}' },
{ id: 'facility-reservation-delete', control: 'Delete reservation / linked group', method: 'DELETE', route: '/facilities/:id/reservations/:reservationId', handler: 'deleteReservation', flutterSource: 'features/facilities/data/facilities_data_source.dart:190-196', test: 'issue-2007-c5' },
{ id: 'facility-reservation-series-create', control: 'Recurring reservation Submit', method: 'POST', route: '/facilities/:id/reservation-series', handler: 'createReservationSeries', flutterSource: 'features/facilities/data/facilities_data_source.dart:141-154', test: 'issue-2007-c6', payload: '{title,requester_name,requester_user_id?,facility_ids?,recurrence_type,recurrence_interval?,weekday_pattern?,custom_dates?,start_time,end_time,start_date,end_date,notes?}' },
{ id: 'facility-reservation-series-update', control: 'Save entire series', method: 'PATCH', route: '/facilities/:id/reservation-series/:seriesId', handler: 'updateReservationSeries', flutterSource: 'features/facilities/data/facilities_data_source.dart:156-172', test: 'issue-2007-c7', payload: '{title,requester_name,requester_user_id?,facility_ids?,recurrence_type,recurrence_interval?,weekday_pattern?,custom_dates?,start_time,end_time,start_date,end_date?,notes?}' },
{ id: 'facility-reservation-series-delete', control: 'Delete entire series', method: 'DELETE', route: '/facilities/:id/reservation-series/:seriesId', handler: 'deleteReservationSeries', flutterSource: 'features/facilities/data/facilities_data_source.dart:198-206', test: 'issue-2007-c7' },
{ id: 'facility-automation-reservations-preview', control: 'Manage automation reservations preview / filters', method: 'GET', route: '/facilities/automation-reservations/preview?facilityId=:facilityId?&startAfter=:startAfter?&endBefore=:endBefore?', handler: 'previewAutomationReservations', flutterSource: 'features/facilities/data/facilities_data_source.dart:208-229', test: 'issue-2007-c10' },
{ id: 'facility-automation-reservations-delete', control: 'Delete automation reservations', method: 'DELETE', route: '/facilities/automation-reservations?facilityId=:facilityId?&startAfter=:startAfter?&endBefore=:endBefore?', handler: 'deleteAutomationReservations', flutterSource: 'features/facilities/data/facilities_data_source.dart:231-250', test: 'issue-2007-c10' },
```

`GET /facilities/reservations` must be registered before `/:id` routes on the server, as it already is (`routes/facilities_routes.ts:9-27`). Do not collapse it into the per-room GET. Do not add a series occurrence PATCH/DELETE contract: Flutter has no occurrence-only control or route.

## Exact visible receipts

The page ledger (`data-testid="page-trace"`) appends receipts in Flutter order. Initial ready load includes:

- `GET /facilities → 200`.
- For each deterministic room id, `GET /facilities/:id/reservations → 200` and `GET /facilities/:id/reservation-series → 200`.
- `GET /facilities/reservations?start=2026-08-10T00:00:00.000&end=2026-08-16T23:59:59.999 → 200` for the default week overview.

Filter/range changes append a new overview GET containing only active optional query keys. Client-only mode changes, dialog/menu open/close, room selection, availability calculation, recurrence choice, custom-date edits, and confirmation cancel never append fake receipts.

Mutation receipts:

- `POST /facilities/:id/reservations {title,requester_name,requester_user_id,facility_ids,start_time,end_time,notes} → 201` (omit optional keys when absent), followed by Flutter-equivalent facilities/per-room/series refresh and overview reload receipts.
- `PATCH /facilities/:id/reservations/:reservationId {title,requester_name,requester_user_id,facility_ids,start_time,end_time,notes} → 200`, followed by the same refresh family.
- `DELETE /facilities/:id/reservations/:reservationId → 204`, followed by refresh receipts.
- Series POST/PATCH use the payloads above and statuses 201/200, then refresh; series DELETE is 204 then refresh.
- Facility POST/PATCH/DELETE are 201/200/204. Create/edit update the page inventory immediately; delete removes its room and schedule records.
- Automation preview is GET 200; filtered queries include active `facilityId`, `startAfter`, and `endBefore`. Cleanup is DELETE 200 and returns `{deleted}`, followed by facility reload; the visible result states the returned deleted count.

## Cross-page consistency

- Tasks automation rules load Facilities as selectable rooms and tell users to add one in Facilities when none exist (`features/tasks/views/automation_rules_view.dart:1855-1869,2154-2168`). Keep shared facility ids/names stable; Facilities CRUD should update only this page's deterministic inventory until the lead intentionally lifts shared fixtures.
- Automation-created reservation fixtures should use task/rule names consistent with Tasks/Rhythms owners where practical, but Facilities owns cleanup preview counts and receipts. No runtime coupling or cross-page local storage.
- Dashboard/Planner date fixtures must agree that fixed now is Wednesday Aug 12, 2026. Facilities' default week is Aug 10-16.
- Reservation deletion can send a direct message to another requester server-side (`controllers/facilities_controller.ts:634-678`), but Flutter shows no Messages-page control or local message receipt. Do not fabricate a Messages endpoint receipt in fixture mode.
- Shell's Facilities nav remains `/facilities`. The lead updates the existing placeholder assertion in `tests/shell.spec.ts`; this page owner does not touch it.

## Shared UI asks

None. Keep all facility fixtures, state, dialogs, and styles page-local under `src/pages/facilities/`. Reuse the Shell navigation, global toast, existing menu/dialog/state/trace patterns, tokens, and icons. A room/calendar glyph can be composed from existing page-local markup if the shared icon set lacks one; do not request a shared icon solely for decoration.

## Lead decisions resolved for implementation

1. Whole-series-only recurring edit/delete is approved parity. One-occurrence exceptions are explicitly deferred product work: they require new UX and API semantics because Flutter routes every recurring call site to series PATCH/DELETE (`facilities_view.dart:2666-2729,3951-3974,4010-4028,4079-4182`). The prototype does not invent occurrence controls or receipts.
2. The four route forms above are approved, with no standalone series route. Unknown room and reservation ids render an in-page recoverable not-found state.
3. The ready fixture identity is a Facilities manager. `readonly` plus an other-user-owned reservation demonstrate permission gates with native disabled controls, `aria-disabled` fieldsets, and visible prerequisite copy.
4. Visible ledger receipts use readable, unescaped ISO timestamps even though a real HTTP client URL-encodes reserved characters.
5. Automation preview preserves Flutter's UI-only manager gate. Cleanup remains manager-enforced. Server-side preview hardening is a Rhythm-repo follow-up outside this fixture prototype.
6. Destructive confirmations name the target, Cancel preserves it without a receipt, and Confirm emits the exact mutation receipt.
