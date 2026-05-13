# API Bug — Workflow wf-2026-05-07-a38ttq

## Description

`POST /rhythms/:id/steps` (i.e. `POST /recurring-rules/:id/steps`) was returning **500** when called from the MCP client because the published `@ajhochy/rhythm-mcp-server@0.3.0` was using a **PATCH-merge** strategy (`apiGet` the rhythm → append step → `apiPatch` the entire `steps` array). The API's update path revalidates every step via `validateSteps`; legacy steps without a `dayOfWeek` then threw an unhandled error that the API's `error_handler` swallowed into a generic 500. The API itself already had a dedicated `POST /:id/steps` route that does the right thing.

This branch fixes the root cause (MCP client) and also makes future regressions diagnosable (API error handler).

## Issues completed

- **#451** — Replaced `rhythm_add_rhythm_step` MCP handler to call `POST /recurring-rules/:id/steps` directly with snake_case body keys. No more fetch-merge-PATCH.
- **#452** — `error_handler.ts` now logs full stack traces with a `correlationId` and returns the same `correlationId` in the 500 response (without leaking the stack).
- **#453** — Vitest coverage for `rhythm_add_rhythm_step` (POST shape, 500 surface, day_of_week omission) and `rhythm_delete_rhythm_step` (GET + PATCH-with-filtered-array).
- **#454** — Bumped `apps/mcp_server/package.json` to `0.4.0` (skipping the broken 0.3.0 release).
- **#455** — Added the two new tools to the MCP README inventory.
- **#456** — Full local verification smoketest. 10/10 checks passed: API build, 169/169 API tests (including `recurring_rule_steps.test.ts`), live curl against the dev server (201/400/400 as expected), synthetic 500 returning `correlationId` with stack trace in logs, MCP build, 20/20 MCP tests. (1 skipped: stdio runtime — no local `RHYTHM_API_TOKEN`.) Evidence under `pipeline-evidence/issue-456/`.
- **#457** — Production sanity check: `POST https://api.vcrcapps.com/recurring-rules/__ping__/steps` returns 401 (auth middleware engaged) — proving the route is deployed. Evidence at `pipeline-evidence/issue-457/prod-route-check.md`.

## Manual setup needed

After this PR merges to `main`:

1. **Publish `@ajhochy/rhythm-mcp-server@0.4.0` to npm**
   - `cd apps/mcp_server`
   - `npm run build` (sanity)
   - `npm publish --access public`
   - Verify with `npm view @ajhochy/rhythm-mcp-server version` (expect `0.4.0`)
   - Reinstall locally: `npm i -g @ajhochy/rhythm-mcp-server@0.4.0`
   - Restart any MCP client (e.g. Claude Desktop) so it picks up the new version
2. **Tag the release**
   - `git checkout main && git pull`
   - `git tag mcp-v0.4.0`
   - `git push --tags`
3. **Optional — local-only**: if `npm test` in `apps/api_server` fails with a `better-sqlite3` ABI error on your machine, run `npm rebuild better-sqlite3` once. CI is unaffected.

## CI

All commits passed `Type-check and build` and `server-checks`.
