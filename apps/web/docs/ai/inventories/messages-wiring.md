# Messages wiring note — issue 2006

## Route registration ask

Register `MessagesPage` in lead-owned `src/App.tsx` for the collection route and every thread deep link, passing the full route without the hash/query:

```tsx
if (route === '/messages' || route.startsWith('/messages/')) {
  content = <MessagesPage route={route} />;
}
```

The page parses the segment following `/messages/`; `/messages/thread-weekend-team` is the canonical seeded deep link shared with Dashboard. `/messages` renders the real page with no selected conversation. Thread selection navigates to `/messages/<threadId>` and Back to conversations navigates to `/messages`. Query state remains after the route (`#/messages/<threadId>?state=readonly`). No bare-route redirect is requested.

## `EndpointContract` additions

Ready-to-merge objects for lead-owned `src/endpointMap.ts`:

```ts
{ id: 'message-thread-list', control: 'Messages initial load / Retry / thread refresh', method: 'GET', route: '/message-threads', handler: 'listMessageThreads', flutterSource: 'messages_data_source.dart:getThreads', test: 'issue-2006-c5: visible ledger records exact message endpoint receipts and excludes client-only controls' },
{ id: 'message-users-list', control: 'New thread recipient directory', method: 'GET', route: '/users', handler: 'listMessageRecipients', flutterSource: 'messages_data_source.dart:getUsers', test: 'issue-2006-c10: new thread validates supported fields creates once and selects the result' },
{ id: 'message-thread-create', control: 'New thread Create', method: 'POST', route: '/message-threads', handler: 'createMessageThread', flutterSource: 'messages_data_source.dart:createThread', test: 'issue-2006-c10: new thread validates supported fields creates once and selects the result', payload: '{participantIds,threadType,title?}' },
{ id: 'message-thread-transcript', control: 'Select / deep-link thread', method: 'GET', route: '/message-threads/:id/messages', handler: 'listThreadMessages', flutterSource: 'messages_data_source.dart:getMessages', test: 'issue-2006-c9: selecting and deep linking hydrate the correct conversation and read state' },
{ id: 'message-thread-reply', control: 'Reply Send / Enter', method: 'POST', route: '/message-threads/:id/messages', handler: 'createThreadMessage', flutterSource: 'messages_data_source.dart:sendMessage', test: 'issue-2006-c11: reply validates appends once preserves focus and exposes the exact receipt', payload: '{body}' },
{ id: 'message-thread-read', control: 'Select thread / Mark as read', method: 'POST', route: '/message-threads/:id/read', handler: 'markMessageThreadRead', flutterSource: 'messages_data_source.dart:markRead', test: 'issue-2006-c12: mark read and unread synchronize thread page and shell badges' },
{ id: 'message-thread-unread', control: 'Mark as unread', method: 'POST', route: '/message-threads/:id/unread', handler: 'markMessageThreadUnread', flutterSource: 'messages_data_source.dart:markUnread', test: 'issue-2006-c12: mark read and unread synchronize thread page and shell badges' },
```

Simulated receipts are exact and visible in `page-trace`:

- `GET /message-threads → 200`
- `GET /users → 200`
- `POST /message-threads {participantIds,threadType,title?} → 201`
- `GET /message-threads/:id/messages → 200`
- `POST /message-threads/:id/messages {body} → 201`
- `POST /message-threads/:id/read → 204`
- `POST /message-threads/:id/unread → 204`
- Deterministic failed create/send fixture operations use the same route and payload-key receipt with `→ 500`; they never contact a server, close the dialog, or clear the draft.

Thread selection follows Flutter order: mark read, get messages, refresh threads. Creation follows: create, refresh threads, then the same selection sequence. Reply follows: create message, then refresh threads. Client-only search/Clear, route navigation, dialog/menu open/close, type/recipient selection, and incoming-banner Dismiss never append fake receipts.

## Cross-page consistency

- The lead-owned Shell badge reads the shared `unreadThreads` value and hides at zero. Keep its initial baseline unchanged: ready Messages fixtures contain exactly six unread threads and each has `unreadCount: 1`, making both unread-thread count and Flutter's summed unread-message count equal six.
- `MessagesPage` updates that shared total after selection and Mark read/unread. Mark read changes both the visible page count and accessible shell label to 5; Mark unread restores 6. Search never changes the shared count.
- Flutter's badge derives from `MessagesController.totalUnreadCount`, the sum of per-thread unread messages (`messages_controller.dart:54-56`; `navigation_sidebar.dart:45-48,97-103`). If product chooses unread-thread semantics later, update page, shell, Dashboard preview, and tests together.
- Dashboard already proposes `/messages/thread-weekend-team`; preserve this slug and matching participant/title/transcript fixture across both owners.
- The Dashboard unread preview may show a subset, but its aggregate must remain six. Search on Messages must not alter any global badge.

## Shared style/icon asks

None. Keep layout, fixtures, and CSS page-local under `src/pages/messages/` and `.pg-messages`. Reuse existing shell navigation, buttons, fields, menus/dialog patterns, state panels, tokens, and available icons. A narrow-screen Back to conversations control may use text if no shared icon exists.

## Lead decisions applied

1. `MessagesPage` imports `useFixtures` and calls the lead-owned `setUnreadThreads` whenever the local unread-thread total changes. The ready seed begins at exactly six and the shell hides its badge when that shared value reaches zero.
2. The canonical Dashboard/Messages fixture is `thread-weekend-team`, titled `Weekend Team`, initially unread, with Morgan Lee and Visalia CRC in its display-name-only transcript context.
3. Group creation requires a name and at least two other participants, matching the dialog's own promise. This intentionally diverges from Flutter's executable one-recipient acceptance: the helper says “Select participants (2 or more)” while `_canSubmit` only rejects an empty selection (`messages_view.dart:1033-1037,1143-1147`); the lead chose truthful label-aligned validation.
4. Failed create/send fixture operations retain the dialog or reply draft and expose a visible error. Flutter currently swallows controller errors, allowing the caller to close/clear (`messages_view.dart:505-516,1040-1050`; `messages_controller.dart:116-151`); the lead classified that behavior as a defect rather than a replication target.
5. Recipient email addresses appear only in the New conversation dialog. Thread context and transcripts use display names, matching Flutter's participant-selection disclosure boundary (`messages_view.dart:1138-1193`).
