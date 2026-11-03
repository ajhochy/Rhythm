# P0 recon: coordinator-multi-run

Date: 2026-10-19. Test source base: `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`.
Locally built target: `/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app` **0.18.83**. Engine health reports
`0.0.0-rhythm-894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`. This bundle was built locally from the mega source head; the API build-identity JSON and engine version both match it. Ports were free before launch.
The existing `packaged-app.ts` fixture launched the app and quit it; no live
API process was started by hand. No messages to real people were sent. Model prompts recorded below used the explicit opt-in and nonce-owned sessions.

## Observations before codification

No workflow goal started. Existing user workflows, repos and sessions remain untouched. Concurrent goal starts, needs-you/Stop, confinement and once-only reports require nonce-owned synthetic repos, a current matching build and explicit real-model opt-in; UNVERIFIED.

Probe command (temporary recon spec, removed after codification):
`cd apps/web && RHYTHM_PACKAGED_APP=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app ./node_modules/.bin/playwright test -c tests/packaged/recon-playwright.config.ts`
Captured local output: `/private/tmp/rhythm-feature-recon-mega.log` (sanitized shape/count summaries; not committed).
Read-only probe: 1 test finished in 42.7s, no renderer errors. This only means
the probe completed; feature assertions had not yet been authored.

## Confirmation precondition

The existing actor-owned primary project's directory is missing. The read-only guard fails
`UNVERIFIED` before resolving/opening it; no goal, run or journal write was sent. Concurrent
starts, worktree confinement, needs-you/Stop, once-only reports and restart require a disposable
signed-in primary/database and owned repository fixtures. Real-model opt-in alone does not
make permanent real-account journal writes reversible.
