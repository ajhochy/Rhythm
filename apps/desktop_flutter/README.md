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
flutter run -d macos
```

## Beta Distribution
- Use the `Desktop Release` GitHub Actions workflow to build downloadable tester artifacts.
- The app now checks GitHub Releases for updates and can open the latest download from inside the sidebar.
- Apple signing and notarization setup is documented in [docs/release/macos_distribution.md](/Users/ajhochhalter/Documents/Rhythm/docs/release/macos_distribution.md).

## Notes
- Avoid placing domain logic in controllers.
- Keep desktop layout components reusable (`app_shell`, `navigation_sidebar`, split view patterns).
