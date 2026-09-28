---
date: 2026-09-23
repo: Rhythm
branch: swarm/pr-1577-integration
pr: 1577
issues: [1558, 1552]
status: BLOCKED
tags: [run, web, session-rail, collapsed-projects]
---

## Final PR #1577 repair — GPT-6 Sol

### Files

Only `SessionRail.tsx`, `sessions.spec.ts`, `electron-e20-session-ordering.spec.ts`, `electron-e16-agents-fixture.spec.ts`, `agents-add-project.spec.ts`, `issue-1558-collapsed-projects.spec.ts`, deletion of the unreferenced stale `issue-1558-collapsed-projects.test.mjs`, issue-1558/1552 contracts and their two run logs. No CSS, styles, mega, project-state/current-plan, commits, push, merge, stash or clean. Recipe `/private/tmp/rhythm-swarm-pr1577-triage-recipe.diff` inspected hunk by hunk, never applied wholesale. The recipe's Node-mirror hunk was rejected because the authoritative browser contract now runs and neither contract nor logs cite the mirror.

### Acceptance and impact

- Verified `/private/tmp/rhythm-swarm-pr1577`, branch `swarm/pr-1577-integration`, existing five modified files before editing.
- RED: `RHYTHM_E2E_PORT=5473 npx playwright test tests/contract/issue-1558-collapsed-projects.spec.ts --grep 'issue-1558-c2b' --workers=1` → **1 failed**: after selecting `session-session-completed`, previously selected `group-project-project-ministry-ops` had `aria-expanded=false` instead of `true`. An initial 120s runner timeout during web build left its own fixture Vite server on 5473; that orphan was identified and stopped before rerun. No backend or engine started.
- GitNexus impact `SessionRail` in `Rhythm`, `apps/web/src/components/SessionRail.tsx`, upstream: **LOW**, 2 direct (`AgentsWorkspace`, E21 `Probe`), 7 total symbols, 0 indexed affected processes, Components/Gateway modules. No HIGH/CRITICAL approval needed.
- Implementation: persisted `Record<projectId,boolean>` changes only on a user toggle; in-memory `useRef(Set)` tracks project IDs only when `selected.id` is truthy. Explicit persisted true/false wins, including false on the current selection. Toggle fallback uses the in-memory set. Creation does not persist a new group or rewrite any other project's choice. Native heading buttons, focus, row tab order and independent toggles are unchanged.
- Browser cases c2b (origin stays open), c3b (true/false across actual persistent browser process close/relaunch), and creation preserving another project's open state were added. Existing fixture journeys explicitly open previously implicit groups. #1552 packaged candidate is **manual not_tested, no waiver**: AJ must smoke child chip at 1440/1024/780 for title/meta separation, usable width, flush-right/centered chevron. Fixture Chromium is not packaged Electron evidence.

### Checks (cwd `apps/web` unless noted)

- `npm run typecheck && npm run build` → PASS; pre-existing Vite chunk-size warning.
- `RHYTHM_E2E_PORT=5473 npx playwright test tests/sessions.spec.ts tests/agents-add-project.spec.ts tests/contract/issue-1558-collapsed-projects.spec.ts --workers=1` → **17 passed, 1 env-gated live sandbox skipped**.
- `npx playwright test --config tests/electron-e20-playwright.config.ts` → **30/30 passed**.
- `E16_FIXTURE=1 npx playwright test --config tests/electron-e16-playwright.config.ts` → **1/1 passed**.
- `RHYTHM_E2E_PORT=5473 npx playwright test tests/contract/issue-1552-child-chip.spec.ts --workers=1` → **5/5 passed** (combined focused: 22 passed, 1 skipped).
- `npm run test:session-opening` → **13/13 passed**.
- `npm run test:electron-slices` → all invoked stages PASS including E20 30/30, E16 fixture 1/1; E14 9+1 skipped, E23 17+1 skipped, E21–24 combined 42+1 skipped, E27 5+1 skipped.
- `RHYTHM_E2E_PORT=5473 npx playwright test --workers=1` (full default stage, separately, 3600s cap) → **474 passed, 49 skipped, 7 failed** in 20.7m: one Hermes splitter (`layout.hermes.status-width` absent), six `live-demo-state-leak` (renderer trusted API base configuration error). None of these are changed or repaired here; identical failure on base has **not** been proven, so they are not classified as baseline failures.
- `npx playwright test --config tests/bucket-a-rendered-repair-playwright.config.ts` (separate stage, 3600s cap) → **11 passed, 4 failed**: issue-1477 header screenshot 4% delta, gallery missing video, two auto-promotion strict locator collisions. Identical base failures not proven; no out-of-scope edits made.
- `git diff --check` → PASS. Electron slice tests rewrote five tracked image artifacts outside scope; restored exact `HEAD` bytes for only those generated images and confirmed none remain in status. No live port or server-dependent test was run; synthetic browser fixture Vite servers only.

### Handoff

**BLOCKED** for final PR verification: default and bucket-A full stages remain red without exact base comparison; one manager-owned Astra rerun has not been performed in this specialist session. Do not label those failures baseline by inference. Packaged #1552 smoke remains manual not_tested. Scoped rail/contract, E20, E16, and session-opening gates pass; preserve the cleanly scoped diff for manager verification.

## Repair 3 (2026-09-24, AJ-revalidated)

### Defects repaired

- D1: `SessionRail` now keeps a per-mount set of selection-opened project ids. The selected session's group opens even when its stored value is `false`, without rewriting storage; an explicit toggle consumes that override and persists normally. Other stored project values remain authoritative.
- D2: criterion 2 again reads, “The group containing the currently selected session is expanded on load.” The browser contract now requires that behavior after document reload and persistent-profile relaunch while confirming storage remains `false`; it also covers a non-selected group whose stored `false` remains collapsed.
- D3: the current source has zero `setCollapsedProjects` references, confirmed by the recursive grep below, and web typecheck exits 0.
- D4: malformed JSON coverage is restored alongside the separate throwing `getItem`/`setItem` coverage. The malformed case requires all non-selected groups collapsed, the selected group open, no throw, and no implicit storage rewrite.

### Files

- `apps/web/src/components/SessionRail.tsx` — per-mount selection override and explicit-toggle handling.
- `apps/web/tests/contract/issue-1558-collapsed-projects.spec.ts` — corrected reload/relaunch expectations, complementary non-selected `false`, and corrupt-JSON case.
- `docs/ai/contracts/issue-1558.json` — original criterion 2 wording restored.
- `docs/ai/runs/2026-09-21-issue-1558-collapsed-projects.md` — this Repair 3 record.

### Commands and observed results

- Repo root: `pwd && git rev-parse --abbrev-ref HEAD && git rev-parse --short HEAD` → `/private/tmp/rhythm-swarm-pr1577`, `swarm/pr-1577-integration`, `37d1bef8`.
- Impact: `gitnexus impact SessionRail --direction upstream --repo /Users/ajhochhalter/Documents/Rhythm/.mega-wt/integration --file apps/web/src/components/SessionRail.tsx --include-tests` → LOW risk; 3 direct dependants, 8 impacted symbols, 0 affected processes, 2 modules. The current temporary root is not registered in GitNexus, so the existing integration index was used read-only.
- Contract execution before implementation: `npx playwright test tests/contract/issue-1558-collapsed-projects.spec.ts --workers=1` → exit 1 before 0 tests ran: `Error: listen EPERM: operation not permitted 127.0.0.1:4173`; `Process from config.webServer was not able to start. Exit code: 1`.
- Typecheck: `npm run typecheck` → exit 0; `tsc -b`, 0 TypeScript errors.
- Requested literal stale-reference command: `grep -n setCollapsedProjects src` → exit 2 with `grep: src: Is a directory` because this grep does not recurse by default.
- Recursive D3 check: `grep -R -n setCollapsedProjects src` → exit 1 with no output, meaning 0 matches.
- Contract execution after implementation: `npx playwright test tests/contract/issue-1558-collapsed-projects.spec.ts --workers=1` → exit 1 before 0 tests ran with the same `listen EPERM` at `127.0.0.1:4173`.
- Static contract discovery: `npx playwright test tests/contract/issue-1558-collapsed-projects.spec.ts --workers=1 --list` → exit 0; 9 tests in 1 file.
- Contract JSON parse: `node -e "JSON.parse(require('node:fs').readFileSync('../../docs/ai/contracts/issue-1558.json', 'utf8'))"` → exit 0.
- Whitespace gate before this appended record: `git diff --check` → exit 0.
- Dev Dashboard publish: `node /Users/ajhochhalter/Documents/dev-dashboard/publish-to-rhythm.mjs run '{"agent":"codex","session":"swarm/pr-1577-integration","task":"Rhythm: repair #1558 selected project collapse persistence","status":"repairing","note":"typecheck pass; focused Playwright blocked by sandbox listen EPERM"}'` → exit 1: `getaddrinfo ENOTFOUND api.vcrcapps.com`.

### Not done

- No Playwright assertion executed because this sandbox prohibits the configured fixture server from listening. The orchestrator must rerun the exact focused Playwright command outside the sandbox.
- No live, packaged, Electron, Flutter, api_server, opencode-engine, or `RHYTHM_LIVE_E2E` verification was run, per the repair constraints.
- No package installation or dependency/manifest/lockfile change was made. No commit, stash, reset, checkout, push, or merge was performed.
- The Dev Dashboard run entry was not published because DNS/network access to `api.vcrcapps.com` was unavailable.
