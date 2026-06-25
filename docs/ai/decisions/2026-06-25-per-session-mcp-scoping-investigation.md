---
tags: [decision, rhythm, investigation, opencode, mcp]
date: 2026-06-25
branch: feature/agent-scheduler
status: investigation-pending-approval
---

# Investigation: making a profile session load ONLY its MCP servers (real context reduction)

## Problem (confirmed)

Per-profile MCP scoping is **metadata only**. A Secretary session (allowlist = 7 servers)
still loads all ~20 globally-connected servers (~142k tokens). The allowlist resolved by
`agent_profile_scope.resolveProfileScope` → `mcpRoleConfig` is passed into
`createSession(...)` on both paths but the SDK call never forwards it.

Verified in code (this session):
- `opencode_client_service.ts:478-513` — `createSession` accepts `mcpRoleConfig` but only
  `logger.info`s it; the SDK body is `{ title }` + optional `{ directory }` query. Comment
  says: *"SDK has no per-session allowlist param."*
- `ws_gateway.ts:376-388,445,481` — resolves `wsMcpRoleConfig`, passes it to `createSession`,
  never converts it to a tool filter on the prompt.
- `ws_gateway.ts:599-609` — the prompt `sdkOpts` forwards `reasoningConfig`, `fastMode`,
  `agent`, `permissionMode`, `system` — **never `tools`**.
- `agent_runner.ts:589-609` (scheduled path) — same: `mcpRoleConfig` resolved, passed to
  `createSession`, never applied.

## Environment facts

- Installed SDK: `@opencode-ai/sdk` **1.14.49** (`node_modules/@opencode-ai/sdk`).
- Running engine binary: **opencode 1.14.40** (`~/.local/bin/opencode`) — drifts from SDK.
- Global MCP servers in `~/.config/opencode/opencode.json`: **20**
  (memory, pco-services, discord, gitlab, context7, firebase, linear, obsidian, rhythm,
  pdf-tools, canva, notion, stripe, mailchimp, nfl_mcp, ableton-mcp, propresenter,
  gmail-work, gmail-personal, supabase).

## Q1 — How does the SDK load MCP tools into a session? Any filtering hook?

The opencode engine connects MCP servers at the **project-instance (directory) level**, from
global `opencode.json`. Every connected server's tool schemas are injected into the model
context for every session in that instance. The SDK exposes three relevant levers:

| Lever | Shape (SDK 1.14.49) | Scope | Reduces context? |
|---|---|---|---|
| `session.create` body | `{ title, parentID }` only | — | No param exists |
| `session.prompt` body | `agent?`, `system?`, **`tools?: {[id]:boolean}`** | per-turn | **No — see Q2** |
| `mcp.connect` / `mcp.disconnect` | `path:{name}`, `query:{directory}` | **engine/instance-global** | **Yes (real)** |
| `config.update` + reload | global `mcp.<name>.enabled` | global, needs reload | Yes (real) |

So there **is** a per-turn `tools` map on `session.prompt` (the createSession comment is
narrowly true but misleading — it only describes `session.create`). The open question is
whether that `tools` map reduces *loaded schemas* or only *gates calls*. → Q2.

## Q2 — Does agent/`tools`/`permission` config reduce loaded schemas or only gate calls?

**Only gates calls. It does NOT reduce loaded MCP context.** This is the decisive finding and
it kills the cheap "3a" path.

- opencode docs (Agents/Config): per-agent `tools: {"server_*": false}` and `permission`
  wildcards control whether a tool may *run*. The `enabled` flag on `mcp.<server>` is the
  documented context lever ("MCP servers add to your context, so be careful which ones you
  enable") — and it is **global per server**, applied at engine load.
- Upstream confirms the gap explicitly:
  - **sst/opencode #5373** "Allow MCP on a per-agent basis" (open, assigned, Dec 2025):
    *"the 'tools' setting won't disable the MCP server… even though the agent can't use it,
    it still appears in the context."*
  - **#3756** "MCP tool blocking not working — agents can still see and access disabled tools."
  - **#3612** "Option to deny MCP tools by default"; **#2888** "global defaultTools";
    **#1101** "Enable/Disable MCP server by Mode." All open.

Conclusion: opencode has **no native per-session/per-agent MCP context scoping**. The only
things that actually remove schemas from context are (a) disconnecting the server from the
instance, or (b) not enabling it in config at engine load. Both are engine-global state.

## Q3 — Upstream issue/PR for per-session scoping or lazy tool loading?

Yes, all **open / unresolved** (above). No merged fix. The only lazy-loading pattern in the
ecosystem is an **external MCP aggregator/proxy** (e.g. `mcpproxy` `retrieve_tools` mode):
opencode connects to one proxy that injects a single `search_tools` meta-tool and lazy-loads
matching schemas on demand — the same deferral pattern Claude Code's ToolSearch uses. Not
built into opencode.

## Options evaluated

### 3a — SDK/agent `tools` or `permission` scoping  ❌ REJECTED
Effort: low. **Does not reduce context** (Q2, upstream #5373/#3756). Only value is call
gating (a safety control, not a context win). Not a solution to the stated problem.

### #1 — Reconcile connected servers to the active profile on session start  ✅ VIABLE NOW
Use existing `connectMcp`/`disconnectMcp` (`opencode_client_service.ts:1546-1624`) to
disconnect non-allowlisted servers before the turn. **This genuinely removes schemas from
context** (unlike 3a). Reuses code that already exists.
- Effort: **low–medium**. Risk: medium.
- **Limitation: engine/instance-global state.** connect/disconnect is scoped to the engine
  (the `directory` query selects a project instance, shared by all sessions in it). Two
  profiles with different allowlists **cannot run concurrently** — switching profiles
  re-disconnects/reconnects servers globally, and a scheduled task running under one profile
  would corrupt an interactive session's toolset. Needs a serialization guard + reconnect
  cost (MCP servers re-handshake, OAuth ones re-read tokens) on every profile switch.
- Good fit for *today's* usage (single user, typically one active agent session at a time).

### 3b — Deferred/lazy tool surface (MCP aggregator proxy)  ✅ DURABLE, concurrency-safe-ish
Stand up one aggregator MCP server; opencode connects only to it; it exposes a
`search_tools`/`load_tool` deferral surface and injects schemas on demand. Massive, uniform
context reduction for **every** session regardless of profile.
- Effort: **high** (new long-lived service + protocol plumbing + OAuth passthrough for the
  ~6 OAuth servers Rhythm already brokers). Risk: medium–high (new failure surface, the
  hand-written SDK d.ts discipline, behavior change — model must discover tools).
- Per-*profile* curation is awkward: opencode holds one global connection to the proxy, so
  the proxy can't cleanly tell which Rhythm profile a given opencode session belongs to. Best
  as a *global* context cut, optionally combined with profile curation.

### 3c — Per-profile engine instance (or per-directory instance)  ✅ DURABLE, true concurrency
Spawn an opencode engine (or use a distinct `directory` instance) per active profile, each
connecting only its allowlist. Clean isolation, true concurrent differently-scoped agents,
real reduction.
- Effort: **high** (engine lifecycle/port management, memory: each engine + its MCP child
  procs). Risk: medium. Heavy for 7 profiles × up to 20 servers, but you only spin up engines
  for *active* profiles.
- **Unverified sub-variant:** whether opencode gives per-`directory` MCP isolation within a
  *single* engine (connect/disconnect take a `directory` query). If it does, 3c becomes much
  cheaper (one engine, per-profile directory instances). **Needs an empirical test** before
  relying on it.

## Recommendation

**Phase A (now): ship #1 — connect/disconnect reconciliation on session start.**
It's the only approach that produces *real* context reduction with code that already exists,
and it matches the existing profile allowlist model. Accept the engine-global limitation,
which is acceptable for current single-active-session usage, and make it safe:
- Reconcile (`mcp.status` → disconnect non-allowlisted, connect missing-allowlisted) keyed on
  the resolved profile allowlist, before the first prompt of a turn.
- Add a **profile-scope serialization guard**: if the requested scope ≠ currently-connected
  scope, queue/serialize; never let a scheduled run mutate a live interactive session's scope
  mid-turn.
- Cache "currently connected scope" to skip redundant reconnects (avoid OAuth re-reads).
- **Empirical gate:** after wiring, restart the Debug app and confirm a Secretary session's
  tool/token count drops to the 7-server set (the user's stated test).

**Phase B (durable): pick when concurrency becomes a hard requirement.**
- If the priority is *global* context reduction with minimal per-profile nuance → **3b**
  (aggregator/deferred surface).
- If the priority is *concurrent, differently-scoped* agents (interactive + scheduled at once)
  → **3c**, first running the cheap empirical test for per-`directory` isolation; if that
  works, 3c is one engine with per-profile directory instances (much cheaper than N engines).

**Do not invest in 3a** beyond optionally using `tools`/`permission` as a *call-gating* safety
layer — it cannot reduce context.

## Risks / discipline notes

- Hand-written `@types/opencode-ai-sdk.d.ts` drifts from the real SDK and the 1.14.40 binary.
  Any wrapper change must diff against `node_modules/@opencode-ai/sdk/dist/gen/*.d.ts` and add
  a boundary test using the real shape (see `opc_sdk_boundary_regression.test.ts`).
- connect/disconnect/`config` calls are `directory`-scoped — current wrappers omit the
  `directory` query (engine-default instance). Confirm which instance the reconcile targets.
- GitNexus impact + detect_changes before any edit; feature branch + PR; never merge to main.

## Empirical probe (this session, live engine :4096)

**Per-directory MCP isolation works within a single engine — 3c is the CHEAP variant.**

Test: disconnected `nfl_mcp` in `directory=/tmp/ocprobe-A` only.
```
POST /mcp/nfl_mcp/disconnect?directory=/tmp/ocprobe-A  → true
GET  /mcp?directory=/tmp/ocprobe-A   → nfl_mcp: {status: "disabled"}
GET  /mcp?directory=/tmp/ocprobe-B   → nfl_mcp: {status: "connected"}   ← unaffected
GET  /mcp                            → nfl_mcp: {status: "connected"}   ← default unaffected
POST /mcp/nfl_mcp/connect?directory=/tmp/ocprobe-A     → true (restored)
```
→ MCP connection state is held **per project-instance (directory)** in one engine. Two
profiles in distinct cwds have independent toolsets → **true concurrency without N engines.**

Caveats found:
- A directory instance must be "touched" (a connect/disconnect or session) before
  `GET /mcp?directory=` returns status; bare/never-used dirs returned empty.
- `/experimental/tool?directory=&provider=&model=` returned only the ~13 built-ins for the
  bare temp dirs (no MCP tools), so it's not a usable external proxy for injected-tool count.
  Final proof of token reduction = live-session count (verification gate), not this endpoint.
- Disconnect state is in-memory; the engine reloads all servers from opencode.json on
  restart → reconcile must run per session start, keyed on the session's cwd.
- Existing `connectMcp`/`disconnectMcp` wrappers (`opencode_client_service.ts:1546-1624`) omit
  the `directory` query → they hit the engine-default instance. They must accept+pass cwd.

## Chosen design — 3c (cheap): per-profile directory instance, reconcile on session start

This is effectively the #1 reconcile mechanism keyed **per-directory** instead of engine-global
— which removes #1's concurrency limitation entirely, on a single engine.

1. **Per-profile cwd.** Each profile gets a stable dedicated working directory (the opencode
   instance key for its MCP scope). Default: app-managed
   `~/Library/Application Support/Rhythm/agent-cwd/<profileId>/`. Sessions for that profile use
   it as `cwd` (already threaded everywhere: createSession, event subscription, permission,
   abort).
2. **Reconcile on session start / first turn.** For the session's cwd: `GET /mcp?directory=cwd`
   → `disconnect` non-allowlisted servers, `connect` allowlisted-but-missing. Cache the
   reconciled scope per cwd to skip redundant work (avoid OAuth re-reads).
3. **Concurrency:** distinct cwds ⇒ independent toolsets ⇒ interactive + scheduled differently-
   scoped agents run at once. No serialization guard needed (unlike engine-global #1).
4. **Verification gate:** restart Debug app, open a Secretary session, confirm tool/token count
   drops to the 7-server set.

Open design choice for the user: where to root per-profile cwds (app-managed scratch dir vs the
user's real project directories). Recommended: app-managed scratch dir.

## Sources
- opencode docs: Agents, Config, MCP servers, Tools (opencode.ai/docs/*)
- sst/opencode issues #5373, #3756, #3612, #2888, #1101
- SDK types: `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`
  (SessionPromptData, McpConnectData/McpDisconnectData, AgentConfig, Agent)
</content>
</invoke>
