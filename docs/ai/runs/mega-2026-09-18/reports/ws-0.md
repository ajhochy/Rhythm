## Summary

Implemented the WS-0 shared list/inspector API, migrated fixture and live Agents → Tasks, and documented adoption. Changes are uncommitted on `mega/ws-0-list-inspector`, based on `648f8d5885b1767bcb53a95c7e8aa7eadce2c5f2`.

Socket-free checks pass. Seven rendered fixture tests are authored but were not run, per the worker brief. Runtime/visual verification remains with the orchestrator.

## Files changed

- `apps/web/src/components/ListInspector.tsx` — exact public exports, URL selection, grouped/searchable rows, keyboard navigation, accessible inspector and explicit states.
- `apps/web/src/components/ListInspector.css` — Rhythm tokens, bounded pane width, focus/selection styles, RTL and narrow single-pane layout.
- `apps/web/src/components/ToolWorkspace.tsx` — both schedule renderers adopt the primitive; preserve action IDs/gateway calls, retain query parameters, guard stale run responses.
- `apps/web/tests/helpers/list-inspector.ts` — all seven requested helpers, scoped axe and structural checks.
- `apps/web/tests/list-inspector-primitive.spec.ts` — seven fixture tests covering selection/actions, keyboard, URL restoration, missing/deleted items, narrow layout, zoom/RTL and states/read-only access.
- `docs/ai/ui-contracts/list-inspector.md` — API, accessibility, responsive/splitter contract, ten-line recipe and Tools adoption checklist.
- `REPORT.md` — this handoff and verification evidence.

## Checks run

Commands below ran in this worktree; web commands ran from `apps/web`.

- `pwd && git rev-parse --abbrev-ref HEAD` — pass: expected worktree and `mega/ws-0-list-inspector`.
- `echo ok > .write-probe && rm .write-probe` — pass, exit 0.
- `node --version` — pass: `v22.23.0`.
- `npm run typecheck && npm run build` — pass, exit 0. Tail: `1682 modules transformed`; `built in 4.05s`. Vite reports a bundle-size warning above 500 kB.
- `node --test src/components/ToolWorkspace.contract.test.mjs` — pass, exit 0. Tail: `tests 9`, `pass 9`, `fail 0`.
- `./node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM --skipLibCheck tests/helpers/list-inspector.ts tests/list-inspector-primitive.spec.ts` — pass, exit 0, no output.
- `node /Users/ajhochhalter/.agents/skills/impeccable/scripts/detect.mjs --json apps/web/src/components/ListInspector.tsx apps/web/src/components/ListInspector.css` — pass, exit 0; output `[]`.
- `git diff --check` — pass, exit 0, no output.
- GitNexus upstream analysis: `gitnexus impact LiveSchedulesTool --direction upstream --repo Rhythm --file apps/web/src/components/ToolWorkspace.tsx` and the equivalent `FixtureSchedulesTool` command — LOW, one direct caller each, three impacted symbols, no indexed processes.
- `gitnexus impact ToolFrame --direction upstream --repo Rhythm --file apps/web/src/components/ToolWorkspace.tsx --summary-only` — HIGH, 21 direct callers; warning reported before editing. Changes are limited to query preservation and the labeled container's region role.
- Equivalent `--summary-only` impact commands for `loadTasks` and `loadRuns` — LOW.
- Playwright, Electron, live APIs and `npm run test:dist-smoke` — not run; sockets/runtime launches prohibited. Existing rendered suites are preserved, not claimed passing.

## Acceptance criteria

- Common layout/row/inspector contract → **done** in both schedule renderers; exact requested exports, helper and adoption documentation present.
- Preserve scheduling, history and actions → **partial**: handlers, confirmations, canonical gateway calls and action selectors retained; static checks pass. Existing rendered/live suites await the orchestrator.
- Mouse/keyboard selection with visible focus/selection → **partial**: implemented and covered by authored fixture tests; rendered execution pending.
- Long content, empty/loading/error/read-only and resizing usability → **partial**: implemented with token styles, explicit states, wrapping controls and bounded width; zoom/RTL/narrow/state specs authored, rendering pending.
- Refresh/deep links and missing/deleted items → **partial**: hash-query hook preserves unrelated parameters; explicit unknown IDs never fall back to another record; stale run responses are guarded. Restoration/deletion specs authored, rendering pending.

## Decisions

- Migrated both schedule renderers so fixture tests exercise the shared primitive; rejected leaving the fixture on its old layout.
- Used hash-query `scheduleId` with `replaceState`, matching existing routes; rejected adding a router or history entry per selection.
- Kept domain IDs in URLs and prefixed only row IDs to preserve legacy `schedule-${id}` test IDs; rejected schedule-specific logic in the primitive.
- Used text-only option rows and a keyboard-operable semantic Back button so disabled action fieldsets still permit inspection; mutation controls remain disabled.
- Used available component width for the 720px breakpoint, including zoom/nested panes; rejected viewport-only reflow and drag-resizing.
- Bound run history to its selected schedule/request to prevent stale details; retained deleted selections for the explicit not-found state.

## Follow-ups

- Orchestrator: run the new fixture spec and the five required existing rendered suites in their appropriate fixture/live/Electron configurations; capture visual and axe evidence.
- Orchestrator: verify live schedule switching with delayed run responses, then integrate the shared splitter when #1524 lands.
- Other workers own remaining tool/page migrations. This does not complete umbrella issue #1513.
- Project-state/run-log and Dev Dashboard publication remain with the orchestrator under this worker's scope and external-write restrictions.

## Needs a human

None for this workstream. Integration tests and committing the working tree belong to the orchestrator.
