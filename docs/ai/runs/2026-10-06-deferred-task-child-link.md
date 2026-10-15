---
date: 2026-10-06
repo: Rhythm
branch: codex/lazy-tool-loading-default-20261006
pr: null
issues: []
status: unverified
tags: [run, rhythm, lazy-tool-loading, web]
---

# Deferred builtin task — child-link compatibility (web normalizer)

Separate from `2026-10-06-lazy-tool-loading-default.md` (not modified). Disjoint UI
increment; engine/API postimages untouched.

## Files

- `apps/web/src/gateway/sessions.ts` — `mapPart` now also treats a part as a task
  execution when `tool === 'mcp_dispatch'` and `state.input` is an object with
  `family === 'builtin'`, `name === 'task'`, and `action` omitted or `'execute'`
  (new helper `isDeferredTaskExecution`). Native `tool:'task'` extraction is
  unchanged (output `task_id:` only). Deferred child id: nonempty string
  `state.metadata.sessionId`, else the existing `TASK_ID_PATTERN` output match; if
  both exist and differ, no `childSessionId` (children block without a link). The
  canonical `tool` (outer name `mcp_dispatch`, callId, input, output, error,
  metadata, attachments) is preserved verbatim. Search/describe, MCP family, other
  builtins, missing family, and malformed/array/non-object input stay generic tools.
- `apps/web/tests/gateway/sessions-gateway.spec.ts` — six cases
  `deferred-task-child-link-c1..c6` (existing Playwright runner, actual
  `sessions.ts` and `transcript-reducer.ts`, no new server/config): native
  unchanged; REST `mapMessage` with retained fields/attachments; running/error/
  omitted-action/metadata-only/output-only; missing and mismatched ids; negative
  spoof families/actions/names/inputs; WS `applyTranscriptEvent`
  `message.part.updated` running→completed.

## Active caller trace (manual; GitNexus runner unavailable, no reindex)

From Sol's report: REST hydration `sessions.ts` `mapMessage` (pagination/child
messages), WS `transcript-reducer.ts:141` → `mapPart`, Rhythm canonical history
`components/AgentsWorkspace.tsx` → `mapMessage`; `components/Transcript.tsx` renders
the child button only for `kind==='children'`. All go through `mapPart`, so the one
edit covers them. Child-fetch ownership/parent proof remains the navigation
authority; no read/execute authority changed.

## Checks — NOT RUN (blocked), no result claimed

This session could not execute any web check:
- `apps/web` has no `node_modules` in this checkout; `npx playwright test
  tests/gateway/sessions-gateway.spec.ts --workers=1` tried to fetch Playwright into
  the npx cache and failed (`Cannot find package '@playwright/test'`). Nothing was
  installed into the repo.
- `bun -e ...` probe and `bun test tests/gateway/sessions-gateway.spec.ts` were
  denied (no approval surface). TypeScript, `npm run build`, and
  `npm run test:dist-smoke` were therefore not attempted.
- **No red-before-fix evidence was captured**; the edit was made from the literal
  active branch (`raw.tool === 'task'` only) per Sol's review. The new cases c2, c3,
  c4 (children kind), c6 should fail on the pre-fix mapper by that same reading;
  unverified.

Commands for an executor with a populated `apps/web` toolchain:

```sh
npx playwright test tests/gateway/sessions-gateway.spec.ts --workers=1
npx tsc -p tsconfig.app.json --noEmit   # per repo web TypeScript config
npm run build
npm run test:dist-smoke
```

Red witness: run the spec once with `sessions.ts` reverted to the preimage, then with
the fix.

## Limits

No rendered child-chip test (optional; not added). Installed Electron behavior
unverified. Mobile unchanged (no equivalent regression per Sol). Source-only; all-tools
acceptance not claimed.
