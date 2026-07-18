---
date: 2026-07-17
repo: rhythm
branch: fix/1124-orphan-detection-sandbox-guard
pr: pending
issues: [1124]
status: implemented
tags: [run, rhythm]
---

# #1124 — Orphan-detection can kill a dev sandbox server

## Problem
`ApiServerService._killOrphanIfPresent()` treated any node process on :4001 with
PPID==1 as an orphan and killed it, then spawned its own embedded server against
production paths. A `nohup ... &` dev sandbox server is also reparented to PPID 1,
so it was a false positive with silent fallback to the live DB/HOME.

## Fix
`apps/desktop_flutter/lib/app/core/server/api_server_service.dart`
- Read `ps -o ppid=,command=` (was `ppid=` only) so we see the full command line.
- Skip + return (do not kill) any :4001 holder whose command line contains the
  `--rhythm-sandbox=` marker that `tools/dev/sandbox.sh` already stamps on its
  server (line 60), logging a clear refusal to stderr.
- Log loudly (command line included) before killing any non-sandbox orphan.

ponytail: reused the existing sandbox marker instead of adding a PID-file scheme.
The suggested-fix "app-written PID file" is a larger mechanism the marker already
covers for the reported repro; add PID-file tracking only if a non-sandbox
false-positive shows up.

## Checks
- `dart format` — clean (0 changed).
- `flutter analyze --no-fatal-infos` on the file — No issues found.
- GitNexus impact(`_killOrphanIfPresent`, upstream): LOW, 1 direct caller (`start`).

## Notes / verification gap
Client startup process-management change; no backend/engine runtime path (AGENTS.md
live-behavioral-test exception applies). Full confidence needs a manual smoke:
start `tools/dev/sandbox.sh up`, launch the app, confirm the sandbox server on its
port is NOT killed and the refusal log appears. Manual-handoff step.
