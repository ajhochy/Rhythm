## Summary

- Decoupled Hermes lifecycle ownership from agent-server ownership. Attached `--interactive-smoke` sessions now start, install/restart, and stop the Rhythm-owned Hermes sidecar when `RHYTHM_HERMES_ENABLED !== '0'`.
- Kept explicit `--smoke` and `--missing-dist` self-test modes Hermes-free. The fixed-port conflict behavior, controller-owned shutdown, and main-only token minting remain unchanged.
- Forwarded supervisor output and lifecycle transitions to main-process stdout, including `hermes: starting`, `hermes: ready`, and `hermes: failed <reason>`.
- Static/socket-free verification is green. A real Electron/Hermes launch remains unverified because this run was constrained not to launch Electron or open sockets. No commit, stash, or checkout was performed.

## Files changed

- [apps/electron/src/main.mjs](/Users/ajhochhalter/Documents/Rhythm/.mega-wt/fix-hermes-ownership/apps/electron/src/main.mjs) — independent Hermes ownership gate, stdout logging, and interactive shutdown/signal handling.
- [apps/electron/test/main-runtime.test.mjs](/Users/ajhochhalter/Documents/Rhythm/.mega-wt/fix-hermes-ownership/apps/electron/test/main-runtime.test.mjs) — socket-free attached-mode, self-test exclusion, disabled-flag, shutdown, and stdout regressions.
- [apps/electron/test/hermes-server.test.mjs](/Users/ajhochhalter/Documents/Rhythm/.mega-wt/fix-hermes-ownership/apps/electron/test/hermes-server.test.mjs) — updated interactive ownership expectations while preserving agent-runtime non-ownership.
- [apps/electron/test/electron-shell.test.mjs](/Users/ajhochhalter/Documents/Rhythm/.mega-wt/fix-hermes-ownership/apps/electron/test/electron-shell.test.mjs) — updated interactive quit/signal assertions for Hermes-only supervision.
- [docs/ai/contracts/issue-1541.json](/Users/ajhochhalter/Documents/Rhythm/.mega-wt/fix-hermes-ownership/docs/ai/contracts/issue-1541.json) — points AC4 to the new runtime contract and records the automated criteria as passing.
- [docs/ai/contracts/hermes-electron-contract.md](/Users/ajhochhalter/Documents/Rhythm/.mega-wt/fix-hermes-ownership/docs/ai/contracts/hermes-electron-contract.md) — documents attached-mode Hermes ownership and the explicit self-test exceptions.
- [REPORT.md](/Users/ajhochhalter/Documents/Rhythm/.mega-wt/fix-hermes-ownership/REPORT.md) — this handoff.

## Checks run

- Worktree/branch/write probe — pass: `/Users/ajhochhalter/Documents/Rhythm/.mega-wt/fix-hermes-ownership`, `mega/fix-hermes-ownership`, clean initial status, writable checkout.
- RED contract run — expected fail before implementation: 37 passed, 3 failed on attached startup/ownership and stdout logging.
- `cd apps/electron && npm run typecheck` — pass.
- Socket-free four-file check — pass, 60/60:

```bash
cd apps/electron && npm run typecheck && \
node --experimental-vm-modules --test \
  --test-skip-pattern='^(slice-5-c1:|slice-5-c[345]:|production repair: (alternate local ports|actual Electron))' \
  test/hermes-server.test.mjs \
  test/main-runtime.test.mjs \
  test/electron-shell.test.mjs \
  test/e12a-auth-boundary.test.mjs
```

- Contract JSON parse/status check — pass: `issue-1541-c3`, `c4`, and `c5` are `pass`; manual criteria remain explicitly listed in `not_tested`.
- `git diff --check` — pass.
- Branch/base evidence — `mega/fix-hermes-ownership` at uncommitted base `0e7b933174b230b64c9cf9bc30755030c04ea2dc`.
- The exact unfiltered command requested in the prompt was run once before edits and failed 58/64: `electron-shell.test.mjs` contains six launch-capable/missing-build cases, attempted the actual Electron binary, and `apps/web/dist` was absent. A first negative-lookahead filter was also ineffective. The final command above uses Node's explicit `--test-skip-pattern` and performs no Electron launch or socket bind.
- GitNexus impact/detect tools were unavailable: no GitNexus MCP server was configured and `.gitnexus/run.cjs` was absent. Local reference review limited the blast radius to Electron main lifecycle wiring and its tests.
- Dev Dashboard publication was not run because its external tracker path would violate this run's no-sockets constraint.

## Decisions

- Hermes is managed whenever the process is not in explicit `--smoke` or `--missing-dist` mode; this is independent of whether Electron owns or attaches to the agent API/OpenCode runtime.
- `--interactive-smoke` continues to leave Flutter-owned ports 4001/4096 untouched, but now owns Hermes on 9121 and waits for that owned child during quit/SIGINT/SIGTERM.
- Port probing, port-in-use failure, child ownership, restart behavior, and session-token minting were left in `hermes-server.mjs` unchanged.
- Lifecycle reasons are logged as one safe first line while full sanitized status remains available through the existing bridge.
- AJ's terminal command to exercise the Hermes tab against the already-running Flutter services is below. It was not executed in this run:

```bash
cd "/Users/ajhochhalter/Documents/Rhythm/.mega-wt/fix-hermes-ownership/apps/electron" && \
RHYTHM_SHELL_USER_DATA="/Users/ajhochhalter/Library/Application Support/Rhythm Electron Testing" \
RHYTHM_LIVE_API_URL="http://127.0.0.1:4001" \
RHYTHM_LIVE_ENGINE_URL="http://127.0.0.1:4096" \
RHYTHM_HERMES_ENABLED=1 \
RHYTHM_HERMES_PORT=9121 \
npx electron . --interactive-smoke
```

This assumes the Flutter-owned API and engine are already healthy and port 9121 is free. The terminal should show `hermes: starting` followed by `hermes: ready`, or `hermes: failed <reason>` without taking ownership of ports 4001/4096.

<oai-mem-citation>
<citation_entries>
MEMORY.md:39-47|note=[preserved non-owning Flutter service launch boundary and canonical ports]
rollout_summaries/2026-09-17T21-35-12-SWxV-electron_readiness_launch_and_ui_issue_tracking.md:35-41|note=[reused interactive profile and live endpoint launch context]
</citation_entries>
<rollout_ids>
01a0b14b-8a39-7e61-9011-e48f01a9477f
</rollout_ids>
</oai-mem-citation>
