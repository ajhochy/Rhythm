# P0 recon: approval-expiry

Date: 2026-10-19. Test source base: `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`.
Locally built target: `/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app` **0.18.83**. Engine health reports
`0.0.0-rhythm-894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`. This bundle was built locally from the mega source head; the API build-identity JSON and engine version both match it. Ports were free before launch.
The existing `packaged-app.ts` fixture launched the app and quit it; no live
API process was started by hand. No messages to real people were sent. Model prompts recorded below used the explicit opt-in and nonce-owned sessions.

## Observations before codification

UI signed `GET :4001/agent-approvals?status=pending` → 200 JSON array, three rows. Fields include `id`, `sessionId`, `status`, `expiresAt`, `decisionNonce`, `consumedAt`, `lane`. Bell renders `3 pending approvals`. Node tokenless same GET → 401 `{error}`. No existing approval was approved/rejected/changed. Controlled pending/expired fixture not created; TTL and expiry decisions UNVERIFIED.

Probe command (temporary recon spec, removed after codification):
`cd apps/web && RHYTHM_PACKAGED_APP=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app ./node_modules/.bin/playwright test -c tests/packaged/recon-playwright.config.ts`
Captured local output: `/private/tmp/rhythm-feature-recon-mega.log` (sanitized shape/count summaries; not committed).
Read-only probe: 1 test finished in 42.7s, no renderer errors. This only means
the probe completed; feature assertions had not yet been authored.

## Confirmation observations

Two read-only cases passed against real signed pending cards. Network and readback IDs/status agree with the bell/card UI; any non-null expiry must still be in the future. An injected 503 refresh shows an error while retaining the known cards, then real GET 200 clears the error and restores the pending status. No card is approved, rejected or changed. Controlled one-hour expiry, stale signed denial/no side effect, rejection and retained all-history remain UNVERIFIED pending a disposable database/native signer.
