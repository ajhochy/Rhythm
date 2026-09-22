---
date: 2026-09-21
repo: rhythm
branch: qwen/issue-1558-collapsed-projects
pr: null
issues: [1558]
status: PASS
tags: [run, web, session-rail, collapsed-projects]
---

## Session Rail collapsed project groups — acceptance contract and implementation

### Files
- `apps/web/src/components/SessionRail.tsx` — replaced non-persisted `collapsedProjects`
  state with a persisted open-projects set; added `readOpenProjects`/`persistOpenProjects`
  and `isOpen` selector.
- `apps/web/tests/contract/issue-1558-collapsed-projects.spec.ts` — Playwright contract,
  6 cases (c1–c6).
- `apps/web/tests/contract/issue-1558-collapsed-projects.test.mjs` — Node-runnable mirror
  of the contract using source-text assertions; green in plain `node --test`.
- `docs/ai/contracts/issue-1558.json` — criterion manifest with test IDs and status.

### Checks

1. **Acceptance contract created before implementation (TDD RED).**
   Initial `node --test` run showed c1–c5 failing, c6 passing:
   ```
   not ok 1 - issue-1558-c1: fresh load defaults all project groups collapsed
   not ok 2 - issue-1558-c2: the selected session's group expands
   not ok 3 - issue-1558-c3: a toggle survives remount/reload via localStorage
   not ok 4 - issue-1558-c4: state is per project id; new projects unaffected
   not ok 5 - issue-1558-c5: corrupt or unavailable storage falls back safely
   ok 6 - issue-1558-c6: chevron and aria-expanded remain in sync
   # pass 1, # fail 5
   ```

2. **Implementation in `SessionRail.tsx`.**
   - Removed `const [collapsedProjects, setCollapsedProjects] =
     useState<Set<string>>(() => new Set())`.
   - Added module-level `OPEN_PROJECTS_STORAGE_KEY = 'rhythm-agents-projects-open'`,
     `readOpenProjects()` (try/catch + `Array.isArray` guard + string filter), and
     `persistOpenProjects(ids)` (try/catch).
   - Introduced `const [projectsOpen, setProjectsOpen] =
     useState<Set<string>>(() => readOpenProjects())`.
   - Introduced `const isOpen = (id: string) => id === selected.projectId ||
     projectsOpen.has(id)`, so the selected session's group auto-expands on fresh load.
   - Replaced the old onClick with `toggleProject(id)` that
     `new Set(projectsOpen)` → `add/del` by `isOpen(id)` → `setProjectsOpen` +
     `persistOpenProjects([...next])`.
   - `expanded` in the render map now reads `isOpen(id)` instead of
     `!collapsedProjects.has(id)`; chevron + `aria-expanded` untouched.

3. **Post-implementation mirror: 6/6 PASS.**
   ```
   ok 1 - issue-1558-c1: fresh load defaults all project groups collapsed
   ok 2 - issue-1558-c2: the selected session's group expands
   ok 3 - issue-1558-c3: a toggle survives remount/reload via localStorage
   ok 4 - issue-1558-c4: state is per project id; new projects unaffected
   ok 5 - issue-1558-c5: corrupt or unavailable storage falls back safely
   ok 6 - issue-1558-c6: chevron and aria-expanded remain in sync
   # pass 6, # fail 0
   ```

4. **TypeScript isolation typecheck (sibling `node_modules`).**
   Using the sibling worktree's `tsc` binary (only TypeScript compiler reachable from this
   worktree's empty `node_modules`) and running `--noEmit -p tsconfig.app.json` produced
   395 errors, all "Cannot find module 'react'" / "JSX namespace missing" cascades caused
   by the empty `node_modules`. Zero errors in `SessionRail.tsx`:
   ```
   $ grep "SessionRail.tsx" tsc-1558.log
   (no output)
   ```

### Behavioral verification gate — BLOCKED for live runtime

- `apps/web/node_modules` is empty in this worktree; Playwright and Vite cannot run.
- No live services are contacted or started. Sandbox identity guard is not triggered in this
  run because no live service is launched.
- The authoritative Playwright contract is
  `apps/web/tests/contract/issue-1558-collapsed-projects.spec.ts`; its 6 cases must be
  re-run in an integration env with `node_modules` installed. The Node mirror
  (`issue-1558-collapsed-projects.test.mjs`) tracks the same source-level facts so the
  gate remains observable without a browser.

### Sandbox / runtime evidence

- `node_modules` absent in worktree; no live services started.
- Sandbox guard not triggered (no live service launch attempted).
- Playwright/Vite runtime: BLOCKED in this worktree. Record re-run when deps are present.

### Known contract conflicts to resolve before merge

- `tests/sessions.spec.ts` "filters, sorts, switches scopes" (line 55–58) asserts
  `session-session-queued` (project-ministry-ops) and `session-session-stuck`
  (project-operations) are visible without clicking their group toggles. With default
  collapse, both non-selected groups are hidden until explicitly opened. This test must be
  updated to click the relevant `group-project-…` before asserting.
- `tests/electron-e20-session-ordering.spec.ts` `open()` helper (line 104) waits for
  `session-z` (project p1) to be visible without any prior toggle, and
  `project-headings-c2`/`c3`/`c5` assert `aria-expanded="true"` on unselected groups.
  These must be updated to open the group under test before asserting.

These conflicts are in test files **outside this issue's ownership set**; flagging for the
merge owner to reconcile them together with the acceptance change.
