---
date: 2026-09-21
repo: Rhythm
branch: ws-b-accounts-relogin
pr: TBD
issues: []
status: draft-pr
tags: [run, rhythm]
---

# Electron Agent Settings → Accounts: re-login + provider auth

## Files

- `apps/web/src/components/tools/AgentSettingsTool.tsx` — per-account **Re-authorize**
  button and a "Needs re-authorization" badge for any account whose status is not
  ok/connected/active/authorized; new **Model providers** block (OpenAI/Codex OAuth
  paste-back, Google/Gemini OAuth, OpenCode API key, OpenRouter API key).
- `apps/web/src/components/tools/AgentSettingsTool.css` — account-row grid fix (the row
  previously reused the 34px avatar column meant for profile rows), warning border for
  stale accounts, provider subhead spacing.
- `apps/web/src/gateway/sessions.ts` — four optional methods over endpoints that already
  existed: `authProviders`, `authorizeProvider`, `completeProviderAuth`,
  `saveProviderApiKey`.
- `apps/web/tests/pages/agent-settings-list-inspector.spec.ts` — two live-boundary specs.
- `apps/web/tests/agent-settings-accounts-playwright.config.ts` — new; the
  "Agent Settings live persistence" block needed a live-gateway server and no config
  targeted it, so those specs had never actually run.

No `apps/api_server` change was required.

## Checks

- `npm run typecheck` (apps/web) — pass
- `npm run build` (apps/web) — pass
- `RHYTHM_LIVE_E2E=1 npx playwright test --config tests/agent-settings-accounts-playwright.config.ts` — 4 passed
- `npx playwright test` (default fixture suite) — see PR body

## Notes

- Root cause of "cannot re-log in": UI only. `POST /opencode/auth/accounts/login-start`
  accepts an existing accountId, and `login-complete` upserts by id and leaves
  `defaultAccountId` untouched — verified against the running instance on :4001.
- Provider auth was ported from
  `apps/desktop_flutter/lib/features/settings/widgets/ai_account_section.dart`:
  same endpoints, same method indexes (OpenAI must use `method=1` paste-back; Google
  uses `method=0` and is finished by the engine plugin's own local listener, so the UI
  re-reads `GET /opencode/auth` instead of exchanging a code).
- `GET /agents/models` returning `[]` is **not** caused by the expired default account:
  the route requires `?agentId=`. With it, claude-code / codex / opencode all return
  populated lists and `/agents/models/catalog` reports `authorized: true` for anthropic.
