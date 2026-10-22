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

## Attempt 3 — F1/F2 repaired; Slice 1 remains incomplete

### Scope / gates / handoff

Parent handoff accepted. Loaded `acceptance-contract` first, then `coding-agent`;
read the predecessor receipt, external plan sections 1–2, supplied AGENTS,
project-state, current-plan and regression registry before investigation.
Started on the requested branch at `e5031254594eca3cc9c6ca2b373a2108edc9e18d`
with a clean tree. No branch change, commit, push, PR, deployment, dependency
installation, networking/Tailscale change, live-data access or live-port request.
The approved feature scope and exclusions in the preceding receipts carry forward.
Slice 2 remains gated on the manager's base landing; no work on it occurred.

**Partial, NOT READY_FOR_VERIFICATION.** No frontend production file was edited.
The backend fixes have real regression/security evidence, but browser transport,
A2 and the complete A1–A5 contract remain unfinished. The manager/independent
verifier can run these tests against the candidate without editing its sources;
no independent verifier has run this candidate yet.

- Phase 0: genuine F1/F2 failing contract recorded before production edits.
  The larger contract is still incomplete: A2 and WS URL unit tests do not exist.
- Phase 1: backend F1/F2 scope reviewed; stale GitNexus plus exact source callers.
  Frontend implementation review/impact analysis is not complete.
- Phase 2: F1/F2 implemented and focused checks pass; aggregate validation failed
  with captured diagnostics denied by host policy. No attempt to bypass denial.

### Files

- `apps/api_server/src/middleware/local_agent_surface_guard.ts`: configured web
  Host branch now applies only to exact configured Hosts; other requests retain
  the pre-existing desktop rule. Web Hosts still reject foreign Origins and
  non-same-origin fetch metadata. No changes to native approval/bearer gates.
- `apps/api_server/src/app.ts`: CORS is the union of localRendererOrigins and
  configured web origins, rather than a replacement.
- `apps/api_server/src/middleware/web_host_surface_contract.test.ts`: eight
  non-loopback-origin guard table cases plus real Express HTTP preflights for
  Electron and web CORS. Only configuration is injected; the guard, CORS,
  owner initialization, UsersRepository and HTTP server are real. Synthetic
  in-memory SQLite and temporary built-index fixture; no mock system under test.
- `apps/web/tests/web-host/playwright.config.ts`: realistic non-loopback origin;
  Chromium resolver maps `rhythm-web.test` to loopback. The insecure-origin-as-
  secure flag approximates the real HTTPS secure context; it does NOT prove
  actual TLS, Tailscale Serve or physical-device behavior. CSP is not bypassed.
- `apps/web/tests/web-host/fixture.ts`: Node HTTP helper explicitly sends web
  Host/Origin while dialing only 127.0.0.1:4098; no DNS/network configuration.
- `apps/web/tests/web-host/security.test.mjs`: same explicit headers for web
  requests; adds loopback local route, Electron and web CORS preflights, originless
  web access, loopback-Origin-on-web-Host rejection, cross-site rejection, and
  accepted loopback/Electron/web WS upgrades. Existing foreign write/upgrade,
  traversal and JSON-404 assertions retained.
- This run log. Own scratch `.sandbox-attempt3.out` removed before handoff.

### Impact / F1/F2 contract commands

Before changing production, upstream GitNexus impact ran for
`isAllowedLocalAgentSurfaceRequest` and `createApp` (including its nested CORS
callback), repo Rhythm, summaryOnly. Both returned LOW, zero direct indexed
callers and affected processes. **Stale index b846fdc: not proof of isolation.**
Exact-source search confirmed HTTP `localAgentSurfaceGuard`, WS upgrades in
`ws_gateway.ts:146–195` (both agent and PTY), and Dayflow router at
`dayflow_integration_routes.ts:131–139` use this same guard. These consumers
retain their separate peer/optional-bearer checks. Risk review: additive desktop
compatibility must not become a foreign-Host/Origin bypass; use a non-loopback
web config so the overlapping-loopback test cannot mask the defect again.

From `apps/api_server`:

```sh
npx --no-install vitest run src/middleware/web_host_surface_contract.test.ts
```

1. Initial contract authoring run: 6 pass / 3 fail. F1 had two genuine
   `expected false to be true` failures; the F2 test lacked web-host initialization
   and was not valid red evidence yet.
2. Added real owner/static fixture initialization before implementation; reran:
   **6 pass / 3 fail**, F1 false-vs-true, F2 `403 !== 204`. Genuine baseline.
3. F1 repair only; reran unchanged assertions: **8 pass / 1 fail**. F2 now
   `401 !== 204`, proving the missing CORS allowance independently of F1.
4. F2 repair; combined default/opt-in tests: **10 pass / 1 fail**. Node fetch
   did not transmit the supplied web Host as required on this runtime; web leg
   got 403. Fixed the test transport to `http.request` with explicit Host,
   preserving exact status and ACAO assertions (not a product relaxation).
5. Final focused command:

   ```sh
   npx --no-install vitest run src/middleware/web_host_surface_contract.test.ts src/middleware/local_agent_surface_guard.test.ts
   ```

   **2 files / 11 tests passed**, including default-mode ts.net refusal.
   One implementation repair per defect; no repeated product-repair loop.

### Builds / Electron identity proof

Before sandbox/browser baseline:

```sh
npm run build:guard -- npm --prefix apps/web run build
shasum -a 256 apps/web/dist/index.html
npm run build:guard -- npm --prefix apps/api_server run build
```

Both builds PASS; web runs `tsc -b && vite build` (1788 modules, existing large
chunk advisory); API tsc/postbuild PASS. Repeated the first two commands at
handoff, again PASS. Before/after SHA-256 of default Electron-mode dist HTML:

```text
09ce840b483bc110872bee25c12e36474823b313b54dd830003ab3ffaa6dbbd4
09ce840b483bc110872bee25c12e36474823b313b54dd830003ab3ffaa6dbbd4
```

Exact byte identity includes its CSP. No frontend production change was made,
so this is a desktop non-regression proof, **not** proof that a separate web
build/CSP/output was implemented. That requirement remains outstanding.

### Canonical sandbox protocol and actual acceptance runs

Both groups below ran each lifecycle plus its tests in a **single Bash tool
invocation**, timeout 1,200,000ms. Never wrapped sandbox.sh in build:guard.
Reused the manager-approved engine checkout read-only, no fork changes/build.
No scripted provider was started and no model, paid or otherwise, was invoked.

Common exports (all values explicit):

```sh
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-web-slice1-fixtures-20261022
export RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-web-slice1-fixtures-20261022/rhythm.db
export RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-web-slice1-fixtures-20261022/opencode.json
export RHYTHM_SANDBOX_ENGINE_DIR=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/opencode_fork/packages/opencode
export RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1 RHYTHM_WEB_HOST=1
export RHYTHM_WEB_PUBLIC_ORIGIN=http://rhythm-web.test:4098 RHYTHM_WEB_OWNER_USER_ID=1
export RHYTHM_WEB_DIST_DIR="$PWD/apps/web/dist"
# Set the per-group directory below before running this common lifetime block.
trap 'tools/dev/sandbox.sh down' EXIT
tools/dev/sandbox.sh up --foreground > .sandbox-attempt3.out 2>&1 & holder=$!
ready=0
for n in {1..180}; do
  if ! kill -0 "$holder" 2>/dev/null; then break; fi
  if curl -sf http://127.0.0.1:4098/health >/dev/null; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then tools/dev/sandbox.sh status; exit 1; fi
tools/dev/sandbox.sh status
# Run the group commands here, before the EXIT trap.
```

Group 1: `RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-web-slice1-sandbox-20261022-attempt3-baseline`

```sh
node --test apps/web/tests/web-host/security.test.mjs
apps/web/node_modules/.bin/playwright test --config apps/web/tests/web-host/playwright.config.ts
tools/dev/sandbox.sh status
```

- Security **6 pass / 0 fail** (before two extra CORS/WS tests were added).
- Chromium **1 failed**, genuine A1 behavioral failure: nav-agents visible,
  but `getByText('Synthetic Admin', {exact:true}).first()` absent after 5000ms.
  Existing default frontend renders the fixture workspace; it is not browser
  live transport. No check weakened to accept that fallback.
- Browser trace: `apps/web/test-results/web-host-shell-A1-configur-3ee48-ll-uses-only-its-own-origin/trace.zip`.
- `security_exit=0 browser_exit=1`. API PID 87652; engine PID 87689 by final
  status. Initial API readiness preceded engine readiness; no engine/prompt
  acceptance is inferred from /health. Runtime remained up for the checks.
- Teardown preserved `...attempt3-baseline.evidence.v8R9EY` and removed sandbox.

Group 2: `RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-web-slice1-sandbox-20261022-attempt3-verification`

```sh
node --test apps/web/tests/web-host/security.test.mjs
env -u RHYTHM_WEB_HOST -u RHYTHM_WEB_PUBLIC_ORIGIN -u RHYTHM_WEB_OWNER_USER_ID -u RHYTHM_WEB_DIST_DIR \
  apps/api_server/node_modules/.bin/vitest run --root apps/api_server \
  src/middleware/web_host_surface_contract.test.ts \
  src/middleware/local_agent_surface_guard.test.ts src/config/web_host.test.ts \
  src/contract/local_agent_surface_hardening.test.ts src/__tests__/agents_ws_e2e.test.ts \
  src/__tests__/issue_755_role_separation.test.ts src/contract/issue_1175_adversarial_followup.test.ts \
  src/__tests__/relay_role.test.ts src/services/decision/decision_env.test.ts \
  src/services/opencode_client_service.test.ts
bash tools/dev/sandbox_guard_test.sh
python3 tools/dev/sandbox_bootstrap_test.py
tools/dev/sandbox.sh status
```

- Observed summary: **`security_exit=0 suites_exit=1 guards_exit=0 bootstrap_exit=1`**.
  Expanded security (8 declared tests, including real permitted WS upgrades)
  exits 0. Guards exit 0. Do not claim the focused aggregate passed.
- Real env/config tests selected using tests importing config/env and exact
  resolver-name search: issue_755_role_separation, relay_role, decision_env;
  opencode_client_service additionally exercises local renderer origins.
  No nonexistent src/config/env.test.ts filter used. Per-file result details
  of this aggregate are unavailable to this agent; no invented counts/results.
- Python observed `Ran 5 tests ... FAILED (failures=4)`: same four pre-existing
  failures identified by the manager. Missing checkout-local engine triggers
  two override subcases; literal NODE_BIN+API_DIR/dist count is 0 vs expected 4;
  prior missing MCP literal case is the other existing source assertion.
  Manager already established the 0 count at 894c16f and f262417. Neither the
  launcher nor bootstrap test was edited; no baseline-failure repair attempted.
- API PID 88670, engine 88709 remained live at final status. Teardown preserved
  `...attempt3-verification.evidence.e6Xmhk` and removed sandbox.
- Full combined capture:
  `/Users/ajhochhalter/.local/share/opencode/tool-output/tool_164f22fbf001h8Zs7HbadPVfMd`.
  **Read tool DENIED this path by host external-directory policy.** No alternate
  tool, copy, symlink, path or rerun was used to retrieve the denied diagnostics.
  Manager must read this evidence to identify the aggregate suite failure.
  This is a diagnostic permission blocker, not sandbox lifetime failure and not
  a feature-scope approval issue. Remaining implementation is not described as
  completed or automatically excused by that denial.

### Acceptance / remaining work

| Criterion | Attempt 3 result | Evidence |
|---|---|---|
| A1 | FAIL | Real Chromium at rhythm-web.test; configured owner missing. Browser infrastructure blocker is gone. |
| A2 | NOT RUN | No A2 spec/provider/prompt/WS reply/reload/readback proof. |
| A3 | PASS | Expanded Node suite exits 0 against real sandbox at explicit web Host/Origin; F1 HTTP/CORS/WS cases covered. |
| A4 | FAIL overall | API + default web tsc/build pass; focused F1/F2/default 11 pass; aggregate suites exit 1; guards exit 0; same 4 pre-existing bootstrap failures; no web CSP build/WS URL unit proof. |
| A5 | NOT RUN (partial harness) | Realistic-origin config/helper/security reusable; only A1 exists in Chromium and fails. A2/backend-write spec still missing. |

Plan corrections/limits: localhost-origin acceptance concealed the desktop/web
union regression; use the new realistic origin. The base bootstrap source
assertions lag the launcher and are not slice defects. Section 2's cloud
forwarder remains explicitly deferred, not authorization to implement it here.
No further substantive plan conclusion was verified.

Smallest next action: manager reads the denied aggregate capture above and
identifies the failed suite before any repair. Then resume the same approved
Slice 1 scope: freeze/run A2 and WS URL contracts, finish main/index/sessions/PTY
browser live transport and honest cloud-unavailable state, skip browser auth/me
and ensureRhythmMcp, build separate web dist/CSP while proving Electron identity,
and run A1–A5 with the scripted provider. Do not reinstall dependencies or redo
scope approvals. Final AJ bar (every confirmed working feature in the web app)
is explicitly NOT met by this partial backend repair.

Final scope audit: GitNexus detect_changes(all, this worktree, Rhythm) returned
3 indexed symbols (createApp, nested origin, shared guard), 5 tracked code/test
files, LOW, 0 indexed affected processes; stale/untracked-module limitations
apply. `git diff --check` passed before this appendix. Default Electron HTML
rebuild hash is identical above. Read-only lsof audit found no sandbox listener
rows on 4097/4098/4099 (exit 1; unrelated Time Machine SMB stat warning).
All edits remain uncommitted for manager review. No completion claim.

## Attempt 4 — frontend delivered; A1/A2/A3 pass, A4 identity and lifecycle remain FAIL

### Scope, gates, and status

Parent specialist handoff accepted at `c8dae8461b553c2fd974538c2dde0c438d7a7e2f`,
branch `feat/tailscale-web-app-20261022`; initial tree clean. Loaded
`acceptance-contract` first, then `coding-agent`; read project-state, current-plan,
predecessor receipt and supplied AGENTS. No orchestrator/peer dispatch. No commit,
push, switch, dependency install, network/Tailscale change, paid model, live-data
access, or requests/process control on 4001/4002/4096. Backend design, Python
bootstrap test and broad suites were not revisited. Only requested served-index
CSP behavior changed in backend. Existing scope/exclusions/approvals carry forward;
Slice 2 remains gated on AJ pushing f262417 to mega.

**PARTIAL / NOT READY_FOR_VERIFICATION as a completed Slice 1.** A1/A2/A3 have
real passing receipts. A4 byte identity fails, and the canonical lifecycle's down
reports a provenance mismatch. AJ's every-confirmed-working-feature bar is NOT met.
Manager is the independent verifier; no independent verification claimed here.
The checked commands can run without editing application sources.

- Phase 0 performed before production edits: authored browser transport contract,
  ran it. Initial loader failure (workspace alias missing) was test infrastructure,
  corrected to load the real workspace error type. Genuine baseline: **1 pass,
  2 fail**: loopback validator rejects browser config; HTTPS PTY produces
  `https://owner.ts.net/ws/pty/terminal` instead of `wss://...`. Existing A1 red
  from Attempt 3 retained; A2 authored later before its first runtime execution,
  not claimed as a complete preimplementation A1–A5 red contract.
- Before backend CSP edit, real Express served-index contract genuinely failed:
  old api.vcrcapps.com/loopback connect-src versus exact configured origins/twins.
- Phase 1 bounded review completed for startup/composition/local guard/WS surface;
  new pending-decisions direct engine fetch discovered during live validation and
  analyzed before repair. Page-wide feature qualification remains incomplete.
- Phase 2 implementation and focused checks performed; unresolved gates below.

### Files changed

- `apps/web/package.json`, `apps/web/.gitignore`: separate `build:web` output
  (`VITE_RHYTHM_WEB_HOST=1 vite build --outDir dist-web`), ignored dist-web.
- `apps/web/src/main.tsx`: opt-in same-origin bootstrap; require web mode and
  owner shape, live gateway, existing startup error on failure; no Google auth,
  `/auth/me`, rhythmShell auth or ensureRhythmMcp in this branch. Minimal AuthUser
  mapping uses owner id/displayName, empty email and conservative member role;
  no extra owner PII added to bootstrap. Full role-dependent feature parity is
  not established by this mapping.
- `apps/web/src/gateway/index.ts`: explicit browser config, same-origin API and
  API-served engine health, no direct engine transport; cloud-backed domains,
  approvals, mobileAccess and sharedAgents omitted. Desktop URL validation kept.
- New `apps/web/src/gateway/browser-transport.ts`: one WeakSet-marked same-origin
  transport that strips Authorization and rejects foreign URLs. No dummy token.
- Local factory guard adaptation (only token preflight and shared-helper import):
  `apps/web/src/gateway/{commands,cookbook,delegation,designs,mcp,memory,permissions,
  research,run-quality,schedules,skills,usage-budget,workstreams}.ts`.
- `apps/web/src/gateway/sessions.ts`: same shared token preflight plus http→ws,
  https→wss; `apps/web/src/gateway/pty.ts`: same scheme correction.
- `apps/web/src/store.tsx`: skip notification polling when domain omitted; fixes
  observed synchronous `undefined.list` shell crash.
- `apps/web/src/pending-decisions.ts`: browser branch does not call a reconstructed
  loopback engine `/question` URL. Questions still arrive over WS, but pending
  question rehydration after browser reload remains unsupported until an API-side
  list exists. This is a deliberate limitation, not claimed feature parity.
- `apps/api_server/src/services/web_host.ts`: only served `/` and `/index.html`
  connect-src rewrite to self + configured origins + ws/wss twins; all remaining
  directives/HTML bytes and on-disk dist remain unchanged; no-store.
- New `apps/api_server/src/services/web_host_csp.test.ts`: real HTTP and SQLite
  owner fixture, exact rewrite + all other HTML bytes preserved + source untouched.
- New `apps/web/tests/web-host/browser-gateway.test.mjs`: actual TS modules loaded,
  real loopback HTTP backend for composition, omitted-domain and health routes;
  PTY/session http+https mapping (socket constructor is only transport observation,
  not live engine proof). No application gateway mocked.
- New `apps/web/tests/web-host/web-host-session.spec.ts`: scripted-provider setup,
  real project/session creation via API, UI-open/send, same-origin WS frames,
  reload transcript and Node HTTP readback of session/project/messages.
- New `apps/web/tests/web-host/run-sandbox.sh`: canonical foreground lifecycle,
  explicit fixture/dist/origin/engine paths, API+engine readiness, trap down and
  provider cleanup. Final trap correction preserves teardown's nonzero exit;
  syntax checked but this exact final trap revision was not rerun live.
- `apps/web/tests/web-host/web-host-shell.spec.ts`: original assertions retained;
  adds CSP audit and screenshot. `playwright.config.ts`: retain success traces
  and failure screenshots. `apps/web/tests/live/scripted-openai-provider.mjs`:
  additive `/v1/models` synthetic catalog so existing real custom-provider setup
  can discover s0-local. No external calls.
- This appended receipt. Generated logs/builds/test-results ignored.

### Impact and risk review

Stale GitNexus **b846fdc**, not the worktree base. Upstream impact attempted before
edits for renderGateway, composeGateway, createLiveGateway, createLivePtyGateway,
createLiveSessionsGateway (disambiguated source path), every adapted local factory,
FixtureProvider and rehydrateDecisions. Indexed results LOW, zero indexed direct
callers/processes. createWebHostRouter and scripted provider were unindexed;
api_impact(web_host.ts) found no indexed routes. Exact source caller searches
cross-checked main→composition→local factories; store→rehydrateDecisions (two
callers); direct loopback question fetch; notification/approval domain reads;
SessionRail and existing conversation/live-session selectors. No HIGH/CRITICAL
result. Zero graph edges are undercount, not isolation evidence.

Risk controls tested: desktop loopback validator still rejects browser-shaped
config without browser branch; no cloud bearer/dummy issued; no direct engine
health; exact origin CSP including Safari-required explicit WS twin; actual
stream/durable transcript. Missing-domain pages are not comprehensively audited:
some existing catches may show generic server-error rather than an explicit
unavailable state (e.g. Tasks); cloud feature parity remains unproven.

Final `detect_changes(scope:all, repo:Rhythm, worktree:<this worktree>)`: LOW,
39 indexed symbols / 25 tracked files / 0 affected indexed processes. New files
and newer backend module unindexed; source diff authoritative.

### Exact commands and observed results

Unit commands run outside sandbox shells. API unit environment removes **all**
RHYTHM_* variables using the following command prefix, not just WEB_*:

```sh
# From apps/api_server (no sandbox exports in this invocation):
env $(env | cut -d= -f1 | /usr/bin/awk '/^RHYTHM_/ {print "-u " $0}') \
  ./node_modules/.bin/vitest run src/services/web_host_csp.test.ts \
  src/config/web_host.test.ts src/middleware/web_host_surface_contract.test.ts \
  src/middleware/local_agent_surface_guard.test.ts
```

**4 files / 29 tests PASS** (2.98s). Earlier CSP-only baseline 0/1 expected fail;
after edit combined CSP/config/F1F2 27/27 passed. No env-leak suite rerun needed.

```sh
node --test apps/web/tests/web-host/browser-gateway.test.mjs
npm --prefix apps/web run typecheck
npm run build:guard -- npm --prefix apps/web run build:web
npm run build:guard -- npm --prefix apps/web run build
npm --prefix apps/web run test:dist-smoke
bash -n apps/web/tests/web-host/run-sandbox.sh
git diff --check
```

Final browser contract **5/5 PASS**; renderer typecheck PASS; both guarded builds
PASS (1789 modules, existing >500kB chunk advisory); dist-smoke PASS `index and 2
relative assets verified`; harness syntax and diff whitespace PASS. Browser
contract's first product rerun found gallery token preflight left unchanged;
fixed through shared helper, then passed. No broad suites run.

Final live invocation (one Bash call, no build guard around lifecycle):

```sh
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-web-slice1-sandbox-20261022-attempt4-final \
  bash apps/web/tests/web-host/run-sandbox.sh bash -c \
  'node --test apps/web/tests/web-host/security.test.mjs; security=$?;
   apps/web/node_modules/.bin/playwright test --config apps/web/tests/web-host/playwright.config.ts;
   browser=$?; tools/dev/sandbox.sh status;
   printf "security_exit=%s browser_exit=%s\n" "$security" "$browser"; exit "$browser"'
```

Harness specifies fixture root `/private/tmp/rhythm-web-slice1-fixtures-20261022`,
its read-only rhythm.db/opencode.json, approved engine checkout from manager,
skip engine build, public origin http://rhythm-web.test:4098, owner 1, absolute
dist-web. Uses existing custom-provider API to register loopback 6996 and
synthetic key from checked provider source. **Deviation:** no inert synthetic
OpenAI catalog account or cloud auth-fixture needed: real owner context + custom
provider registration covers this prompt without using metadata-only account
tokens or any paid provider. Project/session are created via real API then opened
and prompted in browser; browser UI session creation itself is not A2 proof here.
Node readback uses existing harness http.request with explicit Host/Origin rather
than fetch (manager-documented Node Host behavior); actual backend data is read.

Observed final **A3 8 pass / 0 fail; Playwright 2 pass / 0 fail, 16.2s;
security_exit=0 browser_exit=0**. API PID 99488, engine initially 99529 then 99655
after provider config restart. No paid model. Provider emits hello/hello/seedling;
A2 asserts WS frame text, rendered response, reload and stored transcript.

Earlier runs retained as failures, not hidden:
- Initial A1 failed `nav-agents` missing; trace proved synchronous notification
  undefined.list crash. Missing-domain guard fixed it; A1 then passed.
- Initial A2 setup timeout expected .healthy true, actual undefined. Corrected
  observer to actual `/opencode/health` schema `.status === ready`; no backend edit
  or acceptance-outcome relaxation. Rerun A2 passed.
- A1 after A2 then caught CSP-blocked hardcoded loopback `/question` fetch with a
  persisted SDK session. Added explicit browser direct-engine exclusion; final
  combined A1/A2 run passes. Two bounded A1 production repairs total.

### Electron identity proof — FAIL (not waived)

Before any source edit:

```text
09ce840b483bc110872bee25c12e36474823b313b54dd830003ab3ffaa6dbbd4  dist/index.html
d5e47b801245781456b4e926a6a57c3cd32714f43183d0642d9db74c9dd682f9  dist/assets/index-nVDJJXpt.js
```

Final `npm run build:guard -- npm --prefix apps/web run build`, then
`shasum -a 256 apps/web/dist/index.html apps/web/dist/assets/*.js`:

```text
7371edd1863d316fbba345a569ae567be43c2be3fb9d3b34df74066aa2f3066b  dist/index.html
7e364af9238f1e5e18f8cee97e4f368b1f135728251124cd878f2a8da6a2a029  dist/assets/index-DqKPMh3A.js
```

Default output **not byte-identical**: shared gateway/token/WS/source changes alter
the JS hash and thus index asset reference. Source index.html/CSP and Vite base
remain untouched, but that does not satisfy byte identity. Did not hide this with
copied baseline dist, an ignored cached artifact, or a weakened comparison. A
build-time isolation strategy is still necessary if strict identity is retained.

### Evidence, lifecycle failure, permissions

Final current evidence under `apps/web/test-results/`:
- `web-host-shell-A1-configur-3ee48-ll-uses-only-its-own-origin/A1-owner-shell.png`
- Same A1 directory `trace.zip`.
- `web-host-session-A2-projec-7f61e-s-reload-plus-Node-readback/A2-persisted-transcript.png`
- Same A2 directory `trace.zip` and Playwright attached backend-readback JSON.

Canonical `down` was attempted every time. Initial long run down succeeded;
subsequent short run raced engine PID ownership envelope. Provider-bearing runs
restart engine through legitimate config API; down then reports **Refusing unowned
sandbox engine attachment/provenance; engine/API provenance or runtime envelope
mismatch**. Final sanitized diagnostics:
`/private/tmp/rhythm-web-slice1-sandbox-20261022-attempt4-final.evidence.hgq5ST`.
This lifecycle FAIL is independent of the passing assertions. Final trap was
corrected not to mask down's exit, but not rerun live after that correction.
No launcher/provenance safeguard weakened; no manual process-control workaround.

Final read-only `tools/dev/sandbox.sh status` for final directory showed no API
4098, engine 4097, gateway 4099 listeners. `lsof -nP -iTCP:6996 -iTCP:4097
-iTCP:4098 -iTCP:4099 -sTCP:LISTEN` showed no listeners, exit 1 (unrelated Time
Machine SMB stat warning). Sandbox directories/evidence left for operator-owned
cleanup; no assertion that down fully removed them.

Read tool denied `/private/tmp/rhythm-web-slice1-fixtures-20261022/opencode.json`.
No alternate tool/path/copy used to read it; continued using the approved launcher
and remaining source. Manager may inspect it under its own permission. This is
not a scope-approval question and did not stop frontend delivery.

### A1–A5 handoff

| Criterion | Result | Boundary |
|---|---|---|
| A1 | PASS | Chromium realistic origin, owner, no sign-in/foreign page request/CSP errors; screenshot/trace. |
| A2 | PASS | Real scripted loopback provider/API/engine, project/session, WS stream, reload and Node HTTP messages readback; no paid model. |
| A3 | PASS | Unchanged security suite 8/8 in final sandbox. |
| A4 | FAIL | Unit 5/5 + API 29/29 + typecheck/builds/smoke pass, but Electron HTML AND JS identity fail. |
| A5 | FAIL overall (partial) | Reusable harness/specs with named bug assertions and backend readbacks work; canonical down fails provenance after runtime restart; final trap only syntax checked. |

Smallest next action: manager reviews the frontend diff and passing A1/A2 traces,
then addresses strict Electron build isolation and asks the sandbox owner to
resolve runtime-restart provenance/teardown (no safeguard bypass). Independently
rerun exact checked commands. Pending question reload, role-dependent identity,
honest cloud-unavailable states across all pages and every currently-confirmed
working feature still require explicit qualification. Do not call this full web
feature parity or begin Slice 2 from this receipt.

Final post-receipt audit: reran browser units with the same all-RHYTHM_* removal
prefix (`env $(env | cut -d= -f1 | /usr/bin/awk '/^RHYTHM_/ {print "-u " $0}')
node --test apps/web/tests/web-host/browser-gateway.test.mjs`): **5/5 PASS**.
`git diff --check` PASS; HEAD remains c8dae8461b, all edits uncommitted. Confirmed
current A2 screenshot and trace files exist; backend-readback is a Playwright
in-memory attachment, not a separate checked JSON file in that directory.

## Manager review after Attempt 4 (2026-10-22)

- Electron identity criterion revised (manager error in attempt-4 brief): byte identity of the bundle is impossible once shared source changes. Real invariant verified: CSP in `dist/index.html` sha256 of the CSP attribute equals the source `index.html` CSP (`fe847f84...`), and `dist/index.html` equals `dist-web/index.html` modulo asset names. Desktop-path code changes are limited to the `^http`->`ws` regex (identical result for http) and token guards relaxed only for fetchers created by `trustedBrowserFetcher` (browser branch only).
- Desktop gateway regression: `playwright test tests/gateway/{gateway,sessions-gateway,tasks-gateway,receipt}.spec.ts --workers=1` with all `RHYTHM_*` unset -> **27 passed**. First run failed 10/10 in gateway.spec with `Cannot find package 'react' imported from packages/rhythm-workspace-ui/src/context.tsx`; reproduced identically with `apps/web/src` changes stashed (pre-existing environment). Fixed by `npm run build:guard -- npm --prefix packages/rhythm-workspace-ui ci --workspaces=false --ignore-scripts`.
- Evidence loss: that regression run reused `apps/web/test-results/`, which Playwright clears at start; the attempt-4 A1/A2 screenshots/traces listed above no longer exist. Pass results stand as recorded; next live run must use a separate `--output` dir.
- Teardown provenance FAIL cause: `web-host-session.spec.ts` registers the provider through `PUT /opencode/providers`, which restarts the engine under the API; `down` then refuses the unrecorded engine PID. No listeners leaked; sandbox dirs attempt4, attempt4-a2, attempt4-a2-repair1, attempt4-final remain in /private/tmp awaiting approved cleanup.
- GitNexus detect_changes (stale index b846fdc): 39 symbols / 26 files, risk low, 0 affected processes.
