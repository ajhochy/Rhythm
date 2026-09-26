# Summary

- Repaired the three assigned splitter failures in the owned test file without changing product code.
- Planner and Tasks already render shared splitters with bounded `aria-valuenow`, `aria-valuemin`, and `aria-valuemax` values and persist under `layout.planner.day-1` and `layout.tasks.detail`. Retained traces showed their drag targets at `y=954.5` and `y=3352.75` in a 900 px viewport, so the pointer events missed them. The drag helper now scrolls each separator into view before measuring it.
- The reset scenario now opens the existing same-origin Settings gateway harness, resizes its mounted splitter, activates the real **Reset layout** action, verifies every `layout.*` key is removed while unrelated storage remains, and remounts Agents to verify Shell and Agents defaults.
- No commit, stash, checkout, socket binding, or out-of-ownership source edit was performed.

# Files changed

- `apps/web/tests/splitter.spec.ts` — corrected off-screen pointer setup and aligned reset coverage with the documented `layout.*` storage-key contract.
- `REPORT.md` — recorded this handoff.

# Checks run

- **PASS** — launch discipline: requested worktree, branch `mega/fix-splitter-pages`, and write probe confirmed.
- **PASS** — changed-spec compile: `node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --jsx react-jsx --skipLibCheck --types node tests/splitter.spec.ts`.
- **PASS** — test collection: `npx playwright test tests/splitter.spec.ts --list`; 37 tests found in one file.
- **PASS** — `cd apps/web && npm run typecheck && npm run build`; TypeScript exited cleanly and Vite transformed 1,695 modules.
- **PASS** — `git diff --check`.
- **PASS** — ownership audit: the only tracked implementation change before this report was `apps/web/tests/splitter.spec.ts`; pre-existing untracked `apps/web/test-results-detail/` evidence was left untouched.
- **LOW risk** — GitNexus upstream impact for `usePlannerLayout`, `PlannerPage`, and `TasksPage`; direct callers are limited to their page renderers and `App`. The index is stale, so current source and retained traces were used as the behavioral evidence.
- **Unavailable** — GitNexus `detect-changes` because this worktree is not registered in the local GitNexus index.
- **Not run by instruction** — rendered Playwright execution, because the configured fixture and dist servers bind sockets. The socket-enabled orchestrator should rerun `cd apps/web && npx playwright test tests/splitter.spec.ts`.

# Decisions

- Kept Planner and Tasks product code unchanged because the rendered contract and storage keys are already correct; weakening assertions or duplicating splitter logic would hide the test setup defect.
- Added `scrollIntoViewIfNeeded()` to the shared drag helper so pointer coverage still exercises real drag behavior on tall routes.
- Used the established Settings harness because the base fixture intentionally has no Settings gateway. Same-origin navigation preserves local storage across the reset scenario.
- Seeded the documented Planner and Tasks keys, resized Shell, Agents, and the mounted Settings splitter, and retained an unrelated key to prove reset removes the `layout.*` namespace only.
- No Settings follow-up is required; the existing reset action satisfies the documented storage-key scheme.
