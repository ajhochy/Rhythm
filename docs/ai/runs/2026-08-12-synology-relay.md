---
date: 2026-08-12
repo: Rhythm
branch: mobile/synology-relay
pr: pending (draft opens at end of this run)
issues: []
status: built — all phases landed, awaiting AJ device smoke
tags: [run, Rhythm]
---

# Synology relay for mobile — full build (Phases 0–3)

One session took the relay from architecture decision to a complete,
contract-tested implementation on a single integration branch. Delivery
model per AJ: Claude wrote acceptance contracts + tests, Codex implemented in
in-repo worktrees, Claude gated/committed/squash-merged, worktrees removed
after each merge.

## Architecture (docs/ai/plan-synology-relay.md)

Phone → `https://api.vcrcapps.com/relay` (single endpoint, Device tokens).
Mac dials ONE outbound WebSocket to the relay (LAN candidate first) carrying:
events up (verbatim engine envelopes, lossy), seq-outbox mirror rows up
(durable, replayed), artifacts up (immutable blobs), rpc down (tunneled phone
requests), ctrl (hello/health/resync/acks). Relay = same api_server image,
`RHYTHM_ROLE=relay`, own SQLite in /data.

## Files (landed, by track)

- Phase 0: env role + `/relay` skeleton + `docker-compose.synology.yml`
  rhythm-relay service + `.env.relay.example` + runbook section.
- Foundations: `relay_uplink_protocol.ts`, OpencodeEventHub class export.
- T1 `relay_uplink_client.ts`; T2 `relay_uplink_server.ts` +
  `relay_gateway_routes.ts` + MobileSseProxy `hub` DI; T3 phone
  `safeRelayUrl`/`effectiveGatewayBase`/`directBaseUrl` + Mac
  `relayPublicUrl` advertisement; wiring commit (server.ts start, pairing
  snapshot hook, bridge health push).
- T4 `relay_outbox_repository.ts` + migrations (relay_outbox,
  relay_sync_state) + repo hooks + resync replay/flushOutbox/acks + applier
  (FK-off replica semantics) + onResynced SSE kick.
- T5 relay-served mirror reads (mobile_mirror_reads reuse, tunnel-or-503
  fall-through). T6 phone `presence.ts` + MacOfflineError +
  'desktop-offline' status. T7 pushArtifact + relay artifact store/serve
  (tunnel-and-cache) + lastUplinkAt.

## Checks

- Contract suites (all green at final gate): T1 8, T2 18 (incl. relay_role
  additions), T4 10, T5 6, T7 9 (six-file battery 51/51); mobile jest 17/17
  + paired-host 23 scenarios; both tsc clean.
- Full api_server suite: green after Phase 1 (535 files); Phase-2 run caught
  2 real integration defects (fixed, see Notes); final full-suite run at end
  of session (see project-state for the tally).

## Notes — defects the process caught

1. Pre-existing: #1384's mirror-reads suite assumed no engine on :4096 —
   false on any dev Mac running the desktop app. Pinned to a dead port.
2. FK-replica (real, caught by T4 contract): replicated agent_sessions rows
   reference users/projects that deliberately don't exist on the relay;
   applier now runs its connection with foreign_keys=OFF (integrity is the
   single writer's job).
3. Partial-env mocks (real, caught by full suite): replicationEnabled() ran
   inside every mirror-write transaction and assumed full env shape; now
   optional-chained.
4. Source-contract pin (#1282/#1286): T6's hoist of
   `profileId: preferences.profileId` kept behavior but broke the pinned
   literal; restored.

## Orchestrator incidents (for future runs)

- Worktree node_modules symlinks got committed (gitignore's `node_modules/`
  does not match symlinks) and the squash checkout replaced the main
  checkout's real node_modules with self-loops (git treats ignored paths as
  expendable). Recovered via reinstall; `.git/info/exclude` now carries a
  bare `node_modules` entry. apps/mobile is NOT a root workspace — it needs
  its own `npm ci`.
- `git checkout <file>` inside a worktree destroyed uncommitted Codex work
  once (reconstructed). Rule: commit Codex output before any revert.
- The root lockfile was desynced by #1298 (`marked`); synced on this branch.

## Awaiting AJ (manual smoke, physical device)

See the draft PR checklist: NAS compose up + Cloudflare `/relay*` path rule +
Mac env (RHYTHM_RELAY_URLS/BEARER/PUBLIC_URL), then LTE-no-Tailscale smoke:
health/pairing via relay, browse with Mac asleep, live stream latency (<2s,
the #1287 SSE-buffering class), writes + approvals, offline banner, artifact
offline view, PTY fallback to direct.
