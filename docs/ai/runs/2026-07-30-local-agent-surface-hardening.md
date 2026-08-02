---
date: 2026-07-30
repo: Rhythm
branch: codex/harden-local-agent-surface
pr: null
issues: []
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Local agent surface hardening

## Files changed

- Added a shared local-agent HTTP/WebSocket provenance and Host guard.
- Made an empty CORS allowlist fail closed for Origin-bearing requests while
  preserving configured hosted origins and headerless native clients.
- Applied the shared guard before agent and PTY WebSocket acceptance.
- Added the default-on `RHYTHM_AGENT_ORIGIN_GUARD=off` recovery switch.
- Added a real HTTP/WebSocket behavioral contract and updated the existing
  loopback WebSocket regression.

## Checks run

- Acceptance contract baseline on `origin/main`: 9 passed, 6 failed.
- Final acceptance contract: 19 passed, 0 failed.
- Exact API regression selection: 154 passed, 1 unrelated env-gated skip.
- Final serial API suite: 3,713 passed, 110 skipped, 0 failed.
- Focused post-review HTTP/WebSocket suite: 30 passed, 0 failed.
- `npx tsc --noEmit`: passed.
- Issue-level workflow gate: passed.
- Flutter analyze, format, and tests: passed.
- MCP typecheck, tests, and build: passed.
- Vendored engine typecheck and session tests: passed.
- Mobile static, contract, fake-server, and browser E2E: passed; browser E2E
  was 69/69.
- `git diff --check`: passed.

## Notes

- The full API gate initially exposed cross-file environment leakage from the
  new contract harness. Failure triage isolated the cause; the contract now
  uses fresh module instances without mutating process-wide environment state.
  The complete serial API suite passed afterward. No follow-up issue was filed.
- Independent read-only security review found no Critical or High findings and
  recommended approval with follow-ups. Its pre-merge socket-error finding was
  fixed and reverified.
- A read-only production health check confirmed that the hosted deployment has
  a non-empty CORS allowlist: a native-style request succeeded, while an
  unapproved Origin was rejected.
- Authentication middleware, `server.ts`, and `pty_routes.ts` were not changed.
- The requested live sandbox was intentionally not started; validation used
  ephemeral loopback test listeners and never touched ports 4096-4098 or the
  real Rhythm database.
- GitNexus indexed the exact worktree and compared it with `origin/main`:
  7 code/test files, 22 symbols, 0 affected execution flows, low risk.
- No PR was opened and no merge was performed.
