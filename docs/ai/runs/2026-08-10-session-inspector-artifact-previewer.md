---
date: 2026-08-10
repo: Rhythm
branch: mega-ws/inspector
pr: null
issues: [1359, 1360, 1361, 1362]
status: blocked
tags: [run, Rhythm]
---

# Session Inspector artifact previewer

## Files

- Added the pure exact-session transcript artifact extractor and inspector
  Artifacts tab.
- Connected a single shared `LiveArtifactsController` to inspector handoff and
  Dashboard selection.
- Added compact `LiveArtifactView` behavior that reloads an existing WKWebView,
  hides sharing, and invalidates on session/user identity changes only.
- Added #1360–#1362 acceptance contracts and the env-gated real macOS flow.
- Added the shipping-app manual smoke checklist to `docs/testing/manual-smoke.md`.

## Checks

- `flutter pub get --offline` — PASS using the writable Flutter SDK facade and
  warm cache. The required unmodified `flutter pub get` reached dependency
  resolution/download and then terminated without a successful exit in the
  restricted network sandbox; gate status is FAIL, follow-up owner orchestrator.
- `dart format . --output=none --set-exit-if-changed` — PASS.
- `flutter analyze --no-pub --no-fatal-infos` — PASS, exit 0 with 296 existing
  infos and no errors/warnings.
- Focused #1360, #1361, and #1362 `flutter test --no-pub ...` commands — FAIL
  before test loading: `Failed to create server socket (OS Error: Operation not
  permitted, errno = 1), address = 127.0.0.1, port = 0`. Follow-up owner:
  orchestrator on an unrestricted macOS runner.
- Full `flutter test --no-pub` — same managed-sandbox socket failure before test
  loading. Follow-up owner: orchestrator.
- `flutter analyze --no-pub --no-fatal-infos` — PASS with the same 296
  pre-existing infos. The unmodified analyze gate cannot proceed past its
  implicit online pub step here; follow-up owner orchestrator.
- Env-gated `session_inspector_artifacts_macos_test.dart` — UNRUN here because
  this worker cannot bind sockets or start the isolated sandbox. Follow-up
  owner: orchestrator using only `tools/dev/sandbox.sh` with the documented
  `RHYTHM_INSPECTOR_*` fixture values.
- GitNexus blast-radius analysis — existing edited touchpoints are LOW or
  MEDIUM except `AgentsController` (CRITICAL); that controller was deliberately
  not edited. Final `detect-changes` is required before handoff.
- `git add`/incremental commits — BLOCKED: parent worktree metadata is read-only
  (`.git/worktrees/ws-inspector/index.lock: Operation not permitted`). No push
  was attempted.

## Notes

- Exactly four completed mutation tools are recognized. Create IDs come from
  successful JSON output; state/bundle/sharing update IDs come from input args.
- Descendant sessions, unsupported tools/states, malformed IDs, sharing UI,
  backend endpoints, schemas, migrations, and MCP Apps are unchanged.
- The real integration test sends create/update prompts through the sandbox
  agent WebSocket, reads persisted transcript messages, exercises the native
  WKWebView across resize/reload, and asserts one stable Dashboard ID.
- Manual narrow/resize/keyboard/VoiceOver, identity switch,
  provider-account switch, revoked/deleted, and Dashboard checks are explicitly
  pending in `docs/testing/manual-smoke.md`; none are described as passing.
