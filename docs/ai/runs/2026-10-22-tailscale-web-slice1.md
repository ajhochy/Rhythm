---
date: 2026-10-22
repo: Rhythm
branch: feat/tailscale-web-app-20261022
pr: null
issues: []
status: blocked
tags: [run, Rhythm, tailscale-web, acceptance-contract]
---

# Slice 1 — BLOCKED at baseline sandbox / Phase 0

## Scope and approvals carried forward

Parent implementation handoff authorizes only the isolated Slice 1 vertical
slice: explicit RHYTHM_WEB_HOST configuration, exact origin/Host guards,
DB-validated configured owner context, static web dist, non-secret bootstrap,
mobile/relay skip, existing live React browser transport, same-origin API/WS,
and Chromium sandbox acceptance harness. The fixed RHYTHM_WEB_* names and A1–A5
remain unchanged. No new auth, fake bearer, replacement UI, cloud forwarder,
approvals adapter, credential handoff, cutover, LaunchAgent, Tailscale/network
changes, live data, push, PR, merge, or branch/worktree removal.

Developer instructions prohibit commits in this specialist stage (despite the
user's local-commit request). No commit was made. No production code was edited.
Do not ask again about unchanged feature scope; the blocker here is runtime
lifetime plus a distinct host permission denial, not feature-scope approval.

## Files

Draft acceptance-only additions:
- `apps/web/tests/web-host/playwright.config.ts`: Chromium-only discovery;
  operator-owned sandbox; no automatic backend/Vite launcher or CSP bypass.
- `apps/web/tests/web-host/fixture.ts`: exports Playwright page via base test,
  apiBase, Node-fetch API helper.
- `apps/web/tests/web-host/web-host-shell.spec.ts`: draft A1 owner/bootstrap,
  no GoogleSignIn and page-request same-origin assertion.
- `apps/web/tests/web-host/security.test.mjs`: draft A3 Node fetch/http/ws
  bootstrap shape, foreign Origin/Host, upgrade refusal, raw traversal and
  JSON API 404 checks. Every test names its intended regression.
- This log.

These checks are not a finished A1–A5 contract: A2 and A4 checks have not been
written. Do not weaken the draft assertions to make implementation pass. The
manager/independent verifier must run the completed contract against the final
read-only artifact; no independent verification occurred in this run.

## Checks and commands (observed)

1. Loaded `acceptance-contract`, then `coding-agent`; read full external plan,
   supplied AGENTS instructions, project-state and current-plan.
2. `git status --short --branch && git rev-parse HEAD && git diff --stat origin/mega/2026-09-29-consolidation HEAD -- apps/opencode_fork`
   - Branch exactly `feat/tailscale-web-app-20261022`; clean initial tree.
   - HEAD `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`.
   - Fork diff empty, allowing read-only binary reuse specified by parent.
3. Dependency commands, all successful, real local node_modules (no symlinks):
   - An initial `ls apps/api_server && npm ci --workspaces=false` accidentally
     installed the root package, not API. Added 185 packages; root audit 18
     vulnerabilities. No tracked dependency changes resulted.
   - In `apps/api_server`: `npm ci --workspaces=false`: added 180 packages;
     better-sqlite3 N-API prebuild works under Node v22.23.0; 15 vulnerabilities.
   - In `apps/web`: `npm ci --workspaces=false`: added 80 packages;
     3 vulnerabilities.
   - Root: `npm run build:guard -- npm --prefix apps/mcp_server ci --workspaces=false`:
     prepare TypeScript build passed; added 142 packages; 19 vulnerabilities.
   - No audit-fix/dependency upgrade attempted; outside scope.
4. `node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-web-slice1-fixtures-20261022`
   - Canonical synthetic DB/config generation succeeded:
     `Synthetic read-only sources: /private/tmp/rhythm-web-slice1-fixtures-20261022`.
   - No provider was launched, no paid model invoked, no live data copied.
5. Baseline launcher (before any production implementation):

   ```sh
   RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-web-slice1-fixtures-20261022 \
   RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-web-slice1-fixtures-20261022/rhythm.db \
   RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-web-slice1-fixtures-20261022/opencode.json \
   RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-web-slice1-sandbox-20261022 \
   RHYTHM_SANDBOX_ENGINE_DIR=/Users/ajhochhalter/Documents/Rhythm/apps/opencode_fork/packages/opencode \
   RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1 \
   npm run build:guard -- tools/dev/sandbox.sh up
   ```

   API tsc/postbuild and MCP tsc passed. After an initial curl connection
   refusal, launcher reported:
   `Sandbox ready: http://127.0.0.1:4098 (engine :4097)`.
   This was baseline desktop mode, not web-host acceptance.
6. `node --test apps/web/tests/web-host/security.test.mjs`
   - FAIL: 4 tests, 0 pass, 4 fail; bootstrap/write checks `TypeError: fetch
     failed`; WS/raw HTTP checks `ECONNREFUSED 127.0.0.1:4098`.
   - Invalid red acceptance evidence: infrastructure failed, not assertions
     demonstrating absent web-host behavior. Phase 0 NOT complete.
7. Status:

   ```sh
   RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-web-slice1-sandbox-20261022 \
   RHYTHM_SANDBOX_ENGINE_DIR=/Users/ajhochhalter/Documents/Rhythm/apps/opencode_fork/packages/opencode \
   tools/dev/sandbox.sh status
   ```

   Output showed no API :4098, engine :4097, or gateway :4099 listener. No
   server-dependent check was run after this confirmation; no launch repair
   attempted. Following parent STOP instruction, implementation halted.
8. Before investigating, read `docs/ai/regression-registry.md` and searched
   sandbox run records for foreground/ECONNREFUSED/nohup/lifetime failures.
   Relevant prior receipt: `docs/ai/runs/2026-07-26-1186-sandbox-foreground.md`
   documents `up --foreground` as automation-stable lifetime. This is a next
   diagnostic option, NOT a confirmed diagnosis of this failure.
9. Read tool for `/private/tmp/rhythm-web-slice1-sandbox-20261022/api_server.log`
   was DENIED by host external-directory policy. No alternate tool/path was
   used to bypass that denial. This is a host permission issue, independent
   of approved workflow scope. The actual shutdown reason remains unknown.
10. Required teardown, same directory/ports/engine settings:

    ```sh
    RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-web-slice1-sandbox-20261022 \
    RHYTHM_SANDBOX_ENGINE_DIR=/Users/ajhochhalter/Documents/Rhythm/apps/opencode_fork/packages/opencode \
    tools/dev/sandbox.sh down
    ```

    `sandbox: sanitized diagnostics preserved: /private/tmp/rhythm-web-slice1-sandbox-20261022.evidence.eVRIGe`
    `Sandbox removed: /private/tmp/rhythm-web-slice1-sandbox-20261022`
11. In `apps/web`:
    `node --check tests/web-host/security.test.mjs && npx --no-install playwright test --config tests/web-host/playwright.config.ts --list`
    - PASS syntax/discovery only: `Total: 1 test in 1 file`.
    - Chromium was not launched or installed. Not A1/A5 behavioral proof.
12. `git diff --check`: PASS before log addition; working status only draft
    `apps/web/tests/web-host/` additions at that point.
13. Read-only listener audit:
    `lsof -nP -iTCP:4097 -iTCP:4098 -iTCP:4099 -sTCP:LISTEN`:
    no listeners. `lsof -nP -iTCP:4001 -iTCP:4002 -iTCP:4096 -sTCP:LISTEN`:
    node PID 49952 still listening loopback 4001/4002; opencode PID 49998 still
    listening loopback 4096. lsof warned it could not stat an unrelated SMB
    Time Machine mount. No live-port requests or process-control commands
    targeted those ports; no initial PID snapshot was taken, so unchanged PID
    identity across the run is not claimed.

## Acceptance results

| Criterion | Result | Evidence |
|---|---|---|
| A1 | NOT RUN | Draft spec discovered only; no browser run. |
| A2 | NOT RUN | No prompt/session/provider run or spec yet. |
| A3 | FAIL (infrastructure) | Node suite 0/4; ECONNREFUSED, not a security verdict. |
| A4 | NOT RUN | Guard/ws/env regression suites and web tsc/build not run. |
| A5 | NOT RUN (partial harness) | Config/fixture/spec exist and discovery passes; reusable live behavior not verified. |

Sandbox bootstrap/guard Python/Bash suites were not run (launcher untouched).
No success is claimed for unrun checks. No production behavior was implemented.

## Source auth trace (partial, not runtime verification)

- `app.ts:133` installs `localAgentSurfaceGuard` before routing.
  `local_agent_surface_guard.ts:19–43` accepts only renderer allowlisted
  origins and loopback Host in guarded AGENT_LOCAL mode; originless requests
  additionally enforce Sec-Fetch-Site. No web-host extension exists.
- `agent_sessions_routes.ts:18` chooses `authenticateIfPresent` when
  AGENT_LOCAL, otherwise `requireAuth`. Absent Authorization bypasses bearer
  validation; `soleLocalSignedInSession` attaches identity only if exactly one
  user has active local sessions. Zero/multiple owners leave auth absent.
  This is NOT permission to guess an owner for web mode. Present malformed or
  invalid Authorization fails closed. Valid local/cloud bearer resolves identity.
- `projects_routes.ts:9`, `agent_configs_routes.ts:9`, and
  `opencode_models_routes.ts:17` omit requireAuth in AGENT_LOCAL mode. Thus
  these existing local surfaces are tokenless at middleware level, not proof
  every downstream controller operation succeeds without owner context.
- `app.ts:382–406` mounts PTY, MCP and providers without an auth wrapper;
  PTY/provider route files have no bearer middleware. `/opencode/health` is
  unprotected and `/opencode/runtime` explicitly bypasses auth under AGENT_LOCAL.
- `requireAuth` and `requireLocalOrCloudAuth` themselves still require real
  bearers, except the specific pre-existing server-created mobile-device
  context in `requireAuth`. Human approval routes choose protected auth even
  locally; signatures/native human capability cannot be replaced in Slice 1.
- `ws_gateway.ts:74–80` allows no bearer, refuses an invalid present bearer.
  `attachWsGateway` checks shared Host/Origin guard and loopback peer before
  `/ws/agents` or `/ws/pty/:id` upgrades. Agent attachment actor is currently
  derived only from a real bearer (`:180–184`), unlike the HTTP sole-session
  fallback. The future validated web owner must be applied explicitly here.

Plan references inspected on this base were directionally correct; auth file
line numbers have drift (e.g. requireAuth begins at 102, authenticateIfPresent
at 215). No demonstrated substantive plan-source mismatch. Full intended
change-surface/caller review was NOT completed.

## GitNexus / phase status / handoff

`gitnexus_query` ran for local agent auth/upgrade, then `gitnexus_list_repos`
reported Rhythm registered at `/Users/ajhochhalter/Documents/Rhythm`, indexed
commit `b846fdccf107d55fdef2b9208024f8cf6486e6d5`, stale by 249 commits. Not
the supplied worktree baseline. Source read/grep was used for the partial
trace. No indexed production symbol edited; no impact/detect_changes run,
no blast-radius/risk rating invented. Phase 1 impact review remains pending.

- Phase 0: BLOCKED — invalid infrastructure-only red; incomplete A2/A4 contract.
- Phase 1: NOT COMPLETE — preliminary auth/source trace only.
- Phase 2: NOT STARTED.
- Handoff: BLOCKED, not READY_FOR_VERIFICATION.

Smallest next action: obtain host-authorized access to the preserved sanitized
sandbox diagnostics, then have an operator/manager establish an automation-held
canonical sandbox lifetime (existing `up --foreground` receipt) and confirm it
survives before rerunning the baseline contract. Do not bypass host denial or
start an API manually. Resume completing the A1–A5 executable contract before
production edits; keep original feature/exclusion approvals unchanged. The
local-only feature worktree was never read or modified in this run.

## Attempt 2 — partial backend implemented; BLOCKED, not ready for verification

### Scope, entry gate, and phase status

Explicit parent specialist handoff received; loaded `acceptance-contract` first,
then `coding-agent`. Read this receipt, project-state, current-plan, external
plan sections 1–2, and the seven base-changed files' relevant startup/transport
surfaces. Unchanged scope/exclusions above remain binding. No new approval is
needed to resume the same feature. No cloud forwarder, approvals adapter,
credential handoff, service installation, networking, live-port management,
push/PR/merge/commit, branch switching, or other-worktree modification occurred.

- Phase 0 minimum pre-implementation gate: **completed with genuine A3 red**.
  This is NOT completion of the full A1–A5 executable contract: A2 and separate
  WS URL unit checks still do not exist. Original draft assertions unchanged.
- Phase 1: backend intended change surface reviewed before edits; frontend
  implementation/caller review remains incomplete and no frontend production
  file was edited.
- Phase 2: **partial**, not READY_FOR_VERIFICATION. A3 is green, but the browser
  cannot launch, A4 has bootstrap failures, and frontend/A2 remain absent.
  No claim that Slice 1 or AJ's full web-app bar is met.

Manager/independent verifier must execute the unchanged harness against the
resulting artifact without editing production source. No independent verifier
ran in this attempt. The single implementation owner made all edits here.

### Files (Attempt 2 edits)

- `apps/api_server/src/config/web_host.ts`: opt-in parsing; requires explicit
  local role + AGENT_LOCAL; exact HTTP(S) origins/hosts, positive owner ID,
  absolute dist. Default off, no change to existing env resolver.
- `apps/api_server/src/config/web_host.test.ts`: 17 config cases including
  absent opt-in and invalid role/origin/owner/path forms.
- `apps/api_server/src/services/web_host.ts`: startup DB-owner validation and
  dist validation; server-created tokenless owner context; non-secret bootstrap;
  static built files only, realpath containment including symlinks, no SPA API
  fallback. Empty AuthContext.sessionToken records absence of a token; it is
  never issued as a bearer or sent to the browser.
- `apps/api_server/src/app.ts`: guarded web owner/static/bootstrap composition,
  exact web CORS, web-only JSON misses, omit mobile router in web mode.
- `apps/api_server/src/middleware/local_agent_surface_guard.ts`: exact configured
  web Host/Origin plus same-origin/none fetch metadata; desktop branch retained.
- `apps/api_server/src/middleware/local_agent_surface_guard.test.ts`: additive
  A4 assertion that a ts.net-style origin/Host remains rejected by default.
- `apps/api_server/src/middleware/auth_middleware.ts`: tokenless web owner takes
  precedence over sole-signed-in-session inference in authenticateIfPresent.
  requireAuth/requireLocalOrCloudAuth and signed approval gates untouched.
- `apps/api_server/src/services/ws_gateway.ts`: explicit validated web owner for
  tokenless agent attachment, rather than the HTTP sole-session fallback.
- `apps/api_server/src/server.ts`: owner/dist setup after DB init, before engine
  and listeners; omit mobile router/listener/proxy in web mode. Existing relay
  client startup depends on that listener, so no uplink starts in this mode.
- `tools/dev/sandbox.sh`: only additive web runtime-env block. Pins local role
  when web opt-in is enabled and passes the four RHYTHM_WEB_* values explicitly.
- This run log: appended Attempt 2; predecessor receipt retained.

The four predecessor `apps/web/tests/web-host/` files remain untracked and
unchanged. No dependencies reinstalled. Scratch `.sandbox-attempt2.out` deleted
before handoff. Generated web dist and Playwright test-results are ignored;
they are not reviewed web-host release artifacts.

### Impact review (stale index b846fdc)

Before implementation, `impact(direction: upstream, summaryOnly: true,
repo: Rhythm)` ran for `createApp`, `main` (server.ts), `attachWsGateway`,
`isAllowedLocalAgentSurfaceRequest`, and `authenticateIfPresent`. Each returned
LOW, zero direct indexed dependents/processes. This is an undercount, not proof
of isolation. `api_impact(file: apps/api_server/src/app.ts)` returned no routes.
Exact-source caller search confirmed server composition; guard reuse by HTTP,
WS and Dayflow; and many real-server tests using createApp. Security risk review:
default desktop branch must remain unchanged, owner must be validated before
listen, malformed/foreign requests must not bypass the shared guard, and native
approval authentication must not acquire a browser bypass. Proportionate checks:
unchanged live Node security suite, config boundaries, shared guard/hardening,
agent WS, role separation and adversarial loopback/bind tests.

`detect_changes(scope: all, worktree: <this worktree>, repo: Rhythm)` succeeded:
7 indexed changed symbols, 7 tracked changed files, LOW, zero affected processes.
It identifies createApp/nested CORS origin, authenticateIfPresent, shared guard,
main, attachWsGateway, plus a coarse WsMessage hit. It does not cover untracked
new modules and is stale; source diff remains authoritative. No reindex ran.

### Exact sandbox lifetime / contract commands and observed output

Both read-only binary checks succeeded with empty output:

```sh
git diff --stat f262417ade HEAD -- apps/opencode_fork
git -C /private/tmp/rhythm-feature-playwright-2026-10-19 status --short -- apps/opencode_fork
```

All three sandbox invocations used these exports (DIST expanded to this
worktree's absolute `apps/web/dist` path):

```sh
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-web-slice1-fixtures-20261022
export RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-web-slice1-fixtures-20261022/rhythm.db
export RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-web-slice1-fixtures-20261022/opencode.json
export RHYTHM_SANDBOX_ENGINE_DIR=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/opencode_fork/packages/opencode
export RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1 RHYTHM_WEB_HOST=1
export RHYTHM_WEB_PUBLIC_ORIGIN=http://127.0.0.1:4098 RHYTHM_WEB_OWNER_USER_ID=1
export RHYTHM_WEB_DIST_DIR="$PWD/apps/web/dist"
# RHYTHM_SANDBOX_DIR differs below; same directory used for each up/status/down.
trap 'tools/dev/sandbox.sh down' EXIT
tools/dev/sandbox.sh up --foreground > .sandbox-attempt2.out 2>&1 & holder=$!
ready=0
for n in {1..180}; do
  if ! kill -0 "$holder" 2>/dev/null; then
    printf 'BLOCKED: sandbox holder exited before readiness\n'; break
  fi
  if grep -q 'Sandbox ready' .sandbox-attempt2.out && curl -sf http://127.0.0.1:4098/health >/dev/null; then
    ready=1; break
  fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  printf 'BLOCKED: foreground sandbox unavailable; scratch .sandbox-attempt2.out\n'
  tools/dev/sandbox.sh status; exit 1
fi
tools/dev/sandbox.sh status
# Test command(s) below execute HERE, in this same invocation before EXIT trap.
```

1. Baseline SB `/private/tmp/rhythm-web-slice1-sandbox-20261022-attempt2`:
   `node --test apps/web/tests/web-host/security.test.mjs` => **2 pass, 2 fail**.
   Genuine expected behavioral reds: bootstrap `404 !== 200`; unknown API
   content-type `text/html; charset=utf-8` did not match application/json.
   Foreign HTTP/WS checks already passed (existing protection). API PID 79982,
   engine 80022, gateway 79982 remained live during tests. This repairs the
   predecessor's invalid infrastructure-only baseline; no production edit yet.
   Teardown preserved `...attempt2.evidence.4uTVQO` and removed the SB.
2. Candidate SB `/private/tmp/rhythm-web-slice1-sandbox-20261022-attempt2-green`:
   same Node command => **4 pass, 0 fail**, including raw/encoded traversal,
   owner/non-secret bootstrap, foreign Origin POST and WS, unexpected Host,
   JSON unknown API. Status: API 81643, engine 81682, **gateway absent**.
   Then `npm --prefix apps/web exec -- playwright test --config tests/web-host/playwright.config.ts`
   => **invocation error**, resolved config at repo-root tests/web-host (missing),
   not a browser/product result. Corrected below, assertions unchanged.
   Printed `security_exit=0 browser_exit=1`. Teardown preserved
   `...attempt2-green.evidence.Ie2eIT` and removed the SB.
3. Browser SB `/private/tmp/rhythm-web-slice1-sandbox-20261022-attempt2-browser`:
   `apps/web/node_modules/.bin/playwright test --config apps/web/tests/web-host/playwright.config.ts`
   => **1 failed before page launch**, expected Chromium binary absent at
   `/Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`.
   This is infrastructure, NOT a valid A1 behavior result. No executable override,
   CSP bypass, mock, alternate server, or browser download used as a workaround.
   Trace: `apps/web/test-results/web-host-shell-A1-configur-3ee48-ll-uses-only-its-own-origin/trace.zip`.
   API 83326/engine 83364 stayed up, gateway absent. Teardown preserved
   `...attempt2-browser.evidence.beIkMb` and removed the SB.

Every sandbox+test group ran in one Bash invocation with 1,200,000 ms timeout;
no sandbox command was wrapped in build:guard. No preserved diagnostics needed
reading; no host denial occurred in Attempt 2. All sandbox downs completed.

### Other checks

- `npm run build:guard -- npm --prefix apps/api_server run build`: **PASS**,
  tsc and advisory postbuild copy.
- `npm run build:guard -- npm --prefix apps/web run build`: **PASS**,
  `tsc -b && vite build`, 1788 modules; existing >500 kB chunk warning.
  This is the unchanged default frontend build, NOT proof of web live transport.
- From apps/api_server:
  `npx --no-install vitest run src/config/web_host.test.ts src/config/env.test.ts src/middleware/local_agent_surface_guard.test.ts src/contract/local_agent_surface_hardening.test.ts src/__tests__/agents_ws_e2e.test.ts`
  => **4 files, 45 tests passed**. There is NO src/config/env.test.ts; do not
  interpret the nonexistent filter as a passing env suite.
- From apps/api_server:
  `npx --no-install vitest run src/__tests__/issue_755_role_separation.test.ts src/contract/issue_1175_adversarial_followup.test.ts`
  => **2 files, 26 tests passed**, covering role/bind adversarial behavior.
- `python3 tools/dev/sandbox_bootstrap_test.py && bash tools/dev/sandbox_guard_test.sh`
  => **FAIL**, Python ran 5 tests with 4 failures; `&&` did not run guards.
  Two subcase failures: no checkout-local built fork means command resolution
  finds `/Users/ajhochhalter/.local/bin/opencode`, whereas test requires the
  checkout-local dist. Reused sibling binary is only selected for sandbox runs.
  Two source-assertion failures: test expects literal NODE_BIN+API_DIR/dist path
  count 4 (actual 0), and a literal MCP dist guard absent on this newer base.
  Full captured output: tool output `tool_164e1c85d001pWZDT7kVL0qz82`.
  Read test source; no assertions weakened or unrelated launcher paths changed.
  Read-only `git show HEAD:tools/dev/sandbox.sh` count confirmed baseline already
  has 0 old literal references and 5 NODE_BIN+API_BIN references. This confirms
  source-test drift, not a claim the whole suite passes on baseline.
- `bash tools/dev/sandbox_guard_test.sh` separately => **24 passed, 0 failed**.
- `git diff --check`: **PASS** before final run-log append; repeat at handoff.
- `test:dist-smoke`: **NOT RUN**; no installed Playwright browser for its gate.
- No scripted provider or model prompt ran; no paid calls authorized or made.

### A1–A5 result and remaining work

| Criterion | Result | Evidence / limitation |
|---|---|---|
| A1 | FAIL (infrastructure); behavior NOT RUN | Correct Playwright invocation reaches launch, missing expected Chromium. Frontend bootstrap/owner rendering not implemented. |
| A2 | NOT RUN | No A2 spec, provider process, prompt, WS transcript, reload or Node session/message readback proof. |
| A3 | PASS | Unchanged Node suite, real sandbox API, 4/4. Does not prove broader owner/auth isolation beyond those assertions. |
| A4 | FAIL overall | API build, web tsc/build, 71 focused tests, guards 24 pass; bootstrap Python 4 failures. No separate WS URL test yet. |
| A5 | NOT RUN (partial harness) | Existing config/fixture/spec retained at required path; no successful Chromium run or A2/backend-effect harness completion. |

### Seven changed-base files and plan-reference drift

- `ws_gateway.ts`: current attachment normalization needs attachmentActors;
  explicit tokenless web owner is applied there. Prompt/attachment safeguards
  and model routing are not rewritten. Session owner persistence remains via
  HTTP controller behavior; not proved by a new runtime ownership test here.
- `server.ts`: newer qualification/Dayflow composition retained. Inject setup
  after initDb, omit existing mobile composition without rewriting lifecycle.
- `app.ts`: retain newer qualification, coordinator and Dayflow routing; append
  static only after API routes and keep native/protected auth unchanged.
- `main.tsx`: newer test-only token `/auth/me` lookup and per-document MCP ensure
  promise exist. Future browser bootstrap must bypass GoogleSignIn without
  borrowing that token path or triggering per-refresh config writes.
- `gateway/index.ts`: newer qualification-only production-local grant and
  protected coordinator/Dayflow fetchers exist. Do not generalize that native
  grant to browser authority. All real domain token guards still need explicit
  transport adaptation; adding same-origin URLs alone is insufficient.
- `gateway/sessions.ts`: current local projectLabels/createProject already use
  API paths; session factory still requires bearer and uses HTTP-only WS scheme
  replacement. Retain profile, catalog, project, reconnect and transcript logic.
- `sandbox.sh`: explicit sanitized runtime plus API_BIN preservation/intake,
  synthetic OpenAI catalog (metadata-only, NOT prompt credentials), bridge/auth
  fixture options. Only web pass-through added. Do not change API_BIN to satisfy
  obsolete source-string tests or use catalog metadata tokens for paid prompts.

External plan baseline/line references predate f262417ade. Substantive scope
override: section 2 mentions /cloud, but parent explicitly defers forwarding,
credential and approvals work. No need to re-ask those resolved scope questions.
Bootstrap-test literal expectations demonstrably lag the newer launcher.

Smallest next action: provide/install the matching Playwright Chromium through
the normal operator/tooling path, then resume completing A2 + transport contracts
and frontend adaptation under the same scope. Resolve bootstrap-suite baseline
drift without weakening semantic safeguards. Repeat the full A1–A5 sandbox gate
and obtain independent verification. Do not deploy this partial opt-in backend
or call it the working Tailscale web app.

Final handoff audit: `git diff --check` passed after the Attempt 2 log append.
`lsof -nP -iTCP:4097 -iTCP:4098 -iTCP:4099 -sTCP:LISTEN` returned no listener
rows, exit 1; only the existing unrelated Time Machine SMB stat warning.
`.sandbox-attempt2.out` is absent from final status. All changes remain
uncommitted; predecessor harness and log remain untracked alongside new modules.
