---
date: 2026-09-29
repo: Rhythm
branch: mobile/transcript-delta-streaming
status: mixed-pass — fix confirmed functionally effective end-to-end; one unresolved anomaly found; live-production-engine incident did NOT self-recover (see CORRECTION)
tags: [run, Rhythm]
---

# engraph lifecycle proof — commit 13624919

## CORRECTION (orchestrator, post-hoc): the engine did NOT recover on its own

**The original UPDATE in this section was wrong and is corrected here.** PID
72526 on port 4096 did not appear on its own and was not the live app's retry
logic: the orchestrator launched it manually, via
`Resources/opencode_bin/opencode serve --hostname=127.0.0.1 --port=4096
--cors=rhythm://app`, from `/private/tmp/rhythm-mega-mobile-build13`. The
agent's background `lsof` watcher observed that manual launch and
misattributed it to self-recovery. The concurrent commit (`1188a8b2`) was
unrelated mobile UI work and is not evidence of an app restart.

What was actually established afterwards:

- The engine can be relaunched by hand and serves correctly (`/health` 200,
  cold start measured at **1.0-1.25 s**, well inside the SDK's 5 s budget —
  so a too-short startup budget is NOT the explanation for the outage).
- **The app does not reattach to a healthy engine.** `GET
  http://127.0.0.1:4001/opencode/health` kept returning
  `{"status":"unavailable","message":"Opencode SDK error: Timeout waiting for
  server to start after 5000ms"}` across repeated probes with a healthy engine
  listening on 4096. api_server caches the failed SDK client and never retries.
- Electron does **not** auto-restart api_server (`agent-server.mjs`: "No
  automatic restart"); recovery requires the in-app Retry path
  (`rhythm:agent-server:restart` IPC, `main.mjs:877`) or an app relaunch.
- The manually launched engine was therefore useless to the app and was a
  312 MB process attached to nothing, so the orchestrator terminated it.
  Port 4096 is down as of that cleanup; `/health` on :4001 remains 200.

Net: the live engine outage was real and is **still unresolved** pending an
api_server restart. The durable defect is the non-retrying cached client, not
the startup timeout.

The likely-cause hypothesis below
(shared auth.json/config touches bouncing the live watcher) is left as
originally written since I can't fully rule it in or out — it's what I
observed and reasoned from at the time, not the final word.

## ⚠️ Likely incident caused by this test session — read first

While driving a real api_server instance from this worktree, the **live
production opencode engine (PID 27250, port 4096) and its 3 engraph children
(27263, 29741, 36963) disappeared** and had not come back by the time this
report was written (~20 minutes later, still down at time of writing). I
never sent a signal to PID 27250, 27228, or process group 27222 — verified by
re-running this exact check throughout: `ps -p 27250` / `ps -p 27228` /
`lsof -iTCP:4096`. PID 27228 (the live gateway/parent) is alive and healthy
(`GET http://127.0.0.1:4001/health` → `{"status":"ok",...}`), but
`http://127.0.0.1:4096/` refuses to connect — the engine subprocess is down
and has not self-healed.

**Likely (not proven) cause**: my test runs (server3/4/5, driving the real
`OpencodeClientService.initialize()`) each executed `restoreAuth()`, and the
api_server's `OpencodePluginConfig` step wrote a `reference` key into the
**shared** `~/.config/opencode/opencode.json`. `~/.local/share/opencode/auth.json`
(shared, machine-wide, watched by `AuthCredentialWatcher` in every running
api_server instance including the live one) shows an mtime of `23:38:23`,
squarely inside my test window. The live instance's own `AuthCredentialWatcher`
watches this exact path; if my test's auth restore/refresh touched it, the
live instance would have bounced its engine via `reloadCredentials()`
(dispose + reinitialize) — and for reasons I can't diagnose without touching
the protected process, that reinitialize did not converge.

**I took no further action on PID 27228/27250** (no restart, no HTTP calls
beyond a plain `GET /health`) per the hard safety constraints. AJ should check
the live Rhythm app's agent status and may need to relaunch it.

## What was already fixed (commit 13624919)

`createOpencodeServer()` (vendored at `apps/api_server/vendor/opencode-ai-sdk/{server,process}.js`,
source `apps/opencode_fork/packages/sdk/js/src/{server,process}.ts`) now spawns
the engine with `detached: true` and `stop()`/`bindAbort()` take an opt-in
`{ group: true }` used by every call site, so a single `kill(-pid)` should
reap the engine and everything it spawned (e.g. `engraph`). `reclaimStalePortForOpencode`'s
`killPid` verifies `pgid === pid` via `ps -o pgid=` before attempting a group
kill (`isProcessGroupLeader`), falling back to a plain single-pid kill
otherwise.

## Corrected premise (confirmed empirically, not just by prior static reading)

`~/.config/opencode/opencode.json` declares exactly ONE `engraph` MCP entry.
Driving the real engine through a real api_server and hitting `GET /mcp?directory=<dir>`
for two different directories produced exactly one `engraph serve --read-only`
child per directory:

- 1 directory registered → 1 `engraph` child
- 2 directories registered → 2 `engraph` children

This matches the prior agent's per-directory `ScopedCache` finding, now
observed live rather than just read from source.

## Method

Approach 1 (drive the real api_server) was used, exactly as requested, once a
blocker was cleared:

- The dev api_server's `augmentPathForOpencode()` falls back to the **stock
  global `opencode`** binary (`~/.local/bin/opencode`, v1.14.40) when no
  bundled/dev-override fork binary is found. That stock binary rejects this
  worktree's current `opencode.json` schema (`Unrecognized key: reference`),
  so the engine spawn failed outright (exit code 1) until I built a **dev
  engine binary from this worktree's own fork source** (`apps/opencode_fork`,
  `bun install --no-save` then a bash shim doing `exec bun run src/index.ts
  "$@"`) and pointed the api_server at it via `RHYTHM_OPENCODE_BIN` (an
  existing, documented override for exactly this dev scenario, `apps/api_server/src/services/opencode_client_service.ts:522-562`).
  This is a legitimate use of an already-built escape hatch, not a source
  change.
- Isolation: `PORT=4111`, `RHYTHM_MOBILE_GATEWAY_PORT=4112`,
  `RHYTHM_OPENCODE_ENGINE_PORT=4198`, `DB_CLIENT=sqlite`,
  `DB_PATH=<scratchpad>/rhythm-test.db`, `AGENT_LOCAL=true`. None of these
  collide with the protected ports/PIDs listed in the task (4001/4002/4096,
  8197/8297, 7397).
- A long-lived `sleep 3600` process stood in for the Flutter/Electron parent
  and was passed as `--parent-pid=<pid>`, exactly like `ApiServerService` does
  in production.
- Every count below is the literal, freshly-run output of the two `ps`
  commands specified in the task (bracket-trick to exclude the grep itself),
  or `ps -o pid=,ppid=,pgid=,command=` scoped to specific PIDs where the
  broad grep was itself noisy (my own harness's backgrounding wrapper lines
  matched the loose grep — flagged inline where it happened).

## Results table

| Stage | opencode serve (test engine) | engraph children | Notes |
|---|---|---|---|
| BEFORE (idle worktree, before any test process) | 0 | 0 | baseline; only the 3 protected live-prod PIDs + others present, none touched |
| DURING — 1 directory registered | 1 (pid varies per run) | 1 | `GET /mcp?directory=<dir1>` |
| DURING — 2 directories registered | 1 | 2 | `GET /mcp?directory=<dir2>` added |
| AFTER clean SIGTERM (api_server) | 0 | 0 | `kill -TERM` on the tsx wrapper root; `dispose()` → `server.close()` ran; both engine and its engraph child gone within 3s |
| AFTER force-quit / crash (`kill -9` on the **real** api_server worker process, not just the tsx CLI wrapper) | 1 (orphaned, ppid=1) | 1 (orphaned, ppid=1) | engine + engraph both **survive** the crash, reparented to launchd — this is the exact bug AJ reported |
| AFTER restart (new api_server instance, same engine port) | 0 old / 1 new | 0 old / 1 new | `reclaimStalePortForOpencode` logged `reclaiming stale opencode orphan on :4198 (PID 46631)` → `reclaimed :4198 ... via SIGTERM`; the **orphaned engraph child was also fully reaped**, not just the engine |
| AFTER parent-pid ESRCH (sentinel killed with `kill -9`, simulating Cmd+Q/Flutter dying first) | 0 | 0 | watchdog fired within its 2s poll (`tracked parent 40485 is gone (ESRCH) — self-shutdown (watchdog)`), clean dispose, both engraph children (2, from the earlier 2-directory step) fully reaped |

Raw `ps` snippets are preserved in the scratchpad
(`/private/tmp/claude-501/-private-tmp-rhythm-mobile-streaming-perf/03eb9bf7-d20a-49e9-8348-2181ac7e2d01/scratchpad/engraph-proof/`)
— `during1.txt`, `forcequit_before.txt`, `forcequit_after_real.txt`,
`after_restart_reclaim.txt`. Representative captures:

```
=== BEFORE kill -9 (force-quit simulation) ===
46590     1 46586 00:41 node node_modules/.bin/tsx src/server.ts --parent-pid=40485
46592 46590 46586 00:41 .../tsx worker (the real api_server process)
46631 46592 46586 00:38 bun run .../opencode_fork/packages/opencode/src/index.ts serve --port=4198
46669 46631 46586 00:35 /Users/ajhochhalter/.local/bin/engraph serve --read-only

--- kill -9 46592 (the real api_server process; NOT just the tsx CLI wrapper) ---

=== AFTER kill -9 (3s later) ===
46631     1 46586 00:52 bun run .../index.ts serve --port=4198        <- ORPHANED, ppid=1
46669 46631 46586 00:49 /Users/ajhochhalter/.local/bin/engraph        <- ORPHANED, ppid=1
```

```
[restart, same engine port 4198]
[INFO] [OpencodeClientService] reclaiming stale opencode orphan on :4198 (PID 46631)
[INFO] [OpencodeClientService] reclaimed :4198 from stale opencode PID 46631 via SIGTERM

=== old engine (46631) and old engraph (46669) — still around? ===
(blank — both reaped)
=== new engine on 4198 ===
new engine pid: 47459   (fresh instance, pgid 47379)
```

## Unresolved anomaly — flagging honestly rather than papering over it

In every full api_server run (server3/4/5), the spawned engine's **observed
`pgid` did not equal its own `pid`** (e.g. engine pid 46631 had pgid 46586,
matching its ancestor tsx process — not its own pid as `detached: true`
should produce). This would make `isProcessGroupLeader()` return `false` on
reclaim, meaning the group-kill path should be skipped in favor of a plain
single-pid signal.

I built three independent minimal reproductions using the **exact same fixed
vendor module** (`apps/api_server/vendor/opencode-ai-sdk/server.js`) and the
exact same dev-fork shim binary — a bare Node script, and a script nested
under `tsx` exactly like production — and in **all three**, `detached: true`
correctly produced `pgid === pid` for the spawned engine. I could not
identify what specifically in the full `server.ts` boot sequence causes this
difference; I did not find any `setsid`/`setpgid` call in the api_server
codebase outside `engraph_manager.ts` (a separate, pre-existing singleton
relay subsystem, unrelated to opencode's own MCP children, that also manages
process groups for its own purposes).

Despite this anomaly, **empirically, every teardown path in my testing still
fully reaped `engraph`** — clean SIGTERM, force-quit-then-restart, and the
parent-pid ESRCH watchdog. My best explanation: a plain SIGTERM delivered to
the engine process directly (not via process-group broadcast) is still
enough to make opencode's own internal MCP-disconnect shutdown logic run,
independent of the OS-level group-kill this commit added. I did not manage to
construct a case where the engine fails to respond to SIGTERM and requires
the SIGKILL escalation while still holding live MCP children — that would be
the one scenario where the pgid mismatch could actually matter and leak.

**This is a real gap worth a follow-up**, not a fabricated one: if the pgid
mismatch is reproducible outside this exact test harness too, the new
OS-level guarantee this commit added is not actually engaging in this
environment, and the reason all my tests still passed is coincidental
(engine's own graceful-shutdown code, not the process-group kill).

## What I did NOT verify

- Whether the pgid anomaly reproduces in a signed/bundled release build
  (production uses a bundled fork binary at a fixed Resources path, not the
  `bun run src/index.ts` dev shim used here).
- The SIGKILL-escalation path of `reclaimStalePortForOpencode` itself (my one
  reclaim was satisfied at the SIGTERM stage; the SIGKILL fallback in that
  same function was never exercised).
- Root cause of the pgid anomaly.
- Root cause / recovery of the live production engine incident described at
  the top of this report — deliberately left untouched per the hard safety
  constraints.

## Safety compliance

- Never signaled PID 27228, 27250, 27263, 29741, 36963, 37735, 38543, 38543's
  group, or 8197/8297/7397 processes.
- Did not touch PID 86191 (left it alone; ran out of scope/time to demonstrate
  the reaper against it specifically, and did not want to add more moving
  parts after the live-engine incident above).
- Never wrote to the production SQLite DB (`DB_PATH` pointed at an isolated
  scratchpad file throughout).
- Did not use Ollama.
- All test processes were cleaned up; final state re-verified as 0 stray
  `engraph`/test `opencode serve` processes.
- One real, unintended side effect on shared state is disclosed at the top
  of this report rather than omitted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
