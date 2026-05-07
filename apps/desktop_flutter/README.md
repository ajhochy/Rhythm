# Rhythm Desktop (Flutter)

Desktop-first Flutter client for Rhythm.

## Goals
- macOS-first delivery
- feature-level MVC structure
- thin controllers and service-driven business logic
- support multi-pane planning workflows

## Run
```bash
flutter pub get
flutter run -d macos \
  --dart-define=GOOGLE_DESKTOP_CLIENT_ID=<desktop-google-client-id>
```

By default, local Flutter builds use the hosted API at
`https://api.vcrcapps.com`. For a local embedded API/database launch path during
development, use:

```bash
./tools/dev/launch_desktop_current.sh
```

That script:
- starts the API on `localhost:4000` against `~/Library/Application Support/Rhythm/rhythm.db`
- builds the current macOS debug app
- launches a fresh copied app bundle at `/private/tmp/Rhythm Current.app`

This avoids Dock icon cache issues and keeps the desktop app pointed at the same
runtime database each time.

For Google Sign-In, the desktop app now expects `GOOGLE_DESKTOP_CLIENT_ID` as a Dart define. The packaged API must trust the same Firebase Apple client ID through `GOOGLE_AUTH_CLIENT_ID`.

## Runtime architecture

The desktop app talks to two API servers:

- **Production API** (hosted at `https://api.vcrcapps.com`) — owns all user-facing data: tasks, projects, rhythms, messages, facilities, users. The URL is configurable at runtime via Settings → Server URL and persisted by `ServerConfigService`.
- **Local CLI server** (`http://localhost:4001`) — a Node process bundled into the `.app` and spawned at launch by `AgentServerController`. Hosts agent endpoints (`/agent-sessions`, `/agents/capabilities`, `ws://localhost:4001/ws/agents`) and uses local SQLite. Always running; never points at production.

There is no longer an "embedded production API" build mode — the previous `RHYTHM_USE_EMBEDDED_API` / `RHYTHM_SERVER_URL` Dart defines have been removed.

Example:

```bash
flutter run -d macos \
  --dart-define=GOOGLE_DESKTOP_CLIENT_ID=<desktop-google-client-id>
```

To point at a different production API host during local dev, change it in Settings → Server URL inside the running app.

## Beta Distribution
- Use the `Desktop Release` GitHub Actions workflow to build downloadable tester artifacts.
- The app now checks GitHub Releases for updates and can open the latest download from inside the sidebar.
- Apple signing and notarization setup is documented in [docs/release/macos_distribution.md](/Users/ajhochhalter/Documents/Rhythm/docs/release/macos_distribution.md).

### Packaged Beta Smoke Checklist
- Install the DMG or ZIP artifact from the latest `Desktop Release` run.
- Launch the packaged app and confirm it reaches the hosted API without `flutter run`.
- Sign in with Google and verify the app opens past the login gate.
- Quit and relaunch the packaged app; confirm the session restores.
- Open Messages, send/read a conversation across two users, and verify unread badges update.
- Create a task and a facility reservation, then confirm user-scoped data still appears after restart.

## Notes
- Avoid placing domain logic in controllers.
- Keep desktop layout components reusable (`app_shell`, `navigation_sidebar`, split view patterns).
