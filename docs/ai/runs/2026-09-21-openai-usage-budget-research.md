---
date: 2026-09-21
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: null
issues: [1568, 1566]
status: complete
tags: [run, Rhythm]
---

# OpenAI usage-budget research — is remaining Codex quota obtainable?

Research and issue-writing only. No product code touched, no PR.

## Question

`GET /agents/usage-budget` reports Anthropic, Gemini and OpenRouter but hard-codes OpenAI to
`kind: "unavailable"`. Find a real source for the ChatGPT-plan Codex quota, or establish with
evidence that none exists.

## Answer

Yes. `GET https://chatgpt.com/backend-api/wham/usage` — a plain authenticated, zero-token GET
that the Codex CLI itself uses. Filed as **#1568**.

## Files

Read only:

- `apps/api_server/src/services/usage_budget_service.ts` — the working Anthropic reference is a
  1-token `POST /v1/messages` probe read purely for `anthropic-ratelimit-unified-*` response
  headers (`probeAnthropicAccount`, ~:172-220). Not a usage API.
- `apps/opencode_fork/packages/opencode/src/plugin/codex.ts` — custom `fetch` posts to
  `https://chatgpt.com/backend-api/codex/responses` with the ChatGPT OAuth bearer +
  `ChatGPT-Account-Id`; the `Response` is handed straight to the AI SDK, so the `x-codex-*`
  rate-limit headers arriving on every turn are discarded (:408-485).
  `extractAccountIdFromClaims` (:77-84) already derives the account id from the JWT.
- `apps/desktop_flutter/lib/features/agents/models/usage_budget.dart` — consumer model needs no
  change; a `kind: 'window'` OpenAI entry parses as-is.
- `apps/api_server/src/services/agent_model_resolver.ts:545-560` — budget-aware model downgrade
  is blind to OpenAI today because it has no `remainingFraction`.
- `apps/api_server/src/database/migrations.ts:1466` — `agent_session_messages.tokens_json`, the
  basis of the (rejected) local-accounting fallback.

## Checks

Evidence gathered, no commands mutating anything:

- `strings` over the installed `/opt/homebrew/Caskroom/codex/0.153.4/bin/codex` (codex-cli
  0.153.4) — found `-primary-used-percent`, `-primary-window-minutes`, `-primary-reset-at`,
  `-secondary-*`, `-limit-name`, plus `x-codex-active-limit`, `x-codex-credits-balance`,
  `x-codex-rate-limit-reached-type`, and the paths `/api/codex/usage` + `/wham/usage`.
- Upstream `openai/codex` via `gh api` — `codex-rs/codex-api/src/rate_limits.rs`
  (`parse_rate_limit_for_limit`, `parse_rate_limit_event`, `parse_credits_snapshot`),
  `codex-rs/backend-client/src/client/rate_limit_resets.rs:124-129` (`rate_limit_status_url`),
  `client.rs:191-203` (base-url normalization), `:252-271` (`headers()`), `:642-648`
  (`primary_window`/`secondary_window`), `types.rs:56-67`, and the contract test in
  `rate_limit_resets_tests.rs` pinning `https://chatgpt.com/backend-api/wham/usage`.
- `auth.json` inspected for **key names only** (`openai -> type,refresh,access,expires`). No
  credential value was read, printed, copied or transmitted. Note there is no `accountId` key.
- Documented OpenAI usage/cost API confirmed to be the Admin surface (admin key required,
  org-spend ledger, not plan windows).
- **No authenticated request was made.** The single confirming `GET` is written out in #1568 for
  the user to approve.

## Notes

- Nothing was killed or restarted; the running app, api_server (:4001) and engine (:4096) were
  left alone.
- The current `reason` string's first clause (platform API 401s a plan token) is correct; the
  second ("Codex usage backend is undocumented") is stale and should go.
- Second source available if the endpoint proves unreliable: the `x-codex-*` response headers on
  Codex turns Rhythm already makes, and a `codex.rate_limits` SSE event on the same stream. Both
  are passive but only update when a turn happens.
- Fragility is explicit in the issue: the endpoint is unofficial, so every parse failure must
  degrade to `unavailable`, never to a number.
