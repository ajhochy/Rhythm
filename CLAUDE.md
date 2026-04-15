# Rhythm — Claude Working Agreement

## Git / PR Workflow

1. All work is done on a **feature branch** locally.
2. When implementation is complete, **push the branch** and **open a PR on GitHub** — do NOT merge.
3. The PR stays open while the user tests locally.
4. **Only merge to `main` on GitHub after the user confirms testing is successful.**

Never merge a PR automatically. Always leave it open for human review and sign-off.

---

## Project Overview

Rhythm is a macOS desktop productivity app for church staff. It manages tasks, recurring rhythms, projects, messaging, and facility reservations.

**Rhythm 2.0 goal:** Adopt the team-weaver React web app's light UI design inside the Flutter desktop app, and add new screens (Dashboard, Messages, Facilities). The Electron/React `apps/web` and `apps/electron` directories are a prototype/reference — they are NOT the shipping product. The Flutter app is the desktop client.

---

## Monorepo Structure

```
/Users/ajhochhalter/Documents/Rhythm/
├── apps/
│   ├── desktop_flutter/       ← macOS desktop app (Flutter) — THE SHIPPING CLIENT
│   │   ├── lib/
│   │   │   ├── main.dart      ← Entry point; MultiProvider setup; launches ServerConfigService
│   │   │   └── app/
│   │   │       ├── theme/
│   │   │       │   └── app_theme.dart              ← Light theme (white bg, #4F6AF5 primary)
│   │   │       ├── core/
│   │   │       │   ├── constants/app_constants.dart ← apiBaseUrl fallback default
│   │   │       │   ├── layout/
│   │   │       │   │   ├── app_shell.dart           ← Root layout; server status gating; nav switching
│   │   │       │   │   └── navigation_sidebar.dart  ← Light sidebar (#F8F9FA); nav items + gear
│   │   │       │   ├── server/
│   │   │       │   │   ├── api_server_service.dart  ← Spawns local Node server process; polls /health
│   │   │       │   │   └── api_server_controller.dart ← ChangeNotifier; starting/ready/failed states
│   │   │       │   └── services/
│   │   │       │       └── server_config_service.dart ← Persists server URL via shared_preferences
│   │   │       └── features/
│   │   │           ├── tasks/
│   │   │           │   ├── views/tasks_view.dart
│   │   │           │   ├── views/automation_rules_view.dart
│   │   │           │   ├── controllers/tasks_controller.dart
│   │   │           │   ├── controllers/automation_rules_controller.dart
│   │   │           │   ├── models/task.dart
│   │   │           │   ├── models/recurring_task_rule.dart
│   │   │           │   ├── repositories/tasks_repository.dart
│   │   │           │   └── data/tasks_local_data_source.dart
│   │   │           ├── rhythms/
│   │   │           │   ├── views/rhythms_view.dart
│   │   │           │   ├── controllers/rhythms_controller.dart
│   │   │           │   ├── repositories/rhythms_repository.dart
│   │   │           │   └── data/rhythms_data_source.dart
│   │   │           ├── projects/
│   │   │           │   ├── views/projects_view.dart
│   │   │           │   ├── controllers/project_template_controller.dart
│   │   │           │   ├── repositories/project_template_repository.dart
│   │   │           │   └── data/project_template_data_source.dart (also projects_local_data_source.dart)
│   │   │           ├── weekly_planner/
│   │   │           │   ├── views/weekly_planner_view.dart
│   │   │           │   ├── controllers/weekly_planner_controller.dart
│   │   │           │   └── data/weekly_plan_data_source.dart
│   │   │           ├── integrations/
│   │   │           │   ├── views/integrations_view.dart
│   │   │           │   ├── controllers/integrations_controller.dart
│   │   │           │   └── data/integrations_data_source.dart
│   │   │           ├── settings/
│   │   │           │   └── views/settings_view.dart  ← Server URL config screen
│   │   │           └── imports/
│   │   │               └── views/import_dialog.dart
│   │   ├── macos/Runner/
│   │   │   ├── Release.entitlements   ← No app-sandbox (allows child process spawning)
│   │   │   └── DebugProfile.entitlements
│   │   └── pubspec.yaml               ← deps: flutter, http, provider, window_manager,
│   │                                       shared_preferences, package_info_plus, url_launcher
│   ├── api_server/                    ← Node.js/TypeScript Express API (SQLite via better-sqlite3)
│   │   ├── src/
│   │   │   ├── server.ts              ← Express app entry; PORT=4000
│   │   │   ├── app.ts                 ← Route registrations
│   │   │   ├── database/
│   │   │   │   └── migrations.ts      ← All CREATE TABLE IF NOT EXISTS / ALTER TABLE migrations
│   │   │   ├── models/                ← TypeScript interfaces for each entity
│   │   │   ├── repositories/          ← SQLite query layer (one file per entity)
│   │   │   ├── controllers/           ← Request handlers (one file per entity)
│   │   │   └── routes/                ← Express routers (one file per entity)
│   │   │       └── health_routes.ts   ← GET /health — used by Flutter to detect server readiness
│   │   └── package.json               ← scripts: dev (tsx), build (tsc), start (node dist/)
│   ├── web/                           ← React/Vite UI (team-weaver design reference + prototype)
│   │   └── src/
│   │       ├── hooks/useApi.ts        ← React Query hooks for all API endpoints
│   │       └── pages/                 ← Tasks, Projects, Rhythms, Messages, Facilities, Dashboard
│   └── electron/                      ← Electron wrapper for the web app (prototype only)
├── tools/release/
│   └── sign_and_notarize_macos.sh    ← Signs all .node/.dylib/binaries, notarizes .app
├── .github/workflows/
│   ├── desktop_release.yml           ← Flutter macOS build + sign + notarize + GitHub Release
│   └── electron_release.yml          ← Electron build (prototype, not primary)
└── CLAUDE.md                          ← This file
```

---

## Flutter Architecture Pattern

Every feature follows this exact layered pattern:

```
views/foo_view.dart          ← StatefulWidget; reads controller via context.watch/read
controllers/foo_controller.dart  ← ChangeNotifier; status enum (idle/loading/error); methods
repositories/foo_repository.dart ← Calls data source; maps DTOs to models
data/foo_data_source.dart    ← HTTP calls; accepts baseUrl constructor param
models/foo.dart              ← Plain Dart class with fromJson/toJson
```

**Provider wiring** (main.dart MultiProvider):
- All controllers are `ChangeNotifierProvider`
- `ServerConfigService` is also a `ChangeNotifierProvider`
- Data sources get `serverConfigService.url` passed at construction time

**Navigation** is index-based in `app_shell.dart`. The sidebar sets `_currentIndex`, the body switches on it.

---

## API Server Endpoints

Base: `http://localhost:4000` (default, configurable)

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Server health check |
| GET/POST | /tasks | List / create tasks |
| PATCH/DELETE | /tasks/:id | Update / delete task |
| GET/POST | /recurring-rules | List / create rhythms |
| PATCH/DELETE | /recurring-rules/:id | Update / delete rhythm |
| GET/POST | /project-templates | List / create project templates |
| GET/POST | /project-templates/:id/steps | List / add steps |
| PATCH/DELETE | /project-templates/:id/steps/:stepId | Update / delete step |
| GET/POST | /project-instances | List / create project instances |
| GET/POST | /project-instances/:id/steps | Steps for an instance |
| GET/POST | /automation-rules | Automation rules |
| PATCH/DELETE | /automation-rules/:id | |
| GET | /integrations | OAuth integration list |
| GET/POST | /message-threads | Thread list / create thread |
| GET/POST | /message-threads/:id/messages | Messages in thread / send message |
| GET/POST | /facilities | Facility list / create facility |
| GET/POST | /facilities/:id/reservations | Reservations / create reservation |
| GET/POST | /users | User list / create user |

---

## Theme Tokens (Rhythm 2.0 Light Theme)

```dart
// Colors
sidebar bg:        Color(0xFFF8F9FA)
sidebar border:    Color(0xFFE5E7EB)
content bg:        Color(0xFFFFFFFF)
card bg:           Color(0xFFFFFFFF)
card border:       Color(0xFFE5E7EB)
primary:           Color(0xFF4F6AF5)
primary tint:      Color(0x144F6AF5)  // selected nav item bg
text primary:      Color(0xFF111827)
text secondary:    Color(0xFF6B7280)
text muted:        Color(0xFF9CA3AF)
error:             Color(0xFFEF4444)
success:           Color(0xFF10B981)
divider:           Color(0xFFE5E7EB)
```

All new screens must use these tokens via `Theme.of(context).colorScheme` where possible, or the constants above.

---

## New Screens To Build (Rhythm 2.0)

Three screens are planned as separate PRs. Nav placeholders exist in `app_shell.dart` as `_ComingSoonView`.

### Dashboard (index 0)
- Summary of open tasks (count + "due this week")
- Active rhythms count
- Active projects with their next step
- Quick-add task button
- All data from existing endpoints — no new API work needed

### Messages (index 5)
- Left panel: thread list (`GET /message-threads`) with title, unread dot (activity in last 24h), timestamp
- Right panel: message list (`GET /message-threads/:id/messages`) + reply input
- "New Message" button → dialog to create thread (`POST /message-threads`)
- Reply sends `POST /message-threads/:id/messages`

### Facilities (index 6)
- Card grid of facilities (`GET /facilities`)
- Each card: name, reservation count badge, Reserve button
- Reserve opens dialog: title, reservedBy, startTime, endTime, notes → `POST /facilities/:id/reservations`
- Top-level "Reserve Space" button with facility selector dropdown

---

## Local Development

```bash
# API server (dev)
cd apps/api_server && npm run dev      # Runs on :4000, hot-reloads with tsx

# Flutter desktop app
cd apps/desktop_flutter && flutter run -d macos

# React web prototype (reference only)
cd apps/web && npm run dev             # Runs on :5173
```

**DB path (local):** `~/Library/Application Support/Rhythm/rhythm.db`

---

## Testing Flutter Changes Locally

**Always test with `flutter run` before triggering a release build.** Release builds take 10–15 minutes and require a new version tag — local runs are instant.

```bash
cd apps/desktop_flutter && flutter run -d macos
```

- Works for all UI, logic, and API integration changes
- Point Settings → API Server to `https://api.vcrcapps.com` to test against the hosted server
- The only things that require a real release build: code-signing, notarization, and the bundled Node.js server (embedded API). Everything else is testable locally.

---

## CI / Release

- **Trigger:** `workflow_dispatch` in `.github/workflows/desktop_release.yml`
- **Version:** increment the patch from the latest tag (e.g. `beta.18.7` → `beta.18.8`). Never reuse an existing tag.
- **Secrets used:** `APPLE_CERT_BASE64`, `APPLE_CERT_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_NOTARY_KEY_ID`, `APPLE_NOTARY_KEY_ISSUER`, `APPLE_NOTARY_KEY_BASE64`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `PCO_APPLICATION_ID`, `PCO_SECRET`, `PCO_REDIRECT_URI`
- **Steps:** flutter build → bundle api_server → sign all binaries → notarize → upload DMG

---

## Key Constraints

- **No app-sandbox** — entitlements intentionally remove sandbox to allow `Process.start` (spawning the Node.js server). Non-App-Store distribution only.
- **Login shell for Node discovery** — GUI apps on macOS strip PATH. Use `/bin/zsh -l -c 'which node'` not `/bin/sh`.
- **`better-sqlite3` ABI** — Must be compiled with the same Node version the app will use at runtime. `prebuild-install` often downloads wrong binary. Use `node-gyp rebuild` if ABI mismatch.
- **`dart format .`** — Always run before committing. CI fails on format violations (`--set-exit-if-changed`).
- **`flutter analyze --no-fatal-infos`** — Must pass before opening a PR.
