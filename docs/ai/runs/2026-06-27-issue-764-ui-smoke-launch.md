---
date: 2026-06-27
repo: Rhythm
branch: fix/issue-761-agents-ui-render
pr: 763
issues: [764]
status: ready-for-manual-smoke
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# #764 — Agents UI smoke environment launch

## Files changed

- `docs/ai/project-state.md` — refreshed the current snapshot.
- `docs/ai/runs/2026-06-27-issue-764-ui-smoke-launch.md` — this run record.
- `docs/ai/decisions/2026-06-27-launch-dev-app-in-place.md` — recorded the
  dev-launch path requirement.

## Checks run

- Confirmed branch `fix/issue-761-agents-ui-render` at `640f0e1bb368`.
- Confirmed staged fork version:
  `0.0.0-fix/issue-761-agents-ui-render-202606272206`.
- Cleared listeners on `:4000`, `:4001`, and `:4096`.
- `flutter build macos --debug` → PASS.
- Launched
  `apps/desktop_flutter/build/macos/Build/Products/Debug/Rhythm.app` in place.
- Native UI inspection → Agents screen loaded without an unavailable banner.
- `GET http://localhost:4001/opencode/health` → ready.
- Listener on `:4096` resolves to
  `apps/api_server/opencode_bin/opencode`; its own startup log reports the
  required build version.
- `GET http://localhost:4001/agents/capabilities` → `"opencode": true`.
- Confirmed no listener on `:4000`.

## Notes

- The prior GUI failure was primarily a dev-discovery path problem, not an
  engine trust failure. `tools/dev/launch_desktop_current.sh` copies the app to
  `/private/tmp/Rhythm Current.app`; `ApiServerService._findServer()` walks up
  from the executable looking for `apps/api_server`, so that copied app returns
  `bundleNotFound` before Node or opencode can start.
- Launching the freshly built app directly from the repo lets the app spawn the
  `tsx` server on `:4001`, which then resolves the staged fork first in
  `apps/api_server/opencode_bin`.
- The engine took longer than the initial short poll to bind `:4096`; it became
  ready without removing provenance, changing Gatekeeper policy, or re-signing.
- This run only establishes the manual-smoke environment. The human has not yet
  performed #764's functional Claude-turn smoke, so no #764 failure-postmortem
  result was recorded.
