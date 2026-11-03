# Testing Guide

## Canonical workflow commands

```bash
ai-workflow status                  # context-file health
ai-workflow checks --level issue    # flutter analyze + dart format + tsc --noEmit
ai-workflow checks --level pr       # adds vitest (npm test in apps/api_server)
ai-workflow checks --level smoke    # prints pointer to docs/testing/manual-smoke.md
ai-workflow run --issue N[,M,...]   # packed handoff (issue bodies inlined, no extra gh calls)
```

All commands delegate to `scripts/run_ai_workflow.py` in this repo.

## Running tests

### Major-checkpoint isolation and web configuration routing

Run full affected-package suites only at major checkpoints; repair loops run the
failed files/criteria and affected callers, not the full API or web suite. An app
rebuild alone is not a major checkpoint. For each repair, select the changed
behavior's source tests, relevant type checks, and live/API or packaged Playwright
checks that exercise its affected paths. Expand that selection when a new failure
or a shared dependency justifies it. Run the full backend suite once at the final
integration checkpoint rather than after every local build.

Unit checks must not inherit
live-test port overrides: issue655 and Tailscale contracts intentionally expect
engine4096/gateway4002. The September11 checkpoint's seven such failures passed
unchanged after removing `RHYTHM_OPENCODE_ENGINE_PORT` and
`RHYTHM_MOBILE_GATEWAY_PORT`. Do not change their assertions to sandbox ports.

For the manager-owned Phase2 sandbox, run unit/browser commands from their package
directory with this clean shell (substitute only the final command):

```sh
env -i \
  HOME=/private/tmp/rhythm-electron-phase2-integration/home \
  TMPDIR=/private/tmp/rhythm-electron-phase2-integration/tmp \
  PATH=/private/tmp/rhythm-electron-phase2-integration/bin:/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  PLAYWRIGHT_BROWSERS_PATH=/Users/ajhochhalter/Library/Caches/ms-playwright \
  /bin/zsh -f -c '<targeted command>'
```

This reuses isolated HOME/tooling, not the server runtime's port environment.
Only explicitly authorized live tests add their live flags/base URLs. Never
restart/down the manager-owned sandbox to run unit tests. The issue1186 lifecycle
test creates its own disposable fake runtime; its pinned Node stub delegates only
the native-addon ABI probe to real Node and never launches the real API.

Web `npm test` retains three stages: build/default fixture discovery, bucket-A
rendered config, then `npm run test:electron-slices`. `npm run test:list` lists all
three without browser execution. Default discovery excludes `electron-e*.spec.ts`:
`tests/run-electron-slices.mjs` explicitly routes E13–E27/E50–E52A to their dedicated
configs, including both E16 modes. Live-only selection remains controlled by each
config's existing opt-in; no global fake gateway mode is injected. Both runners
fail fast: after a red stage, run the short-circuited dedicated stage explicitly
at the checkpoint, never count its discovery as a pass. During triage use
`npm exec -- playwright test --config tests/electron-e14-playwright.config.ts --grep e14-c1`
or the equivalent failed criterion, not the entire slice manifest.

The old issue1409 source assertions predated E27's actual live PTY. Its default
tests now exercise rendered fixture labeling and no network mutation; live
connection/input/failure behavior remains in the dedicated E27 config.

### Isolated dev sandbox

E02 synthetic bootstrap (2026-09-11, **startup verified; not release qualification**):
the launcher uses an explicit runtime environment and a sandbox-owned
`$SB/bin/security` blocker. Bare `security` fails without reaching macOS
Keychain; missing, symlinked, unowned, modified, or incorrectly permissioned
shims refuse launch. This does **not** qualify real Keychain behavior: that
requires the later dedicated disposable macOS account tier. Normal packaged
Electron lifecycle is also **not tested** by these bootstrap guards.

E02 Phase0 is bounded to bootstrap guards: Keychain shim safety, offline build
input wiring (source inspection only), malformed/unusable MCP rejection, and
ambient promotion disabled. Proportional verification is only
`python3 tools/dev/sandbox_e02_guard_test.py` plus `git diff --check`.
MCP validation requires a nonempty object of local entries with nonempty string
command arrays; this is structural validation, not proof a command is safe to
execute. Operator sanitation remains required.

Synthetic fixture launch and runtime `Npm.install`/Arborist isolation are now a
**launch-only infrastructure prerequisite** for running the proportional guard
inside the sandbox, not application qualification. Prior outside-sandbox guard
PASS does not establish startup PASS. `--skip-install` covers the offline fork
build, not runtime installs. Runtime now pins the absolute local MCP payload
and refuses `up`/`restart` if it is absent. npm/Arborist receives offline mode,
an inert `http://127.0.0.1:9` registry and `$SB/npm-cache`; uncached background
dependencies may fail, not fetch externally. The focused static/environment and
canonical fixture checks are `python3 tools/dev/sandbox_bootstrap_test.py`.
Generate sources with `node tools/dev/sandbox_fixture.mjs /private/tmp/<new-fixture>`:
canonical initDb/migrations, fake workspace/admin/member/session, no live source
copy, disabled schedules/automations, 0400 DB and local MCP JSON. Use its
`rhythm.db` and `opencode.json` as the explicit inputs below. The synthetic
session token is deliberately public and must never be used outside this fixture.

The focused 2026-09-11 diagnosis resolved startup: the caller's Node directory
also contained a stock `opencode`, which shadowed the built fork and rejected
the API-managed `reference` config key. Runtime PATH must order **Keychain shim,
built fork directory, caller Node directory**, then system fallbacks. The API
still invokes the pinned absolute Node (verified v22.23.0 / ABI127); the SDK
launches bare `opencode`. Do not trust the API's override-path log alone.
`RHYTHM_AGENT_URL` and the registered local MCP API URL both target sandbox4098.
`up` rebuilds fork/API/MCP, using `--skip-embed-web-ui` for the headless fork.
Readiness requires `/opencode/health` JSON `status=ready` and a listener whose
executable equals the built fork, not merely HTTP200. Failed startup exits
rescue sanitized `*.log` files and the health body to `$SB.evidence.XXXXXX`;
`down` also preserves evidence before deleting runtime. These sibling directories
survive teardown; do not delete them before reading the actual failure.
One diagnostic and one corrected startup ran; corrected API/engine readiness,
local MCP connected, and both focused files (4 + 4 tests) passed. Both runtimes
were removed; live services were unchanged. No dependency provisioning was needed.
Web/Electron harness expansion
belongs at the first relevant UI/integration checkpoint; real Keychain in a
disposable macOS account and normal packaged lifecycle/architecture qualification
belong at their first relevant integration/release checkpoints. None is qualified
by bootstrap guards. See `docs/ai/runs/2026-09-10-electron-e02-harness.md`.

> ⚠️ **Worktree `node_modules` are often symlinks into the main checkout** (root,
> `apps/api_server`, `apps/mcp_server`, `apps/web`, `apps/opencode_fork`). Never run
> `npm ci` / `npm install` inside such a worktree: the root `package.json` declares
> `apps/api_server` as a workspace, so npm reifies the root tree *through the symlink* and empties
> the main checkout's `node_modules` (observed 2026-09-24). Either use `npx tsc` / `npx vitest`,
> which resolve package bins without `.bin` links, or `rm` the symlinks first and install a real
> tree. `sandbox.sh up` needs `apps/api_server/node_modules/.bin/tsc` because it runs `npm run build`.

Use `tools/dev/sandbox.sh` to run a second local api_server without touching
the live app's ports, database, HOME-relative Opencode files, live-artifact
storage, or run slots.
It uses API port `4098`, engine port `4097`, a SQLite `.backup` copy, and a
temporary HOME. It disables every copied scheduled task before launch.

**`up` requires four explicit env vars naming an operator-sanitized fixture —
there is no default copied-data source (issue-c6 item 6):**
`RHYTHM_APPROVED_FIXTURE_ROOT` (a directory containing only sanitized
fixtures), `RHYTHM_LIVE_DB_PATH` (a read-only SQLite file under that root),
`RHYTHM_SANDBOX_OPENCODE_CONFIG` (a read-only directory or `opencode.json`
under that root declaring a non-empty `mcp` map), and `RHYTHM_SANDBOX_DIR` (must canonicalize
under `/private/tmp` or `/var/folders`). `up` fails closed before any process
launch if any of these are missing, outside the approved root, writable,
nested inside the sandbox dir, or resolve to one of the two hardcoded
prohibited live paths. See `validate_copied_data_inputs` in `sandbox.sh` and
`tools/dev/sandbox_guard_test.sh` for the exact rules and rejection tests.

```bash
RHYTHM_APPROVED_FIXTURE_ROOT=/path/to/sanitized/fixtures \
RHYTHM_LIVE_DB_PATH=/path/to/sanitized/fixtures/rhythm.db \
RHYTHM_SANDBOX_OPENCODE_CONFIG=/path/to/sanitized/fixtures/opencode-config \
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-dev-sandbox \
RHYTHM_OPTIMIZER_MODE=shadow \
tools/dev/sandbox.sh up
tools/dev/sandbox.sh status
tools/dev/sandbox.sh down
```

The defaults are API `:4098`, engine `:4097`, and
`${TMPDIR:-/tmp}/rhythm-dev-sandbox`. Parallel runs must use a distinct
directory and distinct free ports:

```bash
RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-issue-123 \
RHYTHM_SANDBOX_API_PORT=4198 \
RHYTHM_SANDBOX_ENGINE_PORT=4197 \
tools/dev/sandbox.sh up
```

Pass the same three variables to `status` and `down`. The launcher validates
that both ports are unprivileged, distinct integers and still refuses to touch
an occupied port.

For an isolated local + relay topology, opt in with
`RHYTHM_SANDBOX_RELAY=1` and set a distinct
`RHYTHM_SANDBOX_RELAY_PORT` (default `4100`). Pass both variables, plus the
same sandbox directory and local ports, to every `up`, `status`, `restart`, and
`down` command. The relay uses `$RHYTHM_SANDBOX_DIR/relay` for its own copied
DB, HOME, PID, log, and storage; the local role authenticates its
`/relay/uplink` connection with the active synthetic session from the approved
fixture. The token is never printed. Example for the iOS bootstrap gate:

```bash
RHYTHM_SANDBOX_RELAY=1 \
RHYTHM_SANDBOX_RELAY_PORT=4200 \
RHYTHM_SANDBOX_API_PORT=4198 \
RHYTHM_SANDBOX_ENGINE_PORT=4197 \
RHYTHM_SANDBOX_GATEWAY_PORT=4199 \
tools/dev/sandbox.sh up
```

Stateful live suites that share one sandbox database must run as separate
Vitest invocations, or with `--no-file-parallelism`. Do not pass multiple
pairing/device live-test files to one default Vitest invocation: file workers
can create temporary rows concurrently and invalidate isolation assertions
even though each suite cleans up its own records.

The verified live-artifact gate drives the real fork engine → MCP → hosted API
→ human collaborator flow under one stable ID. Keep it env-gated and serial;
use the exact command and expected evidence recorded in
`docs/ai/runs/2026-08-09-live-artifacts-av07.md`.

Mobile-gateway live suites also need a distinct
`RHYTHM_MOBILE_GATEWAY_PORT` exported when `sandbox.sh up` starts (for example,
`:4189`). The launcher and suite must inherit the same value; setting it only
after the sandbox is running does not reconfigure the gateway.

For approval binding and scheduled-run ownership, prefer the UI-level
Playwright contract `apps/web/tests/contract/approval-owner-live.spec.ts`.
`apps/web/tests/fixtures/approval-owner-scripted-provider.mjs --prepare` builds
its synthetic fixture (scripted loopback model, throwaway approval key), and the
spec header lists the exact `sandbox.sh up` and `playwright test` commands. It
needs no paid model.

Live suites that exercise desktop-human approval must also start the sandbox
with `HUMAN_APPROVAL_CAPABILITY_SHA256` set to the SHA-256 digest of a
throwaway test capability and `HUMAN_APPROVAL_PUBLIC_KEY` set to a throwaway
P-256 public key encoded as the base64 form of its 65-byte uncompressed point.
Pass the original capability value to Vitest as
`RHYTHM_LIVE_HUMAN_CAPABILITY`. All three values must be exported before
`sandbox.sh up`. Generate them locally without printing them; never reuse or
record a real capability or private key. For example, this keeps the generated
values inside command substitution while exporting them into the current
shell:

```bash
eval "$(node <<'NODE'
const { createECDH, createHash, randomBytes } = require('node:crypto');
const capability = randomBytes(32).toString('base64url');
const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
process.stdout.write([
  `export RHYTHM_LIVE_HUMAN_CAPABILITY=${quote(capability)}`,
  `export HUMAN_APPROVAL_CAPABILITY_SHA256=${quote(createHash('sha256').update(capability).digest('hex'))}`,
  `export HUMAN_APPROVAL_PUBLIC_KEY=${quote(ecdh.getPublicKey(undefined, 'uncompressed').toString('base64'))}`,
].join('\n'));
NODE
)"
export RHYTHM_MOBILE_GATEWAY_PORT=4189
tools/dev/sandbox.sh up
```

For automation hosts that reap descendants when a command finishes, use the
explicit foreground hold. It performs the same build and readiness checks as
`up`, prints the ready message, and then remains attached to the API process.
Keep that command active, run live tests from another command session, and use
the unchanged `down` command to stop it:

```bash
tools/dev/sandbox.sh up --foreground
# In another command session:
tools/dev/sandbox.sh status
tools/dev/sandbox.sh down
```

After readiness, both launch modes record the sole `:4097` listener only when
its executable is the fork built in this worktree. If API shutdown leaves that
exact engine PID behind, `down` terminates it before removing the sandbox. A
missing record, changed PID, or executable mismatch fails closed without
signaling the listener.

The live SQLite source defaults to
`~/Library/Application Support/Rhythm/rhythm.db`; override it only with
`RHYTHM_LIVE_DB_PATH=/absolute/path/to/rhythm.db`. The sandbox directory
defaults to `$TMPDIR/rhythm-dev-sandbox`; set
`RHYTHM_SANDBOX_DIR=/absolute/path` to retain it elsewhere. `up` refuses to
touch occupied sandbox ports, and `down` only signals the PID recorded inside
its own sandbox directory. Do not enable copied scheduled tasks unless the
specific task is being tested.

### Numbat OpenCode observability hook (#1452, observe-only)

api_server startup invokes `numbat hook install --agent opencode --emit all
--content preview` (`services/numbat_observability_service.ts`) whenever the
`numbat` binary (perplexityai/numbat) is present on the machine — Rhythm never
bundles/auto-downloads it, so the feature is inert (not broken) until it is
installed separately (`brew install perplexityai/tap/numbat` or see
`https://github.com/perplexityai/numbat`). Set
`RHYTHM_NUMBAT_MONITORING_DISABLED=1` to skip the install entirely (checked
before any binary resolution or subprocess spawn); override the binary path
with `RHYTHM_NUMBAT_BIN_PATH` if it is not under `/opt/homebrew/bin`,
`/usr/local/bin`, or PATH.

The install call only ever passes `--agent opencode --emit all --content
preview` — no `--enforce` (numbat rejects it for `--agent opencode` upstream
anyway; it is not a substitute for `rhythm_request_approval`), no `--output
http`/`--http-url` (local-only, no telemetry sink). numbat writes its own
auto-loaded global plugin to
`${XDG_CONFIG_HOME:-~/.config}/opencode/plugins/numbat.ts` — a different
OpenCode plugin-loading mechanism than Rhythm's `opencode.json` `plugin`
array, so it does not touch `opencode_plugin_config.ts` or
`RHYTHM_MANAGED_PLUGIN_NAMES`. With `--emit all`, captured records land at
`$HOME/.numbat/records.ndjson` (one JSON object per line, `content_preview`
bounded to <=200 code points, redacted). **numbat never rotates this file
itself** — that is an operator-managed gap (log forwarder or OS retention
policy), not something Rhythm builds a replacement for.

```bash
cd apps/api_server
npx vitest run src/__tests__/numbat_observability_service.test.ts
tools/dev/sandbox.sh up
RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/numbat_observability_live_e2e.test.ts --no-file-parallelism
tools/dev/sandbox.sh down
```

The live test resolves the binary itself first and skips gracefully (not a
failure) when `numbat` is absent on the running machine — see
`docs/ai/decisions/2026-08-18-numbat-observability-integration.md`.

### Deep Research sandbox model override

For sandbox/ops verification only, `RHYTHM_RESEARCH_MODEL=provider/modelId`
temporarily overrides the Deep Research runner model without changing the
seeded `research` profile assignment. Model IDs may contain slashes; for
example `openrouter/openrouter/free` selects provider `openrouter` and model
`openrouter/free`. Restart the sandbox so the startup-validated value is read:

```bash
tools/dev/sandbox.sh down
RHYTHM_RESEARCH_MODEL=openrouter/openrouter/free tools/dev/sandbox.sh up
cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_VAULT_PATH="$TMPDIR/rhythm-dev-sandbox/vault" \
npx vitest run src/__tests__/agent_research_live_e2e.test.ts
```

### Research Projects full live gate (#1300)

The project gate is deliberately separate from the legacy one-job test. It
requires a disposable copied database, vault, managed skills, API `4098`, engine
`4097`, and mobile gateway `4099`. Never hand-start a second api_server.

```bash
export RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-research-1300
export RHYTHM_LIVE_DB_PATH="$HOME/Library/Application Support/Rhythm/rhythm.db"
export RHYTHM_RESEARCH_PROJECTS_ENABLED=true
tools/dev/sandbox.sh up

cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
DB_PATH=/private/tmp/rhythm-research-1300/rhythm.db \
RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-research-1300/rhythm.db \
RHYTHM_LIVE_VAULT_PATH=/private/tmp/rhythm-research-1300/vault \
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-research-1300 \
npx vitest run src/__tests__/research_projects_live_e2e.test.ts --no-file-parallelism
cd ../..
```

The live suite invokes `tools/dev/sandbox.sh restart` for the restart/resume
phase. Restart preserves the copied DB and vault; it never recopies production
data. Feature-off validation requires a separate fresh sandbox start because
the flag is parsed at process startup:

```bash
tools/dev/sandbox.sh down
unset RHYTHM_RESEARCH_PROJECTS_ENABLED
tools/dev/sandbox.sh up
cd apps/api_server
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 \
DB_PATH=/private/tmp/rhythm-research-1300/rhythm.db \
RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-research-1300/rhythm.db \
npx vitest run src/__tests__/research_projects_flag_off_live_e2e.test.ts --no-file-parallelism
cd ../..
tools/dev/sandbox.sh down
test ! -e /private/tmp/rhythm-research-1300
for port in 4098 4097 4099; do test -z "$(lsof -tiTCP:$port -sTCP:LISTEN)"; done
```

Use a shell trap in orchestration so `down` and all three listener assertions
run even when a test fails. Record Flutter Print / Save as PDF separately in
the manual smoke checklist; backend HTML checks cannot prove the native dialog.

Unset `RHYTHM_RESEARCH_MODEL` and restart to restore the normal `research`
profile model. Invalid values fail startup with the required `provider/modelId`
format and never print the configured value.

### Live inert-regression contracts (#1014, #1007, #997)

`src/__tests__/live_e2e_inert_regressions.test.ts` drives the real api_server,
fork engine, scheduler, public skills.sh/GitHub discovery, and configured model
providers. It is skipped unless `RHYTHM_LIVE_E2E=1`. Run it only with a copied
SQLite DB and temporary HOME on a spare port; it refuses `:4001`.

```bash
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_DB_PATH=/tmp/<isolated-run>/rhythm.db \
RHYTHM_LIVE_SERVER_LOG=/tmp/<isolated-run>/server.log \
npx vitest run src/__tests__/live_e2e_inert_regressions.test.ts
```

Build the fork and api_server and launch with `RHYTHM_OPENCODE_BIN_DIR` as
documented below. Recon evidence and response shapes are recorded in
`docs/testing/results/recon-inert-fixes-2026-07-11.md`.

### Live managed-skill rollback contract (#1082)

`src/__tests__/live_e2e_1082_skill_revert.test.ts` proves the real HTTP
PUT → proposal approve → measure/revert path restores the authoritative
managed `SKILL.md` rather than a stale `agent_skills.body`. Run it only against
the isolated sandbox; the test requires an explicit non-default localhost URL,
matching copied DB paths, and the isolation attestation flag.

```bash
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
DB_PATH=/tmp/<isolated-run>/rhythm.db \
RHYTHM_LIVE_DB_PATH=/tmp/<isolated-run>/rhythm.db \
RHYTHM_LIVE_SERVER_LOG=/tmp/<isolated-run>/api_server.log \
npx vitest run src/__tests__/live_e2e_1082_skill_revert.test.ts
```

Recon evidence and observed timing are recorded in
`docs/ai/runs/2026-07-16-1082-skill-revert-ondisk-snapshot.md`.

### Live paired OpenCode gateway isolation (#1175)

`src/__tests__/issue_1175_mobile_gateway_live.test.ts` pairs a real temporary
device against an isolated api_server + fork engine, registers two temporary
Git projects, and proves cross-project ID denial, response shaping, reload
scope, external-share denial, raw-diff normalization, and opaque worktree
resolution. It requires unique loopback ports, a copied/temporary SQLite DB,
a temporary home, and an explicit secret marker:

```bash
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:54175 \
RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:55175 \
RHYTHM_LIVE_DB_PATH=/tmp/<isolated-run>/rhythm.db \
RHYTHM_SANDBOX_DIR=/tmp/<isolated-run> \
RHYTHM_LIVE_SECRET_MARKER=<unique-noncredential-sentinel> \
npx vitest run src/__tests__/issue_1175_mobile_gateway_live.test.ts \
  --no-file-parallelism
```

Build the fork and api_server first and point the server process at the fork
with `RHYTHM_OPENCODE_BIN_DIR`. Recon evidence is recorded in
`docs/testing/results/recon-issue-1175-paired-gateway.md`.

### Live config-doctor core-permission contract

`src/__tests__/live_e2e_config_doctor_core_permissions.test.ts` drives the
public config-create, proposal-approve, and config-read endpoints against the
real api_server and fork engine. It creates an isolated agent config, seeds
only a UUID proposal row into the copied SQLite database (there is no
proposal-create HTTP route), approves it through
`POST /agent-org-proposals/:id/approve`, then reads the result through
`GET /agent-configs/:id`. The test cleans up only its generated IDs.

Keep the foreground sandbox command attached for the entire test: automation
hosts can reap a background sandbox's descendants after its launch command
returns. Do not globally override `HOME` or `PATH` in the shell running
Vitest; the sandbox itself owns its temporary HOME. When the test finishes,
interrupt or close that foreground `up --foreground` shell first. If its
scoped sandbox directory remains, run `down` from another shell, then confirm
that both `:4098` and `:4097` have no listeners.

```bash
RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-smoke-writer \
  tools/dev/sandbox.sh up --foreground

# In another shell, after "Sandbox ready" is printed:
cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_SANDBOX_DB=/tmp/rhythm-dev-sandbox-smoke-writer/rhythm.db \
DB_PATH=/tmp/rhythm-dev-sandbox-smoke-writer/rhythm.db \
RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox-smoke-writer/rhythm.db \
  npx vitest run src/__tests__/live_e2e_config_doctor_core_permissions.test.ts

# Interrupt or close the foreground shell above first. Then, if its sandbox
# directory remains, run this scoped cleanup from another shell:
RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-smoke-writer \
  tools/dev/sandbox.sh down

lsof -nP -iTCP:4098 -sTCP:LISTEN
lsof -nP -iTCP:4097 -sTCP:LISTEN
```

The three database-path variables must resolve to the sandbox's copied
`rhythm.db`; the test rejects any mismatch. Recon response shapes and timing
are recorded in `docs/testing/results/recon-config-doctor-core-permissions.md`.
Playwright, computer-control, and manual-only coverage are N/A: this is a
deterministic backend HTTP surface.

### api_server (Node.js/TypeScript)
Run `node tools/dev/zen-probe.mjs` to verify the served/free Zen roster and current bootstrap seed.
```bash
cd apps/api_server
npm test                  # vitest run — 965 tests (as of #738-fix, 2026-06-23)
node_modules/.bin/tsc --noEmit   # TypeScript type check (no tsc in global PATH)
```

Note: `better-sqlite3` 13 uses N-API prebuilds across supported Node versions. A
`NODE_MODULE_VERSION` difference by itself does not require a rebuild. The api_server
postinstall script runs a package-entry query probe and falls back to a source rebuild
only if that probe fails.

### Real-server test harness — avoiding undici socket flakes

Many `src/__tests__/*.ts` files spin up a real server with `createApp().listen(0)` and hit it with the global `fetch` (undici). If teardown only calls `server.close()`, undici's pooled keep-alive socket survives; when a later `listen(0)` recycles that ephemeral port, the dead socket is reused → intermittent `UND_ERR_SOCKET` "other side closed" (load-dependent, passes on isolated re-run). Prevent it in the harness:

```ts
const server = createApp().listen(0);
server.maxRequestsPerSocket = 1;          // server sends `Connection: close`; undici never pools
// ...
const closeServer = () => new Promise<void>((res, rej) => {
  server.closeAllConnections();           // destroy any in-flight sockets
  server.close((e) => (e ? rej(e) : res()));
});
```

`undici` is not a direct dependency (it backs Node's built-in `fetch`), so `setGlobalDispatcher`/`Agent` are unavailable — this server-side approach is the dependency-free fix. Applied in `agent_configs_routes.test.ts`; other harness files share the same pattern and risk.

### desktop_flutter (Flutter/Dart)
```bash
cd apps/desktop_flutter
flutter analyze --no-fatal-infos   # must exit 0 (infos are pre-existing, not new)
flutter test                        # unit tests
dart format . --set-exit-if-changed # CI fails on format violations
```

## Key test files

| File | What it covers |
|---|---|
| `src/__tests__/agent_sessions.test.ts` | Session CRUD, agentId validation, Opencode engine readiness gate, SDK mock |
| `src/__tests__/agents_capabilities_routes.test.ts` | Provider-based capability detection, auth bypass |
| `src/services/opencode_client_service.test.ts` | SDK wrapper lifecycle, graceful degradation when uninitialized |
| `src/services/recurrence_service.test.ts` | Rhythm/recurrence generation logic |
| `src/__tests__/weekly_planning_service.test.ts` | Weekly planner assembly |
| `src/__tests__/workspace.test.ts` | Workspace join/share/message flows |
| `src/__tests__/opc_m3_1_changes_tab_diff.test.ts` | OPC-M3-1: GET /session/{id}/diff via typed SDK wrapper (c1a–c1c) |
| `src/__tests__/opc_m3_2_revert_unrevert.test.ts` | OPC-M3-2: POST /session/{id}/revert + unrevert route contracts (c1a–c1f) |
| `src/__tests__/opc_m3_3_compaction.test.ts` | OPC-M3-3: POST /session/{id}/summarize route contract + SDK error→AppError (c1a–c1c) |
| `src/__tests__/opc_m3_4_command_dispatch.test.ts` | OPC-M3-4: session.command WS frame → handleCommandFrame → dispatchCommand (c1a–c1c) |
| `test/features/agents/opc_m3_1_changes_tab_test.dart` | OPC-M3-1: ChangesTab widget (c2–c5), WS event → fetchSessionDiff |
| `test/features/agents/opc_m3_2_revert_test.dart` | OPC-M3-2: MessageActionsRow revert button, RevertRestoreBanner, controller revert state (c2–c5); includes REAL-SURFACE test (c2a) |
| `test/features/agents/opc_m3_3_compaction_test.dart` | OPC-M3-3: TranscriptHeader overflow menu "Compact session" + spinner, CompactionDivider, ContextUsageHint (c2–c5); includes REAL-SURFACE test (c2a/b) |
| `test/features/agents/opc_m3_4_command_dispatch_test.dart` | OPC-M3-4: sendCommand WS frame dispatch, _sendInput routing (known vs unknown command), role='command' optimistic message (c2a/b REAL-SURFACE, c3–c5) |
| `src/__tests__/opc_m3_5_todo_panel.test.ts` | OPC-M3-5: GET /:id/todo route (no mapping → [], real shape, SDK error → 502); bridge relay todo.updated → WS broadcast (c1–c2) |
| `test/features/agents/opc_m3_5_todo_panel_test.dart` | OPC-M3-5: TodoPanel in SessionSidePanel (c3a REAL-SURFACE, c3b empty→hidden, c4a/b WS session-keyed isolation, c5a header count, c5b checkbox states, c6a/b collapse persistence) |
| `src/__tests__/opc_m3_6_child_sessions.test.ts` | OPC-M3-6: GET /:id/children (no mapping → [], SDK listChildren); GET /:id/children/:childSdkId/messages (role mapping user→input/assistant→output, 404 on missing parent) (c1a–c1b, 7 tests) |
| `test/features/agents/opc_m3_6_child_sessions_test.dart` | OPC-M3-6: TaskChip tap → ChildTranscriptView (c2a REAL-SURFACE), openChildSession fetches messages (c2b), closeChildSession no-refetch (c3), ChildTranscriptView read-only (c4), children not in sidebar lists (c5), ToolState regression (c6) |
| `src/__tests__/opc_instant_new_session.test.ts` | #710: bridge session.updated → updateFields + broadcastSessionUpdated (c2a), empty title skipped (c2b), server accepts null/empty agentId (c4) |
| `test/features/agents/opc_instant_new_session_test.dart` | #710: c1 REAL-SURFACE header tap → onNewSession no dialog; c1-controller empty name default; c3 handleWsMessageForTest → session name updated; c4 empty name → "New session" placeholder; c5 ⋯ button → onOptionsPressed |
| `src/__tests__/issue_738_agent_runner.test.ts` | #738: AgentRunner.run() success, timeout+abort, slot released, createSession fail, promptAsync fail, concurrency cap (7 tests) |
| `src/__tests__/issue_739_scheduler_agent_runner.test.ts` | #739: AGENT_LOCAL=true → AgentRunner called, no trigger insert; AGENT_LOCAL=false → trigger inserted, no AgentRunner; loop isolation (4 tests) |
| `src/__tests__/issue_740_cookbook_run.test.ts` | #740: POST /agent-cookbook/:id/run returns 202+sessionId, 404 unknown, prompt compiled from steps, 401 unauth (4 tests) |
| `src/__tests__/issue_738_fix_model_and_session.test.ts` | #738-fix: resolveRunModel 3-step cascade (config/MRU/default), promptAsync gets model arg, session recorded, schema columns present (10 tests) |
| `src/__tests__/issue_738_fix_stale_run_recovery.test.ts` | #738-fix: scheduler boot calls resetStaleRunning on SQLite, skips on Postgres (2 tests) |
| `src/__tests__/issue_743_child_session_persistence.test.ts` | #743: upsertChildSession creates/is-idempotent/null-on-missing-parent; getDiff returns 200 [] for unknown session (5 tests) |
| `test/features/agents/issue_743_parent_id_test.dart` | #743: AgentSession.parentId fromJson (parentSessionId + parentId fallback), toJson omit-when-null, copyWith sentinel, isChildSession; _buildSessionTree root/child/orphan/multi grouping (11 tests) |

## Mocking the Opencode engine in tests

The Opencode engine is mocked at the module level in all agent session tests:

```typescript
vi.mock('../services/opencode_engine', () => {
  let _ready = true;
  const mockClient = {
    get isReady() { return _ready; },
    set isReady(v: boolean) { _ready = v; },
    listProviders: vi.fn().mockResolvedValue(['anthropic', 'openai']),
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-1' }),
    prompt: vi.fn().mockResolvedValue({}),
    promptAsync: vi.fn().mockResolvedValue(true),   // ← required: called inside try block
    setAuth: vi.fn().mockResolvedValue(true),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    statusMessage: 'Opencode SDK ready',
  };
  return { opencodeClient: mockClient, opencodeSessionMap: new Map() };
});
```

**Important:** `vi.clearAllMocks()` resets call counts but NOT the `_ready` closure. Always reset `isReady` in `afterEach` when a test mutates it:

```typescript
afterEach(async () => {
  await closeServer();
  vi.clearAllMocks();
  const { opencodeClient } = await import('../services/opencode_engine');
  (opencodeClient as { isReady: boolean }).isReady = true;
});
```

Failing to do this poisons subsequent tests (they'll hit the 400 "engine not ready" guard).

### opencode fork (Bun/TypeScript)
```bash
cd apps/opencode_fork/packages/opencode
bun run typecheck                                          # must exit 0
bun test src/session/mcp_allowlist.test.ts                 # 5 pass — unit: filterMcpToolsByAllowlist
bun test test/session/mcp_allowlist_e2e.test.ts            # 4 pass — e2e: A=5,B=3,C=1,D=0 tools
bun test test/session/ src/session/                        # full session suite (325+ pass, 0 fail)
```

| File | What it covers |
|---|---|
| `apps/opencode_fork/packages/opencode/src/session/mcp_allowlist.test.ts` | Unit: `filterMcpToolsByAllowlist` — server-level pass-through, tool-level filter, empty allowlist→0, undefined→all |
| `apps/opencode_fork/packages/opencode/test/session/mcp_allowlist_e2e.test.ts` | E2E integration: full `sessions.create → DB persist → runLoop sessions.get → resolveTools → LLM request body`; 4 cases prove the gate fires end-to-end |

## Smoke test checklist (manual, pre-merge)

After deploying the Opencode engine:

- [ ] Start the app — verify the api_server starts on port 4001
- [ ] `curl http://localhost:4001/opencode/health` — returns `{"status":"ready",...}`
- [ ] `curl http://localhost:4001/agents/capabilities` — returns provider-based availability map
- [ ] Settings → AI Account → connect a provider (OAuth or API key)
- [ ] `curl -X GET http://localhost:4001/opencode/auth/` — returns connected providers
- [ ] `POST http://localhost:4001/agent-sessions {"agentId":"claude-code","cwd":"~","name":"Test"}` — returns 201
- [ ] WS connect to `ws://localhost:4001/ws/agents`, send `session.input` — SDK prompt is called
- [ ] `DELETE /agent-sessions/:id` — returns 204, session map entry is cleared
- [ ] `flutter run -d macos` — app launches without errors, AI Account section shows connected providers on open

## Running the fork engine in dev (issue #855)

**Finding:** in ordinary `npm run dev` / `flutter run` development, the api_server
spawns whatever `opencode` binary is first on `PATH` — via `@opencode-ai/sdk`'s
`createOpencode()`, which shells out to the literal command name `opencode`
(`cross-spawn("opencode", ...)`, no absolute-path option). `augmentPathForOpencode()`
(in `apps/api_server/src/services/opencode_client_service.ts`) only prepends the
**bundled** Rhythm fork binary's directory when it can find one at
`<Resources>/opencode_bin/opencode` — a path that only exists inside a signed
release `.app` bundle. In dev, that candidate never exists, so it logs a WARN and
falls through to the ambient PATH — almost always a **stock** upstream opencode
install (e.g. the official installer's `~/.opencode/bin/opencode`, symlinked from
`~/.local/bin/opencode`). Stock opencode carries NONE of the Rhythm-carried
patches (`filterMcpToolsByAllowlist`, per-session `mcpAllowlist`/`skillAllowlist`
on `Session.Info`, etc.) — every MCP tool schema is injected unconditionally,
which is why per-session scoping can appear completely inactive in dev even when
every api_server-side push (`ws_gateway` → `updateSessionAllowlist`) is correct.

### Build the fork binary

```bash
cd apps/opencode_fork/packages/opencode
bun run build --single
# → dist/opencode-<platform>-<arch>/bin/opencode  (e.g. dist/opencode-darwin-arm64/bin/opencode)
```

`--single` (defined in `script/build.ts`) builds only the binary matching the
current host platform/arch — much faster than the full multi-target build used
by CI (`--macos`, which the release workflow uses for the universal arm64+x64
DMG bundle). See `docs/ai/decisions/2026-06-25-opencode-fork-vendoring.md` for the
subtree/build background.

### Point dev at the fork build

Two env vars, read by `augmentPathForOpencode()` at api_server startup, checked
**before** the bundled-release path so an explicit dev override always wins:

- `RHYTHM_OPENCODE_BIN_DIR=/abs/path/to/dist/opencode-darwin-arm64/bin` — a
  directory containing an `opencode` executable.
- `RHYTHM_OPENCODE_BIN=/abs/path/to/dist/opencode-darwin-arm64/bin/opencode` — the
  full path to the executable itself (its parent dir is prepended).

```bash
cd apps/api_server
export RHYTHM_OPENCODE_BIN_DIR="$(cd ../opencode_fork/packages/opencode && pwd)/dist/opencode-darwin-arm64/bin"
npm run dev
```

Unset (the default), behavior is byte-for-byte unchanged from before #855 — no
regression risk for anyone not opting in. An invalid/missing path is logged as a
WARN and the override is ignored (falls through to the pre-#855 candidates), it
never silently no-ops without a trace.

### Confirm which engine is actually running

Every api_server startup now logs exactly one of:

```
[OpencodeClientService] engine: /path/to/fork/dist/.../opencode (dev override — fork patches expected active)
[OpencodeClientService] engine: /path/to/opencode_bin/opencode (bundled fork build — fork patches expected active)
[OpencodeClientService] engine: opencode resolved from PATH (stock PATH — scoping inactive unless RHYTHM_OPENCODE_BIN[_DIR] is set)
```

Read this line first any time MCP/skill allowlist scoping seems inactive. Only
the first two lines mean the fork's `resolveTools` gate can possibly be active;
the third line means every MCP tool schema will be injected regardless of what
the api_server pushes — the bug is "wrong binary," not "wrong allowlist logic."

**Still requires a human to verify live:** this env override was validated at
the PATH-resolution unit level (`augmentPathForOpencode` tests in
`opencode_client_service.test.ts`) in this environment. Actually building the
fork binary (`bun run build --single`) and confirming a real profiled session's
`resolveTools complete { resolveToolsCount, allowlistActive }` debug log shows
`allowlistActive: true` with a trimmed `resolveToolsCount` — end to end, against
the real spawned fork process — was **not** performed in this pass and still
needs a human (or a follow-up agent with a build-capable sandbox) to run.

## MCP allowlist smoke (per-session tool-schema scoping — mcp-scope)

Verifies a profile-scoped session injects only its allowlisted MCP tool schemas.
**Requires the patched fork engine** — either `RHYTHM_OPENCODE_BIN_DIR` pointed at
a locally-built fork binary (see "Running the fork engine in dev" above) or the
bundled fork from a release build (`Contents/Resources/opencode_bin/opencode`).
Confirm the fork is in use via the api_server startup log line described above,
or by checking the engine's `--version` directly: it is NOT a stock `1.x.y` (it
embeds the branch, e.g. `0.0.0-feature/...`).

**Measurement instrument:** the fork's `resolveTools` emits a DEBUG log on every
prompt: `resolveTools complete { resolveToolsCount, allowlistActive }`. Read it from
the engine process logs (propagated through the api_server). `resolveToolsCount` is
the number of tool schemas injected; `allowlistActive` is whether the session was
profile-scoped.

**Expected count helper (dynamic — never hardcode):** the api_server expander gives
the expected Secretary count:
```
cd apps/api_server && npx vitest run src/services/__tests__/mcp_allowlist_expander.test.ts
# C2 asserts secretary.mcp.json → tools.length (36 as of 2026-06-25: rhythm 14,
# gmail-work 2, gmail-personal 2, calendar 3, obsidian 9, pdf-tools 6)
```

Checklist:
- [ ] Open a **Secretary** session → engine log `allowlistActive: true`,
  `resolveToolsCount` equals `expandMcpAllowlist(secretaryConfig).tools.length` (36).
- [ ] Open a **profile-less** session (no role) → `allowlistActive: false`,
  `resolveToolsCount` is GREATER (all connected MCP tools — back-compat).
- [ ] Both sessions function normally (tools present and callable).

Automated coverage already proves this by composition: api_server `opencode_client_service.test.ts`
(Secretary session → createSession body carries `expandMcpAllowlist(config)`),
fork `mcp_allowlist_e2e.test.ts` (gate filters offered tools to exactly the allowlist:
5→3→1→0), and `mcp_allowlist_expander.test.ts` (Secretary → 36). The manual smoke is
the live full-stack visual confirmation with the bundled binary.

## Deferred MCP tool schema loading smoke (tokens-03, #843)

Verifies that a session with `mcpAllowlist.deferred = true` advertises its allowlisted
MCP tools as a names-only catalog + ONE dispatcher tool (`mcp_dispatch`) instead of one
full JSON Schema per tool, and that dispatching a call by name still executes the real
tool. **Requires the patched fork engine**, same build/PATH steps as the MCP allowlist
smoke above.

**Measurement instrument:** `resolveTools complete` (same DEBUG log line as the MCP
allowlist smoke) now also carries `deferredMcpActive` (bool) and `deferredMcpCatalogSize`
(the MCP tool count that would otherwise have been individually schema-injected).
`resolveToolsCount` in deferred mode reflects builtins + 1 (the dispatcher), NOT
builtins + N (one per MCP tool) — that count drop is the direct evidence of the fix.

**Analytical before/after (recorded 2026-07-02, via tokens-01's `estimateToolSurface`):**
Secretary role (36 allowlisted MCP tools): eager ≈ 6125 session-start tokens → deferred
≈ 2830 tokens, a **3295-token (53.8%) drop**. An unscoped/dev-role session (~20 connected
servers, inherit-all estimate) drops even further: ≈ 64125 → ≈ 16750 tokens (**47375
tokens, 73.9%**). Method: `before` = the estimator's existing calibrated 500-chars/tool
JSON-Schema estimate (unchanged); `after` = a conservative 120-chars/tool names-only
catalog entry (name + server + one-line description, no JSON Schema fields — see
`mcp_deferred_tools.ts`'s `formatDeferredToolCatalog`) plus one 500-char dispatcher schema.
**This is an analytical estimate from the same estimator #841 shipped, not a live-engine
byte count** — the live-engine confirmation below is the required follow-up.

Checklist (requires the live signed/built fork binary — NOT yet run in this environment,
recorded here as the explicit required manual smoke per issue #843's contract):
- [ ] Open a session with `mcpAllowlist.deferred: true` and a profile allowlist (e.g.
  Secretary) → engine log `deferredMcpActive: true`, `resolveToolsCount` is small
  (builtins + 1), `deferredMcpCatalogSize` equals the allowlist's tool count (36 for
  Secretary).
- [ ] The model can still successfully call an allowlisted tool by name via
  `mcp_dispatch` and get real output back.
- [ ] Dispatching an out-of-scope tool name is rejected (does not execute).
- [ ] A profile-less or `deferred: false/absent` session is completely unaffected
  (byte-identical eager behavior, same `resolveToolsCount` as before this patch).

Automated coverage already proves the logic by composition: fork
`mcp_deferred_tools.test.ts` (pure-unit: catalog shape, dispatch-time allowlist gating,
parity with `filterMcpToolsByAllowlist`) and `mcp_allowlist_e2e.test.ts` Cases E-H
(E2E: real `resolveTools` → LLM request body proves only `mcp_dispatch` is offered and
individual MCP schemas are absent; F proves an empty allowlist yields an empty catalog;
G proves dispatching a real tool by name executes it and returns real output; H proves
dispatching an out-of-scope name is rejected, falsified in the implementing run by
temporarily removing the guard and confirming the test failed). The manual smoke above
is the live full-stack visual + token-count confirmation with the bundled binary, not
yet run.

### Bounded Coding Workflow live check

`live_coding_workflow_bounded.test.ts` exercises the real local API, built fork,
MCP server, manager/reviewer sessions and server-checked workflow criteria. Only
external model responses are deterministic synthetic data; this proves wiring
and bounded control, not normal served-provider judgement or installed UI behavior.
The suite skips unless `RHYTHM_LIVE_E2E=1`. It creates invented read-only fixtures,
uses only the stock `tools/dev/sandbox.sh` lifecycle, and owns API 4198, engine
4197, gateway 4199, observer 4284 and one ephemeral model listener. Do not run
another sandbox or build in the same worktree concurrently. No credential,
private database, live HOME or existing fixture is copied.

From `apps/api_server`, use an unused absolute receipt directory. The trusted
caller PATH must contain compatible installed Node.js 22 and Bun; the harness
does not install dependencies. Only PATH is propagated from the caller:

```sh
env -i PATH="$PATH" \
  RHYTHM_LIVE_E2E=1 RHYTHM_G2_LIVE_TEST_OUT=/private/tmp/rhythm-g2-new-receipt \
  node_modules/.bin/vitest run src/__tests__/live_coding_workflow_bounded.test.ts
```

The assertions require both server-checked criteria, one actual completed
reviewer under manager 2, exact manager ordinals 1 and 2, admission/continuation
replay invariance, 65 seconds of reconciliation quiescence, the current gateway
fingerprint, unchanged product source hashes, unchanged normal-runtime listener
identities, successful stock teardown, an absent runtime directory, unchanged
read-only fixtures, and teardown of all five owned listeners. Evidence-copy
errors fail qualification while all remaining cleanup still runs. The receipt preserves
source HEAD, product/harness hashes, raw guard transport observations, runtime
logs/guard markers and invented-data SQLite snapshots before stock teardown.
A held, timed-out or interrupted run is unqualified; retain its receipt for
failure triage rather than changing a guard response or weakening an assertion.

### Chat-only bounded Workflow live check

`live_chat_bounded_workflow.test.ts` adds real scoped MCP reference discovery,
proposal, a signed human decision, the dedicated native approval wake, and
one-use admission to the same bounded execution path. It runs two cases: an
idle wake and a stock sandbox API/engine restart after approval. External model
responses and semantic ranking hints are invented fixtures; the actual API,
fork, MCP, indexed source, filesystem checks, approval verification, accounting
and manager/reviewer execution are exercised.

From `apps/api_server` on the committed clean candidate, use an existing
task-owned external receipt parent and the full source SHA:

```sh
env -i PATH="$PATH" RHYTHM_LIVE_E2E=1 \
  RHYTHM_LIVE_SOURCE_SHA=<full-40-hex-candidate-sha> \
  RHYTHM_CHAT_LIVE_TEST_OUT=<absolute-external-receipt-parent> \
  node_modules/.bin/vitest run src/__tests__/live_chat_bounded_workflow.test.ts
```

Each case owns the same isolated ports and stock sandbox lifecycle described
above. Do not run another sandbox or build in that worktree concurrently.
The harness checks the exact SHA and clean tracked source before and after,
actual MCP inventory (111 tools), unchanged signed proposal/deadline after
restart, exact approved values, one consumed approval, held native replay,
both checked criteria, two ordinals, reviewer membership and 65 seconds of
quiescence, plus source/fixture/listener cleanup. New unqualified recon receipts
must remain distinct from these exact committed-source results. Browser card
tests and native installed-app acceptance are separate evidence.

### Shared build-storage guard

```sh
npm run test:build-storage
npm run build:guard -- npm --prefix apps/api_server run build
npm run build:guard -- bash -c 'cd apps/opencode_fork/packages/opencode && bun run build --single'
npm run build:guard -- bash -c 'cd apps/desktop_flutter && flutter build macos'
```

The default 10 GiB ceiling is shared by every cooperating worker/check-out through
a private root, fcntl lock, and retained output registry. `RHYTHM_BUILD_ROOT` may
select an explicit private root (all workers must use the same root).
`RHYTHM_BUILD_LIMIT_BYTES` or `--limit-bytes` can lower the ceiling for fixtures;
values above 10 GiB are rejected and an existing root's ceiling cannot be raised.
A root must be owned by the account, mode 0700, marked, and free of symlinked
boundary/control paths. The real account home comes from uid lookup, not HOME.

The supervisor scans owned scratch and registered generated outputs (Electron
`dist`, fork `dist`, Flutter `build`/`dist`, web/API/MCP `dist`, mobile
`dist`/`dist-e2e`/`build`/`.expo` and native iOS/Android build caches) before launch and
at roughly 50 ms intervals plus scan time. Native-wrapper `--out` is registered
explicitly; other output paths require `--watch /absolute/path`. npm/XDG cache,
Cargo home/target and temporary files are routed into marked run scratch. Existing
source and installed dependency stores are not disposable scratch. Tools writing
other caches/output paths must be configured to write into `RHYTHM_BUILD_SCRATCH`
or registered with `--watch`; this is cooperative tooling, not an OS filesystem
quota. A fast writer can overshoot between samples. Missing outputs remain
registered so later growth counts, including retained output from prior runs.
Nested/hardlinked files count once; symlinks within watched roots are permitted.
Owned per-run temporary directories may contain external source/input aliases:
only the link bytes count, targets are never followed or deleted. Writes through
such aliases require an explicit target `--watch`, like any custom external
output. Temporary IPC sockets/FIFOs are counted as inode bytes and unlinked with
owned scratch after processes exit. External symlinks or IPC nodes in registered
non-temporary output trees still refuse the build.
A validated supervisor/group identity permits
nested entrypoints; setting a boolean/token alone does not bypass preflight.

On breach/signals the owned process group receives termination and escalation,
even if the leader exits. Children intentionally escaping into a new session are
outside this cooperative group contract. Only this run's positively marked
scratch is removed; source, generated outputs, unknown dist, and unproven stale runs are
preserved. On startup, stale scratch is removed only when its registry and marker
agree, its recorded supervisor identity is gone/changed, and its recorded group
has no live members. Unregistered/mismatched scratch or a live/reused group is
preserved and remains counted. The guard never guesses ownership from age alone. `latest.json` and
`previous.json` are the bounded receipts; registry data retains output locations.
Keep current/previous reviewed artifacts by operator action, with explicit
ownership review before removing others. Never copy whole built checkouts or run
npm install/ci through symlinked dependencies; reuse stores only when lockfile and
toolchain match. No automatic cap increase or unknown-output deletion is allowed.

On macOS, exclude only the disposable managed scratch root from future Time
Machine backups: `tmutil addexclusion "$HOME/Documents/Codex/.rhythm-build-scratch"`.
Verify with `tmutil isexcluded` after the root exists. The local 2026-10-19 setup
is excluded. Do not exclude source checkouts or remove existing backup snapshots
as part of routine build cleanup.

The #1186 fake sandbox lifecycle unit fixture derives its runtime from TMPDIR;
its runtime must still resolve under the sandbox's allowed OS temp paths.
Wrapping the entire canonical PR suite in the default Documents scratch pool
therefore causes three deliberate path-policy refusals. Qualify that unchanged
fixture separately in a small marker-owned guard root under `/private/tmp`,
as recorded in the build-storage run. Normal build workers retain the shared
default pool; real sandbox launches use the explicit approved paths above.

## Packaged-app smoke (Playwright against a real Rhythm.app)

Launches a packaged `Rhythm.app`, attaches Playwright over CDP (hardened fuses block
`_electron.launch`), and checks: own runtime healthy on 4001/4096, every nav page renders
without renderer errors, a `[smoke]` task create → edit → complete → reload → delete, a new agent
session gets a real model reply and is deleted, and a clean quit that leaves no listener behind.

```bash
cd apps/web
RHYTHM_PACKAGED_APP=/Applications/Rhythm.app npm run test:packaged
# optional: RHYTHM_EXPECTED_VERSION=0.18.82 asserts the bundle version
```

- Quit Rhythm first: it refuses to start while 4001/4096/4002 are listening, because a second
  instance would adopt the running app's runtime.
- Uses the real HOME and the app's own profile (`~/Library/Application Support/rhythm-electron-shell`),
  so it reuses the saved sign-in and model providers and writes real data (only `[smoke]` records,
  deleted by the test). The Keychain-backed session cannot persist under a substitute HOME.
- Separate profile: `RHYTHM_SMOKE_USER_DATA=/abs/path npm run test:packaged:login` once, then pass
  the same variable to `test:packaged`.
- App output goes to `$TMPDIR/rhythm-packaged-smoke.log`; HTML report in `playwright-report/packaged/`.

### Mega feature tests (local source build)

Inventory and priority checkpoint: [2026-10-19 feature inventory](plans/2026-10-19-feature-test-inventory.md).
Feature specs are `tests/packaged/packaged-<feature>.spec.ts`; they reuse the packaged CDP fixture.
They require the API build identity **and** engine version to match the mega revision. The harness
checks both before launching; the per-test audit also checks the actual running engine.
Do not substitute an older installed app for this source-build gate.

```sh
cd apps/web
npx tsc --noEmit --strict --allowJs --module esnext --moduleResolution bundler --target es2022 --skipLibCheck --types node tests/packaged/*.ts
RHYTHM_PACKAGED_APP=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app \
  RHYTHM_FEATURE_MODEL=1 npm run test:packaged -- --grep '\[P0\]'
# Each feature can also run alone:
RHYTHM_PACKAGED_APP=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app \
  npx playwright test -c tests/packaged/packaged-playwright.config.ts packaged-tasks.spec.ts
```

`RHYTHM_FEATURE_MODEL=1` is explicit real-model/quota opt-in (authorized for the 2026-10-19 run).
Without it, model cases fail `UNVERIFIED` before sending. Tests never silently skip gaps.
`RHYTHM_FEATURE_EXPECTED_REVISION` can pin an operator-provided full SHA; otherwise the feature
suite resolves local `mega/2026-09-29-consolidation`. Keep the app quit and ports 4001/4096/4002 free.
For a locally committed fix on top of mega, explicitly set `RHYTHM_FEATURE_EXPECTED_REVISION` to
the full revision used to package the candidate. API identity and bundled/live engine must all
match it; do not point the tests at the earlier mega artifact or weaken the source assertion.

Router calibration coverage is `packaged-model-router.spec.ts`: real Auto turns (including a
one-literal edit), actual engine/model readback, reload reuse/pin bypass, and 12 synthetic live
Decisions expectations. It uses the same packaged command/opt-in above. Complement it with the
isolated default-policy check after generating synthetic read-only inputs with
`node tools/dev/sandbox_fixture.mjs /private/tmp/<new-fixture>` and starting `tools/dev/sandbox.sh`
under the build guard with the four required fixture/path variables:

```bash
cd apps/api_server
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
  ./node_modules/.bin/vitest run src/__tests__/router_calibration_live.test.ts --no-file-parallelism
```

Run sandbox `down` in `finally`/a shell trap. The sandbox default-policy check is not real-model
proof; the packaged suite supplies that evidence using the operator's explicitly authorized profile.

Owned session creation explicitly selects the enabled `coding-agent` profile; set
`RHYTHM_FEATURE_PROFILE_ID` to another existing eligible profile when required. It does not edit
the profile. Advanced can open before its catalog arrives, so selecting a profile is a fixture
precondition. Action waits are bounded to 15 seconds; provider-response assertions have their
own longer limits. The temporary cwd is explicitly changed to clear any prior branch choice.

### Org Reviewer and private profile checks

`packaged-ai-private-org-reviewer-entry.spec.ts` checks the seeded policy and
visible manual schedule trigger without starting a scan. It requires a new
unloaned synthetic actor and the exact locally built source revision:

```sh
RHYTHM_FEATURE_EXPECTED_REVISION=<full-local-candidate-sha> \
  node tools/testing/run_packaged_ai.mjs --synthetic \
  packaged-ai-private-org-reviewer-entry.spec.ts
```

Keep `RHYTHM_FEATURE_MODEL` unset for the entry case.
`packaged-ai-private-profile-policy.spec.ts` changes an owned profile through
Settings, checks API/database/file persistence after reload, and creates a real
engine session without sending a model turn. It requires a separate fresh,
reviewed selected-default model loan so its model picker has a real authorized
catalog; the test enforces that loan's deadline even though it sends no prompt.
Use the approved loan runner's `run`/`scrub` lifecycle with this single spec,
`RHYTHM_FEATURE_MODEL=1`, and its exact synthetic fixture manifest. Do not combine
it with the unloaned entry case. A successful profile case proves neither a
semantic scan nor runtime enforcement of saved permissions.

`src/__tests__/org_reviewer_stale_skill_live.test.ts` is a separate opt-in API
contract. It submits an actual signed proposal, edits the managed skill through
its normal API, and requires stale approval to preserve the newer complete file,
metadata/version and proposed status without starting a measurement session.
Use only the approved read-only synthetic fixture with the standard sandbox
lifecycle above (API4098/engine4097), plus explicit owner identity/token pins:

```sh
cd apps/api_server
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
  RHYTHM_ORG_REVIEWER_STALE_SKILL=1 \
  RHYTHM_ORG_REVIEWER_OWNER_USER_ID=<synthetic-owner-id> \
  RHYTHM_ORG_REVIEWER_OWNER_EMAIL=<synthetic-owner-email> \
  RHYTHM_ORG_REVIEWER_OWNER_TOKEN_PATH=<private-synthetic-token-file> \
  RHYTHM_ORG_REVIEWER_FIXTURE_ROOT=<approved-read-only-fixture-root> \
  RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
  ./node_modules/.bin/vitest run src/__tests__/org_reviewer_stale_skill_live.test.ts --no-file-parallelism
```

The companion `org_reviewer_interactive_task_live.test.ts` runs with the same
isolated fixture and owner pins, plus `RHYTHM_EXPECTED_SOURCE_REVISION` set to
the full current checkout SHA. It drives normal HTTP prompts using only the
scripted loopback provider and invokes native `general`/`explore` through the
actual offered tool route. It must deny Reviewer delegation without creating
children, refuse bypass changes before durable mutation, repair historical
native helper grants, and retain ordinary chat's `general` helper. These are
runtime permission checks, separate from the UI scan and semantic workflow.
Run the two contracts serially against the sandbox:

```sh
./node_modules/.bin/vitest run \
  src/__tests__/org_reviewer_stale_skill_live.test.ts \
  src/__tests__/org_reviewer_interactive_task_live.test.ts --no-file-parallelism
```

Keep the same environment flags and pins from the preceding command, including
`RHYTHM_ORG_REVIEWER_STALE_SKILL=1`, for this combined run.

The sandbox MCP must be the built local entrypoint from this checkout, with
both API URL variables routed to4098. The loopback scripted provider controls
only model transport; actual API, engine, signed MCP, proposal validation and
managed-file application guards are exercised. This does not prove model
judgment, the native review UI, successful application/scoring, or later skill
use. Keep each result scoped and retain failed Recon receipts.

### Month-wide AI behavior qualification (2026-10-20)

The AI inventory is `docs/ai/plans/2026-10-20-ai-feature-test-inventory.json` and its
Markdown companion. Public issue/PR evidence and the complete September 20–October 20
commit ledger are beside it. Existing fixture tests are retained as focused protection;
their names, including `.live.redspec`, do not establish real runtime coverage.

Run from the task worktree root, after quitting Rhythm:

```sh
# Default is this worktree's locally built apps/electron/dist/Rhythm.app.
# Verifies its exact embedded revision, mega ancestry, unchanged product sources,
# bundled/live engine identity, and the normal packaged lifecycle.
RHYTHM_FEATURE_MODEL=1 node tools/testing/run_packaged_ai.mjs

# Enumerate every runtime case and explicit UNVERIFIED coverage failure without launching.
node tools/testing/run_packaged_ai.mjs --list

# Diagnose one feature; this subset is never full AI qualification.
RHYTHM_FEATURE_MODEL=1 node tools/testing/run_packaged_ai.mjs packaged-ai-companions.spec.ts
```

The command uses `packaged-ai-playwright.config.ts`, one worker, no retries, and
includes the existing router/session/conversation/primary/Coordinator/approval specs.
It also includes failing inventory-driven gaps. Reports go to
`apps/web/test-results/ai-behavior.json` and `apps/web/playwright-report/ai-behavior`.
Keep raw traces/screenshots private: they can contain the signed-in user's data.
Only sanitized recon and result summaries belong in commits.

`RHYTHM_SMOKE_USER_DATA` isolates only the Chromium profile; it does **not** isolate
the local database, engine state, companion state or Keychain credentials. The default
fixture uses signed-in local app data. A disposable-primary/owner-switch scenario needs
a supported isolated database **and** profile/engine/companion inputs (or a disposable
macOS account), not just that variable. Never launch a second API by hand; use the
stock packaged lifecycle or the approved sandbox procedure above.

The mega has a specialized `RHYTHM_QUALIFICATION_FIXTURE_MANIFEST` seam in
`apps/electron/src/agent-server.mjs` and the API qualification services. It binds a
private temporary DB/config/engine-state tree to the exact build. The opt-in
`syntheticActor` extension seeds a disposable ordinary session bearer through the
normal authentication repository, binds Chromium user data to the same private
root and refuses occupied runtimes or saved operator authentication. It supplies
four bounded synthetic profiles; no live database or account store is copied.
This qualifies no real OAuth or Keychain behavior. First native startup recon on
`8b6a4c3f24` exposed a renderer origin-validation prerequisite; its repair and
confirmation are tracked in the continuation run, so this is not yet a green
full-coverage command.

To create explicit private state for a selected disposable scenario after building:

```sh
REV=$(node -p "require('./apps/electron/dist/Rhythm.app/Contents/Resources/api_server/build-identity.json').sourceRevision")
FIXTURE_MANIFEST=$(node tools/testing/qualification_fixture.mjs "$REV")
RHYTHM_QUALIFICATION_FIXTURE_MANIFEST="$FIXTURE_MANIFEST" \
  node tools/testing/run_packaged_ai.mjs <selected-disposable-spec>
```

The launcher and SQLite readback revalidate exact revision, canonical0700 root,
0600 manifest/token, token digest/expiry and private Chromium profile. Invalid
fixture state fails instead of falling back to the operator database. Retain its
private logs while diagnosing; remove only the exact manifest-owned root after
the app and all owned runtimes have stopped and fixture cleanup is verified.
Pure filesystem guard check: `node --test tools/testing/qualification_fixture.test.mjs`.
Isolated model dispatch still needs separately authorized provider credentials;
provider-free router fixture modes are not real-model proof. Hermes child HOME,
native signer, companion input stores and device/relay custody require their own
boundary checks beyond API startup isolation.

The new checks use real catalog/readback/reload and one-request error injection,
read-only memory/filter/search and skill content, schedule history/cancel, canonical
shared-agent readiness, quality windows, and nonce-owned inert cookbook recipes.
Recipe cleanup checks exact ownership, API absence and read-only SQLite absence;
recipes are never run. No existing schedule is triggered or edited. No accounts,
integration connections or global settings are changed.

Hermes and Bot Crossing checks inspect their actual pinned CDP child pages, plus
their real service/IPC data. Hermes draft tests never send; Bot Crossing reads never
archive or open a real user's task in another harness. Dayflow readiness and actual
native attachment are independent assertions: an absent module or rejected artifact
must fail qualification. Native OS recording/privacy permissions are not granted.
Current unmet execution/privacy/device/owner-fixture scenarios remain explicit
`UNVERIFIED` failures rather than inheriting catalog or mocked-bridge success.

The October 19 app was built locally with `apps/electron/scripts/package-mac.mjs`, then signed
locally with `RHYTHM_SIGN_ONLY=1` (no GitHub build, upload, installation or notarization). The
packager and signing commands ran under the shared 10 GiB build guard. See the run log for
exact inputs, source pin, generated-payload preparation and build limitations.

Task UI requests use the actual hosted production API; readback reuses the captured request's
authentication in memory and targets that same origin. This qualifies the mega renderer against
the hosted Tasks contract, not a new hosted backend deployment. Agent sessions and engine reads
use the newly built local backend. Local SQLite is opened with `{readonly:true,fileMustExist:true}`
only. No test writes directly to the real database.

Every created task/session uses a unique `[smoke] <feature> <8-char nonce>` prefix. A per-test ledger
recovers successful-but-unacknowledged creates by exact nonce, verifies ownership before deletion,
hard-deletes sessions, and verifies both 404/readback and zero remaining nonce-owned list entries.
Unexpected renderer errors and new `[ERROR]` log lines fail. The only log exception is the exact
known NOT_FOUND session/deleted-session permission reads for IDs this test just deleted.

Primary entry is prequalified against the authenticated owner's existing root using read-only
SQLite. `/setup` is blocked in read-only primary tests. First-use setup, real Coordinator goals,
run-tree Stop/restart, and controlled signed expiry remain explicit failing `UNVERIFIED` cases:
those flows need a wholly disposable signed-in profile/database/native signer. Their permanent
root/journal/approval records lack safe real-profile cleanup. Real-model authorization alone does
not remove that data boundary. P1/P2 implementation remains paused at the inventory checkpoint.
