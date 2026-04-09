# Rhythm 2.0 — Implementation Plan

## Approach

**Flutter is the desktop client.** The React web app (`apps/web`) is a design reference only — not the shipping product.

The goal: make the Flutter app look like team-weaver (light theme, card-based layout) and add new screens (Dashboard, Messages, Facilities). All screens connect to the bundled `api_server`, with a configurable URL for future remote hosting.

---

## Completed ✅

| PR | What |
|----|------|
| #119 | Flutter light theme + server URL setting (foundation) |
| #120 | Flutter Messages screen (two-panel thread list + reply) |
| #121 | Flutter Facilities screen (card grid + reservation dialog) |
| #122 | Flutter Dashboard screen (summary cards + recent tasks) |
| #126 | API server v2 — users, message threads, messages, facilities, reservations |
| fix  | Wire all screens into app_shell + main.dart (committed directly to main) |

**Current main branch state:**
- Light theme throughout (white bg, #F8F9FA sidebar, #4F6AF5 primary)
- Nav order: Dashboard → Weekly Planner → Tasks → Rhythms → Projects → Messages → Facilities → Automations → Integrations
- All screens live (no more _ComingSoonView placeholders)
- Server URL configurable in Settings (defaults to localhost:4000)
- API has users, messaging, and facilities endpoints

---

## Known Bugs / Quick Fixes

- **Dashboard mark-done** — toggling a task done does not remove it from the recent tasks list; need to call `refresh()` after `toggleTaskDone`
- **Messages new thread** — creating a thread does not add it to the thread list; controller needs to reload threads after `createThread`
- **Dashboard "due this week"** count may not match Weekly Planner (different data models)

---

## Next Up

### Phase 1 — Bug fixes (ready to dispatch)

| # | What | Files |
|---|------|-------|
| A | Dashboard: refresh recent tasks after mark-done | `dashboard_controller.dart`, `dashboard_view.dart` |
| B | Messages: reload thread list after create | `messages_controller.dart` |

### Phase 2 — Facilities improvements (issue filed)

- Date picker for reservation date (separate from time)
- Start/end time as time-only pickers
- Room database: pre-defined rooms to select from; show conflicts
- See GitHub issue for full scope

### Phase 3 — Finish per-user ownership (major milestone)

Auth is now in place, but ownership is still incomplete across the domain. Tasks and several integration-backed records are user-scoped; projects are not fully scoped yet, and some legacy shared records still flow through the system.

**Approach:** Google OAuth (all users are from the same Google Workspace org)

Key work items:
- API: finish `owner_id` / `assigned_to` coverage for projects and remaining shared entities
- Flutter: per-user filtered views (Dashboard shows your tasks, not all tasks)
- Messages: scoped to conversations between named users
- Facilities: reservations show who booked them

See GitHub milestone for individual issues.

### Phase 4 — Release build

Once Phase 1–2 are stable:
- Trigger `desktop_release.yml` for a new beta build
- Test on a clean machine
- Distribute DMG to staff for beta testing

---

## Architecture Reference

### Flutter feature pattern
```
views/foo_view.dart          ← StatefulWidget; reads controller via context.watch
controllers/foo_controller.dart  ← ChangeNotifier; status enum; methods
repositories/foo_repository.dart ← Calls data source; maps DTOs to models
data/foo_data_source.dart    ← HTTP calls; accepts baseUrl constructor param
models/foo.dart              ← Plain Dart class with fromJson/toJson
```

### Theme tokens
```
sidebar bg:     #F8F9FA    content bg:  #FFFFFF
primary:        #4F6AF5    card border: #E5E7EB
text primary:   #111827    text muted:  #9CA3AF
```

### API base URL
Defaults to `http://localhost:4000`. Configurable in Settings screen (persisted via `ServerConfigService`).

### Nav index map
| Index | Screen |
|-------|--------|
| 0 | Dashboard |
| 1 | Weekly Planner |
| 2 | Tasks |
| 3 | Rhythms |
| 4 | Projects |
| 5 | Messages |
| 6 | Facilities |
| 7 | Automations |
| 8 | Integrations |
