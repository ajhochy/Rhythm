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

- No Rhythm product or test source changed in this lane.
- Isolated, local-only Hermes source branch `codex/hermes-timeout-diagnostic` at `c755d85f5eec53bb11e9f6c593bfa4e2810d6157` adds temporary sanitized timeout instrumentation to `apps/desktop/electron/desktop-native-runtime.ts`. The original Hermes checkout and installed/sealed artifacts remain untouched. This diagnostic commit is not a product fix.

## Checks

- Reviewed `docs/ai/regression-registry.md`, the full repair run record, current project state and plan before source inspection. The registry warns that timeout wording can misidentify the failing layer.
- Inspected the private Playwright failure trace without copying payloads into this record. The main-process error stack reaches the Hermes native `fetchJson` socket inactivity callback in the pinned sealed artifact. The 15-second message does not prove TCP connection failure.
- Mapped the sealed manifest source commit `13ade17847a0225dc95b79d9ed5c9c6afc8bc083` to an isolated exact-source checkout. The `hermes:api` handler routes through the real native runtime; the embedded host's fallback proxy is not the failing handler.
- Correlated trace wall time with a bounded, read-only Hermes log interval. Native backend readiness was recorded at 19:19:26.124Z; the Bot test began at 19:19:30.646Z; its strict audit surfaced the timeout around 19:19:45Z. Existing logs do not record the request method/path or a contemporaneous backend health result. Shared agent warnings in this interval cannot be attributed to the tested backend by PID.
- The follow-up hidden-interval CROSS test passed earlier but exercised a ready Hermes child. It did not reproduce this just-started backend overlap.
- `git show --check --oneline c755d85` passed in the isolated Hermes source. No build, native rerun, or RED/GREEN product regression has been claimed.

## Notes

- Temporary diagnostic logs only method, normalized `/api/<family>`, elapsed time, sanitized error code/name, and socket connected/response-started/byte counts. No query, URL, profile, token, payload, or record ID is logged.
- Rhythm's factory validator requires a clean exact source pin, Electron version match, and file-integrity manifest. The diagnostic must be built and sealed from its local commit and repinned normally for a native test; no dirty-artifact admission bypass is planned.
- A fresh isolated Hermes checkout has no dependency store or symlinks. The guarded exact-lockfile install/build awaits the exclusive runtime window after the API serial gate. The final behavioral RED test and smallest product fix depend on the route and backend-health evidence from that run.
