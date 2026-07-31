---
date: 2026-07-30
repo: Rhythm
branch: codex/t1-parity-gate
pr: pending
issues: [1273, 1274]
status: in-progress
tags: [run, Rhythm]
---

# T1 mobile↔desktop parity gate — build + first live run

## Files

- `tools/dev/parity-gate.sh` — new. One-command gate: sandbox up → fake cloud
  up → real pairing handshake (capability header + bearer) → device token →
  MSP-006 live parity test → evidence + summary.json.
- `tools/dev/parity/fake-cloud.mjs` — new. Local `/auth/me` stand-in; maps a
  one-run bearer to a real local user identity; counts hits.
- `tools/dev/sandbox.sh` — security fix (#1273): gateway gets its own port
  (default 4099, was silently binding the Tailscale-published 4002),
  validated + collision-refused; startup log preserved past teardown; engine
  dir overridable (`RHYTHM_SANDBOX_ENGINE_DIR`) to reuse a built fork.
- `apps/api_server/src/controllers/agentResearchController.ts` — fix (#1274):
  owner-visibility semantics for list + requireOwnedJob (unowned legacy rows
  are shared; exact-match hid all 20 legacy jobs from authenticated clients).
- `apps/api_server/src/__tests__/agent_research_owner_visibility.test.ts` —
  new contract test locking the rule in.
- `apps/mobile/tests/msp-006-live-parity.test.mjs` — soft-assert all parity
  routes; report every drifted feed, not just the first.
- `docs/ai/decisions/2026-07-30-mobile-desktop-parity-testing.md` — T0–T3
  tiered strategy decision.

## Checks

- New + existing research suites: 7/7 pass.
- Gate run 1: failed on missing engine build → `RHYTHM_SANDBOX_ENGINE_DIR`.
- Gate run 2: end-to-end, verdict FAIL — real finding (#1274): mobile showed
  0/20 research jobs vs desktop. Confirmed against live DB (read-only): all
  20 rows have `requested_by_user_id` NULL.
- Gate run 3: research parity now passes; new finding — desktop-side
  `/provider` 404s: providers/config truth is engine-served (`directory`
  param stamped by the gateway proxy), so the test compared the wrong
  address. Test updated: engine routes hit
  `RHYTHM_LIVE_DESKTOP_ENGINE_URL` with the same directory scope.
- Gate run 4: test process SIGKILLed at ~110s — a feed hung and the test
  had no fetch timeouts. Test updated: 45s AbortSignal per fetch (hang →
  reported drift for that route) + per-route ok/DRIFT progress markers.
- Gate run 5: first full sweep — 6/14 pass; SIGKILL on engine payloads
  (assert diff rendering on 4MB structures) → memory-safe comparison.
- Gate runs 6–7 (final): **11/14 pass.** Fixed along the way: research,
  schedules, cookbook owner-visibility (#1274 class — repos now use
  `owner IS NULL OR owner = ?`), run-quality `generatedAt` volatility,
  gateway-redaction alignment for /provider + /config. Residuals (filed as a
  follow-up): /agent-webhooks (self-referential URL renders each listener's
  own port — normalization TODO), /opencode/mcp (phone reads the engine,
  desktop reads the API router — two sources, needs a decision),
  /provider/auth (redaction alignment misses unkeyed array items).

## Notes

- Gate runs against `codex/msp-006-project-scoped-tools` base — the
  integration branch (#1268) does not include the MSP-006 gateway tool
  routes, so it cannot host this gate yet.
- Desktop side of the comparison is tokenless (AGENT_LOCAL bypass), matching
  today's shipped desktop. Once PR #1272 (cloud-bearer auth) merges, add
  `RHYTHM_LIVE_DESKTOP_AUTHORIZATION="Bearer <same fake-cloud bearer>"` so
  both sides are authenticated as the same user — the truer future contract.
- GitNexus MCP is version-locked (index v42 vs server v41) until app restart;
  impact analysis for the controller edit was done manually (two mounts).
