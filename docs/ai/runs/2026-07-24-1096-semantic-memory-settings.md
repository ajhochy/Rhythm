---
date: 2026-07-24
repo: Rhythm
branch: codex/1096-engraph-settings
pr: null
issues: [1096]
status: complete
tags: [run, Rhythm]
---

# #1096 WP2 — Semantic Memory Settings

## Files

- `apps/desktop_flutter/lib/features/settings/data/semantic_memory_data_source.dart`
  targets only `AppConstants.agentLocalBaseUrl` and wraps the existing
  `/engraph-manager/*` lifecycle API. Raw backend paths and diagnostic text
  are not retained in the UI model.
- `apps/desktop_flutter/lib/features/settings/controllers/semantic_memory_controller.dart`
  owns discovery, backend validation, lifecycle polling, health/retry/rebuild,
  safe category-to-copy mapping, and cancellation on dispose.
- `apps/desktop_flutter/lib/features/settings/widgets/semantic_memory_section.dart`
  renders optional/local/fail-safe copy, all required states/actions, a
  conventional file picker, install guidance, accessible live status, and a
  rebuild confirmation scoped to Rhythm's private Application Support index.
- `apps/desktop_flutter/lib/features/settings/views/settings_view.dart`
  mounts the section between Agent Server and Memory Vault.
- `apps/desktop_flutter/test/contract/issue_1096_semantic_memory_test.dart`
  covers c12-c20 and generates three visual goldens.
- `apps/api_server/src/__tests__/live_e2e_1096_engraph_manager_http.test.ts`
  drives choose/enable/status/health/retry/rebuild/disable through the real
  HTTP surface and can assert an unrelated process remains alive.
- `docs/ai/contracts/issue-1096.json` maps all 20 acceptance criteria.

## Checks

```text
flutter test --update-goldens test/contract/issue_1096_semantic_memory_test.dart
  PASS — 10 tests

flutter analyze --no-fatal-infos
  PASS — exit 0; pre-existing info notices only

npm run build
  PASS — api_server TypeScript build

npx vitest run src/__tests__/live_e2e_1096_engraph_manager_http.test.ts
  PASS (gate load) — 1 file / 2 tests skipped without RHYTHM_LIVE_E2E=1

RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4398 \
DB_PATH=/tmp/rhythm-dev-sandbox-1096/rhythm.db \
RHYTHM_LIVE_ENGRAPH_BIN=/Users/ajhochhalter/.local/bin/engraph \
npx vitest run src/__tests__/live_e2e_1096_engraph_manager_http.test.ts
  PASS — 2/2 against the branch-built sandbox. Real authenticated search
  reached Ready; retry/rebuild/disable preserved unrelated PID 37322.

RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_ENGRAPH_BIN=/Users/ajhochhalter/.local/bin/engraph \
npx vitest run src/__tests__/live_e2e_engraph_manager.test.ts
  PASS — 2/2 (44.20s). Both fixture and real Engraph paths used only the
  sandbox Application Support HOME; disabling returned retrieval to [].

flutter build macos --debug
codesign --verify --deep --strict --verbose=2 \
  build/macos/Build/Products/Debug/Rhythm.app
  PASS — Apple Development: ajhochy@gmail.com (team 56Q69NYP9H), deep/strict
  verification valid.

signed-client smoke against http://127.0.0.1:4398
  PASS — Settings rendered a sandbox-only permission_denied state as:
  "Review Privacy & Security in System Settings. Do not bypass macOS
  protection. Standard memory search remains active." The real Enable action
  recovered through the branch-built API/Engraph process to Ready; Disable
  returned the signed UI to Off. No Gatekeeper/TCC setting or protection was
  changed, and all temporary source/sandbox state was restored.

ai-workflow checks --level issue
  PASS — Flutter analyze/format + API/MCP typecheck

ai-workflow checks --level pr
  PASS — Flutter test, API/MCP lint/tests/build, fork typecheck/session tests
```

Visual artifacts (inspected, nonblank):

- `apps/desktop_flutter/test/contract/goldens/issue_1096_semantic_memory_ready.png`
- `apps/desktop_flutter/test/contract/goldens/issue_1096_semantic_memory_indexing.png`
- `apps/desktop_flutter/test/contract/goldens/issue_1096_semantic_memory_permission_error.png`

## Notes

The isolated smoke used API `:4398` and engine `:4397`; it did not touch the
installed app on `:4001/:4096` or the foreign sandbox on `:4098/:4097`.
The signed build's API constants were changed only for the throwaway smoke
build, then restored byte-for-byte (`app_constants.dart` SHA-256
`7a65d35bcd9b937b796bb3d3b3c7eaf9e2ecd573f527a02a9bb3ba200b62bc4d`).
The permission failure was injected only into the sandbox manager config so
the production macOS security posture remained untouched. Final sandbox state
was disabled and all temporary workspace changes were removed.
