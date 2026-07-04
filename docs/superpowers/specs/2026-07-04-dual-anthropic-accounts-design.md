# Dual Anthropic Accounts in the Opencode Integration — Design

**Date:** 2026-07-04
**Status:** Approved by AJ (brainstorm 2026-07-03/04)
**Goal:** Run two Claude accounts (team + personal Pro) simultaneously in Rhythm's opencode integration — explicit per-profile/per-session account choice, plus fully automatic spillover when one account hits its rate limit. No more swapping accounts in Claude Code.

## Decisions made during brainstorm

| Question | Decision |
|---|---|
| Why two accounts | Both explicit work/personal routing AND rate-limit spillover |
| Mid-session rate limit | Fully automatic failover to the other account |
| Where the choice lives | Agent-profile default + per-session override |
| Credential acquisition | In-app OAuth login (two account slots in Settings) |
| Architecture | **B: single engine + multi-account auth plugin** (chosen over two XDG-isolated engines) |

Approach B was chosen because spillover is seamless: the same engine session simply continues with the other account's token — no continuation-session seam, no transcript replay.

## Verified feasibility (source-level, fork at v1.14.x)

These were checked directly in `apps/opencode_fork` — they are the load-bearing mechanisms:

1. **Per-request session identity:** every Anthropic request already carries `x-session-affinity: <sessionID>` — `packages/opencode/src/session/llm.ts:383`. A custom `fetch` can route per session.
2. **Auth plugin mechanism:** the anthropic provider's credentials are supplied by a plugin auth hook whose loader returns provider options including a custom `fetch`. This is how the currently-installed `opencode-claude-auth` npm plugin works (installed via `REQUIRED_PLUGINS` in `apps/api_server/src/services/opencode_plugin_config.ts`).
3. **Local file plugins:** the opencode.json `plugin` array accepts local file paths, not just npm specifiers (`packages/opencode/src/plugin/shared.ts:36-57`, `config/config.ts:103-108`). No fork rebuild, no npm publish.
4. **Header precedence is irrelevant:** the plugin's `fetch` sees the final request and sets `Authorization` last; `chat.headers` is not needed.
5. **Upstream will not solve this:** multi-account was declined upstream (anomalyco/opencode issue #25738 "not planned"; ≥6 community PRs closed unmerged). Community plugins (altalt-org/opencode-anthropic-multi-auth, gaboe/oc-anthropic-multi-account) prove the in-engine failover pattern works but do not support explicit per-session routing — hence a small Rhythm-owned plugin.

### Constraints that shaped the design

- One `auth.json` holds exactly one anthropic credential; **Anthropic refresh tokens are single-use (rotate on refresh)** — two independent writers of the same credential race and kill the account's auth. Hence the single-writer rule below.
- `OPENCODE_AUTH_CONTENT` env injection is read-preferred but refresh writes go to disk and are then ignored — unsafe for long-lived servers. Not used.

## Architecture

```
Flutter (Settings: 2 account slots · profile default · session override · badges/toasts)
   │ HTTP/WS :4001
api_server
   ├─ anthropic_accounts_service   ← store CRUD, N-account refresh loop, OAuth PKCE
   ├─ routes: /opencode/accounts*, /opencode/spillover
   ├─ session create: writes routing[sdkSessionId] = accountId
   └─ WS event → Flutter on spillover
   │ writes (single writer)                      │ POST /opencode/spillover
   ▼                                             │
anthropic-accounts.json  ──read-only (mtime-cached)──►  rhythm-anthropic-accounts plugin
                                                 │  (inside opencode engine :4096)
                                                 └─ custom fetch: x-session-affinity → account token
                                                    on 429 → retry with other account
```

### 1. Account store (Rhythm-owned)

`~/Library/Application Support/Rhythm/anthropic-accounts.json`, mode 0600:

```json
{
  "accounts": [
    { "id": "team", "label": "Team (VCRC)", "refresh": "…", "access": "…", "expires": 0 },
    { "id": "personal", "label": "Personal Pro", "refresh": "…", "access": "…", "expires": 0 }
  ],
  "defaultAccountId": "team",
  "routing": { "<sdkSessionId>": "personal" }
}
```

**Single-writer rule:** api_server performs ALL writes (account add/remove, token refresh, routing). The plugin only reads (cached by mtime, re-read on change). Rationale: rotated single-use refresh tokens make concurrent writers a self-destructing design.

### 2. Plugin: `rhythm-anthropic-accounts`

- Lives in-repo (e.g. `apps/api_server/opencode_plugins/rhythm-anthropic-accounts.ts`); registered by adding its absolute path to the opencode.json `plugin` array via `ensureRequiredPlugins()`. **Replaces** `opencode-claude-auth` in `REQUIRED_PLUGINS` (two auth hooks for the same provider would conflict).
- Provides the anthropic auth hook; loader marks the provider autoloaded when the store has ≥1 account and returns a custom `fetch` that per request:
  1. reads `x-session-affinity` → `routing[sessionID] ?? defaultAccountId`;
  2. sets `Authorization: Bearer <access>`, adds the OAuth beta header, strips `x-api-key`;
  3. on a rate-limit response (429 / limit-reached): retries once with the other account, records an in-memory session→account override, and POSTs the spillover event to `http://localhost:4001/opencode/spillover` (AGENT_LOCAL bypass — no auth needed);
  4. on 401: re-reads the store once (api_server may have refreshed) and retries once; otherwise surfaces the error.
- Debug knob: `RHYTHM_FORCE_SPILLOVER=<accountId>` env makes the fetch treat that account's responses as rate-limited, so spillover is smoke-testable without burning a real limit.
- Test knob: `RHYTHM_ANTHROPIC_BASE_URL` env redirects the fetch's upstream, so the real-binary test points the engine at a local stub server and asserts which bearer token each session's requests carry.
- Size target: ~200 lines. No token refresh logic in the plugin.

### 3. api_server

- **`anthropic_accounts_service`** — store CRUD; generalizes `CredentialsBridgeService`'s 15-minute refresh loop to iterate all accounts (refresh before `expires - buffer`, persist rotated refresh token); on refresh failure marks the account `needs_relogin` and emits a notification.
- **In-app OAuth** — `POST /opencode/accounts/:id/login` → returns the Anthropic authorize URL (the same public PKCE client opencode's "Claude Pro/Max" method uses); `POST /opencode/accounts/:id/callback` with the pasted code → token exchange → store write. Reuses Rhythm's existing PKCE machinery from the MCP OAuth work.
- **Session routing** — `POST /agent-sessions` accepts optional `accountId`; resolution order: explicit override → agent profile default → `defaultAccountId`. After `session.create`, api_server writes `routing[sdkSessionId]`.
- **Spillover intake** — `POST /opencode/spillover` (localhost-only, like the other agent endpoints): updates `routing`, stamps the session row, pushes a WS event to Flutter.
- **Migration** — first boot with an empty store: import the current Keychain/auth.json credential as account #1 labeled "Default"; the keychain poll (#856) is then disabled. `auth.json`'s anthropic entry becomes vestigial (the plugin ignores it).
- **DB** — `agent_sessions.anthropic_account_id` (nullable text); agent-profile config gains `default_anthropic_account_id`. Remember the Postgres/SQLite drift rule: ALTER backfills in `postgres_bootstrap.ts` too.

### 4. Flutter

- **Settings → AI Account:** two account slots (label, connected / expired / needs-relogin status, Connect / Disconnect). Connect opens the browser (url_launcher) and shows a code-paste dialog (the Claude OAuth client redirects to Anthropic's code-display page).
- **Agent profile editor:** default-account picker.
- **New-session UI:** shows the inherited account with a per-session override dropdown.
- **Session view:** account badge; on spillover a toast + inline marker: "Team hit its limit — continued on Personal."

### 5. Error handling

- Both accounts rate-limited → the second retry's error surfaces exactly as a single-account rate limit does today.
- Refresh-token death → account flagged in Settings + `rhythm_notify` notification; sessions routed to it fall back to the other connected account.
- Store unreadable/corrupt → plugin surfaces a clear provider-auth error (no silent fallback).

### 6. Testing

- Unit: store CRUD, routing resolution order, refresh loop (mock Anthropic token endpoint), OAuth endpoints, spillover intake.
- **Real-binary integration test** (the #774 mcpAllowlist CI-guard pattern): boot the actual fork binary with the plugin registered and `RHYTHM_ANTHROPIC_BASE_URL` pointed at a local stub server; create two sessions routed to two fake accounts (stub token values); assert each session's requests arrive at the stub with the right bearer token, and that `RHYTHM_FORCE_SPILLOVER` flips a session to the other account and POSTs the spillover event. Mocked-engine tests are explicitly insufficient (see project memory: false-green SDK-mock history).
- Manual smoke: connect both real accounts, run one session on each simultaneously, force spillover via the debug knob, verify badge/toast and that the transcript continues in place.

## Deliberately skipped (add when needed)

- Per-account usage/quota meters — add if spillover decisions need to be proactive.
- More than two accounts — the store is a list, so this is UI work only.
- Proactive switching on rate-limit headers (gaboe-plugin trick) — add if reactive 429 failover feels late in practice.
- Any two-engine / XDG isolation machinery — superseded by the plugin approach.

## Risks

- **Fork drift:** the plugin targets the fork's v1.14 plugin API (`auth` hook + loader fetch + `x-session-affinity`). A fork upgrade that changes these needs the real-binary CI guard to catch it — that test is part of the acceptance criteria, not optional.
- **OAuth client behavior:** the Anthropic PKCE client's code-paste flow is what opencode uses today; if Anthropic changes it, Connect breaks but existing tokens keep refreshing.
- **ToS note:** two legitimately separate subscriptions (team + personal) used by their owner; this is account *usage*, not limit-dodging rotation of one identity.
