# Agent Notification Design

**Date:** 2026-05-08  
**Status:** Approved

## Goal

Allow Claude and Codex agent skills to send a notification to the Rhythm user when they finish a task. The notification must:

- Appear as a **macOS system notification** when Rhythm is backgrounded (persists until dismissed).
- Appear as an **in-app bell badge** when Rhythm is foregrounded (accumulates; cleared by opening the notification panel).
- Carry a **custom title and body** set by the calling agent.

---

## Architecture

### Delivery path

```
MCP tool (rhythm_notify)
  → POST http://localhost:4001/notifications/agent   (no auth; AGENT_LOCAL=true bypass)
      → ws_gateway.broadcast({ type: 'notification.push', title, body })
          → Flutter AgentsController._onWsMessage
              → if backgrounded: LocalNotificationService.showMessageNotification()
              → always: increment bell badge in NavigationSidebar
```

No new server. Port 4001 is the existing `api_server` process spawned by Flutter on launch.

---

## Components

### 1. api_server — new route

**File:** `src/routes/notifications_agent_routes.ts` (new)  
**File:** `src/controllers/notifications_agent_controller.ts` (new)

`POST /notifications/agent`

- Auth: **bypassed** (same `AGENT_LOCAL=true` pattern as agent session endpoints).
- Body: `{ title: string; body: string }` — both required, max 200 chars each.
- Behaviour:
  1. Insert a row into a new local-only `agent_notifications` table (`id`, `title`, `body`, `read_at`, `created_at`).
  2. Call `broadcast({ v: 1, type: 'notification.push', title, body, id })`.
  3. Return `201 { id }`.
- Validation errors return `400`.

**Migration:** add `agent_notifications` table in `database/migrations.ts`.  
This table lives in local SQLite only — it is never referenced by the production Postgres path.

**Route registration:** added to `app.ts` under the agent-local guard (same block as agent session routes).

### 2. api_server — WebSocket broadcast

No changes to `ws_gateway.ts` itself — `broadcast()` already exists and accepts any object. The controller calls it directly after the DB insert.

### 3. MCP server — new tool

**File:** `apps/mcp_server/src/tools/notifications.ts` (new)

Tool name: `rhythm_notify`  
Description: "Send a notification to the Rhythm app user. Use this when you have finished a task or have something important to report."

Args:
- `title` — string, required. Short headline (e.g. "Refactor complete").
- `body` — string, required. One or two sentences of detail.

Implementation: `apiPost` to `${RHYTHM_AGENT_URL}/notifications/agent` with `{ title, body }`.  
Returns a success string on 201, or propagates the error.

**Env var:** `RHYTHM_AGENT_URL` — defaults to `http://localhost:4001`. Added to `index.ts` alongside `RHYTHM_API_URL`. No token needed (auth bypassed on that route).

**Registration:** `registerNotificationTools(server, RHYTHM_AGENT_URL)` called in `index.ts`.

### 4. Flutter — new WS message type

**File:** `lib/features/agents/models/agent_ws_message.dart`

Add `NotificationPushMessage`:

```dart
class NotificationPushMessage extends AgentWsMessage {
  const NotificationPushMessage({
    required this.id,
    required this.title,
    required this.body,
  });
  final int id;
  final String title;
  final String body;
  // fromJson factory
}
```

Add `case 'notification.push':` to `AgentWsMessage.parse()`.

### 5. Flutter — AgentsController

**File:** `lib/features/agents/controllers/agents_controller.dart`

- Inject `LocalNotificationService` into `AgentsController`.
- In `_onWsMessage`, handle `NotificationPushMessage`:
  - Always: append to `_agentNotifications` list (new field) and call `notifyListeners()`.
  - If app is not in the foreground (`WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed`): call `LocalNotificationService.showMessageNotification(id, title, body)`.

New fields:

```dart
final List<AgentNotification> _agentNotifications = [];
int get unreadNotificationCount => _agentNotifications.where((n) => !n.isRead).length;
```

`AgentNotification` is a plain Dart class: `{ int id, String title, String body, bool isRead }`.

Expose:
- `List<AgentNotification> get agentNotifications` — unmodifiable list, newest-first.
- `markAllNotificationsRead()` — sets all `isRead = true`, calls `notifyListeners()`.

`AgentsController` must mix in `WidgetsBindingObserver` and register itself in `initialize()` so it can check `WidgetsBinding.instance.lifecycleState` when a push message arrives.

### 6. Flutter — NavigationSidebar bell

**File:** `lib/app/core/layout/navigation_sidebar.dart`

- Add a bell icon button above (or below) the gear icon in the sidebar.
- Show a red count badge when `agentsController.unreadNotificationCount > 0`.
- Tapping the bell opens a `NotificationPanel` overlay (see below).
- Badge and panel are driven by `context.watch<AgentsController>()`.

### 7. Flutter — NotificationPanel

**File:** `lib/app/core/agents/notification_panel.dart` (new)

A `Positioned` overlay (similar to the agent bubble overlay pattern already in the codebase):

- Lists `agentsController.agentNotifications` newest-first.
- Each row: bold title, body text, relative timestamp.
- "Mark all read" button at top — calls `agentsController.markAllNotificationsRead()` and closes panel.
- Clicking outside dismisses (does not mark read — only the button does).
- Notifications persist in memory for the session; they are not re-fetched from the server on next launch (agent_notifications table is a delivery store, not a history store).

---

## Data model

### `agent_notifications` (local SQLite only)

| column | type | notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| title | TEXT NOT NULL | |
| body | TEXT NOT NULL | |
| read_at | TEXT | ISO datetime or NULL |
| created_at | TEXT | default datetime('now') |

Row is inserted on `POST /notifications/agent`. Flutter reads `id` from the WS event — it does not need to query this table. The table is retained for potential future history endpoint.

---

## Error handling

- MCP tool: if `localhost:4001` is unreachable, surface the error text to the agent so it can report to the user via its normal output.
- Flutter: if the WS message arrives but `LocalNotificationService` throws (e.g. notification permission denied), log to stderr and still update the badge.
- api_server: validation (missing/empty title or body) returns 400 with `{ error: "..." }`.

---

## What is NOT in scope

- Notification persistence across Rhythm restarts (in-memory only this session).
- Per-notification dismiss (only "mark all read").
- Notifications from sources other than the MCP tool (e.g. production webhook).
- Mobile / web surfaces.

---

## Files changed summary

| File | Change |
|---|---|
| `apps/api_server/src/database/migrations.ts` | Add `agent_notifications` table |
| `apps/api_server/src/controllers/notifications_agent_controller.ts` | New |
| `apps/api_server/src/routes/notifications_agent_routes.ts` | New |
| `apps/api_server/src/app.ts` | Register new route |
| `apps/mcp_server/src/tools/notifications.ts` | New |
| `apps/mcp_server/src/index.ts` | Register tool; add `RHYTHM_AGENT_URL` |
| `apps/desktop_flutter/lib/features/agents/models/agent_ws_message.dart` | Add `NotificationPushMessage` |
| `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` | Handle push message; expose badge count |
| `apps/desktop_flutter/lib/app/core/layout/navigation_sidebar.dart` | Bell icon + badge |
| `apps/desktop_flutter/lib/app/core/agents/notification_panel.dart` | New overlay |
| `apps/desktop_flutter/lib/main.dart` | Pass `LocalNotificationService` to `AgentsController` |
