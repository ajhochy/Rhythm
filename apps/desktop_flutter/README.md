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

For Google Sign-In, the desktop app now expects `GOOGLE_DESKTOP_CLIENT_ID` as a Dart define. The packaged API must trust the same Firebase Apple client ID through `GOOGLE_AUTH_CLIENT_ID`.

## Hosted vs local runtime

Desktop builds can choose between:

- local embedded API mode
- hosted API mode

Useful Dart defines:

- `RHYTHM_SERVER_URL`
- `RHYTHM_USE_EMBEDDED_API`

Examples:

```bash
# Local development
flutter run -d macos \
  --dart-define=GOOGLE_DESKTOP_CLIENT_ID=<desktop-google-client-id> \
  --dart-define=RHYTHM_SERVER_URL=http://localhost:4000 \
  --dart-define=RHYTHM_USE_EMBEDDED_API=true

# Hosted/shared environment
flutter run -d macos \
  --dart-define=GOOGLE_DESKTOP_CLIENT_ID=<desktop-google-client-id> \
  --dart-define=RHYTHM_SERVER_URL=https://api.vcrcapps.com \
  --dart-define=RHYTHM_USE_EMBEDDED_API=false
```

## Beta Distribution
- Use the `Desktop Release` GitHub Actions workflow to build downloadable tester artifacts.
- The app now checks GitHub Releases for updates and can open the latest download from inside the sidebar.
- Apple signing and notarization setup is documented in [docs/release/macos_distribution.md](/Users/ajhochhalter/Documents/Rhythm/docs/release/macos_distribution.md).

### Packaged Beta Smoke Checklist
- Install the DMG or ZIP artifact from the latest `Desktop Release` run.
- Launch the packaged app and confirm the bundled API server starts without `flutter run`.
- Sign in with Google and verify the app opens past the login gate.
- Quit and relaunch the packaged app; confirm the session restores.
- Open Messages, send/read a conversation across two users, and verify unread badges update.
- Create a task and a facility reservation, then confirm user-scoped data still appears after restart.

## Notes
- Avoid placing domain logic in controllers.
- Keep desktop layout components reusable (`app_shell`, `navigation_sidebar`, split view patterns).
