# Facilities behavior inventory — issue 2007

## Sources and notation

Behavior authority is the read-only Flutter Facilities feature. Citations use these aliases:

- `FV` — `apps/desktop_flutter/lib/features/facilities/views/facilities_view.dart`
- `FC` — `apps/desktop_flutter/lib/features/facilities/controllers/facilities_controller.dart`
- `FR` — `apps/desktop_flutter/lib/features/facilities/repositories/facilities_repository.dart`
- `FD` — `apps/desktop_flutter/lib/features/facilities/data/facilities_data_source.dart`
- `FM` — `apps/desktop_flutter/lib/features/facilities/models/facility.dart`
- `RM` — `apps/desktop_flutter/lib/features/facilities/models/reservation.dart`
- `SM` — `apps/desktop_flutter/lib/features/facilities/models/reservation_series.dart`
- `AU` — `apps/desktop_flutter/lib/app/core/auth/auth_user.dart`
- `AS` — `apps/desktop_flutter/lib/app/core/layout/app_shell.dart`

API disambiguation cites paths relative to `apps/api_server/src/`. The authenticated Facilities router is mounted at `/facilities` (`app.ts:138`; `routes/facilities_routes.ts:8-55`).

## Shipped composition and data flow

Flutter opens in **Overview / Week** mode around the current week, loads facilities, then in parallel loads every room's reservations and reservation series before loading the cross-facility overview (`FV:26-46,93-130`; `FC:138-167`). The second **Rooms** mode groups facilities alphabetically by building, puts rooms without a building under Unassigned, and sorts rooms within each group (`FV:2790-2825,2840-2871`). The Flutter shell exposes one index-based Facilities destination; it has no URL router or native deep links (`AS:322-345`).

The cross-facility overview is not the same request as per-room hydration. It calls `GET /facilities/reservations` with optional `start`, `end`, `facilityId`, and `building`; the initial room inventory separately calls `GET /facilities/:id/reservations` and `GET /facilities/:id/reservation-series` for each facility (`FC:146-160,169-208`; `FD:61-124`).

Reservation rows are clustered by `reservationGroupId`, otherwise series plus occurrence timestamp, otherwise reservation id. A cluster can therefore represent a linked multi-room booking, one recurring occurrence, or one ordinary reservation (`FV:392-473,505-521`). Overview renders room/building/requester metadata, setup notes, series/external/conflict badges, and partial-conflict status (`FV:2423-2645`).

## Visible control inventory

| Surface/control | Type and precondition / permission | Trigger and visible outcome | Endpoint / payload / status and failure behavior | Flutter evidence |
|---|---|---|---|---|
| Reserve Space | Primary header button; authenticated user, at least one facility | Opens Reserve space dialog, initially selecting the first room | Dialog open is `client-side`; create endpoints are below | `FV:72-75,141-151,820-891,4405-4409` |
| Overview / Rooms | Two-option segmented control | Switches between schedule overview and building-grouped room inventory | `client-side`; initial data remains loaded | `FV:78-95,1120-1147` |
| Day / Week / Month | Segmented range control in Overview | Resets range around now to one day, Monday-Sunday week, or calendar month and reloads overview | `GET /facilities/reservations?start&end&facilityId?&building?` → 200 | `FV:222-242,795-814,1294-1315`; `FC:169-198`; `FD:73-94` |
| Back / Forward | Buttons in Overview | Shifts current range by 1 day, 7 days, or 1 month and reloads | Same cross-facility GET; failure preserves prior rows and renders overview error banner with Retry | `FV:244-267,1316-1325,1426-1433`; `FC:185-208` |
| Building filter | Select; buildings derive from nonblank facility building values | Filters the room options, clears an incompatible selected room, and reloads overview | Same cross-facility GET with `building`; not a separate endpoint | `FC:60-66`; `FV:106-129,1333-1353` |
| Room filter | Select | Reloads overview for all rooms or one `facilityId` | Same cross-facility GET with `facilityId` | `FV:1355-1375`; `FC:169-198` |
| Start / End date | Read-only picker fields | Selects an inclusive range; Start moves End forward if needed; End cannot precede Start; reloads overview | Same cross-facility GET with `start` and `end` | `FV:269-308,1377-1392,1519-1543` |
| Week strip | Seven read-only day cells in Week mode | Shows booking counts and whether each day has a conflict | `client-side`, derived from overview response | `FV:1399-1415,2195-2337` |
| Overview metrics and Attention needed | Read-only cards/rows | Shows rooms in use, setup-note count, conflict count, external-change count; attention rows open reservation details | `client-side`, derived from overview data | `FV:1720-1864,1952-2017` |
| Reservation row / Open details | Clickable row and menu action | Opens detail dialog with title, rooms, date/time, requester/booker, notes, grouped/series context | Dialog open is `client-side`; uncached series detail may call `GET /facilities/:id/reservation-series/:seriesId` → 200 | `FV:2423-2463,2647-2709,3809-3950`; `FD:108-124` |
| Edit reservation | Menu/detail action; Facilities manager or reservation creator | Opens prefilled dialog. A single ordinary booking cannot change room; a linked group can change selected rooms. Success refreshes facilities and overview and shows Reservation updated or group result summary | `PATCH /facilities/:id/reservations/:reservationId {title,requester_name,requester_user_id?,facility_ids?,start_time,end_time,notes}` → 200 | `FV:559-567,2658-2679,3951-3961,3984-4042,4576-4585,5059-5069,5134-5146`; `FC:246-281`; `FD:174-188` |
| Delete reservation / group | Destructive action; Facilities manager or reservation creator | Confirms first. Ordinary deletion removes one reservation. Calling DELETE on one linked group member removes the whole linked group and all room rows | `DELETE /facilities/:id/reservations/:reservationId` → 204; failure is surfaced by the caller/error state | `FV:624-665,2681-2701,3962-3975,4044-4113`; API `controllers/facilities_controller.ts:634-678` |
| Room selection | Building-grouped checkboxes plus Select all/Clear; locked for ordinary edit, editable for create/group edit | One room creates a normal booking; several rooms create a linked group; zero rooms produces “Select at least one room” | Selection is `client-side`; selected ids become `facility_ids` on mutation | `FV:4576-4585,5293-5434`; `FC:211-240,246-278` |
| Title | Required text field | Blank title is rejected before a request | `client-side` validation; API also rejects missing title | `FV:4588-4595,4833-4841`; API `controllers/facilities_controller.ts:202-220` |
| Requester | Required text field; read-only for non-managers, editable for Facilities managers | Defaults to signed-in user; managers can book/reassign for someone else | Included as `requester_name`, with `requester_user_id` only when it matches the current user. API rejects non-manager reassignment | `FV:4412-4417,4597-4613,4881-4887`; `FC:223-238`; API `controllers/facilities_controller.ts:240-267,543-563` |
| Availability panel | Read-only live preview in reservation dialog | For each selected room, shows reservations on the chosen date and marks strict time overlaps; selected slot reports open or conflict. Existing edited reservation/group members are excluded from preview | `client-side`, derived from per-room hydration | `FV:4324-4393,4615-4625,5437-5613` |
| Date / Start Time / End Time | Required picker fields | Picks date and times; rejects missing values and `end <= start` | `client-side`; recurring API also validates ISO times and ordering | `FV:4628-4681,4833-4867,5179-5263`; API `services/facilities_booking_service.ts:455-466` |
| Notes | Optional multiline input | Persists setup/context notes; clearing notes on edit sends null | Included as optional `notes` on create and `notes:null` when cleared on update | `FV:4788-4793,4913,4991-5008,5060-5132`; `FC:228-238,263-272` |
| Submit / Save changes | Button disabled while saving | Single-room create blocks a locally detected overlap and otherwise creates; edit updates. Success closes with toast; failure retains dialog and shows Error | `POST /facilities/:id/reservations {...}` → 201 or PATCH above → 200 | `FV:4795-4821,4914-4926,5059-5155`; `FD:126-139,174-188` |
| Multi-room create/edit | Same dialog with more than one room | Server skips conflicting rooms, creates/updates available rooms, and shows Created in / Updated in / Removed from plus conflict messages. If every room conflicts, request fails | Same POST/PATCH with `facility_ids`; response is `reservations[]` plus `conflicts[]` | `FV:4933-5056`; `RM:89-143`; API `repositories/facilities_repository.ts:1017-1118,1761-1887` |
| Recurring reservation | Switch, absent while editing one ordinary reservation and fixed on while editing series | Reveals Weekly, Bi-weekly, Monthly, Custom dates choices | `client-side` until Submit | `FV:4683-4731` |
| Recurrence choices | Choice chips | Weekly sends interval 1; biweekly/monthly/custom send recurrence type; non-custom requires a series end; custom includes first date automatically and supports add/remove extra dates | Choice/add/remove are `client-side`; payload keys below | `FV:755-793,4732-4786,4868-4877,4901-4912,5158-5234` |
| Create recurring series | Submit in recurring mode | Creates all nonconflicting occurrences, then shows count created and conflicted dates/reasons | `POST /facilities/:id/reservation-series {title,requester_name,requester_user_id?,facility_ids?,recurrence_type,recurrence_interval?,custom_dates?,start_time,end_time,start_date,end_date,notes?}` → 201 | `FV:1669-1717,4937-4984,5097-5122`; `FC:319-360`; `FD:141-154`; API `services/facilities_booking_service.ts:115-159,272-327` |
| Edit entire series | Action only on a non-group recurring occurrence; creator or manager | Loads/caches series detail if needed, opens prefilled recurring dialog, regenerates the whole series, and shows recurring summary | `GET /facilities/:id/reservation-series/:seriesId` → 200 if uncached; `PATCH /facilities/:id/reservation-series/:seriesId {...}` → 200 | `FV:603-622,2666-2672,3936-3946,3951-3960,4010-4028,5070-5096`; `FD:108-124,156-172` |
| Delete entire series | Destructive action only on a non-group recurring occurrence; creator or manager | Confirms that all generated reservations will be removed, then deletes the series | `DELETE /facilities/:id/reservation-series/:seriesId` → 204 | `FV:667-698,2689-2694,3962-3974,4079-4081,4115-4182`; `FD:198-206` |
| Room row | Clickable row in Rooms | Shows room name, building/location/description summary, availability/upcoming count; click opens room detail with up to five future reservations | `client-side`, derived from initial per-room GETs | `FV:3043-3153,3233-3453,3485-3525` |
| Reserve / Reserve this room | Buttons on room row/detail | Opens reservation dialog with that room preselected | `client-side` until Submit | `FV:3136-3153,3211-3219,3431-3445` |
| Room management bar | Visible only to Facilities managers | Exposes Manage automation reservations and Add Space | Permission is client-side visibility backed by server manager checks on writes | `FV:2815-2818,2874-2932`; `FC:51-66`; API `controllers/facilities_controller.ts:37-40` |
| Add Space | Manager-only | Opens Add space dialog. Room name required; Building can be absent, selected, or newly named; Description optional. Success inserts sorted deterministic inventory and shows Space created | `POST /facilities {name,building?,description?}` → 201 | `FV:899-1117,2922-2928`; `FC:68-89`; `FD:30-38`; API `controllers/facilities_controller.ts:122-143` |
| Edit room | Manager-only menu action | Prefills name/building/description, validates, updates sorted inventory, shows Space updated | `PATCH /facilities/:id {name,building,description}` → 200 | `FV:939-1109,3154-3188`; `FC:91-117`; `FD:40-51` |
| Delete room | Manager-only menu action | Confirms “Delete space?”, removes facility and its reservation/series/overview rows | `DELETE /facilities/:id` → 204 | `FV:191-220,3154-3188`; `FC:119-136`; `FD:53-59` |
| Manage automation reservations | Manager-only page control | Opens a dialog and immediately loads cleanup preview | Dialog open is `client-side`; preview endpoint below | `FV:154-166,2914-2920,5811-5842` |
| Automation facility/start/end filters | Optional select and clearable date pickers | Every change refreshes preview; preview shows total and count by facility, or explicit zero result | `GET /facilities/automation-reservations/preview?facilityId?&startAfter?&endBefore?` → 200 | `FV:5844-5867,5914-5983`; `FD:208-229` |
| Delete N automation reservations | Destructive button only when preview total > 0 | Button label is the current preview count and the dialog itself is the confirmation surface. Success closes, reloads facilities, and reports Deleted N automation reservations; failure remains in dialog | `DELETE /facilities/automation-reservations?facilityId?&startAfter?&endBefore?` → 200 with `{deleted}` | `FV:5869-5889,5989-6013`; `FD:231-250`; API `controllers/facilities_controller.ts:703-721` |

## Permission boundaries

- `isFacilitiesManager` is a dedicated user capability, separate from the general `role`; it defaults false (`AU:3-24,26-34`).
- Manager-only UI: Add/Edit/Delete room, automation cleanup, and editable Requester (`FV:2815-2818,2914-2928,3154-3188,4597-4609`). The API independently enforces manager access for facility create/update/delete and automation deletion (`controllers/facilities_controller.ts:37-40,122-165,713-721`).
- Reservation/series mutation is allowed to a Facilities manager or the user who created it—not merely the requester (`FV:559-567`; API `controllers/facilities_controller.ts:42-65`). Other users get Open details only (`FV:2647-2732,3950-3980`).
- Any authenticated user may reserve for themselves. Only managers can enter another requester; the server rejects non-manager booking/reassignment for another user (`FV:4597-4609`; API `controllers/facilities_controller.ts:240-267,333-360,428-435,543-563`).
- All routes require authentication (`routes/facilities_routes.ts:8`). The Flutter shell also assumes an active workspace before composing the page (`AS:305-328`).

## Validation and conflict boundaries

- Flutter validates required room, title, requester, date, start, end, and end-after-start before mutation (`FV:4588-4612,4631-4677,4833-4877`).
- Conflict overlap is strict: existing start `<` selected end and existing end `>` selected start, so touching boundaries are allowed (`FV:4388-4393,5607-5612`).
- Single ordinary create/edit is blocked locally when an overlap exists (`FV:4914-4926`). Multi-room and recurring requests deliberately reach the server so partial successes and per-room/per-date conflicts can be reported (`FV:4933-5055`; API `repositories/facilities_repository.ts:1035-1059`; `services/facilities_booking_service.ts:272-327`).
- Recurring non-custom series require an end date. Custom series always includes the primary date, de-duplicates dates, and uses the last custom date as `end_date` (`FV:4733-4786,4868-4877,4907-4912,5158-5177`).
- Facility create/edit exposes name, building, and description. Although the model/API supports `location`, this dialog does not expose a Location control (`FM:1-24`; `FV:988-1048,1081-1102`). Do not invent capacity/location management.

## Recurring occurrence boundary — important correction

Flutter does **not** distinguish “this occurrence” from “entire series” with separate controls. On a recurring occurrence the action labels are “Edit series” / “Edit entire series” and “Delete series” / “Delete entire series”; those paths call the series PATCH/DELETE endpoints (`FV:2666-2729,3951-3974,4010-4028,4079-4182`). A single-reservation edit code path exists generically, but every recurring call site routes to whole-series handling. The contract therefore asserts the absence of occurrence-only controls. Adding them would invent behavior and an endpoint semantic Flutter does not expose.

Grouped recurring occurrences are another edge: clustering prioritizes group id, and grouped actions say Edit/Delete reservation group; deletion can deduplicate and delete series ids when no group id is available (`FV:505-555,2660-2694,3931-3974,4044-4148`). This interaction is ambiguous enough to keep as an open question rather than invent a separate UI.

## Route and deep-link inventory

Flutter navigation is index-based and has no Facilities subroutes (`AS:322-345`). The web route representation should preserve only surfaces that exist:

- `#/facilities` — Overview mode, Week range by default.
- `#/facilities/rooms` — Rooms mode.
- `#/facilities/rooms/:facilityId` — Rooms mode with the matching room detail open.
- `#/facilities/reservations/:reservationId` — Overview with the matching reservation/group detail open.

There is no standalone series browser in Flutter, so no `/facilities/series/:id` deep link should be added. Recurring series detail/actions remain attached to a reservation occurrence. Invalid room/reservation IDs render a recoverable not-found state and a Back to facilities action without pretending an API request occurred. Query state follows the path, for example `#/facilities/rooms?state=readonly`.

## State inventory and deterministic matrix

Flutter directly models initial loading, populated ready, no facilities, top-level load error with Retry, overview loading, no reservations in the selected range, and overview error with Retry (`FC:10,36-50,138-208`; `FV:83-95,1426-1453,2795-2808,3592-3688`). It also models manager/non-manager controls and creator/non-creator reservation actions. Authentication and server availability are gates above the page.

The shared web matrix maps these behaviors as follows:

- `ready` (default): deterministic manager fixture, Overview/Week, populated rooms and reservations including ordinary, grouped, recurring, conflicted, external, setup-note, owned, and other-user records.
- `loading`: `page-state-loading`, status semantics, no mutation controls.
- `empty`: `page-state-empty`, no facilities/reservations, and manager Add Space escape hatch.
- `server-error`: `page-state-server-error` alert plus `page-retry`; Retry changes the query to ready and restores deterministic data without reload.
- `forbidden`: `page-state-forbidden`, names authenticated Rhythm workspace membership as prerequisite.
- `unavailable`: `page-state-unavailable`, names the local Rhythm API/server as prerequisite.
- `readonly`: `page-state-readonly`, names Facilities manager or reservation-creator access, keeps Overview/Rooms, filters, room/reservation details, availability, and metadata inspectable, and disables every mutating control through a native disabled fieldset with `aria-disabled="true"`.
- Within normal `ready`, another user's reservation exposes details but no edit/delete actions. Manager-only room/automation controls are tied to a manager identity indicator; the implementation should not silently present them to a non-manager fixture.
- No-reservations-in-range remains a local empty result with date/filter escape hatches, distinct from global `?state=empty`.
- Invalid deep links are local not-found states, not server errors.

## Fixture requirements

Pin all timestamps around Wednesday `2026-08-12T15:48:00-07:00`. Suggested stable records:

- Rooms: `room-sanctuary` (id `101`, Main Campus), `room-fellowship-hall` (`102`, Main Campus), `room-prayer-room` (`103`, North Campus), and one unassigned long CJK/emoji room `礼拝チーム室 🎵` (`104`).
- Ordinary owned reservation id `501` (Leadership sync) on Aug 12, 10:00-11:00; conflicting other-user record id `502` (Vendor load-in) on Aug 12, 10:30-11:30; linked group `group-weekend-team` across rooms 101/102; recurring occurrence id `503` with series `series-choir-weekly`; one external record and one setup-note record.
- Manager current user is deterministic. At least one reservation has a different `createdByUserId` so ownership gates are executable.
- Mutations update only page-local state. Reload restores the exact original order/counts, ids, dates, permissions, conflicts, and automation preview totals.

## Visual translation

Use the mineral reference's dark blue-green canvas/surfaces, restrained turquoise accent, hairline borders, compact density, 10/16/24px radii, Inter UI type, and SF Mono for dates/counts/receipts (`../rhythm-dashboard-redesign.html:8-74,82-120`). Translate Flutter's information architecture—overview signals, grouped schedule, building-room inventory, and dialogs—rather than its literal light cards. Support token-driven light theme as required by the brief.

## Open questions

1. The seed mentions distinguishing one occurrence from a series, but Flutter exposes whole-series edit/delete only. Should occurrence exceptions be a later product feature with new API semantics, or is whole-series parity approved?
2. For a grouped recurring occurrence, should Edit/Delete group continue to affect only the materialized group, or should the UI always route to the entire series? Flutter's grouping-first action path and series deletion fallback are not fully consistent (`FV:505-555,2660-2694,4044-4148`).
3. `GET /facilities/automation-reservations/preview` is authenticated but not manager-gated server-side, while the Flutter entry control is manager-only; should the web contract continue UI parity (yes here) or should the API also be hardened later?
4. Facility deletion copy says it removes the room schedule “from the app,” while the repository/API cascade semantics are not stated in the Flutter UI. Should the web confirmation explicitly mention reservations, or preserve the less specific Flutter wording?
5. Should deep-linking to a recurring reservation fetch series detail if it was not present in the collection seed, or should fixture hydration always include the series cache? The contract allows and receipts the exact detail GET only when needed.
