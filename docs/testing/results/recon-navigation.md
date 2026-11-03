# P0 recon: navigation

Date: 2026-10-19. Test source base: `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`.
Locally built target: `/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app` **0.18.83**. Engine health reports
`0.0.0-rhythm-894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`. This bundle was built locally from the mega source head; the API build-identity JSON and engine version both match it. Ports were free before launch.
The existing `packaged-app.ts` fixture launched the app and quit it; no live
API process was started by hand. No messages to real people were sent. Model prompts recorded below used the explicit opt-in and nonce-owned sessions.

## Observations before codification

Tasks and Agents hash routes render with the real shell. UI selectors include `nav-<key>`, `nav-more`, `#tasks-title`, Agents workspace and `notifications-button`. Tasks collection is hosted and sessions collection local. Narrow overflow and error recovery recon pending.

Probe command (temporary recon spec, removed after codification):
`cd apps/web && RHYTHM_PACKAGED_APP=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app ./node_modules/.bin/playwright test -c tests/packaged/recon-playwright.config.ts`
Captured local output: `/private/tmp/rhythm-feature-recon-mega.log` (sanitized shape/count summaries; not committed).
Read-only probe: 1 test finished in 42.7s, no renderer errors. This only means
the probe completed; feature assertions had not yet been authored.

## Confirmation observations

Tasks direct hash/reload loads actual hosted content; selected row detail agrees with the API. At 550×600, More reaches Tasks and then Agents, with real GET 200 collection shapes and the main workspace visible. A failed task collection GET is presented as a server error with Retry, not an empty success. After removing the one request fault, Retry returns GET 200 and restores the page. Readback must preserve the observed `/tasks?status=all` query: bare `/tasks` excludes completed rows and is not an equivalent collection. Tests compare IDs without dumping private task bodies. Navigation makes no data writes.
