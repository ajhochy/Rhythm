---
date: 2026-09-21
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: none
issues: [1568]
status: research-complete
tags: [run, Rhythm]
---

# OpenAI usage endpoint — live confirmation (issue #1568)

Research only. No product code changed, no PR.

## Files

- Read only: `apps/opencode_fork/packages/opencode/src/plugin/codex.ts` (account-id derivation,
  `extractAccountIdFromClaims`), `apps/api_server/src/services/usage_budget_service.ts`
  (`probeAnthropicAccount`, the `remainingFraction` convention).
- Log: this file.

## Checks

One authorized request, exactly as scoped by the user ("i authorize the GET"):

`GET https://chatgpt.com/backend-api/wham/usage` with the ChatGPT OAuth bearer from
`~/.local/share/opencode/auth.json`, `ChatGPT-Account-Id` derived via the repo's existing
`extractAccountIdFromClaims`, `User-Agent: codex-cli`.

**Result: HTTP 200.** The endpoint works for a ChatGPT-plan token. No token, JWT, account id or
email is recorded here or in the issue.

Cross-checks (no extra network calls):

- `GET http://localhost:4001/agents/usage-budget` — live local server, read only.
- A cached Codex rollout snapshot under `~/.codex/sessions/2026/09/18/` containing the
  `rate_limits` object parsed from Route A response headers.

## Notes

- `used_percent` means **used**, not remaining. Confirmed two ways: 90% used with
  `reset_after_seconds` ≈ 4.3 days left of a 7-day window, and the Anthropic entries at :4001
  where an unused account reads `remainingFraction: 1`. Mapping is
  `remainingFraction = max(0, 1 - used_percent / 100)`, mirroring the existing
  `1 - parseFloat(utilization)` line in `usage_budget_service.ts`.
- Shape divergence from upstream `types.rs`: the payload is **flat**, not nested under a
  `rate_limit_status` wrapper; `limit_window_seconds` is present as predicted but the response
  also carries `reset_after_seconds` (relative) alongside `reset_at` (absolute unix seconds);
  `credits` is an object (`balance` is a **string**), not a number; `plan_type` is top-level, not
  inside `rate_limit`.
- `secondary_window` is **null** on this account. `primary_window` is the *weekly* window
  (604800 s), not a 5-hour one. Any implementation must not assume two windows or assume primary
  means the short window — read `limit_window_seconds` and label from it.
- Route A and Route B return the same counter: the cached header-derived snapshot from 2026-09-18
  and today's endpoint response share the identical `resets_at` / `reset_at` value (1790395722)
  and the same window length, with `used_percent` having advanced 88 → 90.

## Recommendation

Primary = **Route A** (response headers already arriving on every Codex turn, zero extra requests).
Route B = cold-start path only, one call when no Codex turn has run yet in the process lifetime.
