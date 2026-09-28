---
date: 2026-09-19
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: []
status: pending
tags: [run, Rhythm]
---

## Files

- Restored Electron desktop OAuth client, scope/consent request, sign-in copy, auth session restore behavior, and auth tests to the state before `aa07b491`.
- Restored the API desktop exchange, integration-account persistence, and focused tests to the state before `aa07b491`; removed the newly introduced login-only capability/exchange routes and live test.
- Left unrelated hosted Messages/Automations and Hermes changes untouched.

## Checks

- `node --experimental-vm-modules --test test/google-oauth.test.mjs test/e12a-auth-boundary.test.mjs`: 18 passed.
- `npm test -- --run src/__tests__/google_desktop_exchange.test.ts` in `apps/api_server`: 5 passed.
- `npm test` in `apps/electron`: 174 passed.
- `npm run typecheck` in `apps/electron` and `apps/web`: passed.
- `npm run build` in `apps/api_server`: passed.
- `ai-workflow checks --level issue`: Flutter analyze/format and API/MCP typecheck passed.
- `rg` across `apps` and `scripts`: no remaining `desktop-login-capability`, `desktop-login-exchange`, or `loginOnlyDesktopExchange` runtime references.
- A source Electron launch with a live web bundle reached sign-in, but the native approval signer still showed its Keychain error. An OAuth session was persisted during that launch. A read-only hosted account check afterward returned HTTP 200: Google Calendar and Gmail were both connected, needed no reauthorization, and retained the same seven scopes as the prior recovery record. This is not installed-app qualification.

## Notes

- The old desktop exchange persistence behavior predates the mega PR (`facceaea`, 2026-04-20). An earlier mega-campaign live login attempt triggered real Calendar/Gmail token/scope downgrades; both integrations were restored and verified connected in `2026-09-19-mega-acceptance-followup.md`. Reverting by request restores that pre-existing risk; no real login was run for this change.
- Installed Electron startup remains blocked separately by the native approval signer. Source and local tests alone are not installed-app login proof.

## Later verification

Signed local repair app completed the restored Google flow and opened the authenticated workspace. User accepted local behavior. See the startup repair run for subsequent native and runtime checks. Earlier blocked observations above are historical.
