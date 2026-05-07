# Smoketest Checklist: wf-2026-05-07-2yo8tk

## Scope

PR: https://github.com/ajhochy/Rhythm/pull/436
Worktree: `/Users/ajhochhalter/Documents/wt-wf-2026-05-07-2yo8tk-base`
Feature: add `rhythm_add_rhythm_step` and `rhythm_delete_rhythm_step` MCP tools to `@ajhochy/rhythm-mcp-server`, bump package to `0.3.0`, and verify publish status.

## Checklist

- [x] Source and package diff validation
  - What to do: In the PR worktree, inspect `apps/mcp_server/src/tools/rhythms.ts` and `apps/mcp_server/package.json` against `origin/main...HEAD`.
  - What to verify: Only the MCP rhythm tool file and MCP package manifest changed; `package.json` is version `0.3.0`; both new tool names are registered; `rhythm_add_rhythm_step` maps `day_of_week` strings to numeric `dayOfWeek`; new steps omit `id`; delete returns an error when `step_id` is missing.
  - Where to verify it: CLI in `/Users/ajhochhalter/Documents/wt-wf-2026-05-07-2yo8tk-base`; evidence file under workflow `evidence/source-diff.txt`.
  - ✅ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/source-diff.txt`
    - `git diff --stat origin/main...HEAD` shows only `apps/mcp_server/package.json` and `apps/mcp_server/src/tools/rhythms.ts`.
    - Diff shows package version `0.3.0`.
    - Diff shows `rhythm_add_rhythm_step`, `rhythm_delete_rhythm_step`, `parseDayOfWeek`, `dayOfWeek: dayOfWeekNum ?? null`, and missing-step `toolError`.

- [x] Build and typecheck
  - What to do: Run `npm run typecheck` and `npm run build` in `apps/mcp_server`.
  - What to verify: Both commands exit with status 0 and generated `dist/tools/rhythms.js` contains `rhythm_add_rhythm_step`, `rhythm_delete_rhythm_step`, and `dayOfWeek` handling.
  - Where to verify it: CLI in `/Users/ajhochhalter/Documents/wt-wf-2026-05-07-2yo8tk-base/apps/mcp_server`; evidence files `typecheck.log`, `build.log`, and `dist-rhythms-grep.txt`.
  - ✅ Evidence:
    - `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/typecheck.log` exited 0 for `tsc --noEmit`.
    - `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/build.log` exited 0 for `tsc -p tsconfig.json --noCheck`.
    - `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/dist-rhythms-grep.txt` shows both new tool registrations and `dayOfWeek` handling in `dist/tools/rhythms.js`.

- [x] MCP tool discovery over stdio
  - What to do: Start the built MCP server with a dummy `RHYTHM_API_TOKEN`, send MCP `initialize` and `tools/list` JSON-RPC messages over stdio, then inspect the returned tool list.
  - What to verify: The server starts successfully and advertises `rhythm_add_rhythm_step` with `rhythm_id`, `title`, optional `day_of_week`, optional `sort_order`; it also advertises `rhythm_delete_rhythm_step` with `rhythm_id` and `step_id`.
  - Where to verify it: Local MCP stdio process launched from `apps/mcp_server/dist/index.js`; evidence file `mcp-tools-list.log`.
  - ✅ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/mcp-tools-list.log`
    - `rhythm_add_rhythm_step` advertised with required `rhythm_id`, `title` and properties `day_of_week`, `rhythm_id`, `sort_order`, `title`.
    - `rhythm_delete_rhythm_step` advertised with required `rhythm_id`, `step_id`.
    - Note: MCP `serverInfo.version` still reports `0.2.0` even though package version is `0.3.0`; this was not part of the requested behavior but is visible in evidence.

- [x] MCP add/delete rhythm step behavior against a mock Rhythm API
  - What to do: Run a local mock HTTP API, point the built MCP server at it with `RHYTHM_API_URL`, call `rhythm_add_rhythm_step`, `rhythm_delete_rhythm_step`, and a missing-step delete through MCP stdio.
  - What to verify: Add fetches `/recurring-rules/:id`, patches `{ steps: [...] }`, inserts at `sort_order`, sends `dayOfWeek: 4` for Thursday, decodes HTML in `title`, and sends no `id` on the new step; delete patches the same endpoint with the matching step removed; missing delete returns an MCP `isError` response.
  - Where to verify it: Local mock API and MCP stdio process; evidence file `mcp-mock-api.log`.
  - ✅ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/mcp-mock-api.log`
    - Add PATCH endpoint was `/recurring-rules/rhythm-123`, inserted at index 1, decoded `Prep &amp; Review` to `Prep & Review`, set `dayOfWeek: 4`, and did not include `id` on the new step.
    - Delete PATCH removed `remove-me` and returned `Step remove-me removed from rhythm rhythm-123.`
    - Missing delete returned `isError: true` with `Error: Step does-not-exist not found on rhythm rhythm-123.`

- [ ] Published package visibility
  - What to do: Run `npm view @ajhochy/rhythm-mcp-server version`.
  - What to verify: The npm registry reports `0.3.0` if manual publishing has completed; otherwise record that publish remains blocked by manual setup.
  - Where to verify it: CLI/npm registry; evidence file `npm-view.log`.
  - ❌ Evidence: `/Users/ajhochhalter/.clideck/plugins/workflow/workflows/wf-2026-05-07-2yo8tk/evidence/npm-view.log`
    - Expected npm registry version: `0.3.0`
    - Actual npm registry version: `0.2.0`
    - Suggested fix: complete manual setup by running `npm login` if needed, `npm publish --access public` from `apps/mcp_server`, then rerun `npm view @ajhochy/rhythm-mcp-server version`.
