---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: unverified
tags: [run, Rhythm]
---

# Schedule timing editor implementation

## Files

- `apps/web/src/components/ToolWorkspace.tsx` — added timing controls, shared pre-submit/enable validation, timing serialization, and a warning derived from persisted enabled schedules without a next run.
- `apps/web/src/scheduleTiming.mjs` and `.d.mts` — local datetime, IANA timezone, five-field cron, and schedule-validity helpers.
- `apps/web/tests/schedule-timing.test.mjs` — focused unit coverage for exact legacy-instant preservation, local-to-ISO conversion, timezone retention, cron validation, and invalid enabled drafts.

## Checks

- Native RED confirmed on the unchanged 4fda build before edits: one failure, zero skips/flaky; missing `Run at (this Mac's local time)` was the only runtime issue. Evidence: `/private/tmp/rhythm-private-4fda-schedule-timing-contract-red-20261020.log` and `/private/tmp/rhythm-schedule-timing-native-red-evidence-20261020/`.
- `npm run build:guard -- node --test apps/web/tests/schedule-timing.test.mjs` — 5/5 passed.
- `npm run build:guard -- ./node_modules/.bin/tsc -p apps/web/tsconfig.app.json --noEmit` — passed.
- `git diff --check` — passed.
- No app, native, API server, engine, model, network, or bundle build was run. Native GREEN remains pending root's rebuilt exact-source Confirm.

## Decisions and limits

- Once input is browser-local and serialized to an ISO instant; if an existing input remains unchanged, the exact stored ISO string (including seconds/milliseconds) is reused.
- Recurring schedules send the entered wall-clock time and IANA zone directly. The editor does not convert recurring times through the browser timezone.
- Only active-type timing fields are sent; unrelated persisted fields are left untouched. The API PATCH controller still falls back to old stored timing while computing `nextRunAt` when a property is explicitly null, so clearing irrelevant fields during a type switch remains outside this change.
- Enabled schedules with missing timing are rejected before create/update. Disabled blank once definitions can still save. If the server accepts an enabled row without `nextRunAt`, the row remains selected and editable with a warning.
- The same validator runs before enabling a disabled schedule. Invalid drafts open in the editor with an inline explanation and the enable intent checked; no enable PATCH is sent until the corrected draft is saved. The missing-next-run warning derives from the selected API row, so it survives reload and also identifies pre-existing incomplete enabled schedules.
- GitNexus `LiveSchedulesTool` upstream impact: LOW, zero indexed callers/processes; the index is 314 commits stale. The manual caller remains the live schedule editor in `ToolWorkspaceTasks`.
- No source behavior has been confirmed in a rebuilt or installed app; this record remains unverified pending native Confirm.

## Parent review and rendered checks

- Backend `_computeNextCron` accepts numeric five-field expressions; the editor helper follows that supported syntax. Named and six-field expressions are not supported by the current engine scheduler.
- Native independent timing contract and MCP scope contract committed separately at `6d13554978`; timing contract has actual RED on old signed `4fda`, while new inspector-enable edge remains pending native Confirm.
- Parent added browser regressions for failed PATCH draft retention/retry on the same row, enabled/null-next-run warning across reload with edit rather than duplicate create, and disabled blank draft Enable opening timing repair with zero write, followed by one enabled PATCH after correction.
- Guarded rendered command: `npm run build:guard -- /bin/sh -c 'cd apps/web && ./node_modules/.bin/playwright test --config tests/post-m1-phase-7-fixture-playwright.config.ts post-m1-phase-7-schedules-quality.redspec.ts'` — **7/7**, 9.1 seconds, exit 0; `/private/tmp/rhythm-schedule-rendered-first3-repair-20261020.log`.
- Earlier broader browser attempt: 4 passed/3 failed. First case transient blank UI during source editing; isolated unchanged rerun passed. Two old navigation cases asserted incidental exact GET counts; replaced with exact owned session URL parameter, actual selected header, and canonical transcript read. An intermediate URL assertion incorrectly forbade valid scheduleId context; corrected. Initial failure evidence retained at `/private/tmp/rhythm-schedule-editor-rendered-review-failure-evidence-20261020`.
- Latest helper unit checks **5/5**, app TypeScript and whitespace checks exit 0. App checks do not include packaged specs; separate strict packaged check after explicit Node/global source configuration and type guards passes for both new contracts.
- This frontend-only repair does not change scheduler execution, backend persistence, routing or permission enforcement. Local rebuilt native GREEN is the next required check; browser route fixtures alone do not qualify the app.
