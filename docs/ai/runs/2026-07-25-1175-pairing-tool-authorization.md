---
date: 2026-07-25
repo: Rhythm
branch: codex/1175-pairing-tool-auth
pr: null
issues: [1175]
status: handoff
tags: [run, Rhythm]
---

# Issue #1175 c18/c19 — pairing and tool authorization

## Files

- Added a credential-free mobile public transport limited to gateway health
  and one-time-code pairing.
- Bound QR payloads and pair responses to the issuing host; the server derives
  the user from the stored code, and device replacement/revocation uses only
  Device credentials with transactional local rollback.
- Classified all ten paired tool mounts as owner-scoped or Mac-global-admin.
  Added SQLite/Postgres owner predicates, deterministic workspace-admin lookup,
  server-derived proposal actors, and paired-client error sanitization.
- Expanded two-user owner/admin matrices and added a guarded live HTTP test.

## Checks

- `npm run build` (api_server) — pass.
- `npm run typecheck && npm run lint` (mobile) — pass.
- `node --test tests/paired-host.test.mjs` — pass; public capability and 22
  paired-host state/security scenarios, including partial rollback restoration.
- `dart format . --set-exit-if-changed` — pass; 432 files, 0 changed.
- `flutter analyze --no-fatal-infos` — pass; 272 pre-existing infos.
- `flutter test test/features/agents/mobile_access_dialog_test.dart` — pass;
  8 tests.
- Focused API pairing/tool/proposal matrix — pass; 50 tests, 1 guarded live
  test skipped in the normal suite.
- `npx vitest run src/contract/issue_1175_adversarial_followup.test.ts -t
  'issue-1175-c1[89]'` — pass; 1 test, 4 parallel criteria skipped.
- Full PR gate reached 3287 API passes before the authenticated-actor fixture
  correction. That correction then passed the 35-test proposal/tool slice.
  The only remaining API failures belong to parallel #1175 c11/c15/c17/c20/
  c21/c23 workstreams and are resolved only after aggregate integration.

## Live behavioral test

Built the fork with `bun run build --single`, built the api_server, and launched
an isolated SQLite copy with the rebuilt fork override:

- API: `http://127.0.0.1:4198`
- Engine: `http://127.0.0.1:4197`
- Fork version:
  `0.0.0-codex/1175-pairing-tool-auth-202607251453`

Exact test command:

```bash
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4198 \
RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox-1175-c18c19-20260725/rhythm.db \
RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-1175-c18c19-20260725 \
npx vitest run src/__tests__/issue_1175_pairing_tool_auth_live.test.ts
```

Observed: 1 file and 1 test passed. The live test asserted public health and
pairing without auth, server-derived identity despite hostile input, code
replay rejection, two-user owner isolation and schedule triggering, staff
denial and workspace-admin global mutations, server-derived proposal reviewer,
and Device-only self-revocation. The server shut down cleanly; ports 4197/4198
were free and the sandbox directory was removed.

## Notes

- Fresh-worktree GitNexus compare-to-main is CRITICAL because the base is the
  cumulative #1076–#1175 integration branch (563 files / 24 flows). The exact
  HEAD-relative c18/c19 scope is MEDIUM: 36 indexed files, 85 symbols, and
  three mobile-gateway flows.
- No destructive migration was added. Owner-aware queries cover both SQLite
  and Postgres paths.
