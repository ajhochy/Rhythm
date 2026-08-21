# Messages behavior inventory — issue 2006

## Sources and notation

Behavior authority is the read-only Flutter Messages feature. Citations use these aliases:

- `MV` — `apps/desktop_flutter/lib/features/messages/views/messages_view.dart`
- `MC` — `apps/desktop_flutter/lib/features/messages/controllers/messages_controller.dart`
- `MR` — `apps/desktop_flutter/lib/features/messages/repositories/messages_repository.dart`
- `MD` — `apps/desktop_flutter/lib/features/messages/data/messages_data_source.dart`
- `MT` — `apps/desktop_flutter/lib/features/messages/models/message_thread.dart`
- `MM` — `apps/desktop_flutter/lib/features/messages/models/message.dart`
- `NS` — `apps/desktop_flutter/lib/app/core/layout/navigation_sidebar.dart`
- `AS` — `apps/desktop_flutter/lib/app/core/layout/app_shell.dart`

API disambiguation cites paths relative to `apps/api_server/src/`. The API mounts the authenticated routers at `/users` and `/message-threads` (`app.ts:136-137`); the exact message methods are registered in `routes/messages_routes.ts:8-14`, and `GET /users` is registered in `routes/users_routes.ts:8-10`.

## Shipped composition and data flow

The Flutter page loads threads and starts 30-second polling after its first frame, stops polling on dispose, and filters the already-loaded list locally by a case-insensitive title substring (`MV:18-39,90-95`; `MC:202-209`). It is a fixed two-panel desktop row: a 330px thread rail and an expanding conversation panel (`MV:42-74,97-105`). Selecting a thread immediately clears that thread's unread count locally, selects it, clears the prior transcript, then performs mark-read, transcript load, and silent thread refresh in that order (`MC:98-114,211-227`).

Thread summaries contain title, last message, updated time, unread message count, participant records, and direct/group type (`MT:23-40,44-58`). Messages contain sender identity, body, timestamp, and thread identity (`MM:3-31`). The shipped conversation header renders the title, message count, and Direct/Group type, but does **not** render participant names even though the model carries them (`MV:545-612`; `MT:39`). The redesign seed explicitly requires participants, so the contract exposes participant names as read-only context; this adds no Flutter-absent control.

## Visible control inventory

| Surface/control | Type and precondition | Trigger and visible outcome | Endpoint / payload / status and failure behavior | Flutter evidence |
|---|---|---|---|---|
| Thread search | Labelled search input; thread data may be ready | Each keystroke lowercases the query and filters by thread title only. A populated no-match result shows a distinct no-results state with Clear search in the prototype; Clear is client-side | `client-side`; never adds a receipt | `MV:19-32,90-95,219-258` |
| New | Button; mutation allowed and user directory available | Opens the New Direct Message dialog; the dialog loads users after opening | Dialog open is `client-side`; directory load is `GET /users` → 200. Directory failure sets controller error | `MV:108,151-160,197-212,1017-1023`; `MC:87-96`; `MD:30-40` |
| Thread row | Selectable row; thread exists | Selects the row, immediately removes its local unread badge, clears stale transcript, loads the chosen transcript, refreshes summaries, and shows subject/type/message count. The web route becomes `/messages/<threadId>` | `POST /message-threads/:id/read` → 204, `GET /message-threads/:id/messages` → 200, `GET /message-threads` → 200. Any caught failure sets Messages error | `MV:128-142,280-305,334-371`; `MC:98-114`; `MD:62-92` |
| Thread actions | Popup menu button on every thread | Opens one action: Mark as read when unread, otherwise Mark as unread. Menu closes after selection | Menu open/close is `client-side`; mutation endpoints below | `MV:376-420` |
| Mark as read | Menu item; thread unread | Optimistically sets that thread's unread count to zero, then refreshes the thread list | `POST /message-threads/:id/read` → 204, then `GET /message-threads` → 200. Failure leaves the optimistic local zero and sets error | `MV:392-400`; `MC:178-189,211-227`; `MD:18-28,84-92` |
| Mark as unread | Menu item; thread currently read | Calls the endpoint and refreshes; refreshed unread count is server-derived | `POST /message-threads/:id/unread` → 204, then `GET /message-threads` → 200. Failure sets error | `MV:392-400`; `MC:191-200`; `MD:18-28,94-102` |
| Incoming message Dismiss | Button; polling produced an incoming notice | Removes the visible sender/preview banner only | `client-side`; system notification creation is background behavior, not a page control | `MV:705-783`; `MC:172-176,265-327` |
| Reply body | Multiline text field; thread selected | Accepts up to four visible lines; Enter sends, Shift+Enter inserts a newline | Validation is client-side: trim then silently ignore empty input, with no receipt | `MV:498-504,885-962` |
| Send | Button; thread selected and mutation allowed | Sends trimmed content. Success appends the returned message once, updates/reorders the thread locally, refreshes threads, clears the composer, and scrolls to the transcript end | `POST /message-threads/:id/messages {body}` → 201, then `GET /message-threads` → 200. Controller catches failure; because its returned future still completes, Flutter currently clears the draft and scrolls even after failure | `MV:498-517,626-646,963-987`; `MC:138-151,229-243`; `MD:74-82`; API `controllers/messages_controller.ts:60-74` |
| New-thread Direct/Group | Two-option local toggle inside dialog | Direct permits exactly one selected user and makes title optional; Group makes title required. Switching a multi-select Group to Direct keeps the first selected user | `client-side`; never adds a receipt | `MV:1012-1038,1077-1111` |
| New-thread title | Text input inside dialog | Direct label is Optional title and omission lets the server default the title to participants; Group label is Group name (required) | Included in create payload only when trimmed and non-empty | `MV:1033-1047,1113-1136`; `MD:42-60`; API `repositories/messages_repository.ts:308-318,361-373` |
| Recipient checkboxes | User list; users loaded | Direct selection replaces any prior recipient; Group selection is additive/removable. Names and emails are visible | Selection is `client-side`; candidates came from `GET /users` | `MV:1138-1193` |
| Cancel new thread | Dialog button | Closes without creating or changing selection | `client-side`; no receipt | `MV:1197-1204` |
| Create new thread | Dialog button; `_canSubmit` true | Sorts recipient IDs, submits type/title, reloads list, then selects and hydrates the returned thread; the web deep link becomes `/messages/<createdId>` | `POST /message-threads {participantIds,threadType,title?}` → 201, `GET /message-threads` → 200, then selection receipts `POST /message-threads/:id/read` → 204, `GET /message-threads/:id/messages` → 200, `GET /message-threads` → 200. Failure sets controller error, but Flutter's caught future allows the dialog to close anyway | `MV:1002-1006,1033-1049,1205-1209`; `MC:116-136`; `MD:42-60`; API `controllers/messages_controller.ts:17-45` |

## Validation boundaries and intentional corrections

- There is no initial-message/body field in the Flutter new-thread dialog. It creates an empty thread only (`MV:1012-1211`; `MD:42-60`). The issue seed's “body” validation therefore belongs to Reply, not New thread. The contract does not invent an initial-body control.
- Direct requires exactly one selected other user in the dialog and again in the API repository (`MV:1033-1037`; API `repositories/messages_repository.ts:290-299,340-350`). A direct title is optional and may default to participant names (`MV:1118-1123`; API `repositories/messages_repository.ts:308-318`).
- Group helper text says “Select participants (2 or more),” but `_canSubmit` only rejects an empty selection; a one-recipient group is enabled (`MV:1033-1037,1143-1147`). The API also only validates a non-empty participant array and has no group minimum (`controllers/messages_controller.ts:17-40`). The contract follows executable Flutter/API validation—one or more group recipients plus required title—while keeping the mismatch open for product resolution.
- Blank Reply is trimmed and ignored (`MV:498-504`). For an accessible web surface the contract requires a visible validation message and retained focus/draft with no receipt; this is a behavior correction, not a new control.
- Flutter catches send/create failures inside controller futures, so callers clear the reply or close the dialog as if the operation succeeded (`MV:505-516,1040-1050`; `MC:116-151`). The state-matrix contract requires truthful recoverable fixture errors; implementation should retain input on a failed mutation.

## Read/unread and global badge derivation

Two counts coexist in Flutter: `unreadThreadCount` counts threads where `unreadCount > 0`, while `totalUnreadCount` sums every thread's unread **message** count (`MC:48-56`; `MT:66`). The app-shell Messages badge watches `totalUnreadCount`, not unread thread count (`NS:45-48,97-103`). API summaries calculate each unread count from other-sender messages newer than the user's last-read timestamp (`api_server/src/repositories/messages_repository.ts:150-180,182-215`). Mark unread sets `last_read_at` to null, so it can restore more than one unread message on refresh (`api_server/src/repositories/messages_repository.ts:530-555`).

Cross-page baseline: ready fixtures must contain exactly six unread threads, each with `unreadCount: 1`. That simultaneously yields `unreadThreadCount = 6`, Flutter-style `totalUnreadCount = 6`, and the shell's required initial accessible label “6 unread.” Search is client-side and must not change either global count. Marking one fixture thread read changes both page unread-thread summary and future dynamically wired shell badge from 6 to 5; marking it unread restores both to 6. The lead must preserve the initial fixed-shell assertion even if dynamic wiring is deferred.

## Route and deep-link inventory

Flutter navigation is index-based, not URL-based: Messages is shell index 5 and `MessagesView` occupies position 5 (`AS:322-345`). Dashboard selects a thread through the controller before switching to Messages (`dashboard/views/dashboard_view.dart:497-504`), so selection survives within the in-memory Flutter shell rather than through a URL.

The web contract adds URL representation without inventing behavior:

- `#/messages` — ready thread list with no selected conversation and the “Select a conversation” state (`MV:545-547,656-702`).
- `#/messages/<threadId>` — selects and hydrates the matching fixture thread. Canonical seeded link: `#/messages/thread-weekend-team`.
- Clicking a thread uses `navigate('/messages/<threadId>')`; invalid IDs render a recoverable thread-not-found message while retaining search/list navigation.
- Query state remains after the path, e.g. `#/messages/thread-weekend-team?state=readonly`.

## State inventory and deterministic matrix

Flutter directly models `idle`, `loading`, and `error` (`MC:11,41-53`). Initial loading replaces only an empty thread rail with a spinner (`MV:115-123`); an empty or no-match filtered list uses the same “No conversations” copy (`MV:122-124,434-474`). No selected thread and selected thread with no messages are distinct local states (`MV:545-547,616-625,656-702`). Controller errors are stored but this view never renders `errorMessage`, so shipped failures can leave stale/empty content without visible recovery (`MC:68-96,98-151,178-200`; no `errorMessage` read in `MV`). Authentication/server availability gates live above the page: polling is enabled only when the local API is ready and the user is authenticated (`AS:101-123`). Flutter has no page-specific role check; message routes require authentication (`api_server/src/routes/messages_routes.ts:8`).

The shared redesign matrix is URL-driven and deterministic:

- `ready` (default): populated fixture list, exactly six unread threads at one unread message each, no selected transcript at `/messages`, selected transcript at a deep link.
- `loading`: `page-state-loading`, status semantics, no mutating controls.
- `empty`: `page-state-empty`, no threads, and primary New conversation escape hatch.
- `server-error`: `page-state-server-error` alert plus `page-retry`; Retry uses `history.replaceState` and restores ready without reload.
- `forbidden`: `page-state-forbidden`, names authenticated workspace membership as prerequisite.
- `unavailable`: `page-state-unavailable`, names the local Rhythm API/server prerequisite.
- `readonly`: `page-state-readonly`, keeps search, selection, transcript, and participants inspectable while native disabled fieldsets disable New, Send, and mark read/unread.
- Interactive no-results is not the global `empty` state: it retains the query, displays `messages-no-results`, and exposes Clear search.
- Invalid deep link is not a server error: it displays `messages-thread-not-found` with a Back to conversations action.

## Background behavior (not additional controls)

Polling is 30 seconds by default (`MC:25-35,202-204`). When Messages is active, polling refreshes the selected transcript, identifies messages with new IDs, shows an in-page incoming banner plus local OS notification, marks the selected thread read, then refreshes threads (`MC:245-287`). When another thread's unread count rises, the first qualifying thread generates a banner/notification unless it is selected (`MC:289-327`). The fixture-only prototype must not use real timers, OS notifications, or network. It may seed and dismiss an incoming banner deterministically; no receipt is attributed to Dismiss.

## Visual translation

The mineral reference establishes a dark blue-green canvas/surface hierarchy, restrained turquoise accent, hairline mineral borders, 10/16/24px radii, Inter UI text, SF Mono operational counts, 44px controls, and a danger-colored shell badge (`../rhythm-dashboard-redesign.html:11-74,82-159`). Messages should translate Flutter's two-panel information architecture into that language using the existing tokens. At narrow widths, the thread list and conversation become one-at-a-time views with a visible Back to conversations control; this is a responsive representation of the same selection behavior, not a new data action.

## Open questions

1. Should Group truly require two **other** participants, matching its helper copy, or keep the currently executable one-or-more rule shared by Flutter and the API?
2. Should a failed create/send remain inside the dialog/composer with its draft intact? The contract chooses truthful recovery, while Flutter currently closes/clears because controller methods catch errors before their futures complete.
3. Should the shell badge eventually represent unread threads or total unread messages? Flutter uses total unread messages; the redesign seed and fixed baseline phrase it as six unread threads. Fixtures intentionally make both equal to six.
4. Should selecting a thread always record `POST /read` even if it is already read? Flutter does, and the contract preserves that exact selection sequence.
5. Participants are present in the thread payload but absent from the shipped header. The issue seed requires them; confirm whether email addresses should remain dialog-only or also appear in transcript context.
