# Google Cloud Console Setup — Desktop PKCE Flow

Required one-time config for the consolidated OAuth flow introduced in PR #242.

## 1. Confirm the Desktop OAuth client exists

Google Cloud Console → APIs & Services → Credentials. There should be an **OAuth 2.0 Client ID** of type **Desktop app** used for `GOOGLE_DESKTOP_CLIENT_ID` (already wired as a GitHub Actions secret; see `.github/workflows/desktop_release.yml`).

If it doesn't exist, create one:
- Type: **Desktop app**
- Name: `Rhythm macOS Desktop`
- No client secret is issued — PKCE only.

## 2. Add loopback redirect URIs

On the Desktop client's detail page, under **Authorized redirect URIs**, add:

```
http://127.0.0.1
```

Google accepts any port on that host at runtime for Desktop clients, so one entry covers every ephemeral port the app will bind. (Google rejects `localhost`-form redirects for Desktop clients as of 2022; use the literal `127.0.0.1`.)

No action needed on **Authorized JavaScript origins**.

## 3. Verify scopes

The OAuth consent screen must list all scopes requested by the app:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/gmail.metadata`

The Gmail + Calendar scopes are sensitive; if the app is still in "Testing" publishing status, every signing-in email must be listed under **Test users**.

## 4. Secrets inventory

| Key | Used for | Status |
|-----|----------|--------|
| `GOOGLE_DESKTOP_CLIENT_ID` | PKCE flow (desktop) | Already set |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Legacy web-side OAuth (Gmail/Calendar re-connect from settings) | Keep for now |

No new secrets are required for this PR.

## 5. Smoke test plan

After this PR merges and a new signed release is cut:

1. Install the fresh DMG on a clean macOS account (or one where Rhythm was removed).
2. Launch Rhythm — app opens to the sign-in screen (app must launch; AMFI is no longer a concern because the keychain entitlement was removed).
3. Click "Continue with Google".
4. Default browser opens Google consent page. Grant all scopes.
5. Browser tab shows "Signed in" confirmation page.
6. Rhythm window transitions into the authenticated app shell.
7. Settings → Integrations shows both **Google Calendar** and **Gmail** as connected, with the same Google account.
8. No "providerConfigurationError: keychain error" at any point.

If sign-in fails, check:
- The "Dump signed entitlements for diagnosis" step in the CI log shows the signed binary has no keychain entitlement (expected).
- The app log (Console.app → filter "Rhythm") for the actual error string from the loopback exchange call.
