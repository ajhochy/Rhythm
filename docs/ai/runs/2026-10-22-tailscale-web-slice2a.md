---
date: 2026-10-22
repo: Rhythm
branch: feat/tailscale-web-app-20261022
pr: 1598
issues: []
status: ready-for-verification
tags: [run, Rhythm, tailscale-web, acceptance-contract]
---

# Slice 2a

## Scope / entry / safeguards
Explicit manager handoff; acceptance-contract loaded first, then coding-agent.
HEAD e2fa501a1f2f3ae25ae4a23df8606d552cab0ac5, initially clean. Only L1/U1/U2/U3/O1
and necessary internal functions/tests authorized. No cloud forwarding, approval
adapter, credentials, networking, paid models, commits/push/switch, provenance
weakening or live-app operations. Planning agent's parity matrix is excluded.
Manager independently verifies unchanged checks against the resulting artifact.

WAIVED: this run log is non-behavioral documentation; product work is not waived.

## Read / receipts
Read AGENTS, project-state, current-plan, regression-registry, Slice 1 receipt
including manager review and rebase gate, and web-host harness/tests before
investigation. Registry section 0 warns busy is sticky, so reply text is not
completion proof. Slice 1 lines 937–953 identify known provider-triggered restart,
three screenshot defects, explicit workstreams pair and baseline regression bar.
External plan read DENIED: `/Users/ajhochhalter/Documents/Obsidian Vault/Projects/rhythm/Tailscale Web App Plan.md`.
No alternate tool/path/copy used to bypass it. Continue from explicit handoff.

## Acceptance contract
Make these checks pass without weakening assertions. Paths: web-host tests,
scripted provider only if proved faulty, sandbox_fixture and harness, web gateway/
startup/shared shell and affected existing pages; backend web_host bootstrap only.
Never edit sandbox_engine_attachment or the concurrent parity plan.
- L1: fixture-lifecycle.test.mjs pre-provisions loopback model/profile; full live
  suite must exit 0 including canonical down and no 4097/4098/4099/6996 listeners.
- U1: web-host-status.spec.ts observes same-origin health calls and rendered Live.
- U2: A2 strengthened separately to require idle UI/WS/backend live and on reload.
- U3: web-host-cloud-unavailable.spec.ts each cloud page's existing unavailable
  element, Settings' existing equivalent, More navigation, no foreign requests or
  uncaught errors; bell absent domains not errors, no unsafe Mark all read.
- O1: DB-read-only owner role comparison and existing Auto-promotion admin gate,
  run with both fixture users. No email needed by this role gate.

## Checks / results
Baseline commands (all inherited RHYTHM_* unset first):
`node --test apps/web/tests/web-host/fixture-lifecycle.test.mjs` → 0/1, genuine
undefined versus loopback baseURL. No product edits yet.
`RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-web-slice2a-red-20261022-1 bash apps/web/tests/web-host/run-sandbox.sh bash -c 'apps/web/node_modules/.bin/playwright test --config apps/web/tests/web-host/playwright.config.ts web-host-status.spec.ts web-host-cloud-unavailable.spec.ts --output=/private/tmp/rhythm-web-slice2a-red-browser-20261022-1'`
→ 6 pass / 7 fail (40.5s). Dashboard, Planner, Tasks, Messages, Facilities lack
unavailable state; bell badge count 1 not 0; bootstrap lacks DB admin role.
Rhythms, Projects, Automations, Integrations, Settings already pass. U1 already
passes after settling; screenshot-before-settle is not a reproduced health bug.
Canonical down removed sandbox; diagnostics `.evidence.IXCzpi`. No provider config
mutation/A2 ran in this baseline, avoiding the already-known restart leak.

## Phase 1 — consolidated review (before product edits)
GitNexus is stale b846fdc. Upstream impacts: DashboardPage HIGH (2 direct,
0 indexed processes, 4 total); loadTasks HIGH (2 direct, 0 processes, 4 total).
Direct drilldown: Dashboard callers LiveArtifactsShell/LiveArtifactsWorkspace;
loadTasks callers TasksPage/recover. Source cross-check confirms App routing,
LiveArtifactsShell fallback when cloud domains absent, task startup/retry reads.
PlannerPage, TasksPage, MessagesPage, FacilitiesPage LOW (1 direct each, 3 total,
0 processes); Shell/FixtureProvider/sandbox_fixture LOW (0 indexed dependents).
renderGateway disambiguated function LOW (1 direct, 0 processes).
createWebHostRouter/cleanup unindexed; api_impact(web_host.ts) has no routes.
No zero-edge claim of isolation: actual createApp mounts bootstrap, main consumes
it, and real HTTP security/CSP tests exercise it. Source grep confirms each path.
HIGH warning reported to manager before edits, not treated as new scope approval.
Risk: shared dashboard/live task/notification changes must preserve native and
fixture paths. Use existing page StatePanels on absent live domains only; do not
fallback to fixtures, suppress genuine failures, or alter cloud/native auth.
Proportionate tests: real browser unavailable pages + desktop gateway 27 + API
95/CSP + both builds. Bootstrap additive role only, not permissions/auth changes.
L1 fixture flag additive, default fixture unchanged; no sandbox.sh/provenance edits.
PATCH /agent-configs does call reloadAgentProfilesBestEffort → reloadConfig;
seed local-lean model before up as well, remove both runtime writes from A2.
U2 provider source already emits finish_reason stop then [DONE]; don't infer idle
from transcript. Strengthen A2 before first run with no product lifecycle edits.

Additional in-scope Settings review, before its edit: SettingsPage and nested
renderInspector impacts LOW, zero indexed dependents/processes (stale index).
Source confirms App → SettingsPage → ListInspector; ListInspector suppresses
both list and detail when any error exists. This cloud failure was blocking
local appearance/runtime preferences too. Added a real failing local-Settings
check before repairing that branch. No scope expansion or renewed approval.

## Files

Production:
- `apps/api_server/src/services/web_host.ts`: additive DB owner's role only.
- `apps/web/src/main.tsx`: validate role metadata and use it, not hardcoded member.
  Email remains empty to satisfy AuthUser's required string; no feature here
  needs real email, so none is exposed in bootstrap. Role remains a UI projection,
  not a replacement for backend authorization.
- `apps/web/src/components/Shell.tsx`: absent notification/approval domains show
  explicit unavailable notice; no Mark all read against an absent gateway.
- `apps/web/src/store.tsx`: do not poll an absent approvals domain or synthesize
  an error from undefined.listPending. Genuine configured-domain failures retained.
- `apps/web/src/pages/{dashboard,planner,messages,facilities}/index.tsx`: reuse
  existing unavailable StatePanels before mounting an absent live gateway.
- `apps/web/src/pages/tasks/index.tsx`: absent-domain guard, no fixture rows even
  on initial live render. Fixture mode untouched.
- `apps/web/src/pages/settings/index.tsx`: cloud absence no longer hides local
  sections. Existing workspace-error state for workspace/members/join code/
  facilities access/notification preferences; no invented email preference data
  or controls against an absent domain. Real configured errors and local action
  errors remain visible.

Harness/contracts:
- `tools/dev/sandbox_fixture.mjs`: additive `--web-host` only; creates synthetic
  local-lean profile, loopback provider/catalog and fake auth-store entry before
  startup. Default and --c1 behavior unchanged. Safe local MCP map retained.
- `apps/web/tests/web-host/run-sandbox.sh`: requires new explicit sandbox dir,
  generates a new read-only fixture dir per run, copies synthetic auth via the
  existing config-dir option, supports explicit member owner, audits freed ports
  after canonical down. No sandbox.sh or attachment/provenance changes.
- `apps/web/tests/web-host/web-host-session.spec.ts`: removes runtime provider
  PUT and profile PATCH (both reload); asserts pre-provisioned profile and adds
  idle header/Send/WS/backend/reload checks plus evidence.
- `apps/web/tests/web-host/security.test.mjs`: exact owner whitelist gains ONLY
  the authorized role field; no secret-disclosure/security assertion removed.
- New `fixture-lifecycle.test.mjs`, `web-host-status.spec.ts`,
  `web-host-cloud-unavailable.spec.ts`; this run log.

Concurrent parity matrix never edited. No other memory snapshot overwritten.

## Repair ledger / earlier failures preserved

1. L1 fixture baseline failed missing provider; first fixture implementation
   exposed that fresh initDb has no local-lean row (UPDATE matched zero). Second
   and final fixture-contract repair explicitly inserts the synthetic profile.
   Unchanged contract passed 1/1, later combined with browser unit 6/6.
2. First candidate live run (`green-20261022-1`) passed 14/15 browser cases but
   A2 failed `Could not resolve a model for agent 'build'`. No provider hit.
   Root cause was fixture provisioning, not browser turn lifecycle: model
   resolution checks OpencodeAuthStore (`listAuthedProviders`), not the config's
   options.apiKey. Seeded the checked fake local key into the synthetic fixture
   auth.json and selected the existing config-DIRECTORY copy option. No real
   credential file read or product resolver/auth change. Next live run passed
   15/15, A3 8/8 and down 0; original API/engine PIDs unchanged through suite.
3. First A3 candidate 7/8 failed exact bootstrap owner equality after the
   authorized role addition. Updated its exact whitelist to include role,
   retaining root keys and secret-field denial. Next runs 8/8.
4. First O1 draft used a path segment for Auto-promotion. Source shows existing
   `?settingsSection=auto-promotion`; corrected before reaching UI assertion.
   No role assertion weakened. Both real DB owner roles now pass that gate.
5. Follow-up classification audit found Settings' global cloud-error blocked
   local sections. Added `local Settings` test and ran BEFORE its product edit
   in member run `member-20261022-1`: 1 pass (O1), 1 genuine fail (Theme selector
   missing). One product repair separates absent-cloud state from local pages;
   all final tests pass. The top-nav Settings contract was clarified/strengthened
   to open its cloud Workspace section, rather than treating all Settings as
   cloud. Local appearance/runtime and absent notification preference controls
   are asserted separately. No unavailable criterion relaxed.
6. First API regression invocation from repo root with `--root apps/api_server`
   gave 94 pass/1 fail: test's relative `../web/index.html` resolved incorrectly.
   Reran from apps/api_server, assertions unchanged: 95/95 twice. No source fix.

No failing check exceeded two product repair attempts. U1 and U2 did not need
product fixes: existing behavior satisfies the strengthened observable checks
when the check waits for HEALTH/IDLE rather than screenshotting the first text.
No fabricated failing assertion or waiver used to pretend otherwise.

## Exact final commands and observed results

Every live command below ran after this prefix, from repo root:

```sh
for v in $(env | grep -o '^RHYTHM_[A-Z0-9_]*'); do unset $v; done
```

### Final live admin (L1/U1/U2/U3/O1 + A1/A2/A3)

```sh
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-web-slice2a-final-20261022-2 \
  bash apps/web/tests/web-host/run-sandbox.sh bash -c \
  'node --test apps/web/tests/web-host/security.test.mjs &&
   apps/web/node_modules/.bin/playwright test \
     --config apps/web/tests/web-host/playwright.config.ts \
     --output=/private/tmp/rhythm-web-slice2a-final-browser-20261022-2'
```

PASS, exit 0: A3 **8/8**, Playwright **16/16 (32.6s)**. Canonical down removed
the sandbox and printed `web-host teardown: exit=0 (canonical down and port audit)`.
API 35962 / engine 36004 at startup, no configuration-write restart during tests.
Fixtures: `/private/tmp/rhythm-web-slice2a-final-20261022-2-fixtures`; generated
read-only DB/config/auth, never copied from operator. Diagnostic envelope:
`/private/tmp/rhythm-web-slice2a-final-20261022-2.evidence.5L2Mqj`.

### Final member (O1 + local Settings)

```sh
RHYTHM_WEB_OWNER_USER_ID=2 \
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-web-slice2a-final-member-20261022-2 \
  bash apps/web/tests/web-host/run-sandbox.sh bash -c \
  'apps/web/node_modules/.bin/playwright test \
     --config apps/web/tests/web-host/playwright.config.ts \
     --grep "O1:|local Settings" \
     --output=/private/tmp/rhythm-web-slice2a-final-member-browser-20261022-2'
```

PASS, exit 0: **2/2 (1.3s)**; down and port audit 0. API 37332/engine 37371.
O1 opens each generated fixture DB using better-sqlite3 `{readonly:true,
fileMustExist:true}`: id **1 Synthetic Admin/admin**, id **2 Synthetic Member/member**.
Bootstrap equals row; existing Auto-promotion panel visible to admin, existing
`Administrator access required...` state visible to member. No role mutation.
Diagnostics: `...final-member-20261022-2.evidence.9LuIax`.

### U2 evidence / browser-specific determination

Unchanged scripted provider sends `{finish_reason:'stop'}` then `[DONE]`
(`scripted-openai-provider.mjs:102`); no provider code fix required. provider.log
shows only loopback listener startup. Actual `/_s0/status` readback: one `plain`
hit, afterTool false, **disconnects 0**. Final console evidence for exact local
session `6598be7c-be80-4d49-a48c-4bf7b27b3741`:

```json
{"v":1,"type":"session.status","id":"6598be7c-be80-4d49-a48c-4bf7b27b3741","working":true,"status":"busy"}
{"v":1,"type":"session.status","id":"6598be7c-be80-4d49-a48c-4bf7b27b3741","working":false,"status":"idle"}
{"v":1,"type":"session.status","id":"6598be7c-be80-4d49-a48c-4bf7b27b3741","working":false}
```

Header **Idle**, Send visible / composer-cancel absent, DB-backed API status
**idle**, durable transcript and idle after reload. No browser-specific product
turn-lifecycle defect reproduced. The former acceptance checked reply text
before stream completion; it now checks the actual terminal state. No claim to
have fixed an unrelated mega lifecycle defect; none demonstrated in this lane.
Initial model-routing failure above was a synthetic fixture defect, not browser.

### Regressions (unit commands OUTSIDE sandbox shells, all RHYTHM_* unset)

```sh
node --test apps/web/tests/web-host/browser-gateway.test.mjs \
  apps/web/tests/web-host/fixture-lifecycle.test.mjs
npm --prefix apps/web run typecheck
npm run build:guard -- npm --prefix apps/web run build:web
npm run build:guard -- npm --prefix apps/web run build
npm run build:guard -- npm --prefix apps/api_server run build
npm --prefix apps/web run test:dist-smoke
```

PASS: browser **5/5** plus fixture **1/1**; typecheck; both web builds (1789
modules, existing chunk-size warning), API build/postbuild; dist smoke `index
and 2 relative assets verified`. Builds are one-shot guarded; no sandbox under
build guard. Existing desktop Playwright config also owns its default dist build.

From **apps/api_server** (not repo root):

```sh
./node_modules/.bin/vitest run src/services/web_host_csp.test.ts \
  src/config/web_host.test.ts src/middleware/web_host_surface_contract.test.ts \
  src/middleware/local_agent_surface_guard.test.ts \
  src/services/opencode_client_service.test.ts
```

PASS **5 files / 95 tests**, final 3.84s. No nonexistent filters or env-leak claim.

From repo root:

```sh
apps/web/node_modules/.bin/playwright test --config apps/web/playwright.config.ts \
  apps/web/tests/gateway/gateway.spec.ts \
  apps/web/tests/gateway/sessions-gateway.spec.ts \
  apps/web/tests/gateway/tasks-gateway.spec.ts \
  apps/web/tests/gateway/receipt.spec.ts --workers=1 \
  --output=/private/tmp/rhythm-web-slice2a-desktop-final-20261022-2
bash tools/dev/sandbox_guard_test.sh
python3 tools/dev/sandbox_bootstrap_test.py
bash -n apps/web/tests/web-host/run-sandbox.sh
git diff --check
```

Desktop PASS **27/27 (14.2s)**. Guards **24 passed / 0 failed** (also captured
standalone). Bootstrap **Ran 5 tests, FAILED (failures=4)**: same pre-existing
checkout-local fork resolution subcases and old launcher source-literal/MCP
assertions described in Slice 1. No new failures, neither launcher nor bootstrap
test edited. Initial guard/bootstrap run accidentally retained inherited env;
repeated both clean; same results. Harness syntax and diff whitespace pass.

### Electron CSP / live-port audit

Executable equality check used Node `fs.readFileSync` on source index and default
dist index, regex `/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i`,
`assert.equal(dist, source)`, then SHA-256 of each matched attribute. **PASS exact
attribute equality**. Both observed hashes:
`e1d472b74459bd181468614179ceb8d2743cf9a7a1efb763b8124b8e89c19bba`.
The brief's `fe847f84...` prefix is **not** this extraction's observed hash; do
not report it as observed. Source index/CSP is untouched (`git diff` empty).
Full CSP meta and line also byte-equal between source/dist. No policy relaxation.

```sh
lsof -nP -iTCP:4097 -iTCP:4098 -iTCP:4099 -iTCP:6996 -sTCP:LISTEN
lsof -nP -iTCP:4001 -iTCP:4002 -iTCP:4096 -sTCP:LISTEN
```

Final first command no listener rows (exit 1). Live second command still node
**4697** on 4001/4002 and engine **4743** on 4096, matching manager's IDs. No
requests or control directed to live ports. lsof prints pre-existing unrelated
SMB Time Machine stat warnings. No manual process kills: canonical script owns
API/engine; harness reaps only its own scripted-provider child as before.

## Page classification (source-backed, not all pages called cloud)

`createLiveGateway` in browser mode explicitly omits productionApiBase domains;
they are not local merely because older copy says “local service.” Local `/projects`
used by agent sessions is distinct from production project templates/instances.

| Top-nav / section | Class / wiring | Browser result and proof |
|---|---|---|
| Dashboard (+ artifacts) | Cloud: dashboard/liveArtifacts/userPreferences | Existing page-state-unavailable; no fixture fallback; U3 |
| Planner | Cloud: planner | Existing page-state-unavailable; U3 |
| Tasks | Cloud: tasks/workspaceMembers | Existing page-state-unavailable; no seeded live rows; U3 |
| Rhythms | Cloud: rhythms | Existing page-state-unavailable; U3 |
| Projects | Cloud: projects (NOT local agent projects) | Existing page-state-unavailable; U3 |
| Messages | Cloud: messages | Existing page-state-unavailable; U3 |
| Facilities | Cloud: facilities | Existing page-state-unavailable; U3 |
| Automations | Cloud: automations | Existing page-state-unavailable; U3 |
| Integrations | Cloud: integrations | Existing page-state-unavailable; U3 |
| Agents | Local: sessions, profiles, catalog, projects, WS | Real created project/session, stream, idle, reload, Node readback A2; not replaced by unavailable |
| Settings — appearance / keyboard / account identity | Local device/validated owner | Theme enabled; identity real; no cloud gate hiding local sections |
| Settings — runtime / retention / Dayflow | Local API/device | Runtime displays healthy in U3; retention/Dayflow deeper behavior deferred to parity stage |
| Settings — workspace / members / join code / facilities access / email notification preference | Cloud: settings | Existing settings-workspace-error text; no mutation controls for absent data |
| Notifications bell / approvals | Cloud-backed notifications; protected local approval adapter deferred | Explicit unavailable; no absence-caused badge/error and no unsafe Mark all read |
| More | Navigation, not a data domain | Actual compact More used for every non-Dashboard cloud destination + Settings |
| Hermes / Bot Crossing / OpenDesign / native Dayflow host | Native host bridges (`availableAgentToolIds`) | Not advertised by browser without host; direct native-route parity NOT RUN/not claimed |

All 10 specified cloud/mixed top-nav page visits assert **zero off-origin
requests and zero uncaught page errors**. Tests never intercept/mimic application
responses; real built browser app, API, DB and fork. The only scripted surface
is the model provider's loopback protocol, no paid model.

## Evidence

Final admin evidence root: `/private/tmp/rhythm-web-slice2a-final-browser-20261022-2/`.
- `web-host-session-A2-projec-7f61e-s-reload-plus-Node-readback/`:
  `turn-completion.png`, `A2-persisted-transcript.png`, `trace.zip`; trace-attached
  JSON `turn-completion` (all WS frames, API detail, provider status) and
  `backend-readback` (project/session/messages).
- `web-host-shell-A1-configur-3ee48-ll-uses-only-its-own-origin/`:
  `A1-owner-shell.png`, `trace.zip`.
- U1 status directory: `environment-healthy.png`, trace.
- Cloud directories: `${destination}-unavailable.png`, bell
  `notifications-unavailable.png`, local/cloud Settings screenshot, all traces.
- O1 admin directory: `owner-admin.png`, trace.
Member root: `/private/tmp/rhythm-web-slice2a-final-member-browser-20261022-2/`,
O1 `owner-member.png` and local Settings screenshot/traces. Desktop output root:
`/private/tmp/rhythm-web-slice2a-desktop-final-20261022-2/` (success traces are not
enabled by that existing config). Earlier failing runs preserved under red,
green-1, and member-1 output roots named above; no default test-results reuse.

## Final scope / phase / handoff

Final GitNexus detect_changes(all, this worktree, Rhythm): **11 indexed symbols,
14 tracked files, MEDIUM, 1 affected process** `RenderInspector →
LocalUserPreferencesKey`. Expected Settings flow; actually exercised local
appearance/runtime. EntityDestination is a stale/coarse hunk attribution, not
an edited function. New modules/tests and newer bootstrap are unindexed; source
diff authoritative. No change to sandbox.sh, attachment/provenance, engine fork,
source CSP, networking, credentials, dependencies or parity matrix.

| Item | Result |
|---|---|
| L1 | PASS: pre-start fixture 1/1; full live + canonical down + port audit 0 |
| U1 | PASS: already-correct settled health; new same-origin browser assertions |
| U2 | PASS: no lifecycle code change; idle live/WS/DB/reload and clean provider termination |
| U3 | PASS: 12 real browser checks incl. all specified pages, bell, local Settings |
| O1 | PASS: DB-backed admin AND member + existing role gate |

Phases 0/1/2 complete; **READY_FOR_VERIFICATION for Slice 2a only**. Manager must
independently rerun these commands without editing application source. No claim
that AJ's all-confirmed-working-features bar is met. Remaining assigned later
slices: 2b cloud forwarding + AJ-present credential handoff, 2c approvals adapter,
3 parity-matrix feature-port qualification. No commit/push/switch done; all code
and test edits left uncommitted at e2fa501a1f for manager review. External plan
read denial remains a host-policy limitation, not an approval to bypass it.

Final post-log `git diff --check` and harness `bash -n` passed. Exclusion audit
initially hit zsh unmatched wildcard (no git operation ran); quoting
`'tools/dev/sandbox_engine_attachment*'` corrected the read-only pathspec.
`git diff --name-only` for all excluded paths returned empty. HEAD remains
e2fa501a1f2f3ae25ae4a23df8606d552cab0ac5; exactly 18 changed/new task files.

## Manager verification (2026-10-22)

- Diff review: security.test.mjs only adds `role` to the exact-owner assertion (no weakening); index.html unchanged since e2fa501. The CSP hash prefix difference (`e1d472b7` vs `fe847f84`) is two extraction methods over the same unchanged attribute; source == dist under both.
- Desktop-affecting edits (Tasks live initial state, Settings list-level error gating, approvals polling guard): ran the 31 existing desktop page specs that touch Settings/Tasks/Dashboard/Planner/Messages/Facilities/notifications (default config, all RHYTHM_* unset). Precise JSON failure-set comparison on the 10 specs with failures, base (apps/web/src stashed) vs slice 2a: **62 failed / 67 passed in both, identical failure set; 0 new, 0 fixed**. The 62 are pre-existing in this environment (ERR_BLOCKED_BY_CLIENT navigation, missing PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, text/geometry assertion drift in notification-presentation and e1-approval-queue suites); not triaged here.
- Independent live run: `RHYTHM_SANDBOX_DIR=/private/tmp/mgr-web-2a-verify-sb bash apps/web/tests/web-host/run-sandbox.sh ...` -> security 8/8, browser **16 passed**, `web-host teardown: exit=0 (canonical down and port audit)`, run-sandbox exit 0, no sandbox listeners, live 4697/4743 identical before/after. L1 confirmed: no manual kills needed.
- Also: build:web PASS, typecheck PASS, browser+fixture units 6/6, api vitest 95/95. Member-role (O1 user 2) run not repeated by manager; worker evidence at /private/tmp/rhythm-web-slice2a-final-member-browser-20261022-2/.
- GitNexus detect_changes (stale index b846fdc): 11 symbols / 14 files, MEDIUM, 1 affected flow RenderInspector -> LocalUserPreferencesKey (Settings inspector; covered by the desktop comparison above).
