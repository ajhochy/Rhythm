---
date: 2026-09-18
repo: Rhythm
branch: mega/ws-hermes-integration
pr: null
issues: [1542]
status: pass
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Hermes dashboard supervisor and view integration

No commit or PR was created.

## Files changed

- `apps/electron/src/hermes-server.mjs` now starts `hermes dashboard` on fixed
  loopback port 9121 by default, uses the installed `hermes_cli/web_dist` asset
  predicate, polls `/api/health`, and owns a fresh main-only session token for
  each child generation with diagnostic redaction.
- `apps/electron/src/hermes-view.mjs` requires the ready supervisor origin and
  its current token generation, loads only the clean `status.url`, and destroys
  the view when either changes. `main.mjs` binds the created supervisor.
- The packaging manifest stages the supervisor and five B3 native support files;
  package scripts now include the Hermes protocol/view suites.
- Preload syntax and E44 fixture ordering were repaired. Security receipts and
  source/package allowlists now cover both `hermes` and `hermesView` exactly.
- `docs/ai/contracts/hermes-electron-contract.md` is one combined supervisor,
  authentication, view, intent, packaging, and verification contract.
- Acceptance contract: `docs/ai/contracts/issue-1542.json` (12 criteria passed).

## Checks run

- Launch preflight: exact worktree, exact `mega/ws-hermes-integration` branch,
  and apply/remove write probe all passed.
- Contract-first suite was red before implementation, exposing the old `serve`
  command/readiness path, missing token integration, packaging/test/security
  gaps, and the merged preload delimiter defect.
- `cd apps/electron && npm run typecheck && node --experimental-vm-modules --test test/hermes-server.test.mjs test/e12a-auth-boundary.test.mjs`:
  exit 0, 49 passed.
- `cd apps/electron && npm run typecheck && node --experimental-vm-modules --test --test-concurrency=1 test/hermes-server.test.mjs test/hermes-view.test.mjs test/hermes-protocol.test.mjs test/security-smoke-receipt.test.mjs`:
  exit 0, 73 passed.
- Non-launching `electron-shell.test.mjs` cases matching
  `interactive-runtime|directory-picker|slice-5-c1|slice-5-c2`: exit 0,
  10 passed. The web fixture was built once after its initially absent dist was
  detected; no Electron process or socket was started.
- `cd apps/web && npm run typecheck`: exit 0. `git diff --check`: exit 0.
- GitNexus upstream impact probes reported LOW for the indexed existing symbols
  and UNKNOWN for new/unindexed Hermes symbols, with no HIGH/CRITICAL warning.
  Index refresh failed in the native analysis worker; compare-scope detection
  could not target this unregistered worktree and is not claimed.

## Notes

- The session token is never included in `Status`, renderer IPC/preload, URLs,
  or diagnostics. The dashboard child receives it only through
  `HERMES_DASHBOARD_SESSION_TOKEN`; Hermes's own served HTML injects it for the
  browser bootstrap.
- Existing absent/failed/install/stop semantics, consent, fixed port, owned-child
  SIGTERM/SIGKILL behavior, and the prohibition on global `--stop` were retained.
- Real Electron-launch cases in `electron-shell.test.mjs`, the packaged security
  smoke in `electron-unsigned-package.test.mjs`, real Hermes dashboard startup,
  and all socket-based checks were skipped because the worker brief explicitly
  prohibited Electron launches and socket binding. They remain release gates.
