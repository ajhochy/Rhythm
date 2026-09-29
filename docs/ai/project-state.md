# Project state

**Focus:** Mobile app repair — live transcript streaming, engraph process lifecycle, session-list & chat-create UI finish.

**Branch / PR:** `mobile/transcript-delta-streaming` → draft **PR #1587**, based on `mega/2026-09-18-mobile-electron-hermes`. Single stacked PR by request; #1585 merged 2026-09-29 05:44 (`d2796905`).

## Landed on this branch

- **ST-1 streaming.** `apps/mobile/lib/opencode/transcript-events.ts` (pure reducer + non-resettable 75 ms maxWait batcher). `message.updated` / `message.part.updated` / `message.part.delta` route through it; full-page refetch removed from those paths; `session.idle` flushes and stays authoritative. Delta envelope is exactly `{sessionID, messageID, partID, field, delta}` — no top-level `id` (a prior attempt failed its gate by inventing one).
- **engraph lifecycle.** Engine now spawned `detached: true`; `stop()`/`bindAbort()` take opt-in `{group: true}`; stale-port sweep verifies `pgid === pid` before group-signalling (fail-closed). Mirrored into `apps/api_server/vendor/opencode-ai-sdk/`. Closes #1574.
- **NC-3 instant create sheet.** `openCreateSheet` no longer awaits the profile catalog; Create disabled until it resolves.
- **Phantom session fix.** Connect-bootstrap called `ensureActiveSession()` → `createSession()` on every connect, fabricating a blank "Untitled chat" per connect. Passive path now passes `allowCreate: false`.
- **Docs.** `docs/ai/spec-session-list-and-create-ui.md`, `docs/ai/runs/2026-09-29-engraph-lifecycle-proof.md`.

## Test status

`tsc --noEmit` clean · `eslint` 0 errors · `jest tests/chat` **119/119** · full mobile jest **263/267** · `api_server` contract **9/9** · Playwright `st1-concurrent-delta-streaming` passing (3 concurrent sessions, 0 mid-stream GETs, RED when deltas dropped).

## Risks / known issues

- **`issue-1387` 4 failures are base-red** — verified identical at `d2796905` with production files reverted. Offline-mirror hydration; out of scope.
- **Live engine :4096 cannot complete any generation** — `ContextOverflowError: 201231 > 200000` on every session including 3-word prompts, from auto-injected skills/vault/docs context. Pre-existing; blocks all live agent verification on that engine.
- **Live engine PID 27250 died during testing and did not respawn** — restart Rhythm. Likely the `AuthCredentialWatcher` bounce race from shared `~/.config/opencode/` writes (cf. 2026-08-15).
- **`ScopedCache` unbounded per-directory MCP clients** in the opencode fork — the mechanism behind "N engraph per engine". Not fixed; bounded impact.
- Mobile gateway pairing needs a Keychain-held P-256 capability, so no unattended live-UI run is possible by design.
- #1586 (silent session stalls, no heartbeat/sweeper) still open.

## Next step

AJ smoke-tests PR #1587 on device/simulator, then merges. Restart Rhythm first to restore the :4096 engine.
