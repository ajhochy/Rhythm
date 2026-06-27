# Hermes-over-OpenCode — Architecture (Rhythm Agent Engine Swap)

> Status: **Proposal / evaluation.** Not yet scheduled. See companion plan in
> `docs/dev-plans/hermes-port-plan.md` and the decision record in
> `docs/ai/decisions/2026-06-22-evaluate-hermes-over-opencode.md`.

## 1. Question this answers

> "Should we have ported the Hermes Agent into Rhythm instead of OpenCode, and
> what would it take?"

Short answer: **Hermes is a strictly larger product than the OpenCode SDK we
embed today.** It is not a drop-in SDK — it is a standalone agent runtime with
its own HTTP + WebSocket gateway, profiles, cron scheduler, skills, memory, and
MCP management. The realistic integration is **not** "replace the OpenCode SDK
import"; it is "run Hermes as a sidecar runtime and put a Hermes engine adapter
behind Rhythm's existing `AgentEngine` seam."

## 2. What Rhythm has today

Rhythm's agent stack (from `apps/api_server/src`):

```
Flutter desktop (apps/desktop_flutter)
  └─ http + ws://localhost:4001/ws/agents
       └─ Node/TS api_server (AGENT_LOCAL=true)
            ├─ controllers/  agent_sessions, agents/capabilities
            ├─ services/opencode_engine.ts        ← singleton + in-mem id map
            ├─ services/opencode_client_service.ts ← THE engine adapter (~1.7k LOC, ~60 methods)
            ├─ services/opencode_stream_bridge.ts  ← SDK events → client frames
            ├─ services/agent_model_resolver.ts    ← provider/model route fallbacks
            └─ repositories/agent_sessions_repository.ts (SQLite, local only)
```

Key facts that constrain the design:

- The engine adapter surface is **already abstracted into one class**
  (`OpencodeClientService`) plus a thin singleton module (`opencode_engine.ts`)
  and an event bridge (`opencode_stream_bridge.ts`). That is the seam we exploit.
- Agent traffic is **localhost-only** on `:4001`, auth-bypassed via
  `AGENT_LOCAL=true`. Production data on `api.vcrcapps.com` is untouched by any
  of this. (CLAUDE.md "Dual-Endpoint Architecture".)
- The persisted session row (`models/agent_session.ts`) already carries
  `sdkSessionId`, `providerId`, `modelId`, `permissionMode`, `agentMode`,
  `thinkingBudget`, `fastMode`. Most map cleanly onto Hermes concepts.
- `agentKind` is currently `'claude-code' | 'codex'`. The model resolver also
  knows `gemini-cli` and `opencode`.

### The adapter surface we'd have to satisfy

`OpencodeClientService` public methods (the contract a Hermes engine must
provide, grouped):

| Group | Methods |
|---|---|
| Lifecycle | `initialize`, `ensureReady`, `isReady`, `statusMessage`, `isDisposed` |
| Sessions | `createSession`, `getSession`, `forkSession`, `listChildren`, `revertSession`, `unrevertSession`, `summarizeSession` |
| Turn I/O | `prompt`, `promptAsync`, `subscribeToEvents`, `abortSession`, `listMessages`, `getTodo`, `getSessionDiff` |
| Providers/models | `listProviders`, `listAuthedProviders`, `listModels`, `listAgents`, `setAuth`, `getOAuthUrl`, `handleOAuthCallback`, `setOAuthCredentials` |
| Permissions | `respondPermission`, `respondToPermission` |
| Commands | `listCommands`, `dispatchCommand` |
| MCP | `listMcp`, `addMcp`, `connectMcp`, `reconnectMcp`, `disconnectMcp`, `removeMcp`, `ensureRhythmMcp`, `ensureCuratedMcps`, `getPersistedMcpConfigs` |
| Terminal | `createPty`, `resizePty`, `removePty`, `runShell` |

The event bridge consumes SDK events of these shapes (from
`@types/opencode-ai-sdk.d.ts`) and relays them to the Flutter client:

```
message.part.delta   message.part.updated   message.updated   message.removed
session.status       session.idle           session.created   session.error
session.diff         session.updated
```

**This is the single most important integration fact:** the Flutter client and
the WS gateway are coupled to *these OpenCode event shapes*, not to OpenCode the
process. If a Hermes adapter emits the same frames, the client doesn't change.

## 3. What Hermes actually is (from the indexed repo)

Indexed: `github.com/NousResearch/hermes-agent` @ `5937b95`
(136,505 nodes / 247,965 edges via GitNexus). The official desktop is **Electron
+ React inside the monorepo** (`apps/desktop/`), not a separate repo and not
Flutter. Hermes exposes a **dashboard/gateway backend** that the Electron
renderer talks to:

```
hermes dashboard  (Python, FastAPI: hermes_cli/web_server.py)
  ├─ REST  /api/status /api/sessions /api/profiles/* /api/config
  │        /api/cron/jobs /api/skills /api/fs/* /api/sessions/:id/messages
  ├─ WS    /api/ws     ← JSON-RPC chat surface (tui_gateway.dispatch)
  ├─ WS    /api/pub + /api/events ← tool-call / event broadcast fan-out
  └─ profile-scoped backend processes (one per HERMES_HOME), pooled/LRU-reaped
```

Hermes features Rhythm does **not** have today and would inherit:

- **Profiles** — multiple isolated `HERMES_HOME` agents, lazily spawned and
  pooled (`startHermes` → `ensureBackend` → `spawnPoolBackend` in
  `apps/desktop/electron/main.cjs`). This is the "domain profiles" idea Rhythm
  has wanted.
- **Cron scheduler** — `/api/cron/jobs`, durable, with cron sessions surfaced in
  the session list. Rhythm currently fakes scheduling via its own jobs.
- **Skills, memory, MCP registry, toolsets** — first-class, already curated.
- **Messaging gateways** (Telegram/Discord/etc.) — out of scope for Rhythm but
  present.

## 4. Three integration options

### Option A — Hermes sidecar behind the engine seam (RECOMMENDED)

Run `hermes dashboard` as a child process from the Node `api_server` (exactly
how `ApiServerService` already spawns Node, and how the Hermes Electron app
spawns its backend). Add `HermesEngineService` implementing the same surface as
`OpencodeClientService`, translating to Hermes REST + `/api/ws`.

```
Flutter (unchanged)  ──ws/http :4001──▶  Node api_server
                                            └─ AgentEngine (interface)
                                                 ├─ OpencodeClientService   (today)
                                                 └─ HermesEngineService     (new)
                                                       └─ http + ws  ─▶  hermes dashboard :9119/:8642
                                                                             └─ profile backends
```

- **Pros:** Flutter client largely unchanged; both engines coexist behind a flag;
  inherits profiles/cron/skills; production path untouched; reversible.
- **Cons:** ships a Python runtime + venv in the macOS bundle (notarization +
  size); two runtimes (Node + Python) to supervise; must map event shapes.

### Option B — Flutter talks to Hermes directly (bypass Node for agent traffic)

Point the Flutter agent data sources at the Hermes gateway directly and retire
the Node agent endpoints. Borrow the Dart client patterns from
`lovesmile/hermes-desktop-ui` (see §6).

- **Pros:** one fewer hop; uses Hermes the way it's designed; least "adapter glue."
- **Cons:** large Flutter rewrite of the agent feature; loses the Node seam that
  lets us A/B the two engines; Rhythm session model and Hermes session model must
  reconcile on the client; couples Rhythm UI to Hermes API churn.

### Option C — Full replacement of OpenCode (NOT recommended)

Rip out `OpencodeClientService` and make Hermes the only engine.

- **Pros:** simplest mental model long-term.
- **Cons:** irreversible mid-flight; throws away working Claude/Codex routing and
  ~60 tested adapter methods; no fallback if Hermes packaging on macOS proves
  painful. **Do not start here.**

## 5. Recommended design (Option A) in detail

### 5.1 The engine interface

Extract an `AgentEngine` interface from the methods in §2 (the union the WS
gateway + controllers actually call — likely ~20 of the 60, the rest are
OpenCode-specific MCP/PTY plumbing). Concretely:

```ts
// services/agent_engine.ts (new)
export interface AgentEngine {
  initialize(cfg?: { directory?: string }): Promise<void>;
  ensureReady(): Promise<boolean>;
  get isReady(): boolean;
  createSession(opts): Promise<{ sdkSessionId: string }>;
  promptAsync(sessionId, input, opts): Promise<void>;   // fire; events stream out
  subscribeToEvents(sessionId, onEvent): Promise<Unsub>;
  abortSession(sessionId, directory?): Promise<boolean>;
  getSession(sessionId): Promise<SessionInfo | null>;   // resume continuity
  listMessages(sessionId): Promise<Message[]>;
  listAuthedProviders(): Promise<string[]>;
  listModels(...): Promise<...>;
  respondPermission(...): Promise<...>;
  // MCP / PTY / shell: optional, capability-gated (Hermes maps some, no-ops others)
}
```

`opencode_engine.ts` becomes `agent_engine.ts` exporting whichever
implementation an env flag selects:

```ts
export const agentEngine: AgentEngine =
  process.env.RHYTHM_AGENT_ENGINE === 'hermes'
    ? new HermesEngineService()
    : new OpencodeClientService();
```

### 5.2 Event translation (the load-bearing piece)

`HermesEngineService.subscribeToEvents` opens Hermes `/api/ws` (JSON-RPC) and/or
`/api/events`, and maps Hermes frames → the OpenCode event shapes the bridge
already understands:

| Hermes frame | → OpenCode event the bridge expects |
|---|---|
| token / content delta | `message.part.delta` (`{ type:'text', text }`) |
| tool start/finish | `message.part.updated` with `type:'tool'` |
| turn complete / idle | `session.idle` |
| run status change | `session.status` |
| session created | `session.created` |
| error | `session.error` |
| diff/patch available | `session.diff` |

Doing the mapping **inside the adapter** means `opencode_stream_bridge.ts` and
the Flutter renderer do not change. This is the crux of keeping the port small.

### 5.3 Session id mapping

`opencode_engine.ts` already keeps `opencodeSessionMap: Map<localId, sdkId>`.
The Hermes adapter keeps the identical map of `localAgentSessionId → hermesSessionId`,
persisted into the existing `sdkSessionId` column (no schema change). Resume
re-attaches via Hermes `/api/sessions/:id` + `/messages`.

### 5.4 Provider / model resolution

Hermes owns model/provider config itself (config.yaml + `/api/config`,
`/api/models`). Two sub-options:

- **B-thin:** keep Rhythm's `agent_model_resolver.ts` and pass an explicit
  provider/model per turn into Hermes (Hermes supports per-turn model override).
- **B-fat:** defer entirely to Hermes profiles/config and reduce
  `agent_model_resolver.ts` to a presentation shim. Preferred once stable.

### 5.5 Profiles → Rhythm "domain profiles"

Map a Rhythm project/domain to a Hermes profile (`HERMES_HOME`). The adapter
calls `/api/profiles/*`; the Electron pool logic Hermes already ships
(`spawnPoolBackend`, LRU reaper) handles lifecycle. This is the single biggest
*new capability* Rhythm gains and the strongest strategic argument for the port.

### 5.6 Packaging (the real cost center)

- Hermes is Python. The macOS DMG must bundle a Python runtime + Hermes venv (or
  a PyInstaller/`uv`-frozen `hermes` binary) alongside the existing Node server.
- `tools/release/sign_and_notarize_macos.sh` already signs "all .node/.dylib/
  binaries" — it must be extended to sign the Python framework + any embedded
  binaries, and notarization must cover them. **This is where schedule risk lives.**
- Entitlements already drop the sandbox (needed for `Process.start`), so spawning
  a second runtime is allowed.

## 6. Reusable Flutter assets (surveyed + GitNexus-mapped)

Cloned to `/Users/ajhochhalter/Documents/hermes-flutter-ui-survey/`:

| Repo | Stars | Stack | Verdict for Rhythm |
|---|---|---|---|
| `lovesmile/hermes-desktop-ui` | 1 | Flutter desktop, SSE, SQLite, 3 conn modes | **Best code reference.** Mapped below. |
| `rusty4444/hermes-android` | 34 | Flutter mobile, riverpod, `/v1/chat/completions` | Mobile chat patterns only. |
| `synthalorian/hermes-wingman` | 7 | Flutter + Rust backend + Rails | Inspiration; introduces its own backend — not a base. |

`lovesmile/hermes-desktop-ui` GitNexus map (1,642 nodes / 3,648 edges):

- `lib/services/connection_manager.dart` — **the gem.** A `ConnectionManager`
  singleton that abstracts local/embedded/remote bridges behind one `runShell`
  + health-check + state-notifier surface. Directly analogous to Rhythm's
  `AgentServerController` and worth borrowing structurally for managing the
  Hermes sidecar (spawn/health/port-autodetect/restart).
- `lib/services/gateway_service.dart` — SSE chat client against
  `/v1/chat/completions` with `X-Hermes-Session-Id` header for continuity, plus
  per-server cache isolation via `serverId`. Good reference for a Dart Hermes
  client **if** we go Option B.
- `lib/services/local_db.dart` — local SQLite session/message persistence keyed
  by mode/server. Mirrors Rhythm's `agent_sessions_repository.ts` intent.
- Screens (`chat`, `cron`, `models`, `platforms`, `logs`, `settings`,
  `file_browser`) — UI decomposition reference for a future Hermes-native surface.

**Caveat:** that repo targets the *OpenAI-compatible* `/v1/chat/completions`
endpoint, which is the lowest-common-denominator surface. To get profiles, cron,
skills, and structured tool events we must target the richer `/api/ws` +
`/api/*` dashboard surface, which none of the three repos fully exercise.

## 7. What we gain vs. what it costs

**Gain:** profiles (domain isolation), durable cron, skills, memory, curated MCP
registry, a maintained agent runtime, and a path off the OpenCode SDK's churn.

**Cost:** a bundled Python runtime + notarization work; a second supervised
process; an event-translation adapter; reconciling two session models. None of
this touches production data (`api.vcrcapps.com`) or the existing feature
screens.

## 8. Bottom line

Porting Hermes "instead of OpenCode" was never going to be a smaller job than
embedding the OpenCode SDK — Hermes is a runtime, not a library. But because
Rhythm already funnels every engine call through `OpencodeClientService` and a
narrow event bridge, **Option A (Hermes sidecar behind an `AgentEngine`
interface) is genuinely tractable and reversible**, and it's the only option that
lets us prove Hermes value (profiles + cron + skills) without betting the app on
it. Recommend prototyping Phase 0–2 of the companion plan behind
`RHYTHM_AGENT_ENGINE=hermes` before committing.
