# Testing Guide

## Running tests

### api_server (Node.js/TypeScript)
```bash
cd apps/api_server
npm test          # vitest run
npx tsc --noEmit  # TypeScript check
```

Note: `better-sqlite3` has ABI compatibility issues on some development machines. If tests fail with `NODE_MODULE_VERSION` errors, run `npm rebuild better-sqlite3`.

### desktop_flutter (Flutter/Dart)
```bash
cd apps/desktop_flutter
flutter analyze --no-fatal-infos
flutter test
dart format . --set-exit-if-changed
```

## Opencode Engine tests

| Test file | What it covers |
|---|---|
| `src/services/opencode_client_service.test.ts` | Service lifecycle, graceful degradation when uninitialized |

## Smoke test checklist (manual)

After deploying the Opencode engine:

- [ ] Start the app — verify the api_server starts on port 4001
- [ ] `curl http://localhost:4001/opencode/health` — returns `{"status":"ready",...}`
- [ ] `curl http://localhost:4001/agents/capabilities` — returns provider-based availability
- [ ] Settings → AI Account → connect a provider
- [ ] `POST http://localhost:4001/opencode/auth/google {"apiKey":"..."}` — stores key
- [ ] Create an agent session — verify it uses the SDK (not PTY subprocess)
- [ ] `flutter run -d macos` — app launches without errors
