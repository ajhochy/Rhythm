---
date: 2026-10-21
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, rhythm, mcp, playwright]
---

# Authenticated MCP catalog readiness

## Files

- `apps/web/src/main.tsx` shares one authenticated ensure attempt with the rendered gateway and leaves a failed attempt retryable.
- `apps/web/src/gateway/index.ts` and `apps/web/src/gateway/mcp.ts` pass that readiness boundary to MCP listing, so the initial catalog GET waits for the ensure result. The API's explicit 503 behavior remains unchanged.
- `apps/web/src/components/tools/AgentSettingsTool.tsx` and `apps/web/src/components/Profiles.tsx` cancel their pending catalog reads on unmount and ignore stale results. Existing Retry and Refresh controls remain available.
- `apps/web/tests/contract/mcp-readiness-auth.spec.ts` and its config cover settled connected status, an ensure failure followed by visible Retry, and unmount cancellation for both callers. `apps/web/tests/gateway/gateway.spec.ts` uses a literal module import so its assertions can execute through the Playwright transform; its receipt expectation includes the already-present `apiBase` field.

## Checks

- Before implementation, guarded browser contract on unchanged b7d5 source: **2 failed, 1 passed**, exit 1. The configured and 503 cases never converged after authenticated ensure; Settings unmount passed. Command: `RHYTHM_MCP_READINESS_CONTRACT=1 npm run build:guard -- apps/web/node_modules/.bin/playwright test --config apps/web/tests/contract/mcp-readiness-auth.config.ts`. Preserved log: `/private/tmp/rhythm-mcp-readiness-red-20261021.log`.
- Expanded test-first contract before implementation: **4 failed, 1 passed**, exit 1. The added failed-ensure case observed two premature GETs before Retry; Profiles also observed two GETs while ensure was pending. The original two convergence cases remained red, and Settings unmount remained green. Same guarded command; this expanded run was captured in the authoring terminal, not a separate saved log.
- After the web patch, the same guarded rendered contract: **5 passed**, exit 0, 8.5 seconds. `npm run build:guard -- apps/web/node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json`: exit 0. Focused test TypeScript with `--strict --noEmit`: exit 0. `git diff --check` on the five web source files: exit 0.
- Nearby Settings/Profiles intercepted live-gateway suite: **7 passed**, exit 0, 10.1 seconds. The repository config first failed before test bodies because its Playwright headless shell is absent; rerun used an installed Chrome channel via `/private/tmp/rhythm-mcp-startup-draft-20261021/settings-columns-chrome.config.mjs` without changing the checked-in test. Command: `RHYTHM_SETTINGS_COLUMNS_CONTRACT=1 npm run build:guard -- apps/web/node_modules/.bin/playwright test --config /private/tmp/rhythm-mcp-startup-draft-20261021/settings-columns-chrome.config.mjs`.
- Nearby gateway assertions: a computed dynamic import had hidden the actual module resolution error as `null`. Literal import exposed a worktree-only missing React peer dependency for `packages/rhythm-workspace-ui`; a private Node import hook redirected that package's `react`, `react-dom`, and `lucide-react` peer resolution to the web app's installed dependencies, matching Vite's configured dedupe. Initial actual-execution result was **12 passed, 1 failed** because a stale exact receipt expectation omitted the existing `apiBase` property. The exact expectation now includes that property. Final guarded rerun: **13 passed**, exit 0, 2.0 seconds. Command: `NODE_OPTIONS=--import=/private/tmp/rhythm-mcp-startup-draft-20261021/web-workspace-peers.mjs npm run build:guard -- apps/web/node_modules/.bin/playwright test --config /private/tmp/rhythm-mcp-startup-draft-20261021/gateway-source.config.mjs`.

## Notes

GitNexus impact returned LOW/0 for the touched web symbols but warned its Rhythm index is 321 commits behind this worktree. The anonymous gateway receipt test was unindexed (UNKNOWN); manual scope is one test assertion. Manual blast radius is authenticated renderer startup, MCP catalog read, and Settings/Profiles consumers. The ensure HTTP fetch has no independent client deadline. The server's MCP local connection uses the configured 600,000 ms timeout; a shorter client timeout could permit overlapping server-side ensure attempts on Retry, so this repair does not invent one.

This is browser-intercepted and source/type evidence. A fresh signed packaged build and actual authenticated app/API/engine MCP convergence check remain **pending**. No backend behavior, API 503 guard, credential, model, sandbox, or native runtime was changed by this run.
