# Smoketest — POST /recurring-rules/:id/steps via MCP

Workflow: wf-2026-05-07-a38ttq
Branch: feat/api-fix
Target: @ajhochy/rhythm-mcp-server v0.4.0 + Rhythm API at https://api.vcrcapps.com

## Pre-flight

- [x] ✅ **Local API server running**
  - Action: `cd /Users/ajhochhalter/Documents/Rhythm/apps/api_server && PORT=4000 npm run dev`
  - Expected: log line `API listening on :4000`; `curl -s http://localhost:4000/health` returns `{"status":"ok"}`.
  - Where to verify: terminal log + curl output.
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/health-port-4000.log` returned HTTP 200 `{"status":"ok","service":"rhythm-api-server"}`. Port 4000 was already occupied by a Rhythm API process, so an isolated smoke API was also started on 4001 with evidence in `local-api-4001-server.log` and `health-port-4001.log`.

- [x] ❌ **Production deployment carries POST /:id/steps**
  - Action: `curl -i -X POST https://api.vcrcapps.com/recurring-rules/__bogus__/steps -H "Authorization: Bearer $RHYTHM_API_TOKEN" -H "Content-Type: application/json" -d '{}'`
  - Expected: HTTP 400 (title required) or HTTP 404 (rhythm not found) — NOT a generic route-miss 404.
  - Where to verify: response body should include `{"error":{"code":"BAD_REQUEST",...}}` or `{"error":{"code":"NOT_FOUND","message":"Rhythm not found",...}}`.
  - If the response is HTML, a 405, or a generic 404 with no `code`, the production API is missing the route — STOP and redeploy before continuing.
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/prod-route-check-empty-token.log` returned HTTP 401 `UNAUTHORIZED` because `RHYTHM_API_TOKEN` is not present in this shell. This does not satisfy the checklist's expected authenticated 400/404 verification.

## Step 1 — `rhythm_add_rhythm_step` MCP tool exists and uses POST /:id/steps

- [x] ✅ **Tool registered in MCP source**
  - Action: `grep -n "rhythm_add_rhythm_step" /Users/ajhochhalter/Documents/Rhythm/apps/mcp_server/src/tools/rhythms.ts`
  - Expected: at least one match; tool block calls `apiPost(apiUrl, apiToken, \`/recurring-rules/${rhythm_id}/steps\`, body)`.
  - Where to verify: file contents.
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/source-tool-grep.log` shows `rhythm_add_rhythm_step` and the `apiPost(... /recurring-rules/${rhythm_id}/steps ...)` call.

- [x] ✅ **`rhythm_delete_rhythm_step` registered**
  - Action: same grep on `rhythm_delete_rhythm_step`.
  - Expected: handler does GET then PATCH with filtered steps.
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/source-tool-grep.log` shows `rhythm_delete_rhythm_step`; source inspection confirms GET then PATCH with filtered steps.

- [x] ✅ **MCP build succeeds**
  - Action: `cd apps/mcp_server && npm run build`
  - Expected: tsc completes with no errors; `dist/tools/rhythms.js` updated mtime.
  - Where to verify: `ls -la apps/mcp_server/dist/tools/rhythms.js`.
  - Evidence: `npm run build` exited 0; `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/mcp-dist-mtime.log` shows `dist/tools/rhythms.js` updated at May 7 14:55.

- [x] ✅ **MCP smoke invocation against local API**
  - Action: start local API (PORT=4000), create a weekly rhythm via `curl -X POST http://localhost:4000/recurring-rules -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"title":"Smoketest weekly","frequency":"weekly","dayOfWeek":1}'`. Note `id`. Then run MCP tool via `cd apps/mcp_server && RHYTHM_API_URL=http://localhost:4000 RHYTHM_API_TOKEN=$TOKEN npm run dev` and from an MCP client invoke `rhythm_add_rhythm_step` with `{ rhythm_id: <id>, title: "Plan upcoming Sunday", day_of_week: "Monday", sort_order: 0 }`.
  - Expected: tool returns the new step JSON (HTTP 201 underneath); contains `dayOfWeek: 1` and `title: "Plan upcoming Sunday"`.
  - Where to verify: MCP client output + API server log shows `POST /recurring-rules/<id>/steps 201`.
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/mcp-handler-invoke-local-4001.log` invokes the registered handler against the isolated local API and returns step JSON with `dayOfWeek: 1` and title `Plan upcoming Sunday`. `local-4001-get-after-mcp.log` confirms persistence.

## Step 2 — error_handler logs stack + returns correlationId

- [x] ✅ **Synthetic 500 is now diagnosable**
  - Action: temporarily insert `throw new Error('synthetic')` into a known controller (e.g. `getAll`), restart server, hit it: `curl -i http://localhost:4000/recurring-rules -H "Authorization: Bearer $TOKEN"`. Revert the throw afterward.
  - Expected: response JSON `{"error":{"code":"INTERNAL_ERROR","message":"Internal server error","correlationId":"<uuid>"}}`. Server stdout shows `Unhandled GET /recurring-rules [cid=<same uuid>]` followed by stack trace including `synthetic`.
  - Where to verify: response body + tailed server log.
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/synthetic-bad-json-500-4001.log` returned 500 with correlationId `8877f7bf-1246-4316-8f12-c58f8d2962eb`; `synthetic-500-server-stack.log` contains matching `Unhandled POST /recurring-rules [cid=...]` and a JSON parse stack trace.

- [x] ✅ **AppError path unchanged**
  - Action: `curl -i http://localhost:4000/recurring-rules/__doesnotexist__ -H "Authorization: Bearer $TOKEN"`
  - Expected: 404 with `{"error":{"code":"NOT_FOUND","message":"..."}}` — NO correlationId field (that's only on INTERNAL_ERROR).
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/app-error-404-4001.log` returned HTTP 404 with `code":"NOT_FOUND"` and no correlationId.

## Step 3 — Vitest tests pass

- [x] ✅ **MCP rhythms.test.ts exists and passes**
  - Action: `cd apps/mcp_server && npm test -- rhythms`
  - Expected: ≥4 tests pass (add success, error passthrough, omit day_of_week, delete tool).
  - Where to verify: vitest output.
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/mcp-full-test.log` shows `src/tools/__tests__/rhythms.test.ts` passed 4 tests.

- [x] ✅ **API recurring_rule_steps.test.ts still passes**
  - Action: `cd apps/api_server && npm test -- recurring_rule_steps`
  - Expected: 4 tests pass (string day_of_week, integer dayOfWeek, missing field 400, unknown rhythm 404).
  - Evidence: after `npm rebuild better-sqlite3` for this shell's Node v22 runtime, `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/api-recurring-rule-steps-test.log` shows 4/4 tests passed.

## Step 4 — Version bump

- [x] ✅ **package.json on 0.4.0**
  - Action: `node -p "require('/Users/ajhochhalter/Documents/Rhythm/apps/mcp_server/package.json').version"`
  - Expected: `0.4.0`.
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/package-version.log` contains `0.4.0`.

## Step 5 — Docs

- [x] ✅ **Tool inventory mentions add/delete step (or commit explicitly notes no inventory exists)**
  - Action: `grep -rn "rhythm_add_rhythm_step" apps/mcp_server/README.md CLAUDE.md` (allow file-not-found).
  - Expected: either a hit, or a documented decision in the commit body that no listing exists.
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/docs-tool-grep.log` shows README entries for both `rhythm_add_rhythm_step` and `rhythm_delete_rhythm_step`.

## Step 6 — End-to-end happy path against LOCAL API

- [x] ✅ **Original repro now returns 201**
  - Action: with local API (4000) and MCP pointed at it, recreate the exact failure scenario:
    1. Create weekly rhythm with no steps.
    2. Call `rhythm_add_rhythm_step` with `{ rhythm_id, title: "Plan upcoming Sunday", day_of_week: "Monday", sort_order: 0 }`.
  - Expected: HTTP 201, response JSON has `dayOfWeek: 1`, `title: "Plan upcoming Sunday"`, `id` populated. Step persists across `GET /recurring-rules/<id>` (steps array length increased by 1).
  - Where to verify: MCP client + curl GET.
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/mcp-handler-invoke-local-4001.log` returned created step JSON with `dayOfWeek: 1`; `local-4001-get-after-mcp.log` shows the step persisted in the rhythm's `steps` array.

- [x] ✅ **Legacy-data PATCH path NO LONGER blocks adds**
  - Action: insert (via direct sqlite) a step row into an existing weekly rhythm with `dayOfWeek: null`. Then via MCP, add another step with `day_of_week: "Tuesday"`.
  - Expected: 201. The new POST endpoint validates only the new step, not all existing steps. (This was the failing path under the old PATCH implementation.)
  - Where to verify: API log shows 201; `GET /recurring-rules/<id>` shows both steps.
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/legacy-null-step-insert.log` injected a legacy step with `dayOfWeek:null`; `legacy-mcp-add-tuesday.log` returned a new Tuesday step with `dayOfWeek: 2`; `legacy-get-after-mcp.log` shows both steps.

## Step 7 — Production verification + publish

- [x] ❌ **Production POST works with real token**
  - Action: against `https://api.vcrcapps.com` with the user's real bearer token, POST a step to a sandbox rhythm via curl directly (bypassing MCP) using the new dedicated endpoint.
  - Expected: HTTP 201 with the persisted step.
  - Where to verify: response + Rhythm desktop client showing the new step.
  - Evidence: blocked by missing production credentials and sandbox rhythm. `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/prod-route-check-empty-token.log` only verifies the unauthenticated response path and returned HTTP 401.

- [x] ❌ **npm publish succeeded**
  - Action: `npm view @ajhochy/rhythm-mcp-server version`
  - Expected: `0.4.0`.
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/npm-view-version.log` returned `0.3.0`, so `0.4.0` is not published on npm.

- [x] ❌ **Reinstall + invoke**
  - Action: `npm i -g @ajhochy/rhythm-mcp-server@0.4.0`; restart Claude Desktop / MCP client; invoke `rhythm_add_rhythm_step` against production rhythm.
  - Expected: 201; step visible in Rhythm Flutter desktop app's Rhythms view.
  - Where to verify: Flutter desktop app — open the target rhythm, confirm the new step appears under the correct day.
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/npm-install-040.log` shows `No matching version found for @ajhochy/rhythm-mcp-server@0.4.0`; production MCP invoke could not be performed.

## Cross-app side effects

- [x] ✅ **Recurrence generation runs after step add**
  - Action: with `enabled: true` on the rhythm, observe API server log after the successful add.
  - Expected: log line about generating instances ahead `RECURRENCE_LOOKAHEAD_WEEKS` worth; `tasks` table contains new auto-generated task instances for the new step's `dayOfWeek`.
  - Where to verify: `sqlite3 ~/Library/Application\ Support/Rhythm/rhythm.db "SELECT id,title,due_date FROM tasks WHERE source_id='<rhythm_id>' ORDER BY due_date"`.
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/tasks-recent.log` shows generated `tasks` rows for `Plan upcoming Sunday` and `Tuesday after legacy null` with recurring-rule source IDs.

- [x] ❌ **Flutter desktop client shows new step**
  - Action: open Rhythm Flutter app, navigate to Rhythms → target rhythm.
  - Expected: new step appears in the list under correct day; tasks generated by the rhythm appear on the Today/Weekly views.
  - Evidence: `/Applications/Rhythm.app` exists and `open -a Rhythm` returned 0, but Computer Use accessibility calls failed with Apple event error `-1743`; see `computer-use-list-apps.log`, `computer-use-rhythm-state.log`, and `applications-rhythm.log`. No desktop UI verification was possible.

- [x] ✅ **No regressions in MCP automation tools**
  - Action: `cd apps/mcp_server && npm test`
  - Expected: existing automations.test.ts still passes; total test count = previous + new rhythms tests.
  - Evidence: `pipeline-evidence/smoketest-wf-2026-05-07-a38ttq/mcp-full-test.log` shows `automations.test.ts` 16/16 passed and total MCP tests 20/20 passed.

## Rollback criteria

- [x] ✅ If 0.4.0 introduces any new failure mode in the Flutter client, `npm dist-tag add @ajhochy/rhythm-mcp-server@0.3.0 latest` and reinstall locally.
  - Evidence: rollback criterion was not triggered because `0.4.0` is not published and could not be installed; `npm view` still reports `0.3.0`.
