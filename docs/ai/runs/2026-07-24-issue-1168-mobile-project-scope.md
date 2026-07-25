---
date: 2026-07-24
repo: Rhythm
branch: codex/mobile-1166-1175
pr: null
issues: [1168]
status: offline_pass_live_pending
tags: [run, Rhythm]
---

# Issue #1168 — mobile gateway authentication and project allowlist

## Files

- Added `mobile_project_scope.ts` with exact active-project lookup, canonical
  repository-owned roots, point-of-use realpath containment, caller-root
  override rejection, and Express scope middleware.
- Added `POST /mobile-gateway/project` behind `requireMobileDevice` followed by
  `requireMobileProject`. It returns only the selected project ID and a
  project-relative path; the absolute host root is not disclosed.
- Added focused service/HTTP acceptance tests and an env-gated live sandbox
  behavioral test.
- Added the acceptance contract and focused implementation plan.

## Checks

- Acceptance RED:

  ```text
  npx vitest run src/services/__tests__/mobile_project_scope.test.ts \
    src/__tests__/issue_1168_mobile_gateway_security.test.ts \
    src/__tests__/issue_1168_mobile_gateway_live.test.ts

  FAIL: mobile_project_scope module did not exist.
  ```

  The fresh worktree initially lacked dependency links; the existing ignored
  dependencies were linked without a package install. The native SQLite module
  was built for ABI 147, so all executable checks used the matching installed
  `/opt/homebrew/bin/node`.

- Focused plus #1166 regression:

  ```text
  PATH=/opt/homebrew/bin:$PATH npx vitest run \
    src/services/__tests__/mobile_project_scope.test.ts \
    src/__tests__/issue_1168_mobile_gateway_security.test.ts \
    src/__tests__/issue_1168_mobile_gateway_live.test.ts \
    src/__tests__/mobile_gateway_routes.test.ts \
    src/__tests__/issue_1166_pairing_contract.test.ts

  Test Files 4 passed | 1 skipped (5)
  Tests 6 passed | 1 skipped (7)
  ```

- API build:

  ```text
  PATH=/opt/homebrew/bin:$PATH npm run build
  exit 0
  ```

- Full API suite:

  ```text
  PATH=/opt/homebrew/bin:$PATH VITEST_MAX_WORKERS=4 npx vitest run
  Test Files 366 passed | 32 skipped (398)
  Tests 3199 passed | 51 skipped (3250)
  ```

- Repository issue gate:

  ```text
  PATH=/opt/homebrew/bin:$PATH ai-workflow checks --level issue
  flutter analyze: pass
  dart format --set-exit-if-changed: pass
  api_server tsc --noEmit: pass
  ```

- Canonical PR-gate reruns exposed pre-existing nondeterminism outside #1168:
  the first failed two `agent_sessions.test.ts` assertions, both of which passed
  immediately in a focused rerun; the second failed a different
  `agent_sessions_mcp_role.test.ts` case on the global 5-second timeout, whose
  three focused cases then passed in 1.23 seconds. The earlier complete API run
  passed all 3,199 active tests. No failing file imports or reaches the new
  mobile project scope, so no unrelated change was made.

- GitNexus:
  - Pre-edit `createMobileGatewayRouter`: LOW, one direct upstream caller
    (`createApp`), zero affected processes.
  - Pre-edit `requireMobileDevice`: LOW, three total upstream symbols, zero
    affected processes.
  - #1168 unstaged detect-changes: LOW, zero affected indexed processes.
  - Required compare-to-main: HIGH because the cumulative branch already
    contains #1166, #1167, and the imported mobile app (229 files / 1,750
    symbols / nine flows). This was reported to the parent; #1168 does not edit
    those high-risk symbols.

## Parent-owned live command

Use only the repository sandbox. Never launch `api_server` directly:

```bash
export RHYTHM_SANDBOX_DIR="$(mktemp -d /tmp/rhythm-1168-security.XXXXXX)"
PATH=/opt/homebrew/bin:$PATH tools/dev/sandbox.sh up
trap 'PATH=/opt/homebrew/bin:$PATH tools/dev/sandbox.sh down' EXIT
export RHYTHM_LIVE_DB_PATH="$RHYTHM_SANDBOX_DIR/rhythm.db"
cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
RHYTHM_SANDBOX_DIR="$RHYTHM_SANDBOX_DIR" \
RHYTHM_LIVE_DB_PATH="$RHYTHM_LIVE_DB_PATH" \
PATH=/opt/homebrew/bin:$PATH \
npx vitest run src/__tests__/issue_1168_mobile_gateway_live.test.ts
cd ../..
PATH=/opt/homebrew/bin:$PATH tools/dev/sandbox.sh down
trap - EXIT
```

The live test refuses any API/engine URL other than 4098/4097, requires the DB
to be exactly `<sandbox>/rhythm.db`, and refuses the installed app database.

## Notes

- Negative coverage includes missing and invalid device tokens, revoked tokens,
  missing and unknown project IDs, archived projects, traversal,
  sibling-prefix paths, symlink escape, arbitrary root/cwd/directory overrides,
  and case-variant overrides.
- Authentication is observably first: an unauthenticated request containing an
  unknown project and traversal path returns `401`.
- No server lifecycle command was executed in this worktree.
- Live behavior and independent spec/security review remain pending with the
  parent orchestration run; no merge-ready claim is made by this checkpoint.
