# Plan — Mobile as a smart-server client (not a raw-engine proxy)

**Date:** 2026-08-11 · **Issues:** #1378 (fail-soft), #1379 (cold-start slowness) · **Status:** proposed
**Source:** parallel code-mapping workflow (`wf_4dbf1db9-a30`), three readers: mobile-now / desktop-target / constraints.

## The reframing

Today the phone is a **thin client of the raw OpenCode engine** (`:4096`): almost every read is a live proxy that blocks on engine liveness (30 s timeout → 504; scope pre-check failure → hard 502). The desktop is a **client of the api_server "smart server"** (`:4001`): it reads from a SQLite mirror and never blocks on the engine for reads. This plan makes the phone the second kind.

## Why this is far less work than it sounds — three existence proofs

The mapping found the hard parts are **already built**:

1. **The mirror already exists and is always current.** One consolidated `/global/event` ingest (`opencode_stream_bridge.ts:739` `ensureGlobalStream`, OCU-29 #1070) persists *every* session's transcript into `agent_session_messages` (parts/tokens/cost) and reconciles metadata into `agent_sessions` — for desktop-driven and background turns too, not just mobile-initiated ones. The data the phone needs is already on disk.
2. **A mirror-served mobile read already ships.** `listOwnerUnscopedMobileChats` (`mobile_chat_catalog.ts:33`) serves the cross-project chat list **entirely from SQLite**, returned behind the *engine-shaped* `experimental.session.list` operationId — so the phone SDK parses it unchanged, with **no fingerprint bump and no re-pair**. This is the exact pattern to replicate.
3. **The phone already consumes api_server-native DTOs.** `/mobile-gateway/projects`, `/profile-catalog`, `/agent-activity`, `PATCH /sessions/:id/state` (a mirror-only write, zero engine contact), and the whole `/tools/*` surface are already served from api_server's own stores.

So the migration is mostly **flipping read paths from live-proxy to the existing mirror**, plus **fanning the bridge's already-synced events to phones** — not building new infrastructure.

## The reads-vs-live boundary (the core split)

| Operation | Today | Target |
|---|---|---|
| Session list (project-scoped) | proxy → engine `session.list` | **mirror** (`agent_sessions`, reuse owner-unscoped/desktop `/agent-sessions`) |
| Archived list | proxy → engine | **mirror** (`archived_at` already mirrored) |
| Transcript (`session.messages`) | proxy → engine (20/page) | **mirror** (`agent_session_messages`, same 20/page shape) |
| Session children (list) | proxy → engine | **mirror** (`parent_session_id`) |
| Static catalogs (config/skills/agents/commands/tool-ids/project-list) | live per-connect fan-out | **cache** at api_server, refresh on reload |
| Reply/turn event stream | per-device SSE → engine `/global/event` | **api_server event bus** fed by the consolidated ingest |
| — send/dispatch (`prompt_async`), abort, permission.reply, question.reply, cancel | proxy → engine | **stay live** (actuation; already async at submit) |
| — pty, session.shell/command, file.*, vcs.*, find.*, session.diff, worktree.*, mcp/provider auth | proxy → engine | **stay live** (working-tree / live state) |

Rule of thumb: **reads-from-mirror + writes/streams-to-engine.** Anything that reflects the live working tree or unblocks the engine stays live.

## Phases (each ships independently)

### Phase 0 — Fail soft (the #1378 quick win) — *small, low-risk, could go in the current PR*
- The scope-validation pre-check turns a cold/timed-out engine into a **hard 502** (`mobile_opencode_proxy.ts:982` `OPENCODE_SCOPE_CHECK_FAILED`, and the synthesized-502 at `:979`). Reclassify engine timeout/unavailable during pre-check as a **retryable 504-transient**.
- Phone side: treat 504-transient as "busy, retry with backoff" instead of dead-ending; **add backoff** so it stops hammering a busy engine (the live log showed dozens of rapid-fire `upstream request timed out`).
- **Verify:** unit-test the pre-check classification; on-device, open a session while the Mac runs a heavy task → soft "loading, retrying" instead of an error wall.

### Phase 1 — Mirror-served reads (the biggest felt win, #1379a)
- Add mirror-backed handlers for **session list**, **archived list**, **transcript**, **children**, served **behind the existing engine-shaped operationIds** (like the owner-unscoped precedent) → **no fingerprint bump, no re-pair**.
- Reuse `listBySessionStructuredPage` (`agent_session_messages_repository.ts:472`) for the transcript with the current 20-item backward-cursor contract; reuse the owner-scoped join + redaction from `listOwnerUnscopedMobileChats`.
- **Backfill guard:** if a session id isn't in the mirror yet (created out-of-band), fall through to a one-shot live engine list to populate it; keep `reconcileCatalogSession` write-through alive.
- **Result:** opening and browsing sessions on the phone is instant and engine-independent.
- **Verify:** contract test that the mirror endpoint returns byte-compatible engine shape; on-device, browse sessions while the engine is saturated → instant.

### Phase 2 — Decouple the event stream (the other half of "instant", #1379b)
- Today each phone opens its **own** engine SSE via `MobileSseProxy` (`mobile_sse_proxy.ts:314`) → N phones = N engine streams, all blocking on engine liveness. And `broadcast()` (`ws_gateway.ts:165`) only fans to the loopback `/ws/agents` `clients` Set — **mobile receives none of the bridge's already-synced frames today**.
- Replace the per-device engine SSE with a **fan-out of the bridge's broadcast frames** (which are persisted to SQLite *before* broadcast) to mobile clients over the authenticated transport, keeping the per-owner/per-project/per-session filter + dedupe + 1 s device-revocation checks `MobileSseProxy` already implements. RN can't stream via XHR fetch, so keep the `expo/fetch` SSE consumer (#1287).
- **Reconnect replay:** on reconnect, replay missed frames from the mirror by `sdk_message_id`/cursor (not just tail new) so a backgrounded phone catches up.
- Combined with **optimistic outgoing-bubble rendering** on the phone (there's no synchronous echo — the user message is echoed by the engine as `message.updated(role=user)`), **sending feels instant**: your message appears immediately and the reply streams from the smart server's state.
- **Verify:** two phones + heavy engine load → both stream without opening engine streams; kill/restart engine mid-turn → stream survives via mirror; background the app, return → transcript caught up.

### Phase 3 — Deeper decoupling (optional, after 1–2 land)
- **Dispatch queue:** accept the turn at the api_server and return immediately to the phone, dispatching to the engine when it frees — so even the submit doesn't block on a saturated engine.
- **Mirror-first writes:** optimistic title/archive edits (reuse the `PATCH /sessions/:id/state` pattern), reconcile to the engine async.
- **Close the child-transcript gap:** the bridge persists child *rows* (`upsertChildSession`) but not child *message parts* — the last engine-coupled read on the chat path. Extend it to persist child parts so nested delegation serves from the mirror.
- **Mirror pending permissions/questions** to SQLite so a reconnecting phone rehydrates open approval cards locally instead of an engine poll.

### Phase 4 — Out of scope now: true offline
The mirror lives on the **Mac's** api_server, reached over Tailscale — these phases remove the *engine* dependency, not the *network* dependency. True offline reads need a **new on-phone store** (net-new work).

## Hard constraints (must-preserve invariants)

- **Never touch the three pinned protocol fields** — `gatewayVersion`, `opencodeVersion='1.14.49'`, `contractFingerprint` (`mobile_pairing_service.ts` ↔ `paired-host-store.ts`) are exact-equality gated; any drift flips every paired phone to `incompatible`. The fingerprint covers only the *engine* OpenAPI. → Serve mirror reads **behind existing engine-shaped operationIds** to stay outside it.
- **Feature negotiation is additive-only.** Advertise a new flag (e.g. `native-read`); never remove `opencode-http-proxy`. The phone's `REQUIRED_FEATURES ⊆ advertised` check tolerates additions, breaks on removals.
- **Keep `Device <token>` auth**, the opaque `X-Rhythm-Project-ID` → server-resolved root contract, and the root/cwd/directory field-stripping. Native reads stay device-token + project-scoped.
- **Re-apply ownership + redaction on every mirror-served read** — the engine is single-tenant; the gateway synthesizes per-`(userId, projectId)` ownership. Never emit a mirror row without the ownership join and host-path/secret scrubbing.
- **Normalize timestamps** (`toUtcIsoInstant`) or transcript ordering scrambles by the reader's offset.
- **Register under the `env.agentExecutionEnabled` role gate**, authed by Device token (not the `AGENT_LOCAL` loopback bypass — mobile arrives over Tailscale).

## Open decisions (need a call before Phase 1/2 land)

1. **Mirror authority vs live backfill:** when is `agent_sessions` authoritative vs. does a session created out-of-band still need a live engine list to appear? (Proposed: mirror-first + live backfill on cache-miss.)
2. **Native-DTO versioning:** engine-shaped reads are covered by the fingerprint; genuinely-new DTOs (`/projects` etc.) have no drift protection today. Do we add a separate mobile-native contract version to the handshake?
3. **What must stay live because it reflects the working tree at request time** — `file.*`, `session.diff`, `vcs.*`, `find.*` — needs an explicit "never mirror" policy so we don't serve stale trees.
4. **Optimistic send** on the phone (recommended) vs. accept one stream round-trip of latency before the outgoing bubble appears.

## Mapping to issues
- **#1378** ⇒ Phase 0.
- **#1379** ⇒ Phase 1 (reads) + Phase 2 (event decouple); Phase 3 is follow-on hardening.
- Proposed new sub-issues when we commit: `#1379a mirror-served mobile reads`, `#1379b mobile event bus + reconnect replay`, `#XXXX child-transcript mirror`, `#XXXX pending-approval mirror`.

## Out of scope
On-device offline cache (Phase 4); any change to the pinned engine contract; PTY/shell/file/vcs/find live paths.
