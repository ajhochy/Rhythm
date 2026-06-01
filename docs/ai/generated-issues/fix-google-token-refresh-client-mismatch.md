# fix(integrations): Google token refresh fails with `unauthorized_client` — refresh uses the WEB OAuth client but tokens were minted by the DESKTOP client

> **Goal type:** bug fix · **Severity:** High (recurring, user-facing) · **Surface:** Integrations page
> **Confidence in root cause:** Very high — confirmed end-to-end in code + deploy config (see Evidence).
> **Blast radius of fix:** One private method, ~3 lines. No migration, no new env vars, no Google Cloud changes.

---

## 1. Problem

On the **Integrations** page, Google Calendar / Gmail intermittently show:

```
Google token refresh failed: {
  "error": "unauthorized_client",
  "error_description": "Unauthorized"
}
```

Re-authenticating ("Reconnect" → Google sign-in) clears it temporarily, but it **recurs** within ~1 hour and the error returns. This is annoying and erodes trust in the integration.

### Why re-auth "fixes" it temporarily (this detail confirms the diagnosis)
A fresh sign-in mints a brand-new **access token** valid ~1 hour. Any sync inside that hour uses the access token directly and succeeds — **no refresh needed**. Once the access token expires, the very next sync triggers a token **refresh**, which fails with `unauthorized_client`. So the symptom is: works right after reconnect → breaks ~1h later → repeat. That is precisely a *refresh-path-only* failure, not an *issuance* failure.

---

## 2. Root cause (confirmed)

**Rhythm uses two different Google OAuth clients, and the refresh path uses the wrong one.**

- **Tokens are minted by the DESKTOP client.** The shipping Flutter desktop app is the only live path that connects Google. It runs an authorization-code + PKCE flow and POSTs to `POST /auth/google/desktop-exchange`, which exchanges the code using **`env.googleAuthClientId` + `env.googleAuthClientSecret`** (the *desktop* OAuth client).

- **Tokens are refreshed with the WEB client.** When an access token nears expiry, `IntegrationsService.ensureFreshAccount` calls `GoogleOAuthService.refreshAccessToken` → `refreshTokens`, which sends **`env.googleClientId` + `env.googleClientSecret`** (the *web/Firebase* OAuth client) with `grant_type=refresh_token`.

Google rejects a `refresh_token` presented with a **different client** than the one that issued it. The token endpoint returns HTTP 401 with `error: unauthorized_client` (a.k.a. `invalid_client` / `"Unauthorized"`). **The refresh client must match the issuing client.**

### Evidence (file:line)

| Fact | Location |
|---|---|
| Refresh sends the **web** client | [`refreshTokens` uses `env.googleClientId` / `env.googleClientSecret`](apps/api_server/src/services/google_oauth_service.ts:242) |
| Mint sends the **desktop** client | [`exchangeDesktopCode` uses `env.googleAuthClientId` / `env.googleAuthClientSecret`](apps/api_server/src/services/google_oauth_service.ts:92) |
| Desktop is the only live mint path (Flutter) | [`DesktopGoogleOAuthClient.signIn()` → `POST /auth/google/desktop-exchange`](apps/desktop_flutter/lib/app/core/auth/desktop_google_oauth_client.dart:75) |
| Refresh is invoked on near-expiry sync | [`ensureFreshAccount` → `googleOAuth.refreshAccessToken`](apps/api_server/src/services/integrations_service.ts:519), [`shouldRefresh` 5-min buffer](apps/api_server/src/services/integrations_service.ts:524) |
| The two env clients are **distinct** in the shipped build | [`desktop_release.yml`: `GOOGLE_AUTH_CLIENT_ID = secrets.GOOGLE_DESKTOP_CLIENT_ID` vs `GOOGLE_CLIENT_ID = secrets.GOOGLE_CLIENT_ID`](.github/workflows/desktop_release.yml:34) |
| Both client sets written to the bundled server `.env` | [`desktop_release.yml` env file printf](.github/workflows/desktop_release.yml:110) |
| `googleAuthClientSecret` has **no fallback** (so refresh-with-web was never accidentally "the same") | [`env.ts`](apps/api_server/src/config/env.ts:32) |
| Error reaches the UI via `markErrorAsync` → `errorMessage` | [`integrations_service.ts` catch → `markErrorAsync`](apps/api_server/src/services/integrations_service.ts:143), [`toAccountDto` returns `errorMessage`](apps/api_server/src/controllers/integrations_controller.ts:49) |
| Existing test already pins the desktop-mint client | [`google_desktop_exchange.test.ts` asserts `client_id=desktop-client…`](apps/api_server/src/__tests__/google_desktop_exchange.test.ts:82) |

---

## 3. The fix

In **`apps/api_server/src/services/google_oauth_service.ts`**, change `refreshTokens` to refresh with the **same client that minted the token** — the desktop client — mirroring `exchangeDesktopCode` exactly.

```ts
private async refreshTokens(refreshToken: string): Promise<GoogleTokenResponse> {
  // Refresh tokens MUST be presented with the same OAuth client that minted
  // them. Every Google integration account in the shipping app is minted via
  // the desktop PKCE flow (exchangeDesktopCode), which uses the *desktop*
  // client. Refreshing with the *web* client (googleClientId/Secret) makes
  // Google return `unauthorized_client`. Mirror the mint client here.
  if (!env.googleAuthClientId || !env.googleAuthClientSecret) {
    throw AppError.badRequest(
      'Google desktop OAuth is not configured. Set GOOGLE_AUTH_CLIENT_ID and GOOGLE_AUTH_CLIENT_SECRET.',
    );
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.googleAuthClientId,
      client_secret: env.googleAuthClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw AppError.badRequest(`Google token refresh failed: ${text}`);
  }

  return (await response.json()) as GoogleTokenResponse;
}
```

### Why this lands first try
`exchangeDesktopCode` and the new `refreshTokens` now use **byte-for-byte identical credentials** (`googleAuthClientId` / `googleAuthClientSecret`). The exchange demonstrably succeeds in every environment where Google sign-in works (that's how the token got minted in the first place). Therefore a refresh that presents the *same* client **must** succeed in those same environments. There is no Google Cloud change, no new secret, and no schema change required — only the client pair the server already holds and already proves valid on every sign-in.

**Do NOT change** (these are already correct — preserve them):
- `refreshAccessToken` keeps the old refresh token when Google omits a new one: `refreshToken: tokens.refresh_token ?? account.refreshToken` ([line 197](apps/api_server/src/services/google_oauth_service.ts:197)).
- `expiresAt` falls back to the prior value when `expires_in` is absent ([line 187](apps/api_server/src/services/google_oauth_service.ts:187)).
- The upsert updates **both** `google_calendar` and `gmail` rows together ([repository loop](apps/api_server/src/repositories/integration_accounts_repository.ts:248)).

---

## 4. Executable acceptance contract (write this test FIRST — it must fail on current code)

Add `apps/api_server/src/__tests__/google_token_refresh.test.ts`. It mirrors the style of the existing desktop-exchange test and pins refresh to the **desktop** client. On the unmodified codebase the first assertion fails (current code sends `googleClientId`); after the fix it passes.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { env } from '../config/env';
import { GoogleOAuthService } from '../services/google_oauth_service';
import type { IntegrationAccount } from '../models/integration_account';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

const ACCOUNT: IntegrationAccount = {
  id: 'acct-1',
  ownerId: 1,
  provider: 'google_calendar',
  externalAccountId: 'google-sub-1',
  email: 'user@example.com',
  displayName: 'User',
  status: 'connected',
  accessToken: 'old-access',
  refreshToken: 'refresh-abc',
  scope: 'openid email profile',
  tokenType: 'Bearer',
  expiresAt: new Date(Date.now() - 60_000).toISOString(), // expired
  lastSyncedAt: null,
  errorMessage: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('Google token refresh uses the desktop (issuing) client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const original = { authId: '', authSecret: '', webId: '', webSecret: '' };

  beforeEach(() => {
    setDb(makeDb());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    original.authId = env.googleAuthClientId;
    original.authSecret = env.googleAuthClientSecret;
    original.webId = env.googleClientId;
    original.webSecret = env.googleClientSecret;
    (env as any).googleAuthClientId = 'desktop-client.apps.googleusercontent.com';
    (env as any).googleAuthClientSecret = 'desktop-secret';
    (env as any).googleClientId = 'web-client.apps.googleusercontent.com';
    (env as any).googleClientSecret = 'web-secret';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    (env as any).googleAuthClientId = original.authId;
    (env as any).googleAuthClientSecret = original.authSecret;
    (env as any).googleClientId = original.webId;
    (env as any).googleClientSecret = original.webSecret;
  });

  it('refreshes with the desktop client_id/secret, not the web client', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'new-access', expires_in: 3600, token_type: 'Bearer' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await new GoogleOAuthService().refreshAccessToken(ACCOUNT);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const body = (init.body as URLSearchParams).toString();
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('client_id=desktop-client.apps.googleusercontent.com');
    expect(body).toContain('client_secret=desktop-secret');
    // Guard against regression to the web client:
    expect(body).not.toContain('web-client.apps.googleusercontent.com');
    expect(body).not.toContain('web-secret');
  });

  it('preserves the existing refresh token when Google omits a new one', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'new-access', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const updated = await new GoogleOAuthService().refreshAccessToken(ACCOUNT);
    expect(updated.refreshToken).toBe('refresh-abc');
    expect(updated.accessToken).toBe('new-access');
  });

  it('surfaces a Google unauthorized_client error as an AppError', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"unauthorized_client","error_description":"Unauthorized"}', { status: 401 }),
    );
    await expect(new GoogleOAuthService().refreshAccessToken(ACCOUNT)).rejects.toThrow(
      /Google token refresh failed/,
    );
  });
});
```

> Verify the exact `IntegrationAccount` field names against [`models/integration_account.ts`](apps/api_server/src/models/integration_account.ts) before running — adjust the fixture if a field differs. The contract is the **client assertion**, not the fixture shape.

---

## 5. Acceptance criteria

- [ ] New test `google_token_refresh.test.ts` exists, **fails on the current code**, and **passes after the fix**.
- [ ] `refreshTokens` sends `client_id` / `client_secret` equal to `env.googleAuthClientId` / `env.googleAuthClientSecret`.
- [ ] Existing `google_desktop_exchange.test.ts` and the full api_server vitest suite stay green.
- [ ] `tsc` build is clean (`npm run build`).
- [ ] Manual smoke (see §7): after a token expires, a Google Calendar/Gmail sync **succeeds** and the Integrations page shows **Connected** with no `unauthorized_client` error.
- [ ] No new env var, migration, or Google Cloud config is required by the code change.

---

## 6. Config / deploy verification (verify, don't assume)

The code fix presumes the server that serves `/auth/google/desktop-exchange` also has the desktop **secret** available for refresh. Confirm for **both** deployment targets:

- **Bundled desktop build** — already provides both client sets to the embedded server: [`desktop_release.yml:34-38`](.github/workflows/desktop_release.yml:34) + [env file write :110](.github/workflows/desktop_release.yml:110). ✅ No change expected; confirm the lines are intact.
- **Hosted API (`api.vcrcapps.com`, Synology)** — the deploy runbook lists `GOOGLE_AUTH_CLIENT_ID` ([hosted deploy doc](docs/release/hosted_deployment_synology_cloudflare.md)) but **confirm `GOOGLE_AUTH_CLIENT_SECRET` is also set** there. If sign-in already works against the hosted API, the secret is present; if it is missing from the runbook checklist, **add it** so future deploys don't regress. (If it were missing, `exchangeDesktopCode` would already be failing — so this is a documentation/guard check, not expected to block.)
- **Google Cloud** — the "Desktop app" OAuth client behind `GOOGLE_DESKTOP_CLIENT_ID` must hold the secret stored in `GOOGLE_DESKTOP_CLIENT_SECRET`. It does (sign-in works). No console change required.

---

## 7. Validation plan

**Automated (api_server):**
```bash
cd apps/api_server
npm test          # new contract test passes; existing suite green
npm run build     # tsc clean
```

**Manual smoke (forces the refresh path without waiting an hour):**
1. `cd apps/api_server && npm run dev` (or use the packaged app pointed at the hosted API).
2. In the desktop app, connect Google (Settings/Integrations → Reconnect → complete sign-in).
3. Force the access token to look expired so the next sync refreshes:
   - Local SQLite: `~/Library/Application Support/Rhythm/rhythm.db` → set `expires_at` to a past ISO timestamp for the `google_calendar` and `gmail` rows in `integration_accounts`; **or**
   - Trigger a sync ≥ the 5-min pre-expiry buffer before natural expiry.
4. Trigger a Google Calendar sync (Integrations page → sync, or the rhythm MCP `resync` path).
5. **Expect:** sync succeeds, `error_message` clears, status shows **Connected**. **No** `Google token refresh failed: { "error": "unauthorized_client" … }`.
6. Confirm the error does **not** return after the access token would have expired again (the previous symptom).

---

## 8. Non-goals / out of scope (file follow-ups, don't expand here)

- **Do not** consolidate the web and desktop clients into one, change scopes, or rework the OAuth architecture.
- **Do not** modify the legacy web `GET /auth/google/callback` (`handleCallback`) flow — it is not used by the shipping desktop client. *Note:* any account historically minted via that web flow would still need one reconnect to switch to a desktop-minted token; a single reconnect resolves it. Acceptable; mention in the PR.
- **Reconnect-needed UX (optional follow-up):** when refresh returns a genuinely terminal error (`invalid_grant` = revoked/expired refresh token), set the account to a "needs reconnect" state instead of showing raw JSON. Out of scope for this fix; file as a separate issue if desired.

---

## 9. Risk

**Very low.** Single private method; mirrors the already-proven desktop-exchange credentials; guarded by a new failing-then-passing test plus the existing exchange test; no migration, no new secret, no external config. The change cannot make a *working* environment worse: it makes refresh use the same credentials that issuance already uses successfully in that environment.
