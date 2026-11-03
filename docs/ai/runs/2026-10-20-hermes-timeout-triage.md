---
date: 2026-10-20
repo: rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: [1598]
status: unverified
tags: [run, rhythm, hermes, repair]
---

# Retained Hermes API timeout triage

## Files

- Added a read-only cold-start overlap case to `apps/web/tests/packaged/packaged-ai-companions.spec.ts`; no Rhythm product source changed in this lane.
- Isolated, local-only Hermes source branch `codex/hermes-timeout-diagnostic` has temporary sanitized request-phase instrumentation at `bfe6a5baeddf8e84c0fbc5992281c2b72b516052`. A later separate commit `9762c2a53678d6fd53b3c0c90351b619ce381f6c` adds a main-only private child HOME option for synthetic fixture isolation. Neither commit is a timeout product fix. The original Hermes checkout and installed artifacts remain untouched.

## Checks

- Reviewed `docs/ai/regression-registry.md`, the full repair run record, current project state and plan before source inspection. The registry warns that timeout wording can misidentify the failing layer.
- Inspected the private Playwright failure trace without copying payloads into this record. The main-process error stack reaches the Hermes native `fetchJson` socket inactivity callback in the pinned sealed artifact. The 15-second message does not prove TCP connection failure.
- Mapped the sealed manifest source commit `13ade17847a0225dc95b79d9ed5c9c6afc8bc083` to an isolated exact-source checkout. The `hermes:api` handler routes through the real native runtime; the embedded host's fallback proxy is not the failing handler.
- Correlated trace wall time with a bounded, read-only Hermes log interval. Native backend readiness was recorded at 19:19:26.124Z; the Bot test began at 19:19:30.646Z; its strict audit surfaced the timeout around 19:19:45Z. Existing logs do not record the request method/path or a contemporaneous backend health result. Shared agent warnings in this interval cannot be attributed to the tested backend by PID.
- The follow-up hidden-interval CROSS test passed earlier but exercised a ready Hermes child. It did not reproduce this just-started backend overlap.
- Guarded isolated exact-lockfile install, Electron 40.10.2 native rebuild, and sealed artifact producer passed. Rhythm's normal factory validator checked all 404 integrity entries for both diagnostic artifacts. The first signed diagnostic package had exact Rhythm product identity `8b6a4c3f2445ccb3e86deb925f6b1dbb00f7d3c5` and Hermes pin `c755d85f5eec53bb11e9f6c593bfa4e2810d6157`.
- The fresh-worker cold-start overlap passed 1/1 in 50.9 seconds with strict native/main audits. The full companion file passed 8 and failed 2 over 2.5 minutes: one Bot Crossing late inventory IPC denial/unavailable and one Dayflow native module absence. All Hermes/CROSS cases passed; the original timeout remains intermittent and unproven as repaired.
- The private-child HOME regression was RED with actual operator HOME instead of fixture HOME, then GREEN 10/10 Hermes backend-env tests after the source change; desktop typecheck passed. This addresses synthetic fixture isolation only.

## Notes

- Temporary diagnostic logs only anonymous request sequence, method, normalized `/api/<family>`, phase, elapsed time, HTTP status, sanitized error code/name, and socket connected/response-started/byte counts on timeout. No query, URL, profile, token, payload, or record ID is logged.
- Rhythm's factory validator requires a clean exact source pin, Electron version match, and file-integrity manifest. The diagnostic must be built and sealed from its local commit and repinned normally for a native test; no dirty-artifact admission bypass is planned.
- The `bfe6a5b` visibility artifact is sealed and validated, ready for the next exact-pinned package. It has not yet been exercised natively. The final behavioral RED test and smallest product fix depend on request-phase/backend-health evidence from that run.
