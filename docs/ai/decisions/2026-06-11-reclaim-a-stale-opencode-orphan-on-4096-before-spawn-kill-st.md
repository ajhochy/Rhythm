---
date: 2026-06-11
repo: rhythm
tags: [decision, rhythm]
---

# Reclaim a stale opencode orphan on :4096 before spawn (kill-stale, not dynamic port) — #655

**Context:** The opencode engine binds a fixed port (`OPENCODE_ENGINE_PORT = 4096`) via the SDK's `createOpencode()`. When the api_server is SIGKILLed / Force-Quit, the existing parent-PID watchdog (`server.ts:106-125`) cannot run, so the opencode grandchild reparents to launchd and squats on :4096 indefinitely. The next launch fails to bind and surfaces the opaque "Server exited with code 1 / engine not ready".

**Decision:** Before `createOpencode()`, `reclaimStalePortForOpencode()` probes :4096. If the holder is unmistakably a stale `opencode serve` (command contains both `opencode` AND `serve`; if a `--port`/`--port=` token is present it must equal 4096), SIGTERM → grace-poll → SIGKILL → poll free, then spawn. If the holder is a NON-opencode process, throw a clear error naming the PID + command (flows through the existing `_initializeImpl` try/catch → `status=error` with that message). The OS boundary (`lsof`/`ps`/`kill`/port-free) is a `StalePortDeps` interface injected for unit tests.

**Alternatives considered:**
- Dynamic alternate-port retry (4097, 4098…) — rejected: the Flutter client + ws_gateway assume a fixed engine port; making it dynamic ripples through more surfaces than kill-stale (the issue's own rationale).
- Rely on the parent-PID watchdog only — rejected: it cannot cover untrappable SIGKILL / Force-Quit / OOM, which is exactly the orphan path.
- Blindly kill whatever holds :4096 — rejected: would kill a foreign process (e.g. another dev server); c2 requires naming-and-refusing instead.

**Consequences:**
- + A single Force-Quit no longer bricks the agent feature; self-heals on relaunch with a diagnosable log line.
- + Foreign-process case fails loudly with the occupying PID/command instead of the opaque exit-code-1.
- − `defaultStalePortDeps` shells to `lsof`/`ps` (macOS-present, the sole shipping target). On a host without them, `lookupPidOnPort` swallows the error and treats the port as free — safe degradation (same as "no orphan"), but means the reclaim is a no-op there.
- − The `serve`+`opencode` heuristic is deliberately conservative; an opencode invoked without `serve` in its argv would not be reclaimed (acceptable — the SDK always spawns `opencode serve`).

**Implementation note (lazy require):** `execFile` is resolved via `require('child_process')` *inside* `runCommand()` at call time, not bound at module load. A top-level `promisify(execFile)` broke `credentials_bridge_service.test.ts`, which partial-mocks `child_process` with only `execSync`; deferring the reference keeps module import inert for partial-mock importers.
