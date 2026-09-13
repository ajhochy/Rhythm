---
date: 2026-09-13
repo: Rhythm
branch: feature/ios-hosted-oauth
pr: null
issues: [ios-hosted-oauth-backend]
status: ready_for_verification
tags: [run, Rhythm]
---

## Files

- Added process-local `GoogleMobileLoginBroker`, hosted mobile begin/redeem routes, namespaced callback dispatch, and focused unit/live contracts.
- Extended only the existing Google OAuth service for login-only web-client authorization and verified ID-token exchange.
- No migration, schema, Postgres bootstrap, repository, mobile, relay, integration-token persistence, production, commit, push, or deploy changes.

## Checks

- Acceptance red: `npx vitest run src/__tests__/ios_hosted_oauth_backend.test.ts`
  - Preserved baseline: 15 failed / 1 passed; missing begin route returned 404. Updated process-local/restart contract then failed 16 / passed 1 before implementation.
- GitNexus upstream impact before edits:
  - `AuthController` LOW: 1 direct caller, 13 total, no processes.
  - `googleCallback` LOW: 0 direct callers, no processes.
  - `GoogleOAuthService` LOW: 3 direct dependents, 24 total, no processes.
  - `auth_routes.ts` LOW: 1 direct importer, 12 total, no processes.
  - New `GoogleMobileLoginBroker`: not yet indexed, UNKNOWN with 0 dependents. API route registry had no callback/mobile route matches.
  - Previously identified CRITICAL `runMigrations` was not edited; AJ approved the process-local replacement ceiling.
- `npm run build`
  - PASS.
- `npx vitest run src/__tests__/ios_hosted_oauth_backend.test.ts src/__tests__/google_mobile_oauth_security.test.ts src/__tests__/google_step_up_scopes.test.ts`
  - PASS: 40/40.
- Canonical contract command from `docs/ai/contracts/ios-hosted-oauth-backend.json`: PASS 20, skipped 1 env-gated live test (the same live test passed separately below).
- `npm test`
  - 6,084 passed, 232 skipped, 1 unrelated existing failure in `workflow_failure_signal_extractor.test.ts:764`; isolated rerun reproduced the same failure.
- Fork build: `bun install --no-save && bun run --cwd packages/opencode build --single`
  - PASS; generated lockfile drift was reverted and is excluded from the diff.
- Sandbox lifecycle used only `tools/dev/sandbox.sh` with isolated API `:4298`, engine `:4297`, sandbox directory `/private/tmp/rhythm-ios-oauth-backend`, sanitized read-only fixture, and loopback fake Google boundary `:4299`.
  - `tools/dev/sandbox.sh status`: API and engine listeners healthy.
  - `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4298 RHYTHM_GOOGLE_OAUTH_TEST_BASE_URL=http://127.0.0.1:4299 npx vitest run src/__tests__/ios_hosted_oauth_backend_live_e2e.test.ts --no-file-parallelism`: PASS 1/1.
  - `tools/dev/sandbox.sh down`: sandbox removed; `:4298` and `:4297` released.
- GitNexus `detect_changes(scope=all, worktree=<exact worktree>)`: LOW, 21 indexed changed symbols in 3 tracked implementation files, 0 affected symbols, 0 affected processes. New/untracked broker and tests are not yet indexed.
- `git diff --check`: PASS. Final scope contains only auth controller/routes, Google OAuth service, new broker/tests, contract, and this run note; fork lockfile is clean.

## Security assumptions and stable mobile contract

- Ponytail ceiling: hosted production remains exactly one API container/process. Login and handoff Maps are capped at 1,000 entries, use hashed lookup keys, random 256-bit IDs, 5-minute/60-second TTLs, opportunistic plus unref'd periodic cleanup, and a per-address begin limiter.
- A process restart loses state by design. Callback/redeem then returns HTTP `409` with `{ "error": "mobile_login_expired", "retry": "begin_fresh_login" }`; no session is created. Clients must begin a fresh login, including after an ambiguous response following consume.
- `GET /auth/google/mobile-begin` accepts `code_challenge_method=S256`, a 43-character SHA-256 base64url challenge, and bounded opaque `app_state`; success is `302` to Google's authorization endpoint and sets an HttpOnly/Secure/SameSite=Lax callback-scoped binding cookie.
- Google receives the fixed configured HTTPS callback/web client, independent namespaced state and nonce, `openid email profile`, and `prompt=select_account`; no integration scopes, offline access, or caller return URL.
- Success callback redirects only to `rhythmagents://oauth/callback?code=<opaque>&state=<original>`; Google codes/tokens and verified identity are never placed in the deep link or logs.
- `POST /auth/google/mobile-redeem` accepts exactly `{ code, codeVerifier }`; one atomic consume may return `{ sessionToken, user }`. Concurrent/replayed consume returns the fresh-login `409`; wrong PKCE returns `401`.
- Mobile begin/callback/redeem responses set `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The sandbox Google override is accepted only with both isolated live-test flags and a loopback HTTP URL.

## Handoff

READY_FOR_VERIFICATION. Real Google/Cloudflare login, integration, deployment, production configuration, and manual approval remain manager-owned.
