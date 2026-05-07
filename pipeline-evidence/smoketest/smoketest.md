# Smoketest — wf-2026-05-07-nud7u3 (API fix: POST /recurring-rules/:id/steps)

Project: `/Users/ajhochhalter/Documents/Rhythm`
Branch under test: `feat/api-fix`
PR: https://github.com/ajhochy/Rhythm/pull/449

## Setup

Run from `apps/api_server`:

```
cd /Users/ajhochhalter/Documents/Rhythm/apps/api_server
npm install
npm run build
```

Start the server in one terminal:

```
PORT=4099 RHYTHM_DB_PATH=/tmp/rhythm-smoketest-nud7u3.db npm run dev
```

NOTE (smoketest run): the server actually reads `DB_PATH` (see `src/config/env.ts`), not `RHYTHM_DB_PATH`. Smoketest used `PORT=4099 DB_PATH=/tmp/rhythm-smoketest-nud7u3.db node dist/server.js` against a fresh sqlite file. A bearer token was seeded with `pipeline-evidence/smoketest/seed-session.js`.

## Checklist

- [x] ✅ **Build is clean.** Ran `npm run build` from `apps/api_server`. Exit 0, no TS errors. Evidence: `pipeline-evidence/smoketest/build.log`.

- [x] ✅ **Unit/integration tests pass.** `npm test` → `Test Files 23 passed (23)`, `Tests 169 passed (169)`. Includes `recurring_rule_steps.test.ts`. Evidence: `pipeline-evidence/smoketest/test.log`.

- [x] ✅ **Endpoint exists in route table.** `grep -n "/:id/steps" apps/api_server/src/routes/recurring_rules_routes.ts` →
  `14:recurringRulesRouter.post('/:id/steps', controller.addStep.bind(controller));`

- [x] ✅ **Create a weekly rhythm via API.** HTTP 201, `id=717799cf-0d0f-4595-a8ef-bd8a77213275`, `frequency:"weekly"`, `steps:[]`. Evidence: `pipeline-evidence/smoketest/create-rule.json`.

- [x] ✅ **POST step with `day_of_week: "Monday"` (string, snake_case).** HTTP 201; body `{"id":"step-1-...","title":"Plan upcoming Sunday","dayOfWeek":1,...}`. Evidence: `pipeline-evidence/smoketest/step-monday.txt`.

- [x] ✅ **POST step with integer `dayOfWeek: 3` (camelCase).** HTTP 201; `dayOfWeek:3`, title "Mid-week prep". Evidence: `pipeline-evidence/smoketest/step-wed.txt`.

- [x] ✅ **POST step missing day_of_week on weekly rhythm returns 400.** HTTP 400; body: `{"error":{"code":"BAD_REQUEST","message":"Step 1 requires dayOfWeek (0-6) for weekly rhythms"}}`. Evidence: `pipeline-evidence/smoketest/step-noday.txt`.

- [x] ✅ **POST step on unknown rhythm id returns 404.** HTTP 404; `{"error":{"code":"NOT_FOUND","message":"RecurringTaskRule not found"}}`. Evidence: `pipeline-evidence/smoketest/step-unknown.txt`.

- [x] ✅ **GET rhythm reflects appended steps.** Steps array contains both items in insertion order with `dayOfWeek:1` then `dayOfWeek:3`. Evidence: `pipeline-evidence/smoketest/get-rule.json`.

- [x] ✅ **Steps persist across server restart.** Killed server, restarted with same `DB_PATH`, GET returned identical step IDs and dayOfWeek values (1, 3). Evidence: `pipeline-evidence/smoketest/get-rule-after-restart.json`.

- [x] ✅ **CLAUDE.md endpoint table updated.** `grep -n "/recurring-rules/:id/steps" CLAUDE.md` →
  `139:| POST | /recurring-rules/:id/steps | Append a step to an existing rhythm |`

- [x] ✅ **PR is open and Draft.** `gh pr view 449 --json state,isDraft,title` → `{"isDraft":true,"state":"OPEN","title":"API fix"}`.

## Result: PASSED (12/12)
