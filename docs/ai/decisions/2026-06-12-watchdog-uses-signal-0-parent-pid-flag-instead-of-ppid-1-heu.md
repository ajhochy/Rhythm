---
index: "[[Rhythm]]"
date: 2026-06-12
repo: rhythm
tags: [decision, rhythm]
---

# Watchdog uses signal-0 + --parent-pid flag instead of ppid===1 heuristic

**Context:** PR #683 smoke revealed that in `flutter run` (dev mode) the process chain is Flutter→npx→tsx→Node. The api_server's direct parent is tsx runner, so `process.ppid` is never 1 when Flutter exits — the legacy `ppid===1` watchdog fires silently. Production (`flutter build`, direct Flutter→Node spawn) works correctly today, but the flag-based approach is more robust and eliminates the mode-specific gap.

**Decision:** `ApiServerService.start()` now appends `--parent-pid=${pid}` (dart:io `pid` = Flutter's PID) to every spawn. `server.ts` reads the flag into `trackedRootPid` and uses `process.kill(trackedRootPid, 0)` — the POSIX liveness probe — rather than polling `process.ppid`. `ESRCH` (no such process) triggers `shutdown('PARENT_GONE')`. Legacy `ppid===1` branch retained for launchers that predate the flag.

**Alternatives considered:**
- PID file: Flutter writes its PID to a known path; server reads it. Rejected — filesystem dependency, needs cleanup, race on write. Signal-0 is synchronous and kernel-level.
- Process group kill from Flutter on exit: would need entitlement changes and is macOS/NSApp hook-specific. Signal-0 probe is platform-agnostic.
- Check liveness of every ancestor PID iteratively: over-engineered; tracking the single root (Flutter) is sufficient.

**Consequences:** Any launcher that does not pass `--parent-pid` falls back to the legacy path transparently. Signal-0 on a same-UID ancestor never returns EPERM on macOS (EPERM only if the probed process is owned by a different user), so EPERM is safely treated as "alive" without risk of false-positive shutdown.
