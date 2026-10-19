---
date: 2026-10-19
repo: rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: [1598]
status: p0-unqualified
tags: [run, rhythm, playwright]
---

## Files

- `docs/ai/plans/2026-10-19-feature-test-inventory.md`: 67 feature groups, seven P0, 53 P1, seven P2. Claims were grouped from 628 source commits, 14 merged PR bodies across consolidation lineages, and committed run records. P1/P2 implementation remains paused at the requested inventory checkpoint.
- `apps/web/tests/packaged/packaged-{tasks,sessions,session-project-scope,conversation,navigation,rhythm-primary-chat,coordinator-multi-run,approval-expiry}.spec.ts`: 33 P0 cases in eight feature specs, including explicit failing UNVERIFIED cases. No product source fixes.
- `feature-test.ts`, `primary-read.ts`: real service readback, exact nonce-owned cleanup, read-only DB checks, existing-owner primary prequalification, real engine revision check and per-test log audit.
- Packaged config discovers all feature specs. The reused CDP fixture refuses a wrong API/engine revision before launch. Legacy smoke writes use the same cleanup ledger and its model case requires opt-in.
- Seven sanitized recon records under `docs/testing/results/recon-<P0-feature>.md`; these specifically requested documents are force-added despite the general generated-results ignore rule. No auth headers, private collection payloads, screenshots, raw logs, full prompts or database dumps are committed.

## Checks

### Source and local build

- Mega source head: `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`; local `main`: `4f915540f700bbb403728ef8e01e0b5e02baf94f`.
- Worktree: `/private/tmp/rhythm-feature-playwright-2026-10-19`, branch `test/feature-playwright-2026-10-19`. Original checkout dirt preserved. No push, PR, merge, GitHub build, installed-app replacement or product-source edit.
- User corrected target to mega source, explicitly authorized a local build and later authorized `RHYTHM_FEATURE_MODEL=1` for P0 model/quota tests. The preliminary old-installed-build probe is superseded and is not feature evidence.
- Local package: `node /private/tmp/rhythm-feature-build-launcher.mjs`, spawning `node apps/electron/scripts/package-mac.mjs`. Successful invocation exited 0 under built-in `ensureBuildGuard`, version `0.18.83`. Environment: `RELEASE_VERSION=0.18.83`, `npm_config_ignore_scripts=true`, public `GOOGLE_DESKTOP_CLIENT_ID` from existing build config (value not recorded), exact-validated `RHYTHM_HERMES_DESKTOP_ARTIFACT_DIR=/Applications/Rhythm.app/Contents/Resources/hermes-desktop`, `RHYTHM_COLONY_ARTIFACT_DIR=/Applications/Rhythm.app/Contents/Resources/colony-desktop`, `RHYTHM_DAYFLOW_APP_DIR=/Applications/Rhythm.app/Contents/Resources/dayflow-desktop/Dayflow.app`.
- The installed app supplied only validated pinned companion build inputs and the public desktop client ID, never the product executable or test target. Hermes source pin `13ade178…`, Colony `2bb12c46…`, Node `22.23.0`. The packager rebuilt current fork, renderer, API and MCP. Target: `apps/electron/dist/Rhythm.app` in this worktree.
- Initial package attempt failed because fork app could not find `vite`; linked matching dependency stores. Never installed through symlinked node_modules. Second package attempt exited 74 when npm lifecycle native rebuild created an external node-gyp Python symlink in a registered output; detached install scripts were disabled for the successful attempt. Packager's native better-sqlite3, node-pty and node:sqlite probes passed. Only generated node-pty spawn-helper executable bits were restored, followed by a second signature pass. No product implementation was changed for these build-environment issues.
- Local signing (twice, second after generated mode fix): `env RHYTHM_SIGN_ONLY=1 APPLE_TEAM_ID=56Q69NYP9H APPLE_SIGNING_IDENTITY=CF6C1EF1525E70E6E3324388A322938977779DB7 python3 tools/build/guard.py --repo . -- node apps/electron/scripts/sign-and-notarize-mac.mjs` → exit 0; deep strict codesign verification → exit 0. Sign-only is unnotarized; no upload. Final guard peak 2,088,354,185 bytes, below shared 10 GiB. The two retained guard receipts are signing runs; successful package numeric peak was overwritten, not invented. Build tool output was captured in the build lane tool transcript; no separate build log file exists.
- Embedded API `build-identity.json` is `{schemaVersion:1,sourceRevision:"894c16f44d30c77dc25d41e7d9a57a644b6ffcfa"}`. Bundled engine `--version` and live `/global/health.version` both equal `0.0.0-rhythm-894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`.
- Native Dayflow optional host layout was not supplied; that host was omitted. The signed Dayflow companion is present. This does not qualify native Dayflow/Hermes/Colony or phone/physical behavior.

### Captured verification

- `cd apps/web && ./node_modules/.bin/tsc --noEmit --strict --module esnext --moduleResolution bundler --target es2022 --skipLibCheck --types node tests/packaged/*.ts` → exit 0 after the final test edits.
- `npm run build:guard -- ai-workflow checks --level issue` → exit 0: Flutter analyze, Dart format, API tsc and MCP tsc all succeeded. No Flutter source changed.
- `npm run build:guard -- npm --prefix apps/web run typecheck` → exit 0 after final edits.
- `cd apps/web && npm run test:dist-smoke` → exit 0: `dist smoke passed: index and 2 relative assets verified`.
- `git diff --check` → exit 0. The local packager already built the fork, renderer, API and MCP as recorded above; product source has not changed since that build.
- Live read-only readiness: API `/health` returned `status:ok`; API `/opencode/health` returned `status:ready,bridgeLive:true`; engine `/global/health` returned healthy with the exact mega version. Port 4002 has no asserted HTTP health route; an ad-hoc `/health` probe there returned 404 and is not a product failure/readiness claim.

### Runtime commands and results

All commands ran from `apps/web` with:
`RHYTHM_PACKAGED_APP=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app RHYTHM_FEATURE_MODEL=1`.
JSON output names below were supplied with `PLAYWRIGHT_JSON_OUTPUT_NAME`; logs/reports remain private local files and are not committed.

1. Fresh read-only mega recon: temporary `recon-playwright.config.ts` → 1 finished, 42.7 s, no renderer errors. Hosted Tasks GET 200 array; local sessions GET 200 object; signed approvals GET 200. Temporary recon files were removed after codification.
2. Focused real-model recon → 1 finished, 50.7 s. UI/API/engine agreed on one prompt and `91`; owned local/SDK session deleted. Original main assertion alone subsequently passed in 40.8 s. Raw model recon includes private system/context material and must not be committed.
3. `./node_modules/.bin/playwright test -c tests/packaged/packaged-playwright.config.ts --grep '\[P0\]' --reporter=line,json` → **11 passed, 20 failed, zero skipped**, 9.2 min, exit 1. Report `/private/tmp/rhythm-feature-p0-run.json`, log `.log` at the same stem.
4. Same command with explicit files `packaged-conversation.spec.ts packaged-navigation.spec.ts packaged-session-project-scope.spec.ts packaged-sessions.spec.ts packaged-tasks.spec.ts` → **10 passed, 9 failed, zero skipped**, 6.3 min, exit 1. Report `/private/tmp/rhythm-feature-p0-focused.json` and matching log. This followed corrections to confirmed fixture/transcription errors below.
5. Same config with files `packaged-conversation.spec.ts packaged-session-project-scope.spec.ts packaged-sessions.spec.ts packaged-tasks.spec.ts` and `--grep 'cancel stops|session project scope|\[P0\] sessions:|failed create retains|empty-account first-use' --reporter=line,json` → **1 passed, 9 failed, zero skipped**, 4.8 min, exit 1. Report `/private/tmp/rhythm-feature-p0-final-cases.json` and matching log. This confirms valid-cwd validation/retry, long Unicode names, mid-stream rendering before cancel, project preference cleanup and task retry readback before the failing UI assertion.

The following is the **latest result per test across those runs**, not a claim that one final 33-case invocation passed. There are **33 P0 cases: 10 passed, 10 failed on product/log behavior, 13 UNVERIFIED**. All finished runs report zero skips/flaky cases. No final case has an unexplained response timeout or cleanup failure.

| P0 family | Passed | Product/log failure | UNVERIFIED | Observed boundary |
|---|---:|---:|---:|---|
| Tasks | 4 | 1 | 1 | CRUD, validation, double submit and long-name/delete-cancel pass; retry creates a persisted row but leaves error UI; empty tenant unavailable |
| Sessions, including owned project scope | 1 | 5 | 1 | Project binding/hydrated reload/preferences pass; five ordinary-session cases reach their behavioral assertions but fail log audit; child paging unavailable |
| Conversation | 0 | 4 | 1 | Real answers, canonical ordering/isolation, visible output while engine busy and cancellation assertions succeed; invalid branch-request ERROR keeps cases red; reconnect/older pages unavailable |
| Navigation | 3 | 0 | 0 | Actual content, hash/reload, narrow More and failed-read recovery pass |
| Primary chat | 0 | 0 | 5 | Three existing-root checks fail safely on missing directory; first-use and scoped journal writes need disposable profile |
| Coordinator multi-run | 0 | 0 | 4 | Existing-run check has the same unavailable root; starts/Stop/restart need disposable journal/repositories |
| Approval expiry | 2 | 0 | 1 | Signed cards and refresh retention/recovery pass; controlled expiry/denial/history unavailable |

### Product failures to repair separately (no product fixes in this branch)

**P1 — successful task retry leaves the collection on its error screen.**
Failing test: `packaged-tasks.spec.ts`, `tasks: failed create retains the draft and can be retried`.
Expected: after one injected create 503, retry creates one task and restores a usable list with that row.
Observed twice: retry POST returns 201, final exact-ID GET returns 200 with the owned title, and the UI announces “added”; the page still displays `503 Retryable server error / Unable to load tasks`, hiding the created row. Finally deletes that exact task and verifies 404/zero nonce rows.
Source: `apps/web/src/pages/tasks/index.tsx`, `recordError` sets the whole surface to server-error; create success appends data/closes the dialog but does not restore the ready surface. The live-parity implementation is `246e8e7b17` (“live parity through Phase 4”); inventory Tasks claims are preserved by #1509 / `f685d7d7c4` and `5faab58996`. These lines predate the mega delta: this is an existing defect still present at the tested head, not proof that mega introduced a regression. Follow-up: restore the recovered surface after success and keep this real API/UI test.

**P2 — Advanced requests branches with an empty project ID.**
Failing tests: the four conversation cases and five ordinary-session cases, through the shared strict log audit (the specific trigger depends on the current unassigned selection).
Expected: creating a session in an owned temporary cwd without a project must not issue an invalid project request or log an ERROR.
Observed repeatedly: `GET /projects//branches` → NOT_FOUND / `Project not found`. Session creation and the API/DB/engine/UI outcome can still succeed; the required no-unexpected-ERROR audit correctly fails.
Source: `apps/web/src/components/SessionRail.tsx:382`, `branches(advancedContextProject?.id ?? selected.projectId)` can receive an empty string. Live branch UI originated in `63274b463f`; the current line is already present in main `4f915540f7`. Session feature claims are #1556 / `58409f4f46` and #1558 / `10e52a88d3`, superseded for selected-group reload by `2a9855d4c2`. This is also a preserved baseline defect, not a newly proved mega regression. Follow-up: avoid branch requests without a current project and retain an unassigned-cwd live case.

**Configuration qualification failure, not classified as a product regression:** during long-name confirmation the local background SyncOrchestrator also logged missing Google and PCO server OAuth configuration. No credentials/settings/integrations were changed and these ERROR lines were not allowlisted. The final long-name case's UI/API/read-only DB assertions succeeded, but its log gate remains red.

### UNVERIFIED contracts

Nine deliberately failing gap tests require: an empty signed-in Tasks tenant; nonce-owned child/ancestor pages; controlled disconnect and older transcript pages; disposable first-use primary/profile-choice and scoped-message journal; two disposable coding repositories and primary journal for concurrent starts/confinement/reports; deterministic needs-you/Stop; full owned restart; and controlled one-hour signed expiry/denial/no-consumption/history. The other four UNVERIFIED results are existing-primary/run inspections stopped by the actual missing canonical project directory. No goal, primary message, approval decision or replacement root was created to bypass this boundary.

### Fixture repairs and interrupted attempts

Earlier attempts are not final product evidence. An initial 26-case run was interrupted by the agent while a model reply was pending; the initial teardown diagnosis was wrong and no teardown change followed. Another run was stopped for confirmed fixture errors. A subsequent 28-case attempt hit the busy-port guard on the orphaned engine from that interrupted run; its executable/cwd and health SHA proved it was this local candidate before it was terminated. The complete 31-case run above was allowed to finish.

After the user noted an apparent hang, read-only CDP recon showed Advanced Start disabled because profile selection was empty. The test had inherited the long model timeout. Final fixtures explicitly choose an eligible existing profile, supply a valid owned cwd, clear a retained branch even when reusing the same cwd, and cap action waits at 15 seconds. Response waits are 20 seconds with handled orphan promises. Other confirmed test errors repaired from recon/source records were: expecting a transcript element for an empty conversation; assuming tokenless `/auth/me` supplied the signed-in actor; ambiguous Agents workspace selectors; reading a filtered Tasks collection with a different query; same-hash caching without a new GET; checking durable engine text before the streamed token persisted; and using the old #1558 collapse expectation instead of its latest Repair 3 contract. Product assertions were not weakened to hide the two failures above.

### Cleanup and final boundaries

- Each finished test's finally cleanup verifies exact nonce ownership, deletion and zero remaining nonce list entries. The combined reports contain zero cleanup failures. Final read-only SQLite checks found zero rows for the run's session prefixes and zero `[smoke] project-scope` projects.
- Final listener check: no process listening on 4001, 4096 or 4002. The fixture stopped the candidate after the last run. Only an earlier, positively identified owned orphan needed explicit termination.
- The final project spec removes only its deleted project's preference keys and preserves pre-existing project choices. Earlier probe layout keys were not snapshotted, so complete restoration of layout state from those probes is not asserted; unknown keys are not deleted.
- P0 qualification remains failed. Full monorepo `ai-workflow checks --level pr` was not run and no overall verification-gate PASS, merge/release readiness or native/device qualification is claimed. P1/P2 implementation remains at the inventory checkpoint.

## Notes

### Evidence boundaries and safety

- Tasks runs the new mega renderer against the current hosted production Tasks service, which is not a deployment of this branch. Local session/engine outcomes do exercise newly built mega backend code. Do not conflate them.
- Every created task/session is named `[smoke] <feature> <8-char nonce>` and deleted in fixture `finally`, with exact-name ownership verification, list fallback for lost acknowledgements, readback 404 and zero remaining nonce-owned rows. Sessions additionally use read-only local DB assertions and engine identity deletion. No existing non-smoke record is mutated or deleted. No message/email/invite sent to people; no integration/account/server setting changed.
- Read-only primary tests first verify a unique existing owner root without invoking `/resolve`; `/setup` is blocked. Existing root inspection only; no goal sent into the real primary.
- Deliberate UNVERIFIED failures: first-use primary/profile choice; actual concurrent coding starts/confinement/reports; needs-you/Stop; full restart; controlled one-hour signed expiry/denial/history. Fixed root names and permanent journals/approvals have no safe real-profile deletion route. These need a wholly disposable signed-in database/profile and native signer. Model permission does not waive data safety.
- Owned project-group persistence, long session names and real busy-turn streaming/cancellation were exercised. Child paging, reconnect and long-history cursor boundaries remain explicit failing tests.
- GitNexus impact was attempted for existing packaged launch/test symbols and new test helpers; the index cannot resolve these test symbols (risk UNKNOWN). `detect-changes --scope compare --base-ref main` reports the entire mega delta (1,425 files/5,312 symbols, zero indexed processes, low), while warning the index is 249 commits stale and rooted at the original checkout. This is not a fresh impact qualification of the new tests. Production source is unchanged. Final `gitnexus detect-changes --repo Rhythm --scope staged --limit 5` returned “No changes detected” with the same wrong-checkout/stale-index warning; this is not proof about this worktree. Manual staged-path review confirmed exactly 23 test/docs files and no product-source or generated-binary changes.
- Full repository PR gate has not been claimed. Required P0 flows include intentional failing gaps, so no overall verification-gate PASS or feature-complete claim is appropriate.
