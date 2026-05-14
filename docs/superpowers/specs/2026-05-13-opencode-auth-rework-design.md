# Opencode auth rework — design

**Status:** draft, awaiting user review
**Date:** 2026-05-13
**Origin:** smoke of PR #574 surfaced four auth bugs (#582, #583, #584, #585); fix attempts for #583 and #584 in commits `b374279` and `b7859ce` reverted from utility once the underlying SDK behavior was probed
**Probe artifact:** `apps/api_server/scripts/auth-strategy-probe.ts` (gitignored, run on 2026-05-13 against `@opencode-ai/sdk@1.14.49`)

## Goal

Rebuild the Opencode auth surface in Rhythm so every supported provider has a working sign-in path, the agent capability map reflects reality, and the empty-state UX no longer references the retired CLI model. Stay aligned with how the upstream Opencode SDK *actually* behaves today (post the Anthropic legal pushback that removed Claude OAuth from the SDK).

## Non-goals

- Codex (`~/.codex/auth.json`) credentials bridge. Probe showed Codex `auth.json` lacks an `expires_at` field, and the OpenAI native OAuth flow already works through the SDK. Defer.
- Windows / Linux Keychain equivalents for the Claude bridge. macOS Keychain + `~/.claude/.credentials.json` file fallback only.
- Writing refreshed tokens back to the macOS Keychain. Refresh tokens are single-use; clobbering Claude Code's copy would break that app.
- Replacing or extending the Opencode SDK. We work with what `@opencode-ai/sdk` ships.

## Probe findings (concrete SDK behavior, 2026-05-13)

1. **Every SDK client method returns a hey-api result wrapper: `{data, error, request, response}`.** `opencode_client_service.ts` reads the top-level object directly (`res.providers`, `res.url`, …), so the actual payload at `res.data.X` is silently dropped. This is the single root cause behind both #583 ("no auth URL returned") and the #584 sub-bug (`listProviders` always empty).

2. **Per-provider OAuth reality:**

   | Provider | `provider.oauth.authorize` | Bridge needed | Notes |
   |---|---|---|---|
   | anthropic | **throws** (`m[d.providerID].methods` undefined) | yes | Anthropic forced SDK removal. Use Claude Code creds bridge via `auth.set({type:'oauth'})`. |
   | openai | works — returns `{url: "https://auth.openai.com/oauth/authorize?...redirect_uri=http://localhost:1455/auth/callback&...", method: "auto", instructions}` | optional | SDK starts its own PKCE listener on :1455. We just need to unwrap `.data.url`. |
   | github-copilot | works — returns `{url: "https://github.com/login/device", method: "auto", instructions: "Enter code: 8518-5780"}` | no | Device code is embedded in the `instructions` string. UI renders verbatim. |

3. **`auth.set({type:'oauth', ...})` is first-class SDK behavior.** Anthropic bridge succeeded with `{data: true}` when given Claude's `accessToken` / `refreshToken` / `expiresAt`. OpenAI bridge failed only because Codex's `auth.json` lacks an `expires_at` field (the SDK requires `expires: number`).

4. **Source-of-truth for "what's authed".** Neither `client.provider.list()` nor `client.config.providers()` lists authed providers — the first returns the full catalog (100+ providers, every model), the second returns model-configured providers. The right source is **reading `~/.local/share/opencode/auth.json` directly** (the file `auth.set` writes).

5. **Credential file shapes:**
   - Claude Code (macOS Keychain item `Claude Code-credentials`): top-level `{claudeAiOauth, mcpOAuth}`. `claudeAiOauth.{accessToken, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier}`. `expiresAt` is ms epoch.
   - Codex (`~/.codex/auth.json`): `{OPENAI_API_KEY, tokens: {id_token, access_token, refresh_token, account_id}, last_refresh}`. No `expires_at`.

## Architecture

Three-tier auth model, picked per-provider based on what's installed and what the SDK supports.

| Tier | Mechanism | Providers |
|---|---|---|
| Subscription bridge | Read Claude Code creds (Keychain or `~/.claude/.credentials.json`) → `client.auth.set({type:'oauth', access, refresh, expires})` | anthropic |
| Native SDK OAuth | `client.provider.oauth.authorize` → opens browser → SDK's own local callback (openai) or device-flow render (github-copilot) | openai, github-copilot |
| API key | `client.auth.set({type:'api', key})` | google, openrouter; plus anthropic / openai fallback when no subscription is present |

### Components

| Component | Path | Responsibility |
|---|---|---|
| `opencode_client_service` (existing) | `apps/api_server/src/services/opencode_client_service.ts` | Unwraps `.data` consistently across every SDK call. Exposes typed wrappers. |
| `opencode_auth_store` (new) | `apps/api_server/src/services/opencode_auth_store.ts` | Reads `~/.local/share/opencode/auth.json`, returns `Set<string>` of provider IDs. Single source-of-truth for "is X authed". |
| `credentials_bridge_service` (new) | `apps/api_server/src/services/credentials_bridge_service.ts` | Reads Claude Code creds (Keychain → file fallback), caches in memory, refreshes against Anthropic's OAuth token endpoint when near expiry, calls `auth.set` to persist into the auth store. |
| `opencode_auth_routes` (extended) | `apps/api_server/src/routes/opencode_auth_routes.ts` | Adds `GET /opencode/auth/sources` and `POST /opencode/auth/anthropic/bridge`. Existing `/authorize` + `/callback` keep working once `.data` unwrap lands. |
| `agents_capabilities_routes` (existing) | `apps/api_server/src/routes/agents_capabilities_routes.ts` | Calls `listAuthedProviders()` from the new store; existing aggregator-mapping logic from `b7859ce` stays. |
| `ai_account_section` (existing, rewritten) | `apps/desktop_flutter/lib/features/settings/widgets/ai_account_section.dart` | Dynamic per-tile rendering driven by `/sources` + `/`. Subscription tile for Claude, OAuth tiles for OpenAI / Copilot, API-key tiles for everything else. |

### Data flow — Claude bridge

```
User clicks "Use Claude subscription"
  → POST /opencode/auth/anthropic/bridge
    → credentials_bridge_service.bridgeAnthropic()
       1. Check in-memory cache. If expiresAt - now > 60s, use cached tokens. Else step 2.
       2. Re-read Keychain (`security find-generic-password -s "Claude Code-credentials" -w`).
          - If Keychain's expiresAt > 60s, ride along on Claude Code's freshly-refreshed tokens.
          - Else step 3.
       3. POST https://console.anthropic.com/v1/oauth/token with `grant_type=refresh_token`,
          `refresh_token=<Keychain refresh>`, `client_id=<Claude Code OAuth client ID>`.
          On success, store refreshed tokens in memory only (no Keychain writeback).
          On failure, return structured error → UI shows "Re-authorize via Claude Code".
       4. client.auth.set({path:{id:'anthropic'}, body:{type:'oauth', access, refresh, expires}})
       5. opencode_auth_store re-reads auth.json; `claude-code` flips true in capability map.
  → response: 200 {success: true, provider: 'anthropic'}
  → Flutter refreshes /opencode/auth/ and /agents/capabilities
  → tile turns green, Agents empty state hides.
```

A 30-minute background timer in `credentials_bridge_service` runs the same decision tree proactively when the bridge has been used at least once this session, so the next user-facing Claude session prompt doesn't pay the refresh latency.

### Data flow — OpenAI native OAuth

```
User clicks "Sign in with ChatGPT"
  → GET /opencode/auth/openai/authorize
    → opencode_client.getOAuthUrl('openai', 0)
       → client.provider.oauth.authorize({path:{id:'openai'}, body:{method:0}})
       → returns {data: {url, method, instructions}} → service unwraps to {url, method, instructions}
  → response: {authUrl, method, instructions}
  → Flutter url_launcher opens authUrl in system browser
  → SDK's PKCE listener on :1455 receives the callback, completes the flow, writes to auth.json
  → Flutter polls GET /opencode/auth/ every 2s for up to 90s
  → openai appears in providers → tile turns green
```

### Data flow — GitHub Copilot device-flow

```
User clicks "Sign in with GitHub Copilot"
  → GET /opencode/auth/github-copilot/authorize
    → returns {authUrl: "https://github.com/login/device", instructions: "Enter code: XXXX-XXXX"}
  → Flutter dialog opens authUrl and displays the instructions string verbatim
    (parse XXXX-XXXX out of instructions for monospace display, but always render the full instructions
     as the source-of-truth for the user).
  → SDK polls GitHub on its own (method: "auto"); auth.json updates when complete.
  → Flutter polls /opencode/auth/ every 2s for up to 10 minutes (device code TTL).
  → github-copilot appears in providers → tile turns green.
  → On timeout: dialog dismisses with "Code expired — try again" + Retry button.
```

## Failure handling

| Failure mode | Behavior |
|---|---|
| No Claude Code installed | `hasClaudeCode()` returns false → subscription tile hidden → API-key tile for anthropic shown with copy "Pro/Max subscriptions require Claude Code installed." No error toast — normal state. |
| Keychain access denied (user clicked Deny) | `readClaudeCreds()` returns `null` with `reason: 'keychain_denied'` → 401 with that reason → tile shows "Keychain access denied — click to retry." No retry loop without user action. |
| `auth.set` returns `{error}` | Surface `res.error.data.error[0].message` to the UI tile. Capability stays false. Cache invalidated so next attempt re-reads Keychain. |
| Claude tokens stale (Claude Code hasn't run recently) | Try bridge anyway. If `auth.set` rejects, UI shows "Open Claude Code once to refresh, then come back." |
| OpenAI :1455 callback collision | SDK throws server-side → route returns 500 with the SDK message → UI tile drops back to API-key field with copy "Browser sign-in failed — paste an API key instead." |
| GitHub Copilot device code expired | 10-min poll timeout in Flutter → dialog dismisses → "Code expired — try again." |
| `~/.local/share/opencode/auth.json` missing | `listAuthedProviders()` returns `[]` → empty state shows. |
| `~/.local/share/opencode/auth.json` malformed | Parse error logged, return `[]`, UI shows small warning row "Auth state could not be read." Don't auto-delete. |
| Anthropic refresh endpoint returns 401 | Cache invalidated. UI shows "Re-authorize via Claude Code." |
| Capability refresh race after auth change | Server: every mutation re-runs `probeConfigs()` in the same response. Client: `AgentServerController.refreshCapabilities()` called from the auth UI success handler. Belt + suspenders. |
| Opencode SDK subprocess not running | Existing 503 path in `opencode_auth_routes.ts` unchanged. UI shows "Agent server unavailable" banner. |

## Testing strategy

### Unit (vitest, `apps/api_server/src/__tests__/`)

- `opencode_client_service.test.ts` (new) — `.data` unwrap contract for all 9 SDK call sites: `listProviders`, `listModels`, `setAuth`, `createSession`, `prompt`, `promptAsync`, `subscribeToEvents`, `getOAuthUrl`, `handleOAuthCallback`, `abortSession`. Each verifies both success and error wrapper handling.
- `opencode_auth_store.test.ts` (new) — auth.json parsed correctly, missing file returns `[]`, malformed JSON returns `[]` without throwing.
- `credentials_bridge_service.test.ts` (new):
  - `readClaudeCreds` parses Keychain shape (mock `execSync`).
  - `readClaudeCreds` falls back to `~/.claude/.credentials.json` when Keychain fails.
  - Cache hit avoids re-running `security`.
  - Cache invalidation after `auth.set` error triggers fresh Keychain read.
  - Refresh decision tree: in-memory fresh / Keychain newer / both stale (calls refresh endpoint).
  - Refresh endpoint 401 surfaces structured error.
- `opencode_auth_routes.test.ts` (extend):
  - `GET /opencode/auth/sources` returns correct booleans from mocked filesystem / `security` probes.
  - `POST /opencode/auth/anthropic/bridge` returns 200 on success, 401 with `reason: 'keychain_denied'` on denial.
  - `GET /:provider/authorize` returns `instructions` field verbatim from SDK.
- `agents_capabilities_routes.test.ts` (extend, existing aggregator coverage from `b7859ce` kept):
  - Connecting anthropic via bridge route flips `claude-code` true.
  - Connecting openai via either bridge or native OAuth flips `codex` true.

### Manual smoke (`docs/testing/manual-smoke.md`)

- Fresh launch with nothing connected → empty state, no errors.
- Save Google Gemini API key → `gemini-cli` capability true.
- Save OpenRouter API key → all three CLI agents capability true.
- Click "Use Claude subscription" → Keychain prompt → tile green → start Claude session → real response.
- Click "Sign in with ChatGPT" → browser opens to `auth.openai.com` → local callback completes → tile green → start Codex session → real response.
- Click "Sign in with GitHub Copilot" → dialog shows device code + URL → enter code in browser → tile green within 10 min.
- Force token near expiry (set in-memory `expiresAt` manually): next Claude session call refreshes transparently.

### Probe regression

Keep `apps/api_server/scripts/auth-strategy-probe.ts` as a gitignored local tool. Re-run after any `@opencode-ai/sdk` upgrade to catch silent contract changes. One-line pointer added to `docs/ai/testing-guide.md`.

## Implementation decomposition

Four issues, ordered by dependency.

### Issue A — Unwrap SDK `.data` consistently in `opencode_client_service`

- **Size:** small
- **Files:** `apps/api_server/src/services/opencode_client_service.ts`, `apps/api_server/src/__tests__/opencode_client_service.test.ts` (new)
- **Acceptance:**
  - All 10 SDK call sites unwrap `.data` (or surface `.error`).
  - `curl /opencode/auth/openai/authorize` returns a real `authUrl` (OpenAI PKCE URL).
  - `curl /opencode/auth/github-copilot/authorize` returns `authUrl` + `instructions` with the device code.
  - `curl /opencode/auth/anthropic/authorize` returns 500 with the SDK's actual error (because anthropic still throws — handled in Issue C).
  - Unit test file covers each call site's success + error wrapper.
  - vitest still ≥ 370 (existing 370 from this session) plus new cases (≥ 10).

### Issue B — Auth source-of-truth: `~/.local/share/opencode/auth.json`

- **Size:** small
- **Files:** `apps/api_server/src/services/opencode_auth_store.ts` (new), `apps/api_server/src/services/opencode_client_service.ts` (add `listAuthedProviders()` delegating to store), `apps/api_server/src/routes/agents_capabilities_routes.ts` (call `listAuthedProviders()`), `apps/api_server/src/routes/opencode_auth_routes.ts` (GET `/` returns file-based list), `apps/api_server/src/__tests__/opencode_auth_store.test.ts` (new)
- **Acceptance:**
  - After `POST /opencode/auth/openrouter` with valid key, `GET /opencode/auth/` returns `{providers: ["openrouter"], ready: true}`.
  - `GET /agents/capabilities` with only openrouter authed flips all three CLI agents true (end-to-end #584 resolution).
  - Missing or malformed auth.json → `[]`, no throw.
  - Aggregator tests from `b7859ce` continue passing.

### Issue C — Anthropic Claude Code creds bridge

- **Size:** medium
- **Depends on:** Issue A
- **Files:** `apps/api_server/src/services/credentials_bridge_service.ts` (new, ~250 LOC), `apps/api_server/src/routes/opencode_auth_routes.ts` (POST `/anthropic/bridge`, GET `/sources`), `apps/api_server/src/__tests__/credentials_bridge_service.test.ts` (new)
- **Acceptance:**
  - With Claude Code installed, `POST /opencode/auth/anthropic/bridge` returns 200, persists tokens to opencode auth.json.
  - `GET /opencode/auth/` then includes `"anthropic"`; `GET /agents/capabilities` flips `claude-code` true.
  - Live `client.session.prompt` against an Anthropic model returns a real response.
  - Near-expiry triggers refresh transparently before next prompt.
  - Keychain denial returns 401 with `{reason: 'keychain_denied'}`.
  - `GET /opencode/auth/sources` reflects install state of Claude Code + Codex.
- **Out of scope:** Codex bridge, Windows/Linux Keychain alternatives, Keychain writeback of refreshed tokens.

### Issue D — Flutter UI rework: `ai_account_section`

- **Size:** medium
- **Depends on:** A, B, C routes exist (can parallelize with C if a separate coding-agent owns it).
- **Files:** `apps/desktop_flutter/lib/features/settings/widgets/ai_account_section.dart`, `apps/desktop_flutter/lib/app/core/agents/agent_server_controller.dart` (verify `refreshCapabilities()` is callable from the section)
- **Acceptance:**
  - With nothing connected, correct tiles per section; clicking each starts the right flow.
  - Claude bridge success: tile green, Agents empty state hides, `claude-code: true`.
  - OpenAI native OAuth success: tile green without paste-code step.
  - Copilot device-flow success: device code displayed clearly, tile green after user enters it.
  - Failures surface SDK's real error message in tile status line.
  - `flutter analyze --no-fatal-infos` + `dart format --set-exit-if-changed` pass.

## Branch / PR strategy

Open question, decided at implementation start: per-issue PRs off `main` (recommended for review-ability; #574 has become hard to scan), or one combined `auth-rework` branch. Default to per-issue unless the user prefers combined.

The existing draft PR #574 stays open with the commits stacked there (#580 / #581 / ESM loader / #585 / #583 paste-code dialog / #584 aggregator map / #582 empty-state / aggregator tests / project-state). Issues A and B supersede the half-fixes for #583 and #584 inside #574; the rework PRs should land before merging #574 so the smoke loop closes cleanly, but git-level cleanup of #574 is out of scope for this spec.

## Open questions to resolve during implementation

- Exact Claude Code OAuth `client_id` for the refresh endpoint call (capture from community plugin source — `griffinmartin/opencode-claude-auth` or `ex-machina-co/opencode-anthropic-auth`).
- Verify `subscribeToEvents()` unwrap location — probe didn't cover it directly. May already work.
- Whether Anthropic refresh endpoint accepts a `redirect_uri` parameter (community plugins suggest no, but verify against a real refresh call before shipping Issue C).

## Sources

- [griffinmartin/opencode-claude-auth](https://github.com/griffinmartin/opencode-claude-auth) — Keychain-first credential reader pattern.
- [numman-ali/opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth) — Codex bridge pattern (deferred for this rework).
- [anomalyco/opencode#7090](https://github.com/anomalyco/opencode/issues/7090) — GitHub Copilot device-flow UI mishandling, our exact symptom.
- `apps/api_server/scripts/auth-strategy-probe.ts` (local-only) + `apps/api_server/scripts/probe-output.log` (local-only) — concrete SDK behavior captured 2026-05-13.
