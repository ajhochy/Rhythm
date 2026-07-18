---
date: 2026-07-17
repo: Rhythm
branch: feat/1096-engraph-manager-wp1
pr: null
issues: [1096]
status: verified-pending-review
tags: [run, Rhythm]
---

# #1096 WP1 — device-local Engraph backend manager + health API

WP1 only (backend manager + authenticated loopback status/action API). WP2
(Flutter Settings UI) is explicitly OUT OF SCOPE for this run and was NOT
started — no `apps/desktop_flutter` files were touched (confirmed via
`git diff --name-only`, all changes are under `apps/api_server`).

## Files

New:
- `apps/api_server/src/services/engraph_manager_config_store.ts` — persisted
  device-local config (JSON, atomic write, mode 0600; mirrors
  `anthropic_accounts_store.ts`). Never stores secrets/memory content.
- `apps/api_server/src/services/engraph_manager.ts` — the manager: discovery,
  binary validation, path/root confinement, spawn/health/ownership lifecycle,
  retrieval-client getter.
- `apps/api_server/src/routes/engraph_manager_routes.ts` — authenticated
  loopback status/action endpoints (`/engraph-manager/*`).
- `apps/api_server/src/__tests__/engraph_manager.test.ts` — unit tests (39
  cases folded into 33 here + 6 in routes file, see Checks).
- `apps/api_server/src/__tests__/engraph_manager_routes.test.ts` — route
  auth-convention + security tests.
- `apps/api_server/src/__tests__/live_e2e_engraph_manager.test.ts` — required
  live behavioral test (fake fixture + optional real-binary run).
- `apps/api_server/src/__tests__/fixtures/fake_engraph_bin.js` — checked-in
  fake `engraph` CLI/HTTP fixture (executable) for fast/offline live testing.

Modified:
- `apps/api_server/src/services/engraph_client.ts` — added an OPTIONAL 4th
  `authToken` constructor param to `EngraphHttpClient` (additive; every
  existing call site/test is unaffected).
- `apps/api_server/src/services/memory_retrieval.ts` — `buildMemoryPreface`'s
  hybrid-mode branch now asks `engraphManager.getRetrievalClient()` for its
  client instead of relying on `getRelevantMemoriesSemantic`'s own default.
  That getter falls back to a plain `new EngraphHttpClient()` (the pre-existing
  #1093/#1095 operator/env-var client) whenever the manager itself isn't
  enabled+healthy, so this is purely additive — with the manager left off (its
  default state) behavior is byte-for-byte unchanged from before this PR.
- `apps/api_server/src/app.ts` — registered `/engraph-manager` (standalone
  prefix, not nested under `/agent-memory`, to avoid its `/:id` catch-all).
- `apps/api_server/src/server.ts` — non-blocking `ensureStartedIfEnabled()` at
  boot (inside the existing `agentExecutionEnabled` gate, alongside
  `memoryVaultSyncJob`) + ownership-guarded `shutdown()` in the existing clean
  shutdown handler.

## Architecture (~10 lines)

- **Discovery**: PATH scan + `/opt/homebrew/bin`, `/usr/local/bin` (no
  bundling). A chosen/discovered path is resolved (`realpathSync`, rejecting
  symlink tricks), confirmed executable, then run with a fixed `--version`
  argv (execFile — no shell) and must reply `engraph <semver>` before it is
  persisted.
- **Rhythm-only HOME**: verified against the real 1.7.2 binary that Engraph
  resolves ALL of its own state (`config.toml`, sqlite db, models) under
  `$HOME/.engraph`. The manager spawns Engraph with `HOME` overridden to its
  own Application Support subdir (`.../Rhythm/engraph-home`), so the user's
  real `~/.engraph` is never read, written, or migrated.
- **Path confinement**: the manager never accepts a caller-supplied vault
  path at all (no folder picker in the MVP) — it always resolves+realpaths
  `resolveMemoryDirPath()` itself. `isWithinApprovedMemoryRoot()` is an
  independently-testable defense-in-depth guard proving traversal/symlink-
  escape/whole-vault/sibling paths are all rejected.
- **Spawn**: fresh ephemeral loopback port + a fresh, never-persisted `eg_`
  API key (read permission only) written into Engraph's own `config.toml`
  (mode 0600) on every (re)start; `engraph serve --http --read-only --port
  <p> --host 127.0.0.1` via `child_process.spawn` with a fixed argv array
  (no shell).
- **Health gate**: `checkHealthNow()` performs a REAL authenticated
  `POST /api/search` with a strict 1000ms `AbortSignal.timeout` — a non-2xx,
  malformed, or timed-out response is NOT healthy; process/port existence is
  never treated as sufficient. Startup retries this exact 1s-budget check on
  a 500ms poll for up to 45s (real binaries can take longer than 1s to finish
  loading their embedding model on a fresh HOME) — but does NOT retry a
  `permission_denied` result, since waiting cannot fix a real auth/config
  problem.
- **Config persistence**: `EngraphManagerConfigStore` — enabled flag,
  executable path + discovery source, approved memory root, lifecycle state,
  last-healthy timestamp, sanitized failure category/message. No secret or
  memory content ever appears here or in the generated API key's lifetime
  (regenerated every start, only ever written to Engraph's own sandboxed
  config file).
- **Endpoints**: `/engraph-manager/{status,discover,choose-binary,enable,
  disable,check-health,retry,rebuild}`, same `if (!env.agentLocal)
  router.use(requireAuth)` convention as every other agent-local surface.

## Anti-#1124 guarantee (process ownership)

The manager tracks only the exact `ChildProcess` object returned by its own
`spawn()` call (`this.child`/`this.childPid`). There is no code path anywhere
in `engraph_manager.ts` that accepts an externally supplied PID or derives a
stop target from a port or process name — a structural test
(`anti-#1124 structural guarantee` in `engraph_manager.test.ts`) asserts the
file never calls `process.kill(`. `stopManagedProcess()`/`shutdown()` first
check `child.pid === this.childPid`; if the handle is absent or mismatched,
nothing is killed (verified: `disable()` with nothing spawned never calls
`kill`; a second `disable()` after the process already exited kills nothing).

## Path validation against the approved root

`resolveApprovedMemoryRoot()` always re-resolves+realpaths the existing
canonical `resolveMemoryDirPath()` — it is the ONLY vault path the manager
ever uses; there is no API surface that accepts an alternate folder.
`isWithinApprovedMemoryRoot()` is the independently-tested guard: exact root
→ true; parent (whole-vault), sibling, `../` traversal, symlink escaping the
root, and a nonexistent path → all false (6 dedicated unit tests).

## Loopback + auth proof, and read-only proof

- Auth: `engraph_manager_routes.test.ts` locks both halves of the existing
  convention — `AGENT_LOCAL=true` reaches every status/action route without a
  bearer token; `AGENT_LOCAL` unset 401s every one of them (including a
  spoofed `X-Forwarded-For` — Express trust-proxy is not configured, so this
  is not a bypass).
- Read-only: this router exposes ONLY lifecycle actions (status/discover/
  choose-binary/enable/disable/check-health/retry/rebuild) — a probe against
  `/search`, `/read`, `/create`, `/note`, `/content`, and `PUT /status` all
  404. The underlying managed Engraph service itself is proven read-only by
  its own real-binary behavior captured during this work: a **read**-
  permission API key gets `403 Insufficient permissions` on every write REST
  endpoint regardless of the `--read-only` flag (double-enforced), and
  `/api/health-check` requires no auth while `/api/search` 401s without a
  bearer token — reproduced live in `live_e2e_engraph_manager.test.ts`.

## Checks run

```bash
cd apps/api_server
npx tsc --noEmit                                                        # PASS, clean
npx vitest run src/__tests__/engraph_manager.test.ts                     # PASS 33/33
npx vitest run src/__tests__/engraph_manager_routes.test.ts              # PASS 7/7
RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/live_e2e_engraph_manager.test.ts
                                                                          # PASS 1/1 (fake fixture), 1 skipped (real-binary opt-in)
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_ENGRAPH_BIN=<downloaded real engraph 1.7.2 binary> \
  npx vitest run src/__tests__/live_e2e_engraph_manager.test.ts          # PASS 2/2 (fake fixture AND real binary)
npx vitest run src/__tests__/memory_retrieval_semantic.test.ts src/__tests__/agent_local_auth_bypass.test.ts
                                                                          # PASS 19/19 — #1095 hybrid-mode contract unchanged
npx vitest run                                                           # 3040 passed / 18 pre-existing memory_* vault-pollution
                                                                          # failures (documented in project-state.md, present on
                                                                          # main, unrelated) / 40 skipped — 0 regressions
```

Live/real-binary provenance: no `engraph` binary is bundled or installed by
Rhythm. For this run I downloaded the official `engraph-macos-arm64.tar.gz`
v1.7.2 release asset to a scratch temp dir (outside the repo, never
committed) purely to validate the manager's contract assumptions and run the
optional real-binary live test. Findings from that manual exploration
(HOME-sandboxing via env var, `serve --http --read-only` auth/permission
behavior, TOML config shape) are captured as code comments in
`engraph_manager.ts` and the fake fixture, and are exactly what the checked-in
`fake_engraph_bin.js` fixture reproduces for CI (no network / no bundled
binary needed).

Cleanup verified: `ps aux | grep engraph` and
`lsof -nP -iTCP -sTCP:LISTEN | grep engraph` both empty after every run —
no leaked processes/listeners.

`detect_changes({scope:'all'})`: risk **low**, 8 touched symbols across the 4
modified files (`createApp`, `main`, `shutdown`, `EngraphHttpClient`/`search`,
`buildMemoryPreface`, 2 consts), 0 affected processes — matches the intended
additive scope exactly.

## Notes / deferred

- **Sandbox not used for this run.** All verification above runs the manager
  directly (in-process unit/route/live tests against real child processes via
  the injected-fake-server harness) — no api_server HTTP surface required the
  running dev sandbox to validate this feature, since the manager's own
  in-process contract (spawn/health/ownership) IS the real entry point being
  proven, not an HTTP route wrapping unrelated business logic. The
  `/engraph-manager/*` HTTP routes themselves ARE covered (auth convention +
  security), just via the existing in-memory `startTestServer` harness rather
  than `tools/dev/sandbox.sh`. If a reviewer wants a full sandbox smoke (real
  api_server on :4098, hitting `/engraph-manager/enable` over HTTP with a real
  binary end-to-end), that remains a manual follow-up — see below.
- **Acceptance criteria met**: all WP1 criteria in the issue are covered by
  the tests above, EXCEPT the macOS signed/notarized-app-specific behaviors
  (Gatekeeper/TCC/quarantine/entitlement diagnostics), which cannot be
  exercised outside a packaged, signed `.app` — see manual handoff below.
- **Deferred / manual handoff**:
  1. Running `/engraph-manager/enable` through the actual signed, packaged
     desktop app (not just `npx vitest`/dev sandbox) to confirm binary
     selection, spawn, and the Application Support write all work from the
     macOS-sandboxed/signed context, and that a real Gatekeeper/TCC block
     produces the "actionable, non-alarming" diagnostic the issue calls for
     rather than a raw stack trace. This needs a signed build; not available
     in this environment.
  2. WP2 (Flutter Settings UI) — untouched, as instructed.
- **Design decision**: the manager's `enable`/`retry`/`rebuild` METHODS run
  indexing+spawn+health-gate to completion internally (this is what the live
  test and unit tests assert against directly — needed for deterministic
  tests and for `ensureStartedIfEnabled()` at boot). The `/engraph-manager/
  {enable,retry,rebuild}` ROUTES do not await them — they fire the action in
  the background (`.catch()`-guarded) and respond immediately with
  `{ accepted: true, status }`, so the HTTP response is never blocked on
  indexing/spawn/the up-to-45s health-gate. Callers (WP2 Settings UI) poll
  `GET /status` to see `'indexing'` → `'starting'` → `'ready'`/`'error'`.
  Locked by a dedicated test (`enable/retry/rebuild respond immediately...`)
  that proves the HTTP response returns in <500ms even when the underlying
  action is deliberately held open. `check-health` (≤1s by design) and
  `disable`/`choose-binary` (bounded to a few seconds) stay awaited — short
  enough not to need the same treatment.

## Next step

Hand off to `verification-gate`.
