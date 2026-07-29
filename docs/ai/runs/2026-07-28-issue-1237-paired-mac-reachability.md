---
date: 2026-07-28
repo: Rhythm
branch: issue/1237-paired-mac-status
pr: null
issues: [1237]
status: corrected-e2e-execution-blocked
tags: [run, Rhythm]
---

# Issue #1237 paired-Mac reachability

## Files

- Added bounded, deduplicated paired-host health polling and routed paired
  OpenCode recovery through that state.
- Updated Settings, Agents/chat loading, chat mutation gating, and paired-Mac
  controls to use authoritative paired-host reachability.
- Added fake-server reachability controls plus root contract and Playwright
  tests. See `.proof/i1237/result.json` for criterion mapping.
- Corrected the E2E regression by leaving unpaired direct-web sessions on the
  existing OpenCode connection path and applying paired reachability gates only
  when a saved paired host exists.
- Moved paired-offline rendering ahead of loaded-session/spinner branches and
  limited SSE-triggered reachability refresh to once per outage.
- Stabilized paired-client identity across same-host probes so the cadence
  cannot restart SSE every five seconds; c5 now checks both transcript and
  Activity uniqueness after recovery.

## Checks

- `git diff --check` — pass.
- `npm run lint` — pass.
- `npm run typecheck` — pass.
- `node --test tests/contract/issue-1237-paired-reachability.test.mjs
  tests/paired-host.test.mjs` — pass, 4/4 test entries; paired-host script
  reports 22 state-machine scenarios passed.
- `npm run build:web:ci -- --clear` — pass; 15 static routes exported.
- Playwright discovery — pass; 21 tests found (16 legacy flows, 5 #1237).
- Focused Playwright execution — blocked before tests ran because the managed
  sandbox rejected the fake server's localhost bind with
  `listen EPERM 127.0.0.1:44096`; failure-triage reproduced and classified
  this as environment infrastructure, not an application assertion failure.
- Physical-iPhone Tailscale off/on smoke — not run; hardware/manual gate.

## Notes

The E2E suite writes offline and recovered screenshots to `.proof/i1237/ui/`
when an external verifier with localhost socket permission runs it. A
pre-existing `recovered.png` from the earlier stalled attempt was inspected but
does not count as corrected-run evidence; `offline.png` is absent. No
screenshot was fabricated after Playwright was blocked before browser startup.
