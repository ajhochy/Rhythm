# Vendored: opencode-claude-auth 1.5.3 (MIT)

Vendored on 2026-07-04 from the opencode plugin cache
(`~/.cache/opencode/packages/opencode-claude-auth@latest/node_modules/opencode-claude-auth`),
upstream <https://github.com/griffinmartin/opencode-claude-auth>, version 1.5.3,
MIT license (see `LICENSE`). The pristine copy was committed unmodified first;
`git log -- apps/api_server/opencode_plugins` shows the full local diff.

The compiled `dist/*.js` IS the source we ship — plain ESM JS, no external
dependencies (only `node:` builtins + relative imports), runs under Bun inside
the opencode engine. No TypeScript lives in this directory.

## Why vendored

Rhythm's dual-Anthropic-accounts feature needs the bearer token resolved
**per request** from `x-session-affinity` → the Rhythm accounts file
(`~/Library/Application Support/Rhythm/anthropic-accounts.json`, written only
by api_server), with automatic failover to the other account on quota
exhaustion. Upstream reads a single credential from the Claude Code keychain.
The upstream request transforms (billing header as system[0], identity split,
`mcp_` PascalCase tool prefixing, 401 retry, 429/529 backoff) are load-bearing,
so we vendor + surgically modify rather than reimplement.

## Local modifications

- `package.json` — `name` → `rhythm-anthropic-accounts` (nothing else).
- `dist/accounts.js` — NEW module: read-only store reader (mtime-cached),
  `resolveForSession(sessionId)` (session override map → file `routing` →
  `defaultAccountId`), `markSpillover()` (fire-and-forget POST
  `/opencode/spillover` to api_server), `forcedSpilloverAccountId()`
  (`RHYTHM_FORCE_SPILLOVER` test knob). Env (`RHYTHM_ACCOUNTS_FILE`,
  `RHYTHM_API_BASE`) is read lazily per call. `markAccountsExhausted()`
  (#930) — fire-and-forget POST `/opencode/spillover` with
  `{exhausted: true}` when a 429/529 has no other Anthropic account to
  spill to, so api_server can decide a cross-provider fallback.
- `dist/index.js` — all changes marked with `// rhythm:` comments:
  1. import from `./accounts.js`;
  2. plugin init skips the Claude Code keychain read + auth.json sync loop
     entirely when the Rhythm store has accounts (api_server owns creds);
  3. loader `baseURL` overridable via `RHYTHM_ANTHROPIC_BASE_URL`;
  4. `fetch()` resolves the account per request from `x-session-affinity`
     (legacy `getCachedCredentials()` keychain path preserved when the store
     is absent);
  5. forced-spillover knob switches to the fallback account BEFORE sending;
  6. quota failover: after `fetchWithRetry` returns 429/529 (retries
     exhausted / retry-after over cap), retry once on the fallback account and
     report via `markSpillover`;
  7. 401 retry and long-context-beta retry re-read the store instead of the
     keychain when the store is live;
  8. (#930) same 429/529 condition as (6), but with no fallback account left —
     calls `markAccountsExhausted()` instead, so api_server can hand the turn
     to the next tier in the cross-provider fallback chain. This plugin never
     invokes another provider itself; only same-provider retry (6) does that.

Everything else (`dist/transforms.js`, `dist/betas.js`, `dist/credentials.js`,
`dist/keychain.js`, `dist/logger.js`, `dist/signing.js`, `dist/model-config.js`,
`dist/plugin-config.js`, entry `opencode-claude-auth.js`) is untouched upstream
code.
