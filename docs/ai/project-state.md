# Project State

## Current focus

2026-07-31: the mobile Agents parity follow-up is implemented on the stacked
rollup branch. Search is the only permanent Chats control; all other Agents
navigation and filters live in the top-right menu. Exact-owner desktop human
sessions now appear in Chats (including NULL-project All Sessions rows), the
Review Queue and Gallery use their desktop data, large Tools catalogs share
search/group/sort controls, and paired mobile creation applies profile model,
MCP, skill, and core-permission scope before the first turn. Projectless rows
are openable using the owner-authoritative desktop `cwd`, transcript loading is
bounded, and the overflow menu scrolls within the device safe area. Integrated proof:
[runs/2026-07-31-issue-1285-1286-integrated-verification.md](runs/2026-07-31-issue-1285-1286-integrated-verification.md).

## Active branch / PR

- Branch: `codex/mobile-fixes-rollup`
- Base: `origin/codex/fix-session-isolation-runtime-performance`
- PR: [#1284](https://github.com/ajhochy/Rhythm/pull/1284) (draft)
- Merge remains a manual human action after review and physical-device smoke.

## In progress

- Publish the corrective device-smoke fixes to draft PR #1284 and watch CI.
- Relaunch the exact PR desktop/mobile builds and repeat physical-iPhone smoke.

## Risks / known issues

- Issue #1280 still needs the signed physical-iPhone multiline composer smoke:
  growth, shrink-on-delete, paste, and scrolling beyond the 132-point cap.
- The new Agents/Tools evidence is browser-rendered at a 390x844 mobile
  viewport. The unplugged physical iPhone was deliberately not reloaded.
- Initial aggregate verification exposed two non-reproducible shared-state /
  timing failures. Both exact files passed in isolation, both full failed
  commands passed independently, and the complete PR matrix passed on rerun.
- GitHub Mobile CI exposed a production refresh race in the shared session
  configuration sheet: live profile/preferences updates could clear a typed
  title while the sheet stayed open. Initialization is now limited to the
  closed-to-open transition, with focused component coverage.
- The PR is intentionally stacked on the session-isolation branch; comparing
  the inherited integration base to `main` is broad and is not this PR's
  review scope.
- The first physical-device pass exposed an 8.95 MB transcript exceeding the
  gateway response cap and a non-scrolling overflow menu. Both are repaired;
  the corrected native build still needs a human re-smoke.

## Test status

- `ai-workflow checks --level issue`: passed all four configured checks.
- `ai-workflow checks --level pr`: passed every Flutter, API, MCP, fork, and
  mobile stage on the combined branch.
- Full serial API: 3,788 passed / 122 skipped / 0 failed.
- Fork session suite: 383 passed / 4 skipped / 1 todo / 0 failed.
- Fresh isolated live rollup suite: 5 files / 5 behaviors passed.
- Fresh mobile↔desktop parity sandbox: 14/14 feeds matched.
- Health probes: `/health`, `/opencode/health`, `/agents/capabilities`, and
  `/mobile-gateway/health` returned HTTP 200.
- Agents proof: `.proof/i1235/ui/agents-tab.png` (30,624 bytes), visible and
  nonblank with the three-dot header.
- Shared-sheet refresh repair: focused component regression passed; native
  Jest passed 7/7; full mobile foundation passed all 69 browser cases in suite
  order; the complete repository PR matrix passed.
- The current worktree passed the complete local PR matrix; GitHub CI for the
  forthcoming pushed commit remains pending.
- Corrective focused mobile tests passed 3 suites / 4 tests; focused API
  discovery and paging regressions passed; the isolated real API + engine test
  passed projectless exact-owner transcript access and cross-owner HTTP 404.
- GitNexus exact-base change detection: MEDIUM aggregate rollup scope, 70
  files / 167 symbols / 3 existing mobile-gateway flows; no HIGH/CRITICAL
  warning.

## Next step

Push the corrected verified commit to draft PR #1284, watch CI, then repeat issue #1280,
Agents, Chats/Activity, Gallery, Review Queue, and profile-scoped first-turn
checks on a physical iPhone before a human merge.

## Recent coding-agent runs

### 2026-07-31 — issue-1285-c1-c6-agents-overflow-native-warnings
- Files modified: `apps/mobile/app/(tabs)/agents.tsx`, `apps/mobile/components/chat/chat-list.tsx`, and new `chat-list-controller.ts` move workspace, terminal, new chat, project, and lifecycle controls into the compact Agents overflow; `session-configuration-sheet.tsx` and new `components/ui/profile-icon.ts` remove the Fragment action child and normalize server icon tokens; focused chat tests cover the composed behavior.
- Checks run: full #1285 contract PASS (6/6); focused Agents overflow/session-sheet Jest PASS (4/4); targeted ESLint PASS; mobile TypeScript passed before c2 integration, while the final shared-tree rerun is blocked by a concurrently-owned `GlobalSession.status` type error in `session-service.ts`.
- Decisions made: preserved Search as the sole permanent chat control; kept create-sheet/focus state in a shared controller; mapped `settings-suggest` to `cog-outline`, `🩺` to `stethoscope`, desktop asset paths to `robot-outline`, and unknown tokens to `account-outline` after glyph-map validation.
- Deviations from spec: none for c1/c6.
- Concerns: `SessionConfigurationSheet` has a HIGH upstream radius, so its change is deliberately presentation-only; final physical-device Metro reload remains part of parent smoke verification.

### 2026-07-31 — issue-1285-c3-c5-tools-device-parity
- Files modified: `rhythm-tools-service.ts`, new shared `tool-catalog-organizer.ts`, the native Tools screen, and `mobile_tools_routes.ts` now align Review Queue vocabulary, serve authorized paired-Mac Gallery metadata, organize the four large catalogs, and limit Providers & Models to paired Rhythm configuration; focused unit, API, browser, and live tests plus a run log record the behavior.
- Checks run: full #1285 contract PASS (6/6); focused mobile unit PASS (4/4); API route regressions PASS (7/7); focused Playwright PASS (new 2/2 and existing 6/6); mobile lint PASS with 0 errors and 3 pre-existing warnings; mobile typecheck PASS; API build PASS; fork build PASS; isolated live Gallery behavior PASS (1/1); `git diff --check` PASS.
- Decisions made: Gallery list/detail metadata comes from the paired Mac behind Device auth, registered-project validation, and workspace-admin authorization; filesystem paths and artifact bytes remain unavailable. All four large catalogs use one deterministic search/group/sort organizer, and provider entries come only from connected or configured paired-Mac providers with safe model metadata.
- Deviations from spec: none for c3-c5; artifact byte streaming was intentionally not introduced because these criteria require visible Gallery content, not desktop-file transfer.
- Concerns: physical-iPhone visual validation remains part of the parent smoke pass. Agent designs are Mac-global records without per-row owner/project fields, so the mobile route is deliberately restricted to registered projects and workspace admins.

### 2026-07-31 — issue-1285-c2-owner-session-discovery
- Files modified: the mobile chat provider/read model and session service now merge paginated owner-scoped desktop discovery into Chats; the mobile gateway proxy, security shaper, route, and ownership repository expose exact-owner NULL-project human chats and resolve their authoritative desktop directory for transcript access; focused API/mobile and isolated live tests cover the boundary.
- Checks run: full #1285 contract PASS (6/6); focused mobile Jest PASS (1/1); focused API Vitest PASS (2/2); mobile typecheck PASS; API build PASS; fork build/smoke PASS; isolated real API/engine live behavior PASS (1/1); `git diff --check` PASS.
- Decisions made: registered-project chats remain interactive; desktop All Sessions chats with NULL/empty project IDs are openable when the exact owner matches, using only the server-recorded `cwd`; authoritative category/system/scheduled metadata keeps scheduled and optimizer runs in Activity; mutations remain unavailable for the projectless read model.
- Deviations from spec: none for c2.
- Concerns: physical-iPhone validation remains part of the parent smoke pass. A separate read-only #1282 diagnostic found the installed SDK drops `profileId` during mobile session creation; no #1282 production code was changed in this lane.

### 2026-07-31 — issue-1286-mobile-first-turn-profile-scope
- Files modified: paired mobile session creation now uses an authenticated raw gateway request carrying the selected Rhythm profile atomically; the gateway resolves and persists server-authoritative agent, real-fork model, core permissions, MCP allowlist, and skill allowlist before engine creation; focused transport, contract, live capture, recon, and run-log coverage records the behavior.
- Checks run: #1286 fast contract PASS (2/2); #1282/gateway regressions PASS (11/11); mobile paired transport PASS; targeted mobile lint PASS; mobile and API TypeScript/build PASS; isolated real-fork schema recon observed `modelID` 400 versus `id` 200; fresh paired Device API→fork→first-model-request live behavior PASS (4/4); `git diff --check` PASS. GitNexus rated the directly edited proxy symbol LOW; the concurrent shared rollup is MEDIUM (21 files / 72 symbols / 3 existing gateway flows).
- Decisions made: bypassed the SDK v2 create serializer only for paired mobile create because it drops custom `profileId`; stripped every caller-supplied scope field before server resolution; flattened validated profile core permissions into the fork's ordered ruleset; used the fork's observed session model shape `{providerID, id}`. Invalid profiles and malformed stored core-permission state fail closed.
- Deviations from spec: none in product behavior. The generated mocked contract initially encoded the wrong `modelID` key; failure-triage plus assertion-free real-fork recon corrected that codification before the unchanged downstream live capture passed.
- Concerns: this lane's repository-wide issue gate was environment-blocked after API TypeScript passed (external Flutter SDK cache was not writable; MCP `npx` fallback had no npm network). Parent integrated verification and any later physical-iPhone smoke remain required; the phone was disconnected during this run.
