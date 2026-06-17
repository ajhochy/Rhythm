# MCP Remote OAuth Workaround (canva / notion)

Date: 2026-06-17
Scope: `apps/api_server` (new OAuth service + routes) + `apps/desktop_flutter` (Connect wiring). Part of #729.

## Why

opencode's SDK/HTTP MCP auth path (`POST /mcp/:name/auth`, exposed as
`client.mcp.auth.start`) generates an authorization URL + starts a loopback
callback server, but **never registers the `state`** in the callback
validator's pending set (`mZ`). Every remote-OAuth callback therefore fails with
`pendingStates=[] … Invalid or expired state parameter`. Proven via opencode
logs + an isolated direct-callback test, and matches the known, unfixed bugs
[anomalyco/opencode#17822] (closed, no fix) and [#15546]. The working path is
the CLI `opencode mcp auth`, which pre-saves state — not usable from the
embedded engine (port 19876 contention, no TTY).

Workaround (documented in #17822): perform the OAuth ourselves and write the
resulting tokens into opencode's auth store, then reconnect.

## opencode auth store (reverse-engineered, verified on disk)

File: `~/.local/share/opencode/mcp-auth.json`. Per-server entry:

```json
"canva": {
  "clientInfo": { "clientId": "...", "clientSecret": "...optional...", "clientIdIssuedAt": 1781708229, "clientSecretExpiresAt": 0 },
  "serverUrl": "https://mcp.canva.com/mcp",
  "tokens": { "accessToken": "...", "refreshToken": "...", "expiresAt": <unix seconds>, "scope": "space sep" }
}
```

- `getForUrl(name, url)` returns the entry **only if `entry.serverUrl === url`** —
  must match the configured server URL exactly (`https://mcp.canva.com/mcp`).
- `tokens()` reads `tokens.{accessToken, refreshToken, expiresAt, scope}`;
  `isTokenExpired` = `tokens.expiresAt < now/1000`.
- Refresh later uses `clientInfo.clientId` (+ secret if present). So whatever
  client WE register must be written into `clientInfo`.

## OAuth endpoints (verified live, canva; notion mirrors)

- 401 on `serverUrl` → `WWW-Authenticate: … resource_metadata="…/.well-known/oauth-protected-resource/mcp"`.
- protected-resource-metadata → `authorization_servers: ["https://mcp.canva.com"]`, `scopes_supported: [...]`.
- `<as>/.well-known/oauth-authorization-server` →
  `authorization_endpoint …/authorize`, `token_endpoint …/token`,
  `registration_endpoint …/register`, `code_challenge_methods_supported: ["plain","S256"]`,
  `token_endpoint_auth_methods_supported: ["client_secret_basic","client_secret_post","none"]`.
- Authorize/token requests carry the RFC 8707 `resource=<serverUrl>` indicator.

## Backend design — `mcp_oauth_service.ts`

A self-contained Authorization-Code + PKCE flow with our **own** loopback
callback (do NOT use opencode's auth.start or its 19876 server):

1. `discover(serverUrl)`: 401 → protected-resource-metadata → AS metadata.
   Return `{ authorizationEndpoint, tokenEndpoint, registrationEndpoint, scopes, resource }`.
2. `ensureClient(name, serverUrl, meta, redirectUri)`: reuse a cached
   `clientInfo` from mcp-auth.json **only if it was registered by us with the
   same redirectUri** (track via a private field, e.g. `redirectUri` saved in
   the entry); otherwise DCR `POST registration_endpoint` with
   `{ client_name, redirect_uris:[redirectUri], grant_types:["authorization_code","refresh_token"], response_types:["code"], token_endpoint_auth_method:"none", scope }`.
   Return `{ clientId, clientSecret? }`.
3. `start(name)`: discover + ensureClient, generate `codeVerifier` (43–128 char
   base64url) + `codeChallenge` (S256) + random `state`; bind a one-shot HTTP
   callback server on a fixed loopback port (default `53682`, configurable via
   env `MCP_OAUTH_CALLBACK_PORT`); build authorize URL with
   `response_type=code, client_id, redirect_uri, state, code_challenge,
   code_challenge_method=S256, scope, resource`. Store pending
   `{state, codeVerifier, meta, clientInfo, serverUrl}` in memory keyed by name.
   Return `{ authorizationUrl }`.
4. Callback handler (`GET /mcp/oauth/callback?code&state`): match `state` to a
   pending entry (reject "invalid state" otherwise), POST `token_endpoint`
   (`grant_type=authorization_code, code, redirect_uri, client_id, code_verifier,
   resource`; if clientSecret present use client_secret_post), receive
   `{access_token, refresh_token, expires_in, scope}`. Write to mcp-auth.json via
   the **exact** schema above (`expiresAt = now/1000 + expires_in`), preserving
   `clientInfo` + `serverUrl`. Reconnect (step 5). Serve a success/fail HTML
   page (mirror opencode's copy so the UX matches). Clear the pending entry and
   close the callback server.
5. `reconnect(name)`: call the **raw** `client.mcp.connect({path:{name}})`
   (NOT our auth.start-first `connectMcp`) so the engine re-reads tokens and
   establishes an authenticated session.

Status tracking: keep an in-memory `Map<name, 'pending'|'connected'|'failed:msg'>`
updated by the callback, exposed via a status route for the UI to poll.

### Routes (`opencode_mcp_routes.ts` or a new `mcp_oauth_routes.ts`)
- `POST /opencode/mcp/:name/oauth/start` → `{ authorizationUrl }`.
- `GET  /opencode/mcp/:name/oauth/status` → `{ status }`.
- Callback server is its own http listener on the loopback port (not an Express
  route) so its redirect_uri is stable and isolated.
- AGENT_LOCAL localhost posture, same as the other agent endpoints.

## Flutter

`mcp_data_source.dart`: `startOAuth(name) → authorizationUrl`,
`oauthStatus(name) → String`. `mcp_controller.connectServer`: for the curated
remote servers, call `startOAuth`, open the URL (existing injectable launcher),
then poll `oauthStatus` (a few times, bounded) and `refresh()` when it flips to
`connected`; on `failed`, surface the inline error. Non-OAuth servers keep the
existing plain-connect path. Keep the curated-catalog "remote/OAuth" flag to
decide which path to use (already distinguishable: remote URL + no requiredEnv).

## Testing

- Backend: spin a **fake OAuth provider** (in-process http server exposing
  well-known metadata, /register, /authorize redirect, /token) + a **temp
  mcp-auth.json**; assert discover → DCR → auth-URL (state+S256) → callback →
  token exchange → correct mcp-auth.json write (exact schema, serverUrl match,
  expiresAt math) → reconnect invoked. Invalid-state callback rejected. No real
  network. Mock the SDK `mcp.connect` for the reconnect assertion.
- Flutter: mounted MCP section; fake data source returns an auth URL then
  `connected` status; assert the launcher fires and the row flips to connected;
  failed status surfaces the inline error.

## Non-goals
- Token refresh scheduling (opencode handles refresh using the clientInfo we
  persist). We only need a valid access+refresh token written.
- Reusing opencode's DCR client / port 19876 (we register our own client + port).

[anomalyco/opencode#17822]: https://github.com/anomalyco/opencode/issues/17822
[#15546]: https://github.com/anomalyco/opencode/issues/15546
