---
date: 2026-07-25
repo: Rhythm
branch: codex/1175-production-oauth-release
pr:
issues: [1175]
status: partial
tags: [run, Rhythm]
---

# Issue #1175 production config, Google mobile OAuth, and iOS release

## Files

- Added a build-variant Metro boundary so production bundles contain no E2E
  identity, credentials, control transport, simulated pairing action, or local
  cleartext engine fallback.
- Made production Expo config fail closed on E2E mode, Google client/redirect
  mismatch, and any Rhythm Cloud origin except `https://api.vcrcapps.com`.
- Added a production bundle verifier that exports the actual iOS bundle and
  inspects clean generated iOS/Android native projects for transport bypasses.
- Pinned the Google mobile client and reverse redirect on the server, added a
  cryptographic nonce to the authorization request, and required authoritative
  ID-token verification of audience, authorized party, nonce, issuer, expiry,
  and verified email before session creation.
- Replaced private EAS launcher paths with EAS CLI `21.2.0`, added authenticated
  project preflight, remote frozen credentials, a repository-owned production
  submit profile, auto-submit, and a deterministic latest-build recovery
  command.

## Checks

- `ai-workflow checks --level issue` — passed Flutter analyze/format plus
  api_server and mcp_server TypeScript checks.
- `cd apps/mobile && npm run lint && npm run typecheck` — passed.
- `cd apps/mobile && npm run test:google-mobile-oauth` — 5 passed.
- `cd apps/mobile && npm run test:rhythm-account` — 22 passed.
- `cd apps/mobile && npm run test:app-config` — passed.
- `cd apps/mobile && node --test --test-name-pattern='issue-1175-c(22|24)' ./tests/issue-1175-adversarial-review.test.mjs`
  — 2 passed.
- `cd apps/mobile && EXPO_APP_VARIANT=production EXPO_PUBLIC_E2E_MODE= EXPO_PUBLIC_E2E_SERVER_URL= EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID=123456789-example.apps.googleusercontent.com EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI=com.googleusercontent.apps.123456789-example:/oauthredirect EXPO_PUBLIC_RHYTHM_CLOUD_URL=https://api.vcrcapps.com npm run verify:production-bundle`
  — actual iOS export and clean generated iOS/Android inspection passed.
- `cd apps/api_server && npm run build` — passed.
- `cd apps/api_server && npx vitest run src/__tests__/google_mobile_oauth_security.test.ts`
  — 17 passed through the real Express HTTP route with Google token and
  token-verification endpoints isolated at the external boundary.
- `cd apps/api_server && npx vitest run src/contract/issue_1175_adversarial_followup.test.ts -t "issue-1175-c23"`
  — 1 passed.

## Notes

- The production Google Cloud project was visible to the signed-in account but
  denied `resourcemanager.projects.get`; an alternate accessible project had no
  OAuth clients. No client ID, redirect, or secret was invented. A project
  administrator must provision or reveal the real iOS OAuth client before the
  production config can be resolved with deployment values.
- The EAS/TestFlight commands are deterministic and non-interactive, but no
  production Apple-signed build or TestFlight submission was started from this
  partial branch. That evidence requires the secure EAS/Apple credentials and
  the real Google mobile client on the fully integrated branch. Running the
  preflight in this clean shell stopped at `EAS whoami` with the bounded
  instruction to provide `EXPO_TOKEN` or authenticate; it did not print an
  identity, token, credential, or project response.
- The branch is based before the concurrent c18/c25 workstreams. Its full mobile
  static gate therefore fails only those two aggregate contracts. Playwright
  reports 28 passed and 10 pairing failures because the c22 E2E fixture already
  emits c18's required exact `{gatewayUrl, hostId, pairingCode}` payload while
  the old base parser still accepts only the former two-key payload. Integrate
  c18 and c25 before the aggregate static and browser rerun.
- `ai-workflow checks --level pr` additionally found two inherited/environment
  gaps outside this workstream: the aggregate base includes
  `agent_org_proposals.owner_user_id` while its exact-column test is stale, and
  this isolated worktree has no Opencode-fork dependency install (`tsgo` and
  the OpenTUI preload are unavailable). The Flutter tests, API lint/build,
  mcp_server tests/build, mobile contract, and mobile fake-server self-test
  stages passed.
- Fresh GitNexus analysis reports this workstream delta as LOW risk: 27 indexed
  files, 59 symbols, zero affected processes. Compare-to-main is CRITICAL
  because the base branch intentionally contains the broader 564-file
  #1076–#1175 aggregate; that inherited scope affects 24 indexed flows.
