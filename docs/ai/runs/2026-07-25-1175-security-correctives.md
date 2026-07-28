---
date: 2026-07-25
repo: Rhythm
branch: codex/1175-security-correctives
pr: null
issues: [1175]
status: passed
tags: [run, Rhythm]
---

# Issue 1175 security correctives

## Files

- Added durable per-user/project ownership for mobile OpenCode sessions and
  PTYs, including additive SQLite and Postgres schema parity.
- Enforced ownership across HTTP lists and direct IDs, global/session SSE, PTY
  token issuance, and the PTY WebSocket bridge.
- Required the desktop Keychain-held human capability for pairing-code
  creation, access administration, and desktop device administration while
  retaining exact Device self-revocation.
- Centralized Google account admission before all user/session persistence.
  Existing/preprovisioned users, explicit email invitations, and verified
  configured Workspace domains are accepted; all other identities fail closed
  in every environment.
- Made a same-URL pairing with a different host ID an explicit replacement and
  avoided revoking an old credential against a recycled endpoint.
- Added corrective contracts, a real sandbox behavioral test, client tests,
  deployment configuration documentation, and the issue-1175 contract entries.

## Checks

- `ai-workflow checks --level issue` — passed: Flutter analyze/format,
  api_server TypeScript, and mcp_server TypeScript.
- `cd apps/api_server && npm run build` — passed.
- `cd apps/api_server && npx vitest run src --exclude='**/pty_proxy.test.ts'`
  — passed: 384 files, 3,317 tests; 49 files and 76 live/conditional tests
  skipped.
- `cd apps/api_server && npx vitest run
  src/__tests__/pty_proxy.test.ts --no-file-parallelism` — passed: 2 tests.
- `cd apps/mobile && npm run typecheck && npm run lint` — passed.
- `cd apps/mobile && node --test tests/paired-host.test.mjs` — passed:
  22 pairing/security state-machine scenarios.
- `cd apps/mobile && EXPO_APP_VARIANT=development npm run build:web:ci` —
  passed: 15 static routes exported.
- `cd apps/desktop_flutter && dart format . --set-exit-if-changed` — passed:
  433 files, 0 changed.
- `cd apps/desktop_flutter && flutter analyze --no-fatal-infos` — exit 0;
  272 pre-existing infos.
- `cd apps/desktop_flutter && flutter test
  test/features/agents/mobile_access_dialog_test.dart` — passed: 9 tests.
- `cd apps/desktop_flutter && flutter build macos --debug` — passed:
  `build/macos/Build/Products/Debug/Rhythm.app`.
- `node --test --test-name-pattern='issue-1175-c30'
  tests/contract/issue-1175.mjs` — passed.
- `cd apps/opencode_fork/packages/opencode && bun run build --single` —
  passed; binary smoke returned
  `0.0.0-codex/1175-security-correctives-202607251729`.
- `curl -fsS http://127.0.0.1:54865/health` — returned `status: ok`.
- `curl -fsS http://127.0.0.1:54865/opencode/health` — returned
  `status: ready`.
- Final live command:

  ```bash
  cd apps/api_server
  RHYTHM_LIVE_E2E=1 \
  RHYTHM_LIVE_E2E_ISOLATED=1 \
  RHYTHM_LIVE_URL=http://127.0.0.1:54865 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:54864 \
  RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox-1175-security-final/rhythm.db \
  RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-1175-security-final \
  RHYTHM_LIVE_HUMAN_CAPABILITY=corrective-live-human-capability-1175 \
  npx vitest run \
    src/__tests__/issue_1175_corrective_security_live.test.ts \
    --no-file-parallelism
  ```

  Passed: 1 file, 1 test, 2.94 seconds of live assertions against the rebuilt
  fork and API.
- `gitnexus detect-changes --repo Rhythm-1175-security-correctives --scope all
  --limit 200` — 35 indexed files, 94 symbols, 3 affected Tailscale diagnostic
  flows, medium risk. The required aggregate comparison to `main` reports
  critical risk because the exact base already contains the 1076-1175
  aggregate (646 files/3,599 symbols); it is not the corrective branch delta.
- `git diff --check` — passed.

## Notes

- The live test created two real paired users in one project and asserted
  isolated session lists, 404s for foreign and unmapped direct session/SSE
  access, denial of a foreign PTY token, denial of a cross-user WebSocket
  upgrade, bearer-only administration denial without mutation, and successful
  capability-backed pairing.
- The sandbox used only loopback ports 54865/54864, a copied SQLite database,
  and `tools/dev/sandbox.sh`; it was removed after the test.
- The full api_server suite's dev-harness test
  `tools/dev/__tests__/agent_eval_driver.test.ts` belongs to the concurrent
  parent workstream and was intentionally not modified here. The complete
  `src/` suite is green.
- Production signing, notarization, EAS production, and TestFlight evidence are
  explicitly deferred while the prototype is validated.
