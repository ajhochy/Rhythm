---
date: 2026-09-14
repo: Rhythm
branch: feature/electron-flutter-retirement
pr: null
issues: []
status: AUTOMATED_PASS_MANUAL_SMOKE_ACTIVE
tags: [run, Rhythm, verification]
index: "[[Rhythm]]"
---

# Electron integrated automated pass

## Files changed

- Integrated candidate at HEAD `82d6b981` plus uncommitted verified changes covers collapsible project headings, live fixture-demo leakage, Planner/Tasks/signed-in Dashboard redesigns, Electron interactive-smoke mode, sandbox `rhythm://app` CORS, and package build/smoke.
- Package produced at `apps/electron/dist/Rhythm.app`.

## Checks run

- Final verifier `4253`: **PASS**, retaining prior integrated automated evidence and focused repair receipts.
- This status does not claim manual smoke, signed dual-architecture qualification, real provider/session behavior, or retirement/merge readiness.

## Notes

- Final manual smoke is active on non-owning candidate PID `8699` against AJ-authorized live API `4001` and engine `4096`.
- Remaining manual scope: Planner native zoom/themes/forced colors/reduced motion/keyboard/backlog/drag/sticky action/density; Dashboard ordering/dates/collisions/legacy-fixture diagnostic disposition/themes/zoom/forced colors/VoiceOver/narrow artifacts; installed Tasks visuals and VoiceOver; real provider/session behavior; signed dual-architecture package and broader retirement gates.
- AJ chose to retain stale verifier sandbox `5898/5897/5899` (PIDs `65058/65094`); do not touch it.
- Generated screenshot churn/deletions and blocked/no-op notes are outside intended commit scope. No commit, push, PR, merge, peer, or runtime action was performed by this update.

---

## 2026-09-15 re-gate triage (failure-triage + repair, no commit)

A fresh integrated re-gate on the same worktree returned three failing commands. All three were
reproduced deterministically in isolation, so machine load from the concurrent iOS workflow is ruled
out as a cause. GitNexus compare-main after the repairs: 449 changed symbols / 269 changed files,
`affected_count` 0, `risk_level` **low** — no HIGH/CRITICAL findings. Bash functions in
`tools/dev/sandbox.sh` are not indexed, so `impact()` on `validate_security_shim` /
`validate_sanitized_config` returned "not found"; those call sites were inspected manually instead.

### 1. `cd apps/web && npm exec -- playwright test` — 21 failed

Three unrelated causes, all repaired:

- **19x `tests/contract/daily-work-dashboard-20260912.spec.ts` (`net::ERR_FAILED` at `:4173`)** —
  test-integration gap, not a Dashboard defect. The spec's `openDashboard()` route allowlist only
  `continue()`s origin `http://127.0.0.1:4286` (its own `tests/dashboard-daily-work-playwright.config.ts`
  dev server, started in live-gateway mode) and aborts everything else, including the top-level
  navigation when the default config serves it on `:4173`. The file was never added to the default
  config's `testIgnore`, which already excludes `bucket-a-rendered-repair.spec.ts` for the same reason.
  Fix: added `'**/daily-work-dashboard-20260912.spec.ts'` to `apps/web/playwright.config.ts` `testIgnore`.
  The feature itself is unaffected — `node tests/dashboard-daily-work-runner.mjs --timeout 15000`
  gives **21/21 passed (14.8s)** with clean `:4286` teardown.
- **`tests/shell.spec.ts:7` (sandboxed Studio iframe never shows `connection-status`)** —
  build-artifact contamination, not a renderer defect. `apps/electron/scripts/package-mac.mjs:93`
  runs `npm --prefix ../web run build` with `rendererBuildEnvironment`, overwriting the shared
  `apps/web/dist/` with a **live-gateway** bundle. The default web config's second `webServer`
  serves that same directory, so after any Electron package build the iframe renders
  "Live gateway could not start … must come from the Electron host runtime". Confirmed by loading
  the sandboxed iframe directly and reading the rendered body. `npm test` never showed this because
  it is literally `npm run build && playwright test && …`; the gate runs the commands in a different
  order. Fix: the default config's dist `webServer` now runs `npm run build && … serve-dist.mjs`
  (timeout raised 30s → 180s), making the required gate command order-independent. Rebuilding
  `apps/web/dist` in fixture mode also restores `npm run test:dist-smoke` (re-run: **passed**,
  index + 2 relative assets).
- **`tests/tasks/task-live-lifecycle.fixture.spec.ts:39` (`tasks-tag-filter` never visible)** —
  real missed caller. The Tasks redesign moved tag/priority/sort behind the `tasks-filters-toggle`
  disclosure (`apps/web/src/pages/tasks/index.tsx:554-557`, `tasks-extra-filters` is `hidden` until
  opened). Two of the three callers were updated (`tests/pages/tasks.spec.ts:57`,
  `tests/contract/issue-2003-tasks.spec.ts:39/65/254`); this one was not. Fix: click the disclosure
  before `selectOption`.

**Re-run:** `cd apps/web && npm exec -- playwright test` → **302 passed, 9 skipped, 0 failed (5.8m)**.
The previously accepted baseline flake (Tasks empty Deferred listbox `aria-required-children`) did
not manifest.

### 2. `cd apps/web && npm exec -- playwright test --config tests/bucket-a-rendered-repair-playwright.config.ts` — 3 failed

- **`issue-1477-c1` golden-screenshot mismatch (2227 px, 1%)** — stale baseline, accepted delta.
  The test's structural assertions (avatar containment, avatar/title/branch/status non-collision)
  all still pass; only `toHaveScreenshot` failed. The diff image is confined entirely to the left
  session rail (row heights and the overflow control), with zero change in the session header this
  test is actually about. The baseline PNG dates from 2026-09-11, before the 2026-09-14 SessionRail
  hit-area work that raised `.session-overflow-button` to 44x44 and the row inline-end padding from
  42px to 46px. The regenerated render was inspected: rail rows are clean, nothing clipped or
  overlapping. Fix: regenerated
  `tests/bucket-a-rendered-repair.spec.ts-snapshots/issue-1477-constrained-session-header-darwin.png`
  with `-g "issue-1477-c1" --update-snapshots`.
- The other two (`self-improvement-auto-promotion-live` `calls[0].confirmation` undefined;
  `self-improvement-auto-promotion-errors` expected `Admin/system access required`, actual
  `Auto-promotion service unavailable`) are the accepted pre-existing pair, confirmed byte-identical
  in message this run.

**Re-run:** **11 passed / 2 failed (21.4s)** — exactly the accepted baseline pair, `issue-1477-c1` green.

### 3. `bash tools/dev/sandbox_guard_test.sh` (worktree root) — 6 failed

Pre-existing within this branch's committed history, never covered because this script was not in
any prior gate table. Both causes are stale *test* fixtures against guards this branch legitimately
tightened; `tools/dev/sandbox.sh` was not changed.

- **4x MCP fixture shape.** `validate_sanitized_config()` (sandbox.sh:188) now requires each `.mcp`
  entry to be `type == "local"` with a non-empty string `command` array; the guard test's fixtures
  still used the pre-tightening `{"mcp":{"rhythm":{"type":"local"}}}`. The real approved fixture
  config (`/private/tmp/rhythm-e02-fixture-20260911-phase0-57ba71255a/opencode.json`) already
  conforms, so the validator is right and the fixtures were stale. Fix: fixtures now carry
  `"command": ["node", "mcp_server.js"]`. The "empty MCP map rejected" case still rejects, but with
  the validator's current wording, so its expected substring moved from `empty MCP map` to
  `requires a safe MCP map`.
- **2x restart-engine subtests.** This branch added `validate_security_shim()` and calls it from
  `launch_engine` (sandbox.sh:530), which `restart_engine` reaches; the subtests build a mocked
  sandbox dir that never installs the Keychain shim and is mode 0755, so the fail-closed guard
  refused. Fix (test-side): `chmod 700` on the mocked sandbox root and a `prepare_security_shim`
  call inside the sourced body before `restart_engine` / `launch_engine`, so the tests exercise the
  real shim-creation path rather than duplicating `security_shim_content` and drifting from it.

**Re-run:** **19 passed, 0 failed.**

### Standing UI-review BLOCKER is already resolved in the working tree

The read-only review's single blocker (`.session-overflow-button` 34x34, and E20 asserting 44px only
for `.subagent-disclosure`) was read against committed HEAD, not the working tree. In the working
tree `apps/web/src/styles.css:193` is already `width: 44px; height: 44px` and
`.session-row-wrap.has-subagents` already reserves a `44px` track, and
`tests/electron-e20-session-ordering.spec.ts:230` `subagent-overflow-hit-area` already measures
`session-menu-z` (has-subagents grid) and `session-menu-b` (absolute plain row) at >= 44x44 across
1024/390/320. Mutation-verified: reverting the CSS to `34px`/`34px` track makes that test fail
(`z overflow width at … >= 44`); the CSS was restored byte-identical
(md5 `577cbaa22a8a8e1f4c84a504bb1dad53`) and `--config tests/electron-e20-playwright.config.ts` is
**30 passed**. No further hit-area work is needed.

### Files changed by this triage

- `apps/web/playwright.config.ts`
- `apps/web/tests/tasks/task-live-lifecycle.fixture.spec.ts`
- `apps/web/tests/bucket-a-rendered-repair.spec.ts-snapshots/issue-1477-constrained-session-header-darwin.png`
- `tools/dev/sandbox_guard_test.sh`

### Supporting re-runs

- `cd apps/web && npm run test:electron-slices` → exit 0, **155 passed / 4 explicit live skips / 0 failed** across 16 configs.
- `cd apps/web && npm run test:dist-smoke` → passed.
- `node apps/web/tests/dashboard-daily-work-runner.mjs --timeout 15000` → 21/21 passed.
- `git diff --check` → clean.

No commit, push, PR, or merge was performed. No sandbox was started (`tools/dev/sandbox.sh` was never
run), and ports 4001/4096, `/Applications/Rhythm.app`, and the retained sandboxes were not touched.
The remaining gate commands from the 2026-09-12 table (API suite, web typecheck/build, Electron
typecheck/test/test:package, the two python sandbox tests) were not re-run here and still need the
full re-verification pass.
