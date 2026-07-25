---
date: 2026-07-24
repo: Rhythm
branch: codex/1096-engraph-settings
pr: null
issues: [1096]
status: verification-blocked
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

The verification gate is **not complete**. This workstream was instructed not
to start or stop a server because foreign work owns 4097/4098 and the live app
owns 4001/4096. Therefore c3/c7/c9 and the c11 signed-app criterion remain
pending.

When an isolated slot is available, build/launch the branch per
`docs/ai/testing-guide.md`, then run:

```bash
cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:<sandbox-port> \
DB_PATH=/tmp/<sandbox>/rhythm.db \
RHYTHM_LIVE_ENGRAPH_BIN=/absolute/path/to/engraph \
npx vitest run src/__tests__/live_e2e_1096_engraph_manager_http.test.ts
```

Then point a signed development client at that sandbox and verify:

1. detected/selectable Engraph can reach indexing → starting → ready;
2. the UI remains usable throughout and health/retry/rebuild/disable work;
3. a Gatekeeper/TCC-style permission denial shows only the fixed safe System
   Settings guidance and never suggests bypassing macOS protection;
4. disabling returns to standard-memory-search reassurance without touching
   any unrelated process.
