---
date: 2026-08-22
repo: Rhythm
branch: fix/electron-production-acceptance
pr: 1474
issues: [electron-production-acceptance]
status: merged-and-released
tags: [run, Rhythm]
---

## Addendum — real shared-service dogfood, root-cause repair, and AJ acceptance

The section below this one is the prior agent's handoff evidence (contract RED/GREEN, pre-dogfood
checks). This addendum covers the actual dogfood session that followed: launching the repaired
Flutter build to own :4001/:4096, proving the CORS fix live, then launching the repaired Electron
client against those shared services and finding/fixing what was still actually broken.

### Environment blocker (not part of the diff)

The opencode engine failed to boot entirely (`Unrecognized key: reference` in
`~/.config/opencode/opencode.json`) because no bundled fork binary existed for this dev build, so
the api_server fell back to the stock PATH `opencode` (v1.14.40), which predates the `reference`
key that `apps/api_server/src/services/opencode_plugin_config.ts`'s `ensureManagedDefaults()`
writes. Fixed by building the vendored fork (`apps/opencode_fork/packages/opencode`, `bun run build
--single`) and pointing `RHYTHM_OPENCODE_BIN_DIR` at it. No code change; environment-only, with
AJ's explicit approval before editing his global `~/.config/opencode/opencode.json` (backed up
first).

### Root causes found live (CDP + Playwright), beyond the prior agent's diagnosis

1. **Dashboards loaded their static shell but never their data.** `LiveArtifactsShell.tsx`'s
   host-side bridge only implemented `pco.services.read`. Flutter's bridge
   (`live_artifact_bridge.dart`) also implements `state.get` / `state.update`, which is what the
   actual dashboard artifacts call to fetch their data (`window.rhythm.request('state.get', null)`).
   Every such call was rejected `unsupported_method` under Electron/web, silently, while the
   artifact's own already-rendered header/hero (baked into server-rendered HTML) made it look like
   partial data had loaded. A `bad120f1-…` CSP script-load failure in the same artifact turned out
   to be an unrelated, pre-existing broken relative `<script src>` in that one artifact's own stored
   content — a red herring, not touched.
2. **Viewer pane collapsed to near-zero height.** Two nested wrapper `<div>`s had no explicit
   height: the cross-route persistence wrapper added in `App.tsx` (this PR) and the per-artifact-tab
   wrapper in `LiveArtifactsShell.tsx` (also this PR). `.live-artifact-surface`'s `height:100%` had
   nothing definite to resolve against at either level.
3. **Text collision on the plain Dashboard tab** (not an artifact tab) — pre-existing, exposed only
   once (2) was fixed and the container was finally tall enough to reveal it. `.pg-dashboard` was
   `display:grid` with a 3-row `grid-template-rows`, but `LiveDashboardPage` has 4 top-level children
   (an always-visible quick-card banner was added between the toolbar and the scroll area at some
   point) while `FixtureDashboardPage` still has 3. Switched to flexbox so track count doesn't need
   to match child count for either variant.
4. **Consequential a11y regression** surfaced by fix (3): the scrollable `<aside class="page-trace">`
   request-log region had no `tabIndex`, so axe's keyboard-focusable-scroll-region rule failed once
   it was actually visible/scrollable at full height. Added `tabIndex={0}` to both dashboard variants.

None of (1)-(4) required any change to `apps/api_server`'s production-deployed code or a separate
deploy — all four fixes are client bundle (apps/web) changes that ship inside the Electron/Flutter
apps themselves.

### Files changed (this addendum, on top of the prior agent's diff)

- `apps/web/src/pages/dashboard/LiveArtifactsShell.tsx` — bridge `state.get`/`state.update`
  handling, mirroring Flutter's `LiveArtifactBridge._dispatch`; `.artifact-tab-pane` className on
  the per-tab wrapper.
- `apps/web/src/App.tsx` — `.live-artifact-route-pane` className on the cross-route persistence
  wrapper.
- `apps/web/src/pages/dashboard/liveArtifacts.css` — height:100% for both wrapper classes.
- `apps/web/src/pages/dashboard/styles.css` — `.pg-dashboard` grid→flex; `.dashboard-scroll` gets
  `flex: 1 1 auto`.
- `apps/web/src/pages/dashboard/index.tsx` — `tabIndex={0}` on both `<aside className="page-trace">`
  occurrences (Live and Fixture variants).

### Verification

- Live CORS proof (unchanged from prior agent, reconfirmed): `rhythm://app` origin gets
  200/200/204 with exact `Access-Control-Allow-Origin` on API (:4001) and engine (:4096);
  `https://evil.example` gets 403 with no ACAO.
- Playwright attached over CDP (`chromium.connectOverCDP`) to an already-authenticated, normally
  launched Electron instance (never launched fresh via `_electron.launch`, which uses its own throwaway
  profile and would force a real interactive Google sign-in) — confirmed: Dev Dashboard and FFB
  Dashboard both render full data matching the Flutter reference; artifact iframe measured at
  552.75px filling its pane (previously near-zero); tabs survive a Planner→Dashboard round trip;
  Messages and Tasks pages load correctly; Planner defaults to Open with Open/All toggle intact.
- `npm test` in `apps/web` (full suite): 262 passed, 1 failed (`issue-2001-c10`, the axe violation
  from fix 4, on a build that predated the `tabIndex` addition), 4 skipped. Re-ran
  `tests/contract/issue-2001-dashboard.spec.ts` alone after rebuilding with the fix: 12/12 passed.
- `npx tsc --noEmit` in `apps/web`: clean.
- GitNexus `detect_changes(scope: all)`: LOW risk, 7 changed symbols, 0 affected processes.
- AJ live-verified in the actual Electron app (not just Playwright) across two rounds of feedback
  ("dashboards don't load correctly" → fixed; "viewer pane still super short" → fixed) and gave
  final acceptance: "looks right."

### Out-of-scope items filed during this session (not touched here)

- #1475 — Add a "Deferred" column to the Task board (Flutter + Electron).
- #1476 — Electron/web Agents session list: nest child sessions under parent (match Flutter); a
  "SUB AGENTS" group already exists in the sidebar but always shows 0.
- #1477 — Agents session header: title/branch text collides with breadcrumb path — same class of
  bug as fix (3) above, in an unrelated part of the Agents workspace.

### Post-commit independent review and cleanup

Dispatched an independent review agent against the frozen commit `def12c6c` (this addendum's diff).
No critical/high findings — the security-sensitive `state.get`/`state.update` bridge validation and
race-safety were confirmed sound against the Flutter reference contract. Two low-severity findings
fixed in a follow-up commit `ecf6131`:
- Dead `grid-template-rows` left in `.pg-dashboard`'s 520px media query after the grid→flex
  conversion — harmless today, but a landmine for a future narrow-breakpoint change.
- The toolbar's "state revision N" label went stale after an artifact-initiated `state.update`
  (only the bridge's local closure updated, not `tab.detail`). Fixed with a stable
  `useCallback`-memoized `onStateRevisionChange` passed down to patch `tabs` state.

Final HEAD after both commits: `ecf61317e87246ce3058a62441a3b1dcc1112a4`.

### Merge and release

AJ gave explicit approval ("merge + Release") after the review-cleanup commit. Sequence:

1. CI (Desktop/Mobile/Server) green on HEAD `aa68cf31`.
2. Marked PR #1474 ready for review and merged (not squashed) into `main` — merge commit
   `452f5c83d672b0588904ac5833fc8d7200941bd4`.
3. Dispatched `.github/workflows/electron_release.yml` against `main` with
   `version=0.18.61` (incremented from the only existing tag, `electron-v0.18.60`) and
   `prerelease=true`.
4. Build succeeded end-to-end: typecheck, unsigned-package contract tests, signed + notarized,
   post-sign packaged smoke (post-m1-p11-c4), GitHub release published at tag `electron-v0.18.61`.
5. Downloaded the published `Rhythm.zip` from the release and verified independently:
   `codesign --verify --deep --strict` → valid, satisfies designated requirement;
   `spctl --assess --type execute` → accepted, source=Notarized Developer ID;
   `xcrun stapler validate` → notarization ticket present and valid.
6. Confirmed the published bundle's `web/dist` assets actually contain this session's fixes
   (`state.get` bridge method, `artifact-tab-pane` class) rather than a stale cached build.

### Standing rules followed

- Never merged, marked ready, or deployed to production without explicit approval — waited for
  AJ's "looks right" (functional acceptance) and separately for "merge + Release" (merge/publish
  approval) before taking either action.
- Production API (`apps/api_server`) was investigated as a possible fix site and deliberately NOT
  touched once the real (client-side) root cause was found — avoided an unnecessary, riskier
  production deploy for a fix that didn't need one.

## Contract

- Contract: `docs/ai/contracts/task-electron-production-acceptance.json` (7/7 pass).
- RED Flutter: `/Users/ajhochhalter/development/flutter/bin/flutter test test/app/core/server/api_server_environment_test.dart` failed 3 new assertions: absent origin was `null`, explicit origin omitted `rhythm://app`, and messy input remained unnormalized. The no-duplicate assertion already passed because stock HEAD preserved the existing value.
- RED web: `npx playwright test --config tests/post-m1-phase-8-fixture-playwright.config.ts` failed the four new regressions and passed 12 existing tests: restored picker-open showed bridge-only empty `srcdoc`; A's `organization` visibility bled into B; the pane detached on `/planner`; and the new tab disappeared after navigation.
- API baseline: `npx vitest run src/middleware/local_agent_surface_guard.test.ts src/services/opencode_client_service.test.ts` passed 62/62 before implementation. These preservation tests encode already-correct downstream behavior and could not truthfully be RED without contradicting the supplied diagnosis.
- GREEN: Flutter focused 20/20, API focused 62/62, and phase-8 Playwright 16/16.

## Files changed

- `apps/desktop_flutter/lib/app/core/server/api_server_service.dart` — add the exact Electron origin to the normalized inherited allowlist.
- `apps/desktop_flutter/test/app/core/server/api_server_environment_test.dart` — exact-string union/normalization contracts.
- `apps/api_server/src/middleware/local_agent_surface_guard.test.ts` — loopback allow/deny and actual preflight ACAO contract.
- `apps/api_server/src/services/opencode_client_service.test.ts` — exact engine CORS option contract.
- `apps/web/src/App.tsx` — keep only the live artifact workspace mounted across routes.
- `apps/web/src/pages/dashboard/LiveArtifactsShell.tsx` — load restored tabs, sync auth state after PATCH, select through the lazy-load guard, and retain one keyed pane per UUID.
- `apps/web/tests/post-m1-phase-8-live-artifacts.redspec.ts` — restore/content, identity/isolation, mounted-navigation, and persistence regressions.
- `docs/ai/contracts/task-electron-production-acceptance.json` — executable acceptance contract.
- `docs/ai/runs/2026-08-22-electron-production-acceptance.md` — this evidence.

## Checks run

- `dart format . --set-exit-if-changed` (absolute SDK path used): first run formatted one touched test and exited nonzero as designed; second run was clean.
- `flutter analyze --no-fatal-infos`: exit 0 with 311 pre-existing info diagnostics.
- `flutter test test/app/core/server/api_server_environment_test.dart`: 20 passed.
- `node_modules/.bin/tsc --noEmit`: pass in `apps/api_server`.
- `npx vitest run src/middleware/local_agent_surface_guard.test.ts src/services/opencode_client_service.test.ts`: 2 files, 62 passed.
- `npm run typecheck`: pass in `apps/web`.
- `npx playwright test --config tests/post-m1-phase-8-fixture-playwright.config.ts`: 16 passed.
- `npx playwright test --config tests/bucket-a-rendered-repair-playwright.config.ts`: 5 passed.
- `npm test` in `apps/electron`: 43 passed, 3 Keychain tests skipped, 0 failed.
- `git diff --check`: pass.
- GitNexus pre-edit impact: LOW for `buildApiServerEnvironment`, `LiveArtifactsShell`, `LiveArtifactsWorkspace`, and `LiveArtifactSurface`; `App` was not resolved by the index.
- GitNexus `detect_changes(scope: all)`: LOW, 6 indexed changed symbols, 0 affected processes.

## Notes

- No diagnosis, sandbox, package rebuild, live dogfood, commit, push, or PR action was performed, per dispatch.
- Security invariants remain unchanged: iframe sandbox is still exactly `allow-scripts`; source-window, 32-hex document token, one-handshake, MessagePort, and frame-generation checks were not loosened.
- Electron tests rewrote `docs/ai/runs/evidence/electron-m1-shell.png`; it was restored byte-for-byte from HEAD and is not part of the diff.
- Deviation: the API downstream/security tests were GREEN on stock HEAD because those implementations were already correct, matching the supplied root-cause diagnosis. Product RED evidence came from the Flutter origin producer and all four web defects.
- No finding contradicted the supplied root-cause diagnosis.
