# API fix

## Description

Fixes the bug reported against `POST /rhythms/:id/steps`. In this codebase rhythms are exposed at `/recurring-rules`, and there was no per-step POST endpoint — sending a step with `day_of_week` was unusable. This PR adds `POST /recurring-rules/:id/steps`, accepts `day_of_week` as either an integer (0-6) or a case-insensitive day name (`Sunday`..`Saturday`, plus 3-letter prefixes), persists via the existing rule update path so notifications and task-instance regeneration stay consistent, and returns 201 with the decorated step. The same string-name acceptance is also wired into the existing rule create/update path through `normalizeStep`.

## Issues completed

- #442 Add day-of-week coercion helper (`coerceDayOfWeek`)
- #443 Use `coerceDayOfWeek` inside `normalizeStep` so rule-create/update accept string day names too
- #445 Implement `RecurringRulesController.addStep`
- #444 Add `POST /recurring-rules/:id/steps` route
- #446 Add integration tests for the new endpoint (4 tests, all passing)
- #447 Document the new endpoint in `CLAUDE.md`
- #448 Verify (`npm run build` and `npm test` from `apps/api_server` — green)

## Manual setup needed

None. This change is pure code: a new controller method, a new route, validation reuse, tests, and a documentation row. There are no new environment variables, secrets, webhooks, or third-party integrations to configure.

---

Workflow: `wf-2026-05-07-nud7u3`
