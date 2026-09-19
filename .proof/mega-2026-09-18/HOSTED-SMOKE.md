# Hosted smoke receipt

## September 19 follow-up

**7 passed / 22 failed / 5 skipped** out of 34. The authorized existing bearer was supplied only in process memory. Browser origin `http://127.0.0.1:4175` is rejected by local/hosted API CORS; native `rhythm://app` is allowed. Preserve the failures. No Origin spoofing, proxy or security bypass was used.

Paused Automation API create/read-back/delete passed; UI loading failed. Messages safely skipped before creation because the deployed API has no delete route. Creator-scoped cleanup and paused-create behavior passed a disposable real API/engine sandbox (1/1); the new route is not deployed. The attach-only native harness selects 12 applicable tests but has not run because native auth persistence did not finish.

Final authenticated collection audit at 2026-09-19T15:42:33Z found **zero campaign-prefix rows in all six collections**, all HTTP 200: tasks 1541, facilities 18, reservations 310, templates 1, automations 3, threads 7. No current-run rows remain. See [sanitized audit](hosted-final-audit-2026-09-19.json). Traces/screenshots/videos were off, retained output disabled, and cache/dist/test-results contained zero bearer matches.

## September 18 receipt (historical)


## Result

BLOCKED. `RHYTHM_LIVE_TOKEN` is absent in the executing process. The exact requested command exited 1: one test setup failed on the required-bearer assertion; 33 tests did not run. Cleanup then observed connection refusal from the requested local API :4001. No test reached a create/write operation.

```
cd apps/web
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4001 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4096 npx playwright test --config tests/live-smoke-playwright.config.ts --reporter=list
```

GET checks against https://api.vcrcapps.com for `/tasks`, `/facilities`, `/facilities/reservations`, `/project-templates`, `/automation-rules`, and `/message-threads` all returned 403 without authentication. Bodies were not logged. Therefore zero marker rows created by this run is established from execution, but a global zero-prefix row count is UNVERIFIED.

## Decisions

- Do not retrieve or persist a bearer from another credential store, copy it into the renderer, or fabricate hosted coverage with a fixture token.
- Narrow cleanup to the current invocation marker in name/title/label. Regression test first failed on a previous-run row, then both ownership tests passed.
- Retain the lack-of-delete Messages skip and atomic-paused Automations skip already present in the suite; a full credentialed run must report these exact remaining gaps instead of claiming all hosted writes ran.
