# P0 recon: rhythm-primary-chat

Date: 2026-10-19. Test source base: `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`.
Locally built target: `/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app` **0.18.83**. Engine health reports
`0.0.0-rhythm-894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`. This bundle was built locally from the mega source head; the API build-identity JSON and engine version both match it. Ports were free before launch.
The existing `packaged-app.ts` fixture launched the app and quit it; no live
API process was started by hand. No messages to real people were sent. Model prompts recorded below used the explicit opt-in and nonce-owned sessions.

## Observations before codification

`rhythm-primary-entry` is rendered. Existing primary root is present in the account, but this probe did not open/send to it. Canonical resolve/history/reopen/error recovery recon pending. Do not create a real-account root as a test fixture.

Probe command (temporary recon spec, removed after codification):
`cd apps/web && RHYTHM_PACKAGED_APP=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app ./node_modules/.bin/playwright test -c tests/packaged/recon-playwright.config.ts`
Captured local output: `/private/tmp/rhythm-feature-recon-mega.log` (sanitized shape/count summaries; not committed).
Read-only probe: 1 test finished in 42.7s, no renderer errors. This only means
the probe completed; feature assertions had not yet been authored.

## Confirmation precondition

The read-only desktop `auth.currentSession()` IPC supplies only the actor ID to the test.
SQLite contains one designated owned root and an active project, but that project's canonical
directory is missing. Primary tests fail `UNVERIFIED` before `/resolve` or `/setup` rather than
recreating a permanent root or changing an existing project. Canonical history, scoped sending,
first-use profile choice and recovery therefore remain unqualified. The tokenless local
`/auth/me` 401 in an earlier test attempt was an incorrect actor-discovery choice, not a product bug.
