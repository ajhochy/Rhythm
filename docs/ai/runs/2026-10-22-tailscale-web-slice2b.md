---
date: 2026-10-22
repo: Rhythm
branch: opencode/web-cloud-2b
pr: null
issues: []
status: blocked
tags: [run, Rhythm, tailscale-web, acceptance-contract]
---

# Slice 2b — synthetic-only cloud forwarder / host handoff

## Scope / approvals

Explicit manager specialist handoff authorizes C1–C4 in this isolated worktree,
C5 only after C1–C4 pass. No page components, Shell, store, approvals adapter,
live app/data/credentials, production calls, network/Tailscale changes, parent
worktree access, push or PR. Developer role forbids commits: leave uncommitted.
No repeated scope approval required for unchanged feature/internal helpers.
Manager is the independent verifier; can execute checked tests without editing
application sources. No independent verification claimed here.

Initial command `pwd && git branch --show-current && git rev-parse HEAD`:
`/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/web-cloud-2b`,
`opencode/web-cloud-2b`, `e2fa501a1f2f3ae25ae4a23df8606d552cab0ac5`. Clean initial tree.

## Phase 0 / checks

Loaded acceptance-contract first, then coding-agent. Read AGENTS, project-state,
current-plan and the entire slice-1 receipt including manager review/rebase gate.
Host policy DENIED the external Obsidian plan; restated essentials used. Host
policy DENIED `/private/tmp/rhythm-feature-playwright-2026-10-19/apps/opencode_fork/packages/opencode`.
No alternate tool/path used to bypass either denial. Live checks blocked: cannot
verify approved read-only binary provenance; no sandbox launched.

Dependencies: guarded real `npm --prefix apps/api_server ci --workspaces=false`
(180 packages, 15 audit findings), web (80, 3 findings), workspace-ui with
`--ignore-scripts` (154, 7 findings). No dependency remediation in scope.

Contract command from apps/api_server (unset ALL inherited RHYTHM_*):
`env $(env | cut -d= -f1 | /usr/bin/awk '/^RHYTHM_/ {print "-u " $0}') ./node_modules/.bin/vitest run src/services/web_cloud_contract.test.ts`
Baseline: **12 passed / 12 failed**. Genuine reds: valid credential bootstrap
false rather than true; forwarder 404 vs 200; traversal 404 vs 400; redirect 404
vs 502; auth failure NOT_FOUND vs CLOUD_ACCOUNT_DISCONNECTED; oversized body
500 vs 413. Existing refusal/Origin cases already pass: retained as boundaries,
not claimed as missing behavior proof. Real Express app + SQLite + fake upstream
127.0.0.1:7097; no system-under-test mocking (only web config injection).

From apps/web, same env prefix:
`./node_modules/.bin/playwright test tests/gateway/cloud-browser.spec.ts --workers=1 --output=/private/tmp/rhythm-cloud-2b-contract-red`
Baseline **1 failed**, expected tasks gateway defined, actual undefined.
Corrected an unexecuted test-author API typo (`projects.list` -> `templates`),
not an assertion relaxation. Mistake: default Playwright config auto-built web
in this initial run without build:guard; future Playwright commands use guard.

Mandate: make named contracts pass without weakening them. C4 contract must
precede exporter implementation; C5 and live UI proof remain separately gated.

## Phase 1 review

GitNexus stale b846fdc in another checkout, not authoritative for this tree.
Upstream impact: createApp LOW 0 direct/0 processes; initializeWebHost and
createWebHostRouter unindexed UNKNOWN. api_impact(web_host.ts) no routes found.
createLiveGateway LOW 1 direct / 3 total / 0 processes, composeGateway LOW 1
direct / 2 total / 0 processes. renderGateway initially ambiguous, disambiguate
before edit. Exact source search cross-checks server.ts->initializeWebHost,
app.ts->createWebHostRouter, main.tsx->composeGateway->createLiveGateway and tests.

## Notes

No durable production user-ID mapping exists in User (models/user.ts:1–14).
Existing cloud binding is verified `/auth/me` Google subject plus matching email
(services/mobile_cloud_identity_service.ts:109–134), not equality of local/cloud
numeric IDs. Use its stricter non-mutating equivalent: compare existing owner's
nonempty googleSub and email, plus credential userId to authoritative cloud id;
do not bind/backfill/mutate local DB. Cloud unavailable if no existing mapping.

### Consolidated impact and risk review

Disambiguated renderGateway: LOW, 1 direct, 0 processes. Upstream analysis for
every adapted createLive* cloud factory: LOW, 0–1 direct, 0 processes. Tasks
request LOW/1 direct/8 total; response helpers Tasks MEDIUM/7, Dashboard
MEDIUM/10, Planner MEDIUM/8, Rhythms MEDIUM/9, Messages MEDIUM/7, Automations
MEDIUM/10, Notifications LOW/3, parsedError LOW/2 direct/13 total. Projects
response HIGH/21, Facilities HIGH/17, Integrations HIGH/16 direct: warned before
edit. Preserve success parsing, typed errors, statuses and desktop error labels;
only the exact disconnected code gets the new bounded label. Proportionate
tests exercise these three domain errors over real HTTP plus desktop 27/27.

New cloud functions, trustedBrowserFetcher, Electron main/exporter, fixture/api
and harness/script targets unindexed UNKNOWN. Exact-source caller/read review
covers server initialization/bootstrap, guard-before-router and parser/logger
order; main's current in-memory session, restore/persist/invalidate/OAuth/ready
paths and native dialog wrapper; cloud factories/composition; and existing
synthetic fixture/registrar/auth-fixture gates. No auth-policy, native approval,
existing session persistence, process ownership or teardown safeguard changed.
Sandbox change is only credential PATH pass-through in the existing web block.

Read regression-registry.md and searched docs/ai for traversal/Express slash/cloud
forwarder before the raw-slash repair. Prior slice1 receipt:338,493 covers raw
HTTP traversal (not browser-normalized URLs); no existing /cloud slash fix found.
First server candidate 23/24: Express mount removed a leading slash in req.url.
Repair 1 validates req.originalUrl; unchanged suite then 24/24. Later exact-body
check genuinely failed before its fix (`'{}'` vs `''` on bodyless DELETE).
One repair uses transport body presence rather than Express's default `{}`.

Final GitNexus detect_changes(all, explicit worktree): 70 indexed symbols,
26 tracked files, LOW, 0 affected processes. Stale line offsets produce coarse
hits (e.g. isLoopbackAddress); untracked new modules are omitted. Source diff is
authoritative. No reindex, commit, peer dispatch or other checkout access.

## Files

- NEW `apps/api_server/src/services/web_cloud.ts`: protected startup descriptor
  read, trusted fixed destination, non-mutating owner verification, cloud state
  and bounded JSON forwarder. Unsafe credentials leave local host up.
- `apps/api_server/src/services/web_host.ts`: initialize cloud after owner/dist,
  advertise only a boolean in bootstrap.
- `apps/api_server/src/app.ts`: web-only /cloud behind shared guard, before broad
  parser/logger. Desktop route/auth behavior unchanged.
- NEW `apps/api_server/src/services/web_cloud_contract.test.ts`: 30 synthetic
  real HTTP/SQLite cases, fake :7097; refusal/identity/snapshot, headers,
  redirects/traversal/Origin, expiry, cap/parse/type, reflection/log suppression,
  real timeout and bodyless DELETE. UID is simulated at the OS getuid boundary;
  no privileged chown or mock fetch/system-under-test.
- NEW `apps/electron/src/web-cloud-export.mjs`: native menu/confirmation,
  in-memory session recheck, protected dir/file, atomic temp+fsync+rename,
  ownership/symlink refusal, generic safe errors, no IPC or secure-store access.
- `apps/electron/src/main.mjs`: namespace Electron import and installer in ready;
  credential callback from existing memory, disabled smoke/qualification gate.
- NEW `apps/electron/test/web-cloud-export.test.mjs`: 7 real-main contracts with
  fake Electron/dialog/safeStorage and synthetic-only temp records. Cancel,
  signed-out, unsafe dir, foreign uid, symlink, rename failure/atomicity,
  qualification, no additional decryption/IPC/log/dialog disclosure.
- `apps/web/src/gateway/index.ts`: cloud boolean, existing factories over fixed
  `${origin}/cloud` using existing trusted tokenless fetcher. Browser approvals,
  mobileAccess/sharedAgents remain undefined.
- NEW `apps/web/src/gateway/cloud-error.ts`: exact-code bounded account label.
- `apps/web/src/gateway/tasks.ts`, `dashboard.ts`, `planner.ts`, `rhythms.ts`,
  `projects.ts`, `messages.ts`, `facilities.ts`, `automations.ts`,
  `integrations.ts`, `live-artifacts.ts`, `user-preferences.ts`,
  `notifications.ts`, `auto-promotion.ts`, `workspace-members.ts`, `settings.ts`:
  token guard relaxation only via isTrustedBrowserFetcher, disconnected label.
  Tasks token type permits undefined (trusted transport strips header).
  Integration OAuth URL creation refuses browser use, never invents/query-exports
  a token. Existing desktop production validator remains unchanged.
- `apps/web/src/main.tsx`: 5-line diff passing bootstrap cloud flag; no browser
  login/token/per-document MCP init.
- NEW `apps/web/tests/gateway/cloud-browser.spec.ts`: real HTTP composition,
  Tasks/Projects read, high-fanout errors, same-origin/no bearer, local sessions.
- NEW `apps/web/tests/web-host/fake-cloud.mjs`: synthetic-only loopback :7097,
  Node-side recorded-request, disconnect and shutdown controls.
- NEW `apps/web/tests/web-host/web-host-cloud.spec.ts`: RHYTHM_LIVE_E2E=1 AND
  RHYTHM_WEB_CLOUD_TEST=1 gated Tasks/Facilities render, Node bearer readback,
  expiry message via Facilities, local no-prompt session, browser requests/
  responses/HTML/bootstrap/storage token scans. **NOT RUN live.**
- `apps/web/tests/web-host/fixture.ts`, `playwright.config.ts`, `run-sandbox.sh`:
  env-parametrized origins/ports/fixture/engine paths, original defaults retained.
- `apps/web/tests/live/scripted-openai-provider.mjs`: provider port env, old
  default6996 retained; cloud recipe sets7096. Existing A2 spec is still default-
  port-only and is not selected by the alternate-port recipe.
- `tools/dev/sandbox.sh`: additive credential PATH pass-through only.
- `tools/dev/sandbox_fixture.mjs`: optional --api-port/--cloud-port/--web-cloud
  synthetic subject, protected credential/registrar. Default behavior retained.
- This log. No retained dependency/lockfile or generated evidence changes.
  Restored own generated `docs/ai/runs/evidence/electron-m1-shell.png` after smoke.

## Final commands and results

Below CLEAN denotes the exact prefix:
`env $(env | cut -d= -f1 | /usr/bin/awk '/^RHYTHM_/ {print "-u " $0}')`.
Commands from repo root unless specified. No unrun check is reported as a pass.

### API and security — PASS 78/78, six files (18.37s)

From `apps/api_server`:
```sh
CLEAN ./node_modules/.bin/vitest run src/services/web_cloud_contract.test.ts \
  src/services/web_host_csp.test.ts src/config/web_host.test.ts \
  src/middleware/web_host_surface_contract.test.ts \
  src/middleware/local_agent_surface_guard.test.ts \
  src/contract/local_agent_surface_hardening.test.ts
```

Cloud suite 30/30, including real 15s abort. Earlier selection 77/77 before
bodyless check; isolated new red command with `-t 'preserves bodyless DELETE'`
gave 1 fail /29 filtered skips. One fix, then final78/78. No token-bearing log
output observed; reflection refusal console capture and response scans pass.

### Frontend composition + requested desktop regressions — PASS 28/28 (24.8s)

```sh
CLEAN RHYTHM_E2E_PORT=4293 RHYTHM_DIST_PORT=4294 npm run build:guard -- \
  apps/web/node_modules/.bin/playwright test --config apps/web/playwright.config.ts \
  tests/gateway/cloud-browser.spec.ts tests/gateway/gateway.spec.ts \
  tests/gateway/sessions-gateway.spec.ts tests/gateway/tasks-gateway.spec.ts \
  tests/gateway/receipt.spec.ts --workers=1 \
  --output=/private/tmp/rhythm-cloud-2b-gateway-final
```

Cloud1 + desktop27 pass. First aggregate attempt blocked at occupied :4173.
Did not reuse/manage listener; distinct4293/4294 repaired test infrastructure.
No application repair needed. Output dirs are separate from slice1 evidence.

### Electron — final 49/49 + isolated actual-shell smoke23/23 PASS

```sh
CLEAN node --experimental-vm-modules --test --test-concurrency=1 \
  apps/electron/test/web-cloud-export.test.mjs \
  apps/electron/test/e12a-auth-boundary.test.mjs \
  apps/electron/test/main-runtime.test.mjs apps/electron/test/google-oauth.test.mjs \
  apps/electron/test/production-api-security.test.mjs
CLEAN npm run build:guard -- node --experimental-vm-modules --test \
  --test-concurrency=1 apps/electron/test/electron-shell.test.mjs
```

Exporter7/7. Before exporter implementation the real-main contract was0/3,
`native owner menu action must exist` (genuine red, not missing-import failure).
Initial green3/3, then extra boundaries7/7. Final shell smoke23/23 ran after the
native submenu typing repair. Tests manage synthetic profiles, not daily app.

### Builds and other gates

- PASS `npm run build:guard -- npm --prefix apps/api_server run build`, final
  after body repair: tsc + advisory postbuild copy succeed.
- PASS `npm run build:guard -- npm --prefix apps/web run typecheck`.
  Initial ad-hoc `npm --prefix apps/web exec -- tsc --noEmit -p tsconfig.app.json`
  failed invocation (root tsconfig path), corrected to existing typecheck script.
- PASS guarded `npm --prefix apps/web run build` and `run build:web`:1790 modules,
  separate dist/dist-web, existing chunk warning. `npm --prefix apps/web run
  test:dist-smoke`: PASS index+2 relative assets.
- **FAIL overall** `npm run build:guard -- npm --prefix apps/electron run typecheck`.
  Initial helper lacked JSDoc; repair1 added types and exposed MenuItem vs menu
  options typing. Repair2 builds a real submenu then appends item. Test boundary
  Menu mock corrected to actual append/events, no assertions weakened. Final
  compiler output ONLY unchanged `src/hermes-backend-artifact.mjs(58,41):TS7053`,
  `Architecture` cannot index `{arm64:73;x64:72}`, `Property arm does not exist`.
  `git diff -- ...hermes-backend-artifact.mjs` empty. No unrelated repair, no
  aggregate PASS claim, no more than two repair attempts.
- **PASS meaningful CSP equality, supplied pinned prefix not reproduced.** Node
  regex `/http-equiv="Content-Security-Policy" content="([^"]*)"/` extracts exact
  source and Electron `apps/web/dist/index.html` raw attribute; equality passes.
  UTF-8 SHA256 without added LF, BOTH:
  `e1d472b74459bd181468614179ceb8d2743cf9a7a1efb763b8124b8e89c19bba`.
  Full meta-element hash BOTH:
  `b0b57d4a451ed11fc0617d216a318bddfeb3d63a1246adba7d97974698f00b20`.
  Diagnostic prefix assertion using attribute+LF FAIL (`6ab40903...` vs brief's
  fe847f84). No CSP/source HTML change to manufacture that prefix; manager must
  reconcile original extraction/input convention. No pinned-hash PASS claimed.
  Node scan of all3 html/js/css assets in EACH dist/dist-web for the three
  synthetic test sentinel tokens PASS (none present).
- PASS CLEAN `node --test apps/web/tests/web-host/browser-gateway.test.mjs`:5/5.
- PASS `bash tools/dev/sandbox_guard_test.sh`:24 passed/0 failed.
- PASS `bash -n tools/dev/sandbox.sh apps/web/tests/web-host/run-sandbox.sh`,
  `node --check tools/dev/sandbox_fixture.mjs`, fake-cloud.mjs, scripted provider.
  CLEAN Playwright cloud config `--list`:3 specs discovered. NOT live proof.
- Bootstrap Python NOT RUN; slice1 receipt documents four baseline drift failures;
  no launcher lifecycle edit here. Full broad API suite NOT RUN.
- PASS `git diff --check`. Guarded real installs also completed Electron74
  packages/3 high audit findings and MCP142/19 findings (prepare build PASS).
  No dependency upgrades/remediation or symlinked node_modules installs.
  Observed shared build guard peak ~8.50GB, below unchanged10GiB ceiling.

## C1–C5 acceptance / phase status

| Criterion | Result | Boundary |
|---|---|---|
| C1 | PASS synthetic server contract | Positive/refusal/identity/snapshot; real owner NOT RUN. Existing subject/email mapping only, no DB mutation. |
| C2 | PASS synthetic real HTTP contract | Fake7097 bearer/header/body/redirect/traversal/Origin/expiry/timeout/cap/reflection. Real engine+API sandbox NOT RUN. |
| C3 | PASS composition contract; UI NOT RUN | Trusted fixed same-origin factories, desktop27/27. Required live UI/expiry/local-session proof blocked. |
| C4 | PASS synthetic real-main exporter contract |7/7, plus final regression/smoke72 tests. New packaged build and real owner export NOT RUN. Aggregate Electron typecheck FAIL above. |
| C5 | NOT RUN / NOT IMPLEMENTED | Explicit C1–C4 acceptance gate, including live checks, not satisfied. Browser still skips ensureRhythmMcp. |

**BLOCKED, NOT READY_FOR_VERIFICATION as a completed slice.** Phase0 genuine
reds recorded, Phase1 source/impact review performed; Phase2 candidate and focused
validation performed but required live/aggregate gates remain. No independent
verifier yet. HEAD unchanged e2fa501a1f2f3ae25ae4a23df8606d552cab0ac5; all changes
uncommitted (developer role prohibition). No commit SHA, push, PR or cutover.

## Ceilings / integration notes vs 2a

- Credential read once at startup; export/renewal/removal needs host restart.
  Upstream401/403 clears in-memory snapshot immediately, local routes stay up.
  File is an independent copy, not automatically deleted on desktop logout;
  owner removal+host restart revokes host copy, upstream expiry/revocation applies.
- 1MiB JSON request, 8MiB buffered response, 15s total deadline; auth/me5s.
  Only upstream Content-Type survives, plus safe local headers. No upstream
  Set-Cookie/Location/hop/arbitrary/encoding/length replay. No binary uploads,
  streaming responses or redirected browser integration OAuth. No token issuance.
- No pages, Shell, store, approvals edits. Likely 2a overlap: main.tsx (only cloud
  flag plumbing here), possibly gateway/index.ts for its environment/status work;
  preserve both its additions and this fixed-origin cloud composition.
- Tasks source receipt `apps/web/src/pages/tasks/index.tsx:162–166` discards
  error.message and maps typed status to a generic forbidden state. New gateway
  message alone does NOT fix that UI. 2a/manager owns Tasks/Shell connection-state
  display. Facilities retains bounded error messages (`pages/facilities/live.tsx:
  18–23`) and is used in the unrun expiry UI spec. No claim this UI passed.
- Original A2 test still uses default provider/WS ports; select only
  web-host-cloud.spec.ts for alternate4198/4197/4199/7096/7097 cloud run.

## Real handoff owner steps — future, AJ present only

1. **New Rhythm.app build required.** Running daily app lacks this exporter.
   Build/install/quit/cutover not done or authorized by this synthetic run.
2. In the signed-in app AJ selects native menu **Browser access → Enable browser
   access on this Mac…** (disabled signed out, smoke or qualification).
3. Native warning title **Enable browser access on this Mac?**; message **Allow
   the Rhythm web host to use your signed-in account?** Detail displays exact
   absolute file path and host-access warning. Buttons **Enable browser access**
   / **Cancel**, default Cancel. Confirm Enable browser access.
4. Main atomically writes ALREADY-DECRYPTED memory `{productionApiBase,userId,
   sessionToken}` to `app.getPath('userData')/web-cloud/credential.json`, dir0700,
   file0600. Normal repo package profile is `~/Library/Application Support/rhythm-electron-shell/`;
   the prompt is authoritative for packaged/redirected profiles. AJ's actual
   profile was NOT read. Absolute host-only override is
   RHYTHM_WEB_CLOUD_CREDENTIAL_PATH, set consistently for app and server.
5. Later operator configures server same credential PATH and trusted production
   base, existing mapped RHYTHM_WEB_OWNER_USER_ID, then restarts host. C1 verifies
   authoritative /auth/me id against exported id AND subject/email against local
   owner. No numeric local/cloud ID assumption, DB replacement or backfill.
6. Renewal repeats native owner action+host restart. For revocation remove host
   file under operator control and restart host. Never paste contents into
   browser/logs/issues or IPC. No real credential operation occurred here.

## Unrun live recipe for manager

Host-authorized engine path access and external fork diff-vs-HEAD verification
must happen first; never use a different tool/path to bypass its denial. No
sandbox was launched here, hence no down/status receipt is claimed. No process
kill, live-port request/control, production call or networking change occurred.

In ONE Bash invocation, with inherited RHYTHM_* removed first:
```sh
env $(env | cut -d= -f1 | /usr/bin/awk '/^RHYTHM_/ {print "-u " $0}') bash <<'CLOUD_SANDBOX'
set -euo pipefail
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-cloud-2b-new-fixture
node tools/dev/sandbox_fixture.mjs "$RHYTHM_APPROVED_FIXTURE_ROOT" --web-cloud --api-port=4198 --cloud-port=7097
export RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-cloud-2b-new-sandbox
export RHYTHM_SANDBOX_API_PORT=4198 RHYTHM_SANDBOX_ENGINE_PORT=4197 RHYTHM_SANDBOX_GATEWAY_PORT=4199
export RHYTHM_SANDBOX_ENGINE_DIR=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/opencode_fork/packages/opencode
export RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1 RHYTHM_SCRIPTED_PROVIDER_PORT=7096
export RHYTHM_WEB_PUBLIC_ORIGIN=http://rhythm-cloud.test:4198
export RHYTHM_WEB_CLOUD_CREDENTIAL_PATH="$RHYTHM_APPROVED_FIXTURE_ROOT/private/cloud.json"
export RHYTHM_SANDBOX_BRIDGE_FIXTURE=1 RHYTHM_SANDBOX_AUTH_FIXTURE_URL=http://127.0.0.1:7097
export RHYTHM_SANDBOX_BRIDGE_REGISTRAR_FILE="$RHYTHM_APPROVED_FIXTURE_ROOT/registrar"
export RHYTHM_LIVE_E2E=1 RHYTHM_WEB_CLOUD_TEST=1
node apps/web/tests/web-host/fake-cloud.mjs > apps/web/tests/web-host/fake-cloud.log 2>&1 & fake=$!
stop_fake() { if kill -0 "$fake" 2>/dev/null; then node -e 'fetch("http://127.0.0.1:7097/_cloud/shutdown",{method:"POST"}).catch(()=>{})'; wait "$fake"; fi; }
trap stop_fake EXIT
bash apps/web/tests/web-host/run-sandbox.sh apps/web/node_modules/.bin/playwright test \
  --config apps/web/tests/web-host/playwright.config.ts web-host-cloud.spec.ts \
  --output=/private/tmp/rhythm-cloud-2b-live-evidence
CLOUD_SANDBOX
```
Provisional recipe/fixture generation NOT RUN. Keep the whole block in one tool
invocation; kill -0 only checks the owned fake child, never terminates a process.
run-sandbox uses canonical up --foreground and down, same ports/dir, never under
build:guard. Existing registrar+synthetic DB proof gates permit the loopback auth
fixture override (RHYTHM_CLOUD_API_URL), which is C1/C2 trusted base; PROD_API_URL
defaults unchanged. If down refuses, report; never weaken ownership or kill API/
engine. Stop only the fake upstream through its own control endpoint.

Next: manager independent review, authorized live proof, Tasks connection-state
integration, aggregate Electron compiler/hash receipt resolution, then C5
contract before server MCP init. Do not perform real handoff without AJ present
or claim full cloud parity from this receipt.

Final audit: `git diff --check` PASS; `git diff --stat HEAD -- apps/opencode_fork`
empty for THIS worktree (not permission to inspect external denied binary).
Branch/HEAD unchanged; 26 modified tracked paths +9 new paths, all within assigned
source/tests/harness/run-log scope. No smoke screenshot/dependency drift remains.

## Manager integration onto slice 2a (2026-10-22)

- 2b committed as e116cde in its isolated worktree, cherry-picked onto e0e4403 -> a9e4cc1. Conflicts (web_host.ts, main.tsx, sandbox_fixture.mjs, run-sandbox.sh) resolved keeping both: bootstrap has owner role AND live cloud capability; fixture supports --web-host and --web-cloud plus ports; run-sandbox.sh keeps 2a's fresh per-run fixture and port audit, adds 2b's port parametrization and, with RHYTHM_WEB_CLOUD_TEST=1, its own fake upstream + synthetic credential.
- Manager change: Electron export menu is installed only when RHYTHM_WEB_CLOUD_CREDENTIAL_PATH is set (staff installs never offer to write their session). New exporter test for that gate; Dayflow host-hook harness taught the new import.
- Checks (all RHYTHM_* unset): api build PASS; web build + build:web PASS; typecheck PASS; Electron CSP source == dist; api vitest 7 files 144/144; browser+fixture units 6/6; desktop gateway + cloud-browser Playwright 28/28; Electron exporter 8/8; Electron main.mjs-dependent tests 211/216 with the same 5 failures as base e0e4403 (slice-5-c3/c4/c5, alternate-ports, artifact protocol: actual Electron launch).
- Live: standard web-host suite security 8/8, browser 16 passed / 1 skipped (cloud spec gated), teardown exit 0. Synthetic cloud (`RHYTHM_WEB_CLOUD_TEST=1`): web-host-cloud.spec.ts 1 passed, teardown exit 0, evidence /private/tmp/mgr-int-cloud4-browser/. Two earlier failures were the spec clicking a session inside a collapsed project group (fixed: project-scoped session, expand group). One manager run aborted by AJ; its sandbox removed afterwards with canonical down (exit 0).
- Observation for slice 3: final cloud screenshot shows the environment pill at 'Connecting/checking' right after in-app navigation to Agents; web-host-status.spec asserts it reaches Live, so likely a transient re-check. Verify during porting.
