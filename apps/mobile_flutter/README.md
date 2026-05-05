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
