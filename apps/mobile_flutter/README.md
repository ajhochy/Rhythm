# Rhythm Mobile

Flutter mobile companion app for Rhythm — a productivity platform for church staff.

## Getting Started

```bash
# Install dependencies
flutter pub get

# Run on a connected device or simulator (Google sign-in requires --dart-define)
flutter run -d <device> \
  --dart-define=GOOGLE_MOBILE_CLIENT_ID=<your-google-oauth-client-id> \
  --dart-define=GOOGLE_MOBILE_REDIRECT_URI=com.rhythmapp.mobile:/oauth-callback
```

List available devices with `flutter devices`.

### Google OAuth `--dart-define` values

| Key | Description |
|-----|-------------|
| `GOOGLE_MOBILE_CLIENT_ID` | Google OAuth 2.0 client ID for iOS/Android (from Google Cloud Console). Use an **iOS** client ID on iOS and an **Android** client ID on Android. |
| `GOOGLE_MOBILE_REDIRECT_URI` | Deep-link redirect URI registered in Google Cloud Console. Default: `com.rhythmapp.mobile:/oauth-callback` |

These values are never committed to source control. The app will throw a `StateError` at sign-in time if they are missing.

## Default API

The app connects to the hosted Rhythm API at `https://api.vcrcapps.com` by default.
No backend changes are required — the mobile app consumes the same endpoints as the desktop client.

## Sync model

The mobile app uses the same hosted Rhythm API (`https://api.vcrcapps.com`) as the desktop client — there is no separate mobile backend.

Data is kept current in two ways:

1. **Pull-to-refresh** — drag down on the Today view to manually fetch the latest task list from the server.
2. **Foreground resume** — when the app returns to the foreground after being backgrounded, it automatically calls `tasksController.load()` to refresh the task list. This is debounced: if a refresh already fired within the last 5 seconds, the duplicate call is skipped.

There is no real-time push or background sync in the MVP. The app does not receive server-sent events or WebSocket notifications.

**Cross-device workflow:** A task created on the desktop appears on mobile after the next refresh (pull-to-refresh or foregrounding the app). A task completed on mobile appears as done on desktop after the next desktop refresh.

## Platform Requirements

- iOS: 13.0+
- Android: API level 21 (Android 5.0)+

## Architecture

Follows the same layered pattern as `apps/desktop_flutter`:

```
views/       — StatefulWidget UI
controllers/ — ChangeNotifier state management
repositories/— DTO mapping
data/        — HTTP calls
models/      — Plain Dart classes with fromJson/toJson
```
