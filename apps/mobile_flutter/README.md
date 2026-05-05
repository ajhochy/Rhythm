# Rhythm Mobile

Flutter mobile companion app for Rhythm — a productivity platform for church staff.

## Getting Started

```bash
# Install dependencies
flutter pub get

# Run on a connected device or simulator
flutter run -d <device>
```

List available devices with `flutter devices`.

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
