---
date: 2026-07-30
repo: Rhythm
branch: codex/fix-1278-boot-bounce-noise
pr: null
issues: [1278]
status: complete
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #1278 — prevent boot-owned auth writes from bouncing the engine

## Files changed

- `apps/api_server/src/server.ts` — arm `AuthCredentialWatcher` only after
  `OpencodeClientService.initialize()` and startup account/Claude credential
  reconciliation complete.
- `apps/api_server/src/__tests__/issue_1278_boot_auth_write_live.test.ts` —
  add an isolated live contract that checks boot ordering, one SDK
  initialization, and no credential-reload bounce.
- `docs/ai/contracts/issue-1278.json` — map the acceptance criterion to the
  live test.
- `docs/ai/project-state.md` — refresh the lean branch snapshot.

## Checks run

- RED on the untouched source:
  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1
  RHYTHM_LIVE_URL=http://127.0.0.1:4278
  DB_PATH=/private/tmp/rhythm-dev-sandbox-1278/rhythm.db
  RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-dev-sandbox-1278
  RHYTHM_LIVE_SERVER_LOG=/private/tmp/rhythm-dev-sandbox-1278/api_server.log
  npx vitest run src/__tests__/issue_1278_boot_auth_write_live.test.ts` —
  failed because the watcher was armed before `restoreAuth` completed
  (`3592` was not greater than `4316`).
- GREEN after the fix, using the same isolated sandbox command — 1/1 passed.
  The boot transcript contained one SDK initialization, `restoreAuth`
  completed before the watcher started, and there were zero
  `reloadCredentials` bounce entries.
- `npx tsc -p tsconfig.json --noEmit` — passed.
- `npx vitest run src/services/auth_credential_watcher.test.ts
  src/services/opencode_client_service.test.ts
  src/__tests__/issue_755_role_separation.test.ts
  src/__tests__/issue_1278_boot_auth_write_live.test.ts --reporter=dot` —
  3 files passed / 1 skipped; 90 tests passed / 1 skipped.
- Fresh fork build: `bun run build --single` — passed; the built
  `opencode --version` smoke passed.
- Fresh API build: `npm run build` — passed.
- `ai-workflow checks --level issue` — Flutter analyze, Dart format, and API
  typecheck passed. The unrelated `apps/mcp_server` check remains blocked
  because that package has no local TypeScript compiler and `npx tsc`
  resolves the npm placeholder package.
- GitNexus `detect-changes` against `main` reported CRITICAL inherited scope
  (1,134 files / 5,584 symbols / 43 flows) because this lane is stacked on the
  large integration branch. The exact assigned-base comparison against
  `origin/codex/fix-session-isolation-runtime-performance` reported LOW risk:
  2 tracked files / 7 symbols / 0 affected flows. The final staged comparison,
  including the new contract/test/run files, also reported LOW risk: 5 files /
  7 symbols / 0 affected flows.
- `git diff --check` — passed.

## Notes

- Root cause: `server.ts` started `AuthCredentialWatcher` while async
  `opencodeClient.initialize()` was still restoring `auth.json`. That let a
  server-owned boot write look external and enter the credential-reload path.
- The fix moves the existing watcher-start block; watcher debounce,
  classification, and runtime reload behavior are unchanged.
- The live sandbox used dedicated API/engine/gateway ports and was stopped
  after verification. Production was not touched.
- No push, PR, merge, release, or worktree removal was performed.
