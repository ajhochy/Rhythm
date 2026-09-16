---
date: 2026-09-12
repo: Rhythm
branch: feature/electron-flutter-retirement
pr: null
issues: []
status: BLOCKED_AUTOMATION
tags: [run, Rhythm]
---

## Files
- `apps/electron/src/main.mjs`: separate interactive smoke from automated smoke; require absolute explicit userData before the instance lock; retain two-flag alternate-port gate. Do not construct the owned runtime, subscribe to it, migrate legacy data, start it, or register its shutdown signals in interactive mode. Report owned service as stopped, not a fabricated healthy sandbox.
- `apps/electron/test/electron-shell.test.mjs`: four offline contracts executing real main-module flag/lifecycle logic with Electron and runtime-service host boundaries replaced. No Electron child or server connection.
- This note only. Existing worktree documentation/screenshot dirt was present before this run and left untouched. HEAD remains `82d6b981`.

## Checks
Phase 0 completed before implementation:
- From `apps/electron`: `node --experimental-vm-modules --test --test-name-pattern=interactive-runtime test/electron-shell.test.mjs` → **RED**, 2 failed / 1 passed. Interactive launch unexpectedly recorded `construct`, `subscribe`, `migration`, `start`, `prevent-quit`, `stop`, `quit`; missing userData produced “Missing expected rejection.” The combined UI/lifecycle contract was subsequently split into c1/c2.
- Contract mapping is kept here to respect the three-file ownership limit: c1 visible window/normal agents route/no automation exit; c2 zero owned-service construction/lifecycle/error calls and zero SIGINT/SIGTERM listeners; c3 absent/relative userData rejected, explicit path precedes lock, six flag combinations preserve exact 4098/4097 versus 4001/4096 gating; c4 production lifecycle retained and automated smoke remains hidden without start/stop/migration. c5 focused bounded checks below; c6 scope/no commit/no peer/process actions verified by this run and diff review.

Phase 1 completed:
- Read worktree AGENTS, project-state/current-plan, main/test, existing main-runtime harness and runtime/config/package boundaries; checked branch/status with `git status --short && git branch --show-current && git rev-parse --short HEAD`.
- GitNexus MCP `list_repos` exposes only the older canonical Rhythm index, not this worktree. `impact` on main/AgentServerService returned target-not-found; worktree-path lookup returned repository-not-found. No new risk result claimed. Dispatch supplies **LOW: 3 direct refs, 0 processes** for AgentServerService; its implementation is unchanged.

Phase 2 completed, first implementation passed:
- From `apps/electron`: `node --experimental-vm-modules --test --test-name-pattern='interactive-runtime|e11-c6' test/electron-shell.test.mjs test/main-runtime.test.mjs && npm run typecheck` → **PASS**, 5 tests / 0 failures (~101 ms); Electron `tsc --noEmit` exit 0. Existing startup-failure bridge/dialog test retained.
- From worktree root: `git diff --check` → exit 0; reviewed `git diff --stat -- apps/electron/src/main.mjs apps/electron/test/electron-shell.test.mjs` and `git diff -- apps/electron/src/main.mjs`.
- No full suites, web build, packaging, real Electron smoke, screenshot writes, server probes, process signals, sandbox lifecycle commands, commits, pushes, PRs, or peer dispatches. Existing actual-Electron tests were deliberately filtered out because their default smoke uses live canonical ports and writes shared screenshot evidence.

## Notes / manager handoff
**READY_FOR_VERIFICATION**, not packaged/manual-smoke PASS. VM contracts prove host wiring, not actual Chromium visibility or sandbox connectivity. Manager must rebuild/package this source before launching; existing packaged candidate does not contain this repair.

Manual c1/c2/c3 target: visible normal agents UI at sandbox 4098/4097, no local-runtime ownership dialog or migration prompt, remains open for interaction; closing the Electron candidate leaves sandbox running. Fixture source remains `/private/tmp/rhythm-e02-fixture-20260911-phase0-57ba71255a`; sandbox remains manager-owned at `/private/tmp/rhythm-electron-interactive-smoke`. No contact with shipping `/Applications/Rhythm.app`, API4001, or engine4096 occurred.

After manager packaging, launch this candidate directly (not `/Applications/Rhythm.app`):

```bash
env HOME=/private/tmp/rhythm-electron-interactive-smoke/home \
  RHYTHM_SHELL_USER_DATA=/private/tmp/rhythm-electron-interactive-smoke/electron-user-data \
  RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
  /Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement/apps/electron/dist/Rhythm.app/Contents/MacOS/Rhythm \
  --interactive-smoke --allow-test-runtime-ports
```

Do not add `--smoke`: it intentionally retains hidden automated behavior. Without the allow flag, canonical port pinning still applies; use the exact launch above for manual verification. Keep the sandbox running.

## Smoke-test-writer packaged probe — BLOCKED / UNVERIFIED

This section supersedes the earlier manager-owned lifecycle handoff for the **automated probe only**. No packaged interactive PASS is claimed. Branch/HEAD checked as `feature/electron-flutter-retirement` / `82d6b981`, with the existing uncommitted interactive repair preserved.

### Files and coverage

- Added only `apps/electron/test/packaged-interactive-smoke.mjs` and updated this evidence note. No product/package-script edits, package rebuild, screenshots, commits, or peer dispatches. Pre-existing project-state/generated evidence/blocked-note dirt was preserved.
- KEEP existing VM contracts: they catch flag and runtime-ownership wiring regressions, but cannot establish real window behavior. KEEP hidden packaged contracts: they exercise packaged protocol/preload, not visible interactive lifetime.
- One opt-in Node probe reuses installed `apps/web/node_modules/playwright`. It launches the actual `apps/electron/dist/Rhythm.app/Contents/MacOS/Rhythm` with `--interactive-smoke --allow-test-runtime-ports`, plus loopback ephemeral Chromium remote debugging. The hardened package disables Node inspector arguments; no fuse or product-code weakening was attempted.
- Planned assertions: exact agents URL and preload 4098/4097 configuration; real Dashboard → Agents clicks; visible renderer plus PID-scoped macOS AX/onscreen standard window and no native dialog/sheet across six one-second observations; native graceful quit with exit 0; unchanged sandbox listener PIDs afterward. Native helper is embedded in the one probe and compiled into disposable sandbox storage. Missing accessibility permission is an explicit `UNVERIFIED` failure, not a manual-only pass.
- **None of those acceptance assertions completed:** CDP discovery blocked before attachment. The Swift observer compiled after an initial harness-only correction but was not executed. No screenshot was taken; no computer-control fallback was used. Deterministic coverage remains the intended path; human smoke and verification-gate remain pending.

### Exact command and local dependencies

From `/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement`:

```bash
node --check apps/electron/test/packaged-interactive-smoke.mjs && RHYTHM_LIVE_E2E=1 node apps/electron/test/packaged-interactive-smoke.mjs
```

Syntax check passed. Probe exited **1**. Without `RHYTHM_LIVE_E2E=1`, the script skips rather than launching any process.

The probe owns `tools/dev/sandbox.sh up`, `status`, and `down` in `finally`, with exact sanitized inputs:

```text
RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-e02-fixture-20260911-phase0-57ba71255a
RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-e02-fixture-20260911-phase0-57ba71255a/rhythm.db
RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-e02-fixture-20260911-phase0-57ba71255a/opencode.json
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-electron-interactive-probe
RHYTHM_SANDBOX_API_PORT=4098
RHYTHM_SANDBOX_ENGINE_PORT=4097
RHYTHM_SANDBOX_GATEWAY_PORT=4099
```

Candidate HOME is `/private/tmp/rhythm-electron-interactive-probe/home`; absolute `RHYTHM_SHELL_USER_DATA` is `/private/tmp/rhythm-electron-interactive-probe/electron-user-data`; live API/engine URLs are `http://127.0.0.1:4098` / `http://127.0.0.1:4097`. Candidate environment is allowlisted, with sandbox XDG/cache/tmp paths and the sandbox Keychain blocker on PATH. No live application or 4001/4096 inspection, request, or signal was performed. The sandbox launcher necessarily rebuilt its fork/API/MCP payloads during each `up`; the Electron package was not rebuilt.

### Observed output and cleanup

Final run output (build boilerplate omitted; result-bearing lines verbatim):

```text
curl: (7) Failed to connect to 127.0.0.1 port 4098 after 0 ms: Couldn't connect to server
Sandbox ready: http://127.0.0.1:4098 (engine :4097)
sandbox: /private/tmp/rhythm-electron-interactive-probe
live-artifact storage: /private/tmp/rhythm-electron-interactive-probe/live-artifacts
api :4098 listener: 35710
engine :4097 listener: 35728
gateway :4099 listener: 35710
sandbox: sanitized diagnostics preserved: /private/tmp/rhythm-electron-interactive-probe.evidence.q6Id5Z
Sandbox removed: /private/tmp/rhythm-electron-interactive-probe
AssertionError [ERR_ASSERTION]: UNVERIFIED: packaged Chromium CDP unavailable
```

The initial curl refusal is the launcher's readiness retry, followed by ready. Candidate remained without an observed exit/signal during the ten-second CDP discovery window, but emitted no stdout/stderr endpoint and no discovery file. This establishes an automation attachment blocker, **not** visible/interactive behavior or a diagnosed product failure. Failure cleanup signaled only the directly spawned candidate, then `sandbox.sh down` completed; graceful candidate exit and PID preservation acceptance remain unverified.

Five bounded attempts all reached sandbox readiness and completed `down`: initial Swift harness compile failure (`kAXSheetsAttribute` unavailable, corrected to AX child role checks; diagnostics `.evidence.VtFBfJ`); then CDP-unavailable runs `.evidence.UPkw0K`, `.evidence.J7zYRd`, `.evidence.5WcAGJ`, and `.evidence.q6Id5Z`. Subsequent harness changes added startup output, early signal detection, and the standard `DevToolsActivePort` discovery fallback; none established attachment.

Required unblock: establish a working deterministic connection to this unchanged hardened candidate (or authorize a different native observation path), then rerun the single probe and verification gate. No acceptance gap is marked PASS.

## Focused sandbox renderer-origin repair — BLOCKED (existing guard failures)

### Files / phases

- Owned changes only: one constant in `tools/dev/sandbox.sh`, one regression assertion in `tools/dev/sandbox_guard_test.sh`, this appended evidence. Existing Electron/product/generated dirt preserved. Branch verified: `feature/electron-flutter-retirement`.
- Phase 0: invoked acceptance-contract first; read AGENTS/project-state/current-plan. Contract mapping is inline to preserve the three-file scope: origin-c1 exact two-origin export plus live allow/deny matrix; origin-c2 existing guards and browser-origin HTTP/CORS; origin-c3 new export assertion; origin-c4 owned up/status/probes/down; origin-c5 scope/diff and command review. No new contract file or implementation abstraction.
- RED command: `bash tools/dev/sandbox_guard_test.sh` → **12 passed, 7 failed**, including `FAIL (exact approved renderer origins exported)`. This test sources the real launcher and executes `env -i "${runtime_env[@]}" /bin/bash` to assert the exact value despite caller injection `RHYTHM_LOCAL_RENDERER_ORIGINS=https://unapproved.invalid`; no SUT mock added.
- Phase 1: GitNexus upstream impact for `tools/dev/sandbox.sh` in `Rhythm` returned target-not-found / UNKNOWN, not a LOW claim. Dispatch supplies LOW / 1 direct test ref / 0 processes for unchanged `resolveOpencodeCorsOrigins`. No product symbols modified.
- Phase 2: changed only the constant to `http://127.0.0.1:4175,rhythm://app`. First rerun of the same guard command → **13 passed, 6 failed**; origin assertion green. Six failures occur both before and after implementation: safe fixture, schema-valid config, fresh-home safe fixture lack required MCP command arrays; empty-map test expects obsolete error wording; restart lifecycle and readiness-timeout fixtures fail security-shim ownership/type/permissions. Those unrelated tests/guards were not repaired under the one-regression-assertion ownership limit. No second repair attempt.

### Live command and evidence

Executed from `/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement` inside `bash -c` with `set -euo pipefail`:

```bash
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-e02-fixture-20260911-phase0-57ba71255a
export RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-e02-fixture-20260911-phase0-57ba71255a/rhythm.db
export RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-e02-fixture-20260911-phase0-57ba71255a/opencode.json
export RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-electron-origin-verify
export RHYTHM_SANDBOX_API_PORT=4098 RHYTHM_SANDBOX_ENGINE_PORT=4097 RHYTHM_SANDBOX_GATEWAY_PORT=4099
export RHYTHM_LOCAL_RENDERER_ORIGINS=https://unapproved.invalid
[[ ! -e "$RHYTHM_SANDBOX_DIR" ]]
trap 'bash tools/dev/sandbox.sh down' EXIT
bash tools/dev/sandbox.sh up
bash tools/dev/sandbox.sh status
python3 -c 'import subprocess
for origin in ("rhythm://app", "http://127.0.0.1:4175", "https://unapproved.invalid"):
 for port, path in ((4098, "/health"), (4097, "/global/health")):
  result = subprocess.run(["curl", "--noproxy", "*", "--max-time", "10", "-sS", "-i", "-H", "Origin: " + origin, f"http://127.0.0.1:{port}{path}"], check=True, capture_output=True, text=True).stdout
  headers, body = result.split("\n\n", 1)
  status = int(headers.splitlines()[0].split()[1])
  cors = [line.split(":", 1)[1].strip() for line in headers.splitlines()[1:] if line.lower().startswith("access-control-allow-origin:")]
  print(f"{port}{path} Origin={origin} HTTP={status} ACAO={cors} body={body.strip()}", flush=True)
  if origin != "https://unapproved.invalid":
   assert status == 200 and cors == [origin], result
  else:
   assert not cors, result
   if port == 4098: assert status == 403, result
'
```

Result: **exit 0**, all six assertions passed. Launcher performed its built-in fork/API/MCP builds; no Electron package build or full suites. Initial readiness curl connection refusal was followed by `Sandbox ready: http://127.0.0.1:4098 (engine :4097)`.

| Origin | API /health | Engine /global/health | Access-Control-Allow-Origin |
| --- | --- | --- | --- |
| `rhythm://app` | 200, status=ok | 200, healthy=true | exact `rhythm://app` on both |
| `http://127.0.0.1:4175` | 200, status=ok | 200, healthy=true | exact browser origin on both |
| `https://unapproved.invalid` | 403, FORBIDDEN_ORIGIN | 200, healthy=true | absent on both (engine denies browser CORS access) |

Status recorded API/gateway PID **40718**, engine PID **40736**, sandbox `/private/tmp/rhythm-electron-origin-verify`. EXIT cleanup printed:

```text
sandbox: sanitized diagnostics preserved: /private/tmp/rhythm-electron-origin-verify.evidence.qVktcY
Sandbox removed: /private/tmp/rhythm-electron-origin-verify
```

`down` completed its owned-process shutdown and sandbox-listener-empty checks. No request, inspection, or signal to `/Applications/Rhythm.app` or ports 4001/4096. No peers, commit, push, PR, merge, installed-candidate launch, or package rebuild.

### Handoff

`bash -n tools/dev/sandbox.sh tools/dev/sandbox_guard_test.sh && git diff --check` passed; `git diff -- tools/dev/sandbox.sh tools/dev/sandbox_guard_test.sh` confirms one constant plus one assertion; `git status --short` confirms existing dirt remains. **BLOCKED** rather than READY_FOR_VERIFICATION because the required guard test remains red on six pre-existing cases. The focused origin repair and live up/status/CORS/down verification pass; manager needs a separately authorized guard-fixture repair or explicit baseline disposition before declaring the gate green. Installed side-by-side smoke remains manager/AJ-owned and unverified by this run.
