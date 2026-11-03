# P0 recon: tasks

Date: 2026-10-19. Test source base: `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`.
Locally built target: `/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app` **0.18.83**. Engine health reports
`0.0.0-rhythm-894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`. This bundle was built locally from the mega source head; the API build-identity JSON and engine version both match it. Ports were free before launch.
The existing `packaged-app.ts` fixture launched the app and quit it; no live
API process was started by hand. No messages to real people were sent. Model prompts recorded below used the explicit opt-in and nonce-owned sessions.

## Observations before codification

UI `GET https://api.vcrcapps.com/tasks` → 200, JSON array. Fields include `id`, `title`, `notes`, `status`, `ownerId`, dates and collaborators. Local tokenless `GET :4001/tasks` → 401 `{error}`. Creation selectors: `tasks-header-add-task`, `task-create-title`, `task-create-notes`, `task-create-submit`. Mutation/validation recon still pending.

Probe command (temporary recon spec, removed after codification):
`cd apps/web && RHYTHM_PACKAGED_APP=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app ./node_modules/.bin/playwright test -c tests/packaged/recon-playwright.config.ts`
Captured local output: `/private/tmp/rhythm-feature-recon-mega.log` (sanitized shape/count summaries; not committed).
Read-only probe: 1 test finished in 42.7s, no renderer errors. This only means
the probe completed; feature assertions had not yet been authored.

## Observed write and recovery contracts

The mega renderer requests hosted `/tasks?status=all`; tokenless local `/tasks` is not its contract. Owned create returns 201 with the exact Unicode/quoted title. PATCH returns 200 with edited title, two-line notes and then `status: done`; exact-ID readback and reload agree. UI permanent delete returns 204 and exact-ID readback returns 404. Double submit creates one nonce-owned row; the long Unicode title is retained after delete cancellation/reload.

The create-outage probe intercepts one POST with 503. Its draft remains and no owned backend row exists. Retry returns 201 and the UI announces the owned task was added, but the collection remains on `503 Retryable server error / Unable to load tasks` and the new row is absent. This is a product recovery failure, not a request/readback status guess; final confirmation reads the created ID before the failing UI assertion. Cleanup deletes the created row and verifies absence.

Revisiting the identical hash may produce no GET. The fixture now forces a document reload to establish fresh collection/auth evidence rather than timing out on a cached page. Empty-account first use requires a disposable tenant and has an explicit failing UNVERIFIED test; existing real tasks are never deleted to manufacture it.
