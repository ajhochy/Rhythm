# Project state

## Current focus

Relay reliability: the Mac→relay uplink had no heartbeat, so a half-open tunnel
read as perfectly healthy while the phone showed a generic network error.
Fixed on its own branch, stacked for review against the mega consolidation.

## Active branch / PR

- `fix/relay-uplink-heartbeat` → draft PR #1601 against
  `mega/2026-09-29-consolidation`. Uplink ping/pong + idle timeout, honest
  `macOnline`/`lastUplinkAt`, RPC timeout, explanatory offline bodies, engine
  health auto-recovery, `/mobile-gateway` + `/relay` access logging.
  Run log: `docs/ai/runs/2026-09-30-relay-uplink-heartbeat.md`.
- `mega/2026-09-29-consolidation` → draft PR #1598 against `main` (tracking
  issue #1599; Server CI smoke flake #1600). Supersedes #1594. It carries the
  local decision engine, router curation, the System One (Kev / Jev) routing
  backend (#1596), the Electron fixes and the Rhythm MCP bundle and sign-in
  install (#1597), mobile streaming, and Org Reviewer paging. Deleted branch
  tips are reachable from the local tag
  `archive/branch-consolidation-2026-09-29`
  (`docs/ai/runs/2026-09-29-branch-consolidation.md`).

## In progress

- Manual smoke of #1601 on a real phone: kill the Mac's network mid-session and
  confirm the phone names the uplink as the fault with a last-contact time,
  then recovers on its own without restarting the desktop app.
- CI + manual smoke on #1598 per its checklist, including the System One backend
  (Kev: `uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b --port 8009`;
  recommended rollout `first_prompt` scope, Shadow for a week, then On —
  `docs/ai/decision-engine-setup.md`) and the packaged Electron rhythm MCP after
  sign-in.

## Risks / known issues

- `macOnline` can now report false while a socket is still open, and an RPC
  timeout marks the Mac offline — an overloaded-but-alive Mac can produce a
  brief offline window. Deliberate; see
  `docs/ai/decisions/2026-09-30-uplink-liveness-is-derived-not-asserted.md`.
- #1586 (sessions stuck `status=working`) is still open and is NOT covered by
  #1601 — it is session/provider-stream, not WS transport.
- The original 2026-09-30 ~03:45 symptom has no established cause; it predates
  the gateway request logging #1601 adds.
- **Kev cold latency**: 2.8–4.2 s for the first calls after other heavy work;
  under the 1000 ms default those prompts time out and keep the baseline route
  (logged as `timeout`).
- Electron `issue-1402` packaging test needs
  `RHYTHM_HERMES_DESKTOP_ARTIFACT_DIR`; only the release workflow supplies it,
  so MCP bundling is not covered by PR CI.
- Local env: `native_runtime_guard` fails under Node 24.21 + better-sqlite3
  12.8. (`apps/mobile/node_modules` was reinstalled 2026-09-30 and the full
  mobile jest suite now passes locally.)
- Carried: `issue-1387` mobile tests base-red (offline-mirror hydration).
- `pty_proxy.test.ts` and `issue_1574_engraph_ownership.test.ts` flaked once
  under full-suite load (150 ms sleeps / worktree spawn); both pass in isolation
  and in two subsequent full runs. Timing-sensitive, not a regression.

## Test status

`fix/relay-uplink-heartbeat` @ `111491fd`: api_server + mobile `tsc` clean;
api_server `vitest run` 750 files / 7090 passed; mobile `jest` 55 suites /
308 passed; `npm run build` exit 0. Every new test mutation-verified (7
mutations, each one failing its tests). Live probes against the built `dist/`
confirmed the explanatory 503 body, the engine `recovering` flag, and the new
`[MobileGateway]` / `[Relay]` access-log lines.

Consolidated head `7b0cba74` (#1598): api_server + web tsc clean; api_server
decision/router/MCP vitest 239 passed; mobile router settings jest 32/32;
`ai-workflow checks --level pr` green except the local-env failures above.

## Next step

AJ smoke-tests PR #1601 (phone-side uplink failure UX), then #1598. Merge both
manually. The `relay-uplink-heartbeat` worktree can be removed once #1601 lands.
