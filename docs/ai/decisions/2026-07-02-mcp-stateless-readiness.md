---
date: 2026-07-02
repo: Rhythm
branch: issue-864-mcp-audit
tags: [decision, Rhythm, mcp, audit]
issues: [864]
---

# MCP stateless-readiness audit (server + fork client)

## Context

The MCP spec is evolving toward stricter statelessness, explicit session
handles, formalized tool-list caching semantics (`listChanged` +
cache-invalidation rules), and an experimental **Tasks** extension for
long-running tool calls. None of this is on fire today — both of Rhythm's
MCP surfaces run over `stdio`, which is inherently single-process,
single-session, and not exposed to the multi-client/session-resumption
scenarios the new spec provisions are aimed at. Issue #864 asks for a
proactive audit rather than a reactive fix: enumerate the assumptions baked
into each surface, document them, and add a cheap guard so a future
regression (e.g. two tool groups silently colliding on a name, or a
capability claim silently drifting) is caught before it becomes a spec
compliance problem.

Two MCP surfaces exist in this repo:

1. **`apps/mcp_server`** — Rhythm's own MCP **server**, published as
   `@ajhochy/rhythm-mcp-server` (v0.6.1) and run by Claude Desktop / Claude
   Code as a stdio child process. SDK: `@modelcontextprotocol/sdk@1.29.0`.
2. **`apps/opencode_fork/packages/opencode`** — a vendored git subtree
   (sst/opencode v1.14.49, per `AGENTS.md`) whose engine acts as an MCP
   **client**, connecting outbound to Rhythm's server and ~20 other
   third-party MCP servers. SDK: `@modelcontextprotocol/sdk@1.27.1` (older
   than the server's — see Risk 6). Per the vendoring constraint, this
   audit does **not** modify the fork or add it to any build pipeline.

## Decision

Document the current-state assumptions of both surfaces, and land one
cheap regression guard (`apps/mcp_server/src/__tests__/mcp_capabilities_and_tool_registration.test.ts`)
that pins the two claims most load-bearing for future spec compliance:
tool registration is collision-free and order-independent, and the
`tools.listChanged` capability we advertise matches what we actually do
(nothing — the tool set is static).

### Surface 1 — `apps/mcp_server` (our MCP server)

**Transport.** `StdioServerTransport` only (`apps/mcp_server/src/index.ts:75`).
No HTTP/SSE/StreamableHTTP transport is implemented or planned; the server
is always spawned as a child process by the calling client (Claude
Desktop/Code, or the opencode fork via `connectLocal`).

**Statefulness / session-identity assumptions.**
- **One process = one identity.** `RHYTHM_API_TOKEN` is read once from
  `process.env` at module load (`src/index.ts:25`) and closed over by every
  `register*Tools(server, apiUrl, apiToken)` call. There is no per-request
  or per-MCP-session auth negotiation, no token refresh, and no notion of
  "session" at the MCP protocol level beyond the single stdio connection's
  lifetime. If the new spec's explicit session-handle model expects a
  server to multiplex multiple logical sessions over one transport (or to
  re-authenticate per session), this server cannot — it is 1:1 with its
  spawning process.
- **No dynamic reconfiguration.** All 18 tool-registration functions run
  once, synchronously, at startup (`src/index.ts:42-72`). Tools are never
  added, removed, or re-scoped after `server.connect()`. This is by design
  (the server has no concept of "sessions" to scope by) but means any
  future per-caller tool scoping (mirroring the fork's own mcp-scope work)
  would need new server-side plumbing.
- **Routing split, not session split.** The dual-endpoint architecture
  (`RHYTHM_API_URL` vs `RHYTHM_AGENT_URL`) is a deployment-target concern
  (production Postgres vs local agent SQLite), not a session concept — it
  does not vary per MCP client/session.

**Tool-list caching posture.** No `cacheScope`, TTL, or invalidation logic
exists anywhere in `apps/mcp_server` (confirmed by grep — zero hits). The
`@modelcontextprotocol/sdk` `McpServer` class auto-advertises
`tools: { listChanged: true }` as soon as any `.tool()` call is made
(`node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js:66-68`).
**This is an unintentional capability claim**: Rhythm's server never calls
`server.server.notification({ method: "notifications/tools/list_changed" })`
anywhere in the codebase, because the tool set truly is fixed for the
process lifetime — but the SDK claims support for a notification the
server will never send. A client that took the capability literally and
waited for a listChanged event before refreshing its cache would never see
one (harmless here, since the list never changes — but worth stating
explicitly, see Risk 1).

**Tasks-extension readiness.** The installed SDK (1.29.0) ships the
experimental `server.experimental.tasks.registerToolTask(...)` API
(`node_modules/@modelcontextprotocol/sdk/dist/cjs/experimental/tasks/mcp-server.js`),
but **no Rhythm tool uses it**. All 62 registered tools are synchronous
request/response handlers via the plain `server.tool()` API. Several tools
proxy to genuinely long-running work (`rhythm_start_research`,
`rhythm_run_org_optimizer`, `rhythm_trigger_now`) but model this as
fire-and-forget-plus-poll (a job id the caller re-queries), not as a
protocol-level Task. This is a reasonable stopgap but is exactly the
pattern the Tasks extension formalizes — see Risk 4 for the recommended
migration path.

### Surface 2 — opencode fork MCP client (`apps/opencode_fork/packages/opencode/src/mcp/index.ts`)

**Transports.** All three: `StdioClientTransport`, `StreamableHTTPClientTransport`,
`SSEClientTransport` (imported at the top of `mcp/index.ts`). Remote
servers try StreamableHTTP first, then fall back to SSE
(`connectRemote`, lines 332-347); local servers always use stdio
(`connectLocal`).

**Statefulness / session-identity assumptions.**
- **One shared `Client` per configured MCP server name, for the whole
  opencode instance** — not per opencode session/conversation. State lives
  in `InstanceState` (`s.clients`, `s.status`, `s.defs`, `mcp/index.ts:232-236`)
  and is shared across every conversation/session running in that
  instance. This matches the earlier investigation finding recorded in
  `docs/ai/decisions/2026-06-25-per-session-mcp-scoping-investigation.md`:
  MCP servers connect at the **project-instance (directory) level**, and
  per-session/per-profile scoping (Rhythm's `mcp-scope` patch) is a
  **client-side filter over one shared cache**, not a separate connection
  or a separate tool-list fetch per session.
- **No automatic reconnect on transport drop.** `connect`/`disconnect`/`add`
  are explicit operations (`mcp/index.ts:643-657`); a crashed stdio child
  or dropped HTTP/SSE stream leaves the server `status: "failed"` until
  something explicitly calls `connect` again. There is no health-check
  loop or retry-with-backoff.
- **OAuth flows assume the remote server issues stable, resumable state**
  (`pendingOAuthTransports` map keyed by server name, `mcp/index.ts:100`) —
  a second concurrent OAuth attempt for the same server name will
  clobber the first's pending transport.

**Tool-list caching posture.** Explicit and correct for today's spec:
`defs()` fetches `tools/list` once at connect time and the result is
cached in `s.defs[clientName]` (`mcp/index.ts:466,472`). The client
registers a real `ToolListChangedNotificationSchema` handler per connected
client (`watch()`, lines 501-513) and re-fetches `defs()` only when the
server actually sends `notifications/tools/list_changed` — this is the
**correct**, spec-compliant reactive-cache pattern (a strict improvement
over "cache forever" or "never cache"). No TTL exists — invalidation is
notification-driven only, so a server that mutates its tool list without
sending the notification would go stale silently (see Risk 2).

**Rhythm's carried patch (`mcp-scope`, PR chain in `git log --grep mcp-scope`).**
Two pure, dependency-free helper modules apply a per-session view over the
one shared cache above, re-derived on every resolve call (not cached
themselves):
- `src/session/mcp_allowlist.ts` — `filterMcpToolsByAllowlist(toolKeys,
  keyToServer, mcpAllowlist)` filters the composed tool-key list by a
  session's `{servers, tools}` allowlist.
- `src/mcp/index.ts:696-709` (`toolClientNames()`) — builds the
  `composedKey → clientName` map the filter needs, explicitly **not**
  splitting on `"_"` (so hyphenated server names like `gmail-work` survive
  — a real bug class the comment calls out).
- `src/session/mcp_deferred_tools.ts` (issue #843) — a **names+description-only
  catalog plus one dispatcher tool** (`mcp_dispatch`), deferring full JSON
  Schema resolution until the model actually calls a tool by name. This
  predates and is philosophically aligned with Tasks-style
  lazy/two-phase tool resolution (cheap list, expensive resolve-on-call).

**Tasks-extension readiness.** Zero references to `experimental`, `tasks`,
`taskSupport`, or any task-augmented `callTool` anywhere in the fork's
source. The fork's vendored SDK (1.27.1) predates the version where the
Tasks module was added to `apps/mcp_server`'s SDK (1.29.0) — the fork
cannot consume a Tasks-based tool from Rhythm's server today even if
Rhythm's server offered one (see Risk 4/6).

**Vendoring constraint (respected by this audit).** Per `AGENTS.md`, the
fork is a git subtree of upstream sst/opencode; it is edited only for
`mcp-scope-*` work, synced via `git subtree pull`, and must never be added
to `apps/api_server/tsconfig.json` or any build pipeline. This audit is
read-only with respect to the fork — no fork files were modified.

## Enumerated breaking risks (new/evolving MCP spec) + recommended fixes

1. **Unearned `tools.listChanged: true` claim on our server.** The SDK
   auto-advertises this capability the moment any tool is registered; we
   never emit the notification because our tool set is static. Low risk
   today (no client currently depends on receiving it), but if the spec
   tightens rules around capability truthfulness (e.g. clients that treat
   an advertised-but-never-fired capability as a protocol violation, or
   spec guidance requiring servers to either emit the notification or omit
   the capability), this becomes a compliance gap.
   **Fix:** if/when the SDK exposes a way to opt out of auto-advertising
   `listChanged` for genuinely static tool sets, take it; until then, this
   doc constitutes the explicit record that the claim is inert by design.
   Re-audit when the SDK is bumped past 1.29.0.

2. **Fork's tool-list cache has no TTL, only notification-driven
   invalidation.** If a third-party MCP server mutates its tool list
   without correctly sending `notifications/tools/list_changed` (common
   with less-mature servers), the fork's cached `s.defs[clientName]` goes
   stale for the life of the instance, and every session sees outdated
   tools until an explicit disconnect/reconnect.
   **Fix:** add a soft TTL-based revalidation (e.g. re-fetch `defs()` if
   the cache is older than N minutes AND the client is about to be used),
   independent of the notification, as defense-in-depth. This is a
   fork-side change gated by the `mcp-scope-*` work convention — not
   something this audit implements, since it touches the vendored
   subtree's core connect/cache path rather than the carried patches.

3. **Single-process identity on our server has no session-handle
   concept.** `RHYTHM_API_TOKEN` is fixed for the process lifetime with no
   re-auth path. If the new spec's explicit-handle model expects a server
   to support multiple concurrent logical sessions (each potentially with
   different auth) over one transport, our server's "one process, one
   identity, one token" model would need a real redesign (per-session
   token negotiation via an `initialize`-time parameter, not an env var).
   **Fix:** no action needed while the server is spawned 1:1 per client
   (the common case for stdio MCP servers). If Rhythm ever runs the MCP
   server as a shared long-lived process serving multiple clients, revisit
   this before that ships — track as a follow-up issue at that time, not
   preemptively.

4. **No Tasks-extension usage on either surface, despite two candidate
   long-running flows.** `rhythm_start_research` and
   `rhythm_run_org_optimizer` are long-running server-side jobs modeled as
   "kick off + separately poll by id" rather than a protocol-level Task.
   This works today but means the calling agent must know to poll — there
   is no standard "task submitted, check back" signal a generic MCP client
   could render. Additionally the fork could not consume a Task-based tool
   even if we built one (SDK 1.27.1 predates the Tasks module).
   **Fix:** treat this as a candidate migration once (a) the fork's
   vendored SDK is bumped to a version with Tasks client support, and (b)
   the Tasks extension exits "experimental" upstream. Do not migrate now —
   premature given both blockers. File a follow-up issue when the SDK
   bump happens.

5. **No automatic reconnect on the fork's MCP client side.** A crashed
   stdio child (including our own `rhythm-mcp-server`) or dropped
   HTTP/SSE stream leaves that server in `status: "failed"` with no retry
   loop; only an explicit `connect` call recovers it. Under a
   stricter-statelessness spec that expects clients to gracefully recover
   dropped sessions transparently, this is a gap.
   **Fix:** fork-side; out of scope for a carried patch (touches core
   connection-management, not the mcp-scope allowlist/deferred-tools
   patches this repo maintains). Note it for the next upstream sync
   review — check whether upstream sst/opencode has added retry-with-backoff
   since v1.14.49.

6. **SDK version skew between the two surfaces (1.29.0 server vs 1.27.1
   fork client).** Any future spec-driven wire-protocol change lands in
   the SDK first; a version-skewed pair risks one side assuming behavior
   (e.g. a new capability negotiation field, a Tasks schema) the other
   side's SDK doesn't understand yet.
   **Fix:** when bumping either SDK, bump both in the same change and run
   this repo's cross-surface tests (`apps/mcp_server` vitest suite +
   opencode fork's `mcp_allowlist.test.ts` / `mcp_deferred_tools.test.ts`)
   together. Track SDK versions in this doc's "Context" section going
   forward so drift is visible at a glance.

7. **Tool-name collisions across `apps/mcp_server`'s 18 registration
   functions would fail silently.** The SDK's tool registry is a
   `Record<string, RegisteredTool>` keyed by name — a second
   `server.tool('rhythm_x', ...)` call silently overwrites the first, with
   no error and no log line. With 62 tools spread across 18 files, this is
   a plausible copy-paste mistake, not a paranoid hypothetical.
   **Fix implemented in this issue** — see below.

## Alternatives considered

- **Do nothing until the spec ships.** Rejected per the issue's own
  framing: proactive hardening is cheap now (a doc + one test) and
  expensive later (spec ships, multiple surfaces need simultaneous
  changes under time pressure).
- **Implement TTL-based cache invalidation on the fork now.** Rejected for
  this issue: it touches the fork's core `mcp/index.ts` connect/cache path
  rather than a `mcp-scope-*` carried patch, and the issue explicitly asks
  for audit + cheap guard, not a fork behavior change. Recorded as Risk 2
  for a dedicated follow-up.
- **Add the guard test as an integration test against the real
  `apps/opencode_fork` binary.** Rejected: too expensive for "cheap guard"
  (requires building the fork binary — see `docs/ai/project-state.md`'s
  "Running the fork engine in dev" section, a multi-step, per-machine
  process) and violates the vendored-subtree/build-pipeline constraint in
  `AGENTS.md`. The guard instead targets `apps/mcp_server`, where a real
  `McpServer`/`Client` pair over `InMemoryTransport` is cheap and gives
  genuine wire-level assurance (not a hand-rolled stub).

## Consequences

- Future spec-compliance work has a single reference point
  (`docs/ai/decisions/2026-07-02-mcp-stateless-readiness.md`) enumerating
  what to re-check, rather than requiring a fresh audit from scratch.
- The new guard test
  (`apps/mcp_server/src/__tests__/mcp_capabilities_and_tool_registration.test.ts`)
  will fail loudly if a future PR introduces a duplicate tool name across
  the 18 registration files, or if an SDK upgrade silently changes the
  `tools.listChanged` capability default — both of which would otherwise
  be invisible until a client misbehaved at runtime.
- No behavior changed in either surface. This is a documentation +
  regression-guard change only, consistent with the issue's "not a fire"
  framing.
- Risks 2, 4, 5 explicitly require fork-side changes and are **not**
  implemented here; they are recorded so the next `mcp-scope-*` or
  upstream-sync pass has a checklist instead of a blank slate.
