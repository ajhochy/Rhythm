# Rhythm — Project State

**Focus:** Synology relay for mobile (`docs/ai/plan-synology-relay.md`) — the NAS becomes the
phone's single always-on endpoint; the Mac dials one outbound uplink carrying events, replicated
mirror rows, and tunneled commands. Supersedes the standalone smart-client plan's remote-access
phase; builds on merged #1384 + #1386.

**Branch:** `mobile/synology-relay` (integration branch; #1384 + #1386 merged in, conflict
resolved in `mobile_sse_proxy.ts`). **Do NOT merge to main — AJ merges after device smoke.**
No PR yet; one draft PR opens when all phases land.

## Delivery model (AJ's standing instruction)

Claude writes acceptance contracts (`docs/ai/contracts/relay-t*.md`) + contract tests; Codex
implements in in-repo worktrees (`.worktrees/*`); Claude gates (tsc + contract suites), commits,
squash-merges each track into the integration branch, then removes the worktree + branch.

## Landed on the branch (all gated green)

1. #1384 + #1386 merge, plus a hermeticity fix (mirror-reads suite pinned to a dead engine port —
   it failed on any dev Mac running the desktop app).
2. Phase 0: `RHYTHM_ROLE=relay` (agentExecutionEnabled=false), `/relay` surface skeleton,
   `rhythm-relay` compose service (own SQLite volume, host 4010 LAN fast path), Cloudflare path
   rule `/relay*` documented in the runbook, `.env.relay.example`.
3. Shared foundations: `relay_uplink_protocol.ts` (frame contract §2 of the plan),
   `OpencodeEventHub` class export.
4. Track 1 — `relay_uplink_client.ts` (Mac side): ordered candidate dialing (LAN first), bearer
   auth, hello + devices snapshot, verbatim envelope forwarding, rpc dispatch against 4002,
   reconnect/backoff. 8/8 contract tests.
5. Track 2 — `relay_uplink_server.ts` + relay routes: WS upgrade auth via cloud bearer,
   hello→resync handshake, health passthrough (verbatim + macOnline), replace-all device-verifier
   snapshots, relay-local hub, scoped SSE via MobileSseProxy hub mode (engine fallback
   impossible), rpc tunnel catch-all (query-preserving, /pair bootstrap exempt), PTY 501,
   supersession, malformed-frame tolerance. 18/18 contract tests. MobileSseProxy gained an
   injectable `hub` option (Mac singleton default; Mac-path SSE suites re-verified).
6. Track 3 — phone relay transport: `safeRelayUrl` (exact-match relay base), pairing payload +
   health adoption of `relayUrl`, relay-first base selection, path-prefix-safe client URLs, PTY
   pinned to direct `.ts.net`; Mac advertises `RHYTHM_RELAY_PUBLIC_URL` in pair/health. jest 7/7 +
   api_server 3/3 + paired-host 23 scenarios.
7. Orchestrator wiring: server.ts starts the uplink client behind
   `RHYTHM_RELAY_URLS`+`RHYTHM_RELAY_BEARER`; pairing mutations push device snapshots; bridge
   pushes fresh health on engine-stream resubscribe; shutdown stops the client.
8. Root lockfile sync fix (`npm ci` was broken by #1298's `marked` dep).

**Full api_server suite after Phase 1: 535 files passed / 103 skipped, exit 0.**

## In flight (Codex, worktrees)

- Track 4 `.worktrees/relay-repl` — outbox + row replication (S2.1–S2.3): relay_outbox +
  relay_sync_state tables, repo hooks (applyPartDelta deliberately excluded), resync replay,
  flushOutbox ordering (persist → flush → publish), idempotent whitelist applier, acks/prune,
  onResynced → phone-SSE force-close.
- Track 5 `.worktrees/relay-mirror-reads` — relay serves the three #1384 mirror reads from its
  replica; null → tunnel when Mac online, else 503 `mac_offline_and_mirror_incomplete`.
- Track 6 `.worktrees/phone-offline` — MacOfflineError, presence derivation,
  `desktop-offline` connection status; reads never gated.

## Next

- Gate + squash-merge Tracks 4–6 (expect a small deliberate overlap in `relay_gateway_routes.ts`
  between T4's SSE force-close and T5's mirror routes — resolve at merge).
- Phase 3 contract + Codex track: artifact push-on-produce (`file/artifact` frames, ≤8 MB), relay
  store/serve with cache-on-fetch, `lastUplinkAt` presence polish.
- Final gate: full api_server suite + mobile checks, push branch, open ONE draft PR, leave open
  for AJ's physical-device smoke (LTE, no Tailscale: browse with Mac asleep, live stream, writes,
  offline banner, artifact view).

## Risks / known gaps

- Relay smoke on real infra still pending: Cloudflare path rule + SSE-buffering check
  (issue-#1287 class) are documented in the runbook but unverified against the real tunnel.
- PTY over relay intentionally 501s (falls back to direct `.ts.net`); deferred write queue
  intentionally out of scope.
- `git checkout`-style reverts inside Codex worktrees destroy uncommitted Codex work (bitten once,
  reconstructed); commit Codex output before any revert.
- Worktree node_modules symlinks must never be committed (`.git/info/exclude` now covers;
  gitignore's `node_modules/` pattern does not match symlinks).

## Test status

- Integration branch (post-Phase-1): full api_server suite green (535/103 skipped). Mobile:
  targeted jest + node-test suites green; full mobile suite deferred to final gate.
