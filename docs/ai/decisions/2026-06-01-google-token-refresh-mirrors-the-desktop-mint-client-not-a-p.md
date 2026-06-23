---
index: "[[Rhythm]]"
date: 2026-06-01
repo: rhythm
tags: [decision, rhythm]
---

# Google token refresh mirrors the desktop mint client (not a per-account issuing-client column)

**Context:** Google integration accounts were minted by the desktop PKCE client (`exchangeDesktopCode` → `googleAuthClientId/Secret`) but `refreshTokens` refreshed with the web client (`googleClientId/Secret`). Google rejects a refresh token presented under a different client than issued it → recurring `unauthorized_client` on the Integrations page.

**Decision:** Make `refreshTokens` present the same credentials `exchangeDesktopCode` uses (`googleAuthClientId/Secret`), with a not-configured guard. No schema/migration.

**Alternatives considered:**
- Add an `issuing_client_id` column to `integration_accounts`, populate on upsert, and refresh with the matching client — rejected: requires SQLite+Postgres migration and a backfill, for zero practical benefit since the Flutter desktop app is the only live mint path and every shipping account is desktop-minted.
- Consolidate to a single Google OAuth client — rejected: larger change, out of scope, and the desktop (PKCE/loopback) and web (redirect) flows have legitimately different client types.

**Consequences:**
- + Symmetric with issuance: any environment where Google sign-in works will refresh successfully (same credentials), so the fix "lands first try" with no new secret or Google Cloud change.
- + Tiny, low-risk surface (one private method) covered by a contract test.
- − Any legacy account minted via the now-unused web `/auth/google/callback` flow would need one reconnect to switch to a desktop-minted token.
- − Depends on the serving API having `GOOGLE_AUTH_CLIENT_SECRET` set; bundled build provides it (`desktop_release.yml`), hosted deploy must too (already required since desktop-exchange works there).
