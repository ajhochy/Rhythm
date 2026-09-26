---
date: 2026-09-19
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [1516, 1518]
status: local-verified-hosted-pending
tags: [run, Rhythm]
---

# Hosted Messages and Automations write coverage

## Decisions

- Keep hosted Messages smoke self-only: create a uniquely marked group thread containing only the authenticated user, read it back in API and UI, and delete it. It never posts a message or invites another user. This leaves message sending unverified rather than sending to a real account.
- Add `DELETE /message-threads/:id` only for the thread creator. A positive safe-integer guard rejects malformed IDs before SQL; a single `DELETE ... WHERE id = ? AND created_by = ?` gives the same 404 for absent or foreign threads. Existing SQLite and Postgres foreign keys cascade thread participants, read markers, and messages. No migration or broad participant delete permission is needed.
- Automation POST already honors `enabled:false` in the controller and both repositories. Its first persisted state is paused, so the smoke uses that API capability and verifies UI read-back. No enabled-then-paused interval is permitted, and no automation implementation was duplicated.
- An older hosted API lacks Messages DELETE. CORS answers OPTIONS before route matching, so the smoke probes with a creator-scoped DELETE against absent negative ID `-2147483648`, after confirming it is not in the authenticated user's thread list. Only the new route's exact JSON `NOT_FOUND / MessageThread not found` permits creation. An old route produces a different 404 and skips before creating a thread. The automation smoke similarly probes the existing DELETE route with an absent zero UUID before creating a paused rule.
- Page-level API writes in the live suite are blocked before network unless they create a row named for this invocation or DELETE an exact URL returned from a marked create/cleanup lookup. This prevents read-only selection tests from accidentally mutating an existing row, blocks PATCH/PUT and message sends, and avoids cross-domain numeric ID collisions. Cleanup still matches this invocation's marker, not previous runs. The credentialed Playwright config disables trace, screenshots, video and retained test output.
- The additional `RHYTHM_LIVE_E2E` gate runs only against a fresh canonical synthetic sandbox on local 4198/4197/4199. It creates a two-user thread and one synthetic message inside that sandbox to prove the message, participant, and read-marker cascades; the hosted smoke remains self-only and sends no messages. The gate also reads the paused rule's first persisted state and checks foreign-user denial before owner cleanup.
- The browser-origin `:4175` hosted smoke cannot load through the actual local/hosted CORS allowlists. A separate opt-in Electron transport now attaches over loopback CDP to the parent-owned packaged Rhythm process and reuses its already-authenticated `rhythm://app/index.html` page. The fixture requires an owned disposable userData path, its matching `DevToolsActivePort`, the exact current-worktree candidate PID/executable, and preload gateway URLs matching the test's endpoints. It restores the original hash route after the worker and does not override the native page's media preferences. It never launches or closes the app, injects a renderer bearer, proxies responses, or weakens browser security. The process bearer remains only in Playwright's direct `APIRequest` calls. Only hosted platform-applicable tests are selected in this config; browser-only assertions remain in the original 34-test configuration.
- The candidate may be launched from the package directory with a relative command. The attach guard checks the process UID through `ps` and the primary executable mapped by `lsof -d txt` against the exact current-worktree binary; it does not infer executable identity from argv0. The existing PID, CDP listener, userData, port-file, and preload gateway checks remain required.

## Files

- `apps/api_server/src/routes/messages_routes.ts`, `controllers/messages_controller.ts`, `repositories/messages_repository.ts`: creator-scoped thread delete and 204/404 contract.
- `apps/api_server/src/__tests__/hosted_write_gaps.test.ts`: real HTTP, in-memory SQLite owner/participant denial, cascade, route probe, and atomic paused automation persistence/read-back.
- `apps/api_server/src/__tests__/hosted_write_gaps_live_e2e.test.ts`: opt-in, real-running API/engine synthetic sandbox behavioral gate with fail-closed port/path checks.
- `apps/web/tests/live/mega-2026-09-18-smoke.spec.ts`: guarded hosted write/read-back/delete cycles, old-deployment preflight, and marked thread cleanup.
- `apps/web/tests/helpers/mega-smoke-ownership.ts`, `apps/web/tests/mega-smoke-ownership.spec.ts`, `apps/web/tests/live-smoke-playwright.config.ts`: pre-send write allowlist, focused safety cases, and no credentialed browser artifacts.
- `apps/web/tests/live/electron-native-test.ts`, `apps/web/tests/live/electron-native-attach.spec.ts`, `apps/web/tests/electron-native-attach-playwright.config.ts`, `apps/web/tests/live-electron-playwright.config.ts`, and the live spec: attach-only native page fixture, process identity regression, hosted test selection, hash navigation, and removal of the write route/request listeners after every test. Native config disables traces, screenshots, video, CSP bypass, and retained output.

## Checks

- Red first: `cd apps/api_server && npx vitest run src/__tests__/hosted_write_gaps.test.ts --reporter=verbose` yielded 1 failed / 1 passed; creator DELETE returned 404 rather than 204. The paused automation create/read-back test passed without source changes.
- Green after implementation: the same focused API file passed 2/2 (including owner deletion/read-back for both resources). With neighboring `auth_and_messaging.test.ts` and `automation_rules_controller.test.ts`, 14/14 passed.
- `cd apps/api_server && npm run build` passed after the final controller guard.
- `cd apps/web && npm run typecheck` passed after the live config and page-write guard changes. `npx playwright test tests/mega-smoke-ownership.spec.ts --reporter=line --workers=1` passed 3/3. Live spec collection listed 34 tests without launching a service.
- The new live E2E test is skipped by default (1 skipped); the API build passes with it included. A fresh synthetic fixture was generated at `/private/tmp/rhythm-hosted-write-fixture-20260919-primitive`. The exact hosted browser smoke remains unrun by this agent. Before the controller guard, SQLite already returned 404 for malformed ID because it binds NaN as null; the explicit guard prevents a Postgres cast error and is not claimed as a separately red SQLite test.
- Full API unit run: `cd apps/api_server && npm test` finished with 6,179 passed, 3 failed, 251 skipped (log `.proof/2026-09-19-hosted-write-api-full.log`). The failures were outside this change: `issue_1186_sandbox_foreground` timed out waiting for an output line after 5 seconds, `org_proposals_routes` hit a 15-second setup hook timeout, and `pr_1489_harness_race_repair` saw 3 waits rather than its required 6 under the concurrent run. Separate unchanged-file reruns passed 7/7, 27/27, and 13/13 respectively; logs are `.proof/2026-09-19-hosted-write-api-{issue1186,org-proposals,pr1489}-rerun.log`. The full invocation is still recorded as failed, not relabeled green.
- Real synthetic sandbox gate: `tools/dev/sandbox.sh up --foreground` with the approved fixture and ports API 4198, engine 4197, gateway 4199 became ready. `tools/dev/sandbox.sh status` showed API PID 37373, engine PID 37547, and gateway PID 37373. The exact opt-in Vitest command below passed 1/1 in 96 ms, exercising HTTP through the running API plus ready engine and SQLite cascade/readback. `tools/dev/sandbox.sh down` removed that sandbox; the foreground holder exited 0. Output is `.proof/2026-09-19-hosted-write-sandbox-live.log`. An initial detached `up` reported ready but its processes exited with its command session; its owned runtime was removed with `down` before the foreground retry. Both teardowns preserved only sanitized diagnostics under sibling `.evidence.*` directories.
- Native transport was validated statically only: `cd apps/web && npm run typecheck` passed; `RHYTHM_LIVE_ELECTRON_TRANSPORT=1 RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_TOKEN=synthetic-discovery-only npx playwright test --config tests/live-electron-playwright.config.ts --list` selected exactly 12 hosted/platform-applicable tests. The original browser config still discovers 34 tests. No native app or hosted browser test was launched by this agent for the new mode. GitNexus pre-edit impact for the existing `openLive` and `recordPageWrites` helpers was LOW (zero indexed dependents/processes/modules); the index omits their in-file test call sites, which were reviewed directly.
- Candidate executable identity regression, red first: `cd apps/web && npx playwright test --config tests/electron-native-attach-playwright.config.ts` yielded 1 failed / 2 passed because the exact packaged executable with a relative argv0 was rejected. After replacing the argv0 check with the primary `lsof txt` path, the expanded focused suite passed 4/4, covering relative argv0, wrong executable, a secondary mapped candidate path, and wrong UID. `npm run typecheck` and `git diff --check` passed; native live behavior remains unrun by this agent. GitNexus impact for `ownedCandidate` returned UNKNOWN because the new fixture is unindexed; its direct use was reviewed.

```bash
RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-hosted-write-fixture-20260919-primitive \
RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-hosted-write-fixture-20260919-primitive/rhythm.db \
RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-hosted-write-fixture-20260919-primitive/opencode.json \
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-hosted-write-20260919-primitive \
RHYTHM_SANDBOX_API_PORT=4198 RHYTHM_SANDBOX_ENGINE_PORT=4197 RHYTHM_SANDBOX_GATEWAY_PORT=4199 \
RHYTHM_OPTIMIZER_MODE=shadow tools/dev/sandbox.sh up --foreground
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-hosted-write-20260919-primitive \
RHYTHM_SANDBOX_API_PORT=4198 RHYTHM_SANDBOX_ENGINE_PORT=4197 RHYTHM_SANDBOX_GATEWAY_PORT=4199 \
tools/dev/sandbox.sh status
cd apps/api_server
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_API_URL=http://127.0.0.1:4198 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4197 \
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-hosted-write-20260919-primitive \
DB_PATH=/private/tmp/rhythm-hosted-write-20260919-primitive/rhythm.db \
npx vitest run src/__tests__/hosted_write_gaps_live_e2e.test.ts --reporter=verbose
cd ../..
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-hosted-write-20260919-primitive \
RHYTHM_SANDBOX_API_PORT=4198 RHYTHM_SANDBOX_ENGINE_PORT=4197 RHYTHM_SANDBOX_GATEWAY_PORT=4199 \
tools/dev/sandbox.sh down
```

## Remaining gate

The new DELETE route is not yet on the hosted API. The parent operator owns the bearer, deployed-version check, live command, and cleanup proof. A hosted run against the old deployment must skip Messages before creation; it can independently exercise the already-supported paused automation cycle. The new route needs deployment before the Messages create/read-back/delete gate can pass. Use only the process environment for the disposable bearer. Vite transforms the app entry in its in-memory module graph while its on-disk cache is for dependency optimization, so the token is not expected in a Vite disk cache; this must still be checked with a filename-only scan after the credentialed run, alongside `dist` and `test-results`, before claiming no disk copy.

The parent's hosted browser run later showed direct API bearer access but page loads failed at the origin boundary: browser-origin `http://127.0.0.1:4175` `GET`/`OPTIONS /health` returned 403 without CORS headers from local 4001 and 500 without CORS headers from hosted API, while an origin-free API request returned 200. The page test failures therefore do not qualify hosted browser behavior. An approved browser origin or the actual Electron host transport is required; neither production CORS nor browser security was bypassed here.

Once the parent-owned candidate is signed in visibly, the native gate requires these process environment values: `RHYTHM_LIVE_ELECTRON_USER_DATA` (absolute owned disposable directory), `RHYTHM_LIVE_ELECTRON_EXECUTABLE` (absolute packaged `Rhythm.app/Contents/MacOS/Rhythm`), `RHYTHM_LIVE_ELECTRON_PID`, `RHYTHM_LIVE_ELECTRON_CDP_URL=http://127.0.0.1:<port>` matching that directory's `DevToolsActivePort`, and the existing three API/engine/production bases. It remains unrun pending that parent-owned app and deployed Messages DELETE route. The command, with the bearer exported only into the test process, is:

```bash
cd apps/web
RHYTHM_LIVE_ELECTRON_TRANSPORT=1 RHYTHM_LIVE_E2E=1 \
npx playwright test --config tests/live-electron-playwright.config.ts --workers=1
```

With `RHYTHM_LIVE_TOKEN` already exported in the parent process, the targeted hosted command is:

```bash
cd apps/web
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4001 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4096 RHYTHM_LIVE_PRODUCTION_API_URL=https://api.vcrcapps.com npx playwright test --config tests/live-smoke-playwright.config.ts --grep 'self-only marked thread|paused rule create' --workers=1
```

The token is intentionally present in the test renderer's memory through the existing `VITE_RHYTHM_LIVE_TOKEN` harness. A server-only auth transport is a separate harness change; no production renderer credential path was added here.
