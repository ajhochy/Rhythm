# Smoketest Checklist: wf-2026-05-07-2yo8tk

## Scope

PR: https://github.com/ajhochy/Rhythm/pull/436
Worktree: `/Users/ajhochhalter/Documents/wt-wf-2026-05-07-2yo8tk-base`
Feature: add `rhythm_add_rhythm_step` and `rhythm_delete_rhythm_step` MCP tools to `@ajhochy/rhythm-mcp-server`, bump package version to `0.3.0`, and verify npm publication status.

## Checklist

- [x] Source and package diff validation
  - What to do: In the PR worktree, inspect `apps/mcp_server/package.json` and `apps/mcp_server/src/tools/rhythms.ts` from `origin/main...HEAD`.
  - What to verify: Package version is `0.3.0`; both new tool names are registered; `rhythm_add_rhythm_step` accepts `rhythm_id`, `title`, optional `day_of_week`, and optional `sort_order`; `day_of_week` is converted to numeric `dayOfWeek`; new steps omit `id`; `rhythm_delete_rhythm_step` accepts `rhythm_id` and `step_id` and reports an MCP error if the step is absent.
  - Where to verify it: CLI in `/Users/ajhochhalter/Documents/wt-wf-2026-05-07-2yo8tk-base`; evidence file `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/source-diff.txt`.
  - ✅ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/source-diff.txt`
    - Package diff changes `"version": "0.2.0"` to `"version": "0.3.0"`.
    - Source diff adds `parseDayOfWeek`, `rhythm_add_rhythm_step`, and `rhythm_delete_rhythm_step`.
    - Add step builds a new step with decoded title, numeric `dayOfWeek`, and no generated `id`; missing delete returns `toolError(new Error(...))`.

- [x] Build and typecheck
  - What to do: Run `npm run typecheck` and `npm run build` in `apps/mcp_server`.
  - What to verify: Both commands exit with status 0 and generated `dist/tools/rhythms.js` contains `rhythm_add_rhythm_step`, `rhythm_delete_rhythm_step`, and `dayOfWeek` handling.
  - Where to verify it: CLI in `/Users/ajhochhalter/Documents/wt-wf-2026-05-07-2yo8tk-base/apps/mcp_server`; evidence files `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/typecheck.log`, `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/build.log`, and `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/dist-rhythms-grep.txt`.
  - ✅ Evidence:
    - `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/typecheck.log` shows `tsc --noEmit` with `EXIT_STATUS=0`.
    - `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/build.log` shows `tsc -p tsconfig.json --noCheck` with `EXIT_STATUS=0`.
    - `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/dist-rhythms-grep.txt` shows both new tool registrations and `dayOfWeek` handling in `dist/tools/rhythms.js`.

- [x] MCP tool discovery over stdio
  - What to do: Start the built MCP server with a dummy `RHYTHM_API_TOKEN`, send MCP `initialize` and `tools/list` JSON-RPC messages over stdio, then inspect the returned tool list.
  - What to verify: The server starts successfully and advertises `rhythm_add_rhythm_step` with required `rhythm_id` and `title`, optional `day_of_week` and `sort_order`; it also advertises `rhythm_delete_rhythm_step` with required `rhythm_id` and `step_id`.
  - Where to verify it: Local MCP stdio process launched from `apps/mcp_server/dist/index.js`; evidence file `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/mcp-tools-list.log`.
  - ✅ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/mcp-tools-list.log`
    - `tools/list` returned `rhythm_add_rhythm_step` with required `rhythm_id` and `title`, plus optional `day_of_week` and `sort_order`.
    - `tools/list` returned `rhythm_delete_rhythm_step` with required `rhythm_id` and `step_id`.
    - Script printed `ASSERTIONS PASSED: rhythm step tools are discoverable with expected schemas.` and `EXIT_STATUS=0`.

- [x] MCP add/delete rhythm step behavior against a mock Rhythm API
  - What to do: Run a local mock HTTP API, point the built MCP server at it with `RHYTHM_API_URL`, call `rhythm_add_rhythm_step`, `rhythm_delete_rhythm_step`, and a missing-step delete through MCP stdio.
  - What to verify: Add fetches the rhythm, patches `{ steps: [...] }`, inserts at `sort_order`, sends `dayOfWeek: 4` for Thursday, decodes HTML in `title`, and sends no `id` on the new step; delete patches the same rhythm with the matching step removed; missing delete returns an MCP `isError` response.
  - Where to verify it: Local mock API and MCP stdio process; evidence file `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/mcp-mock-api.log`.
  - ✅ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/mcp-mock-api.log`
    - Add PATCHed `/recurring-rules/rhythm-123`, inserted at index 1, decoded `Prep &amp; Review` to `Prep & Review`, set `dayOfWeek: 4`, and did not include `id` on the new step.
    - Delete PATCHed `/recurring-rules/rhythm-123` with `remove-me` omitted and returned `Step remove-me removed from rhythm rhythm-123.`
    - Missing delete returned `isError: true` with `Error: Step does-not-exist not found on rhythm rhythm-123.`
    - Script printed `ASSERTIONS PASSED: add/delete rhythm step behavior matched expected API calls and MCP responses.` and `EXIT_STATUS=0`.

- [ ] Published package visibility
  - What to do: Run `npm view @ajhochy/rhythm-mcp-server version`.
  - What to verify: The npm registry reports `0.3.0` if manual publishing has completed; otherwise record that publish remains blocked by manual setup.
  - Where to verify it: CLI/npm registry; evidence file `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/npm-view.log`.
  - ❌ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/npm-view.log`
    - Expected npm registry version: `0.3.0`.
    - Actual npm registry version on May 7, 2026: `0.2.0`.
    - `npm view` exited 0, so the package exists, but the bumped package has not been published.
    - Suggested fix: complete manual setup by running `npm login` if needed, `npm publish --access public` from `/Users/ajhochhalter/Documents/wt-wf-2026-05-07-2yo8tk-base/apps/mcp_server`, then rerun `npm view @ajhochy/rhythm-mcp-server version`.
