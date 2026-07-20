# Context Glossary

Shorthand that recurs across `docs/ai/repo-map.md`, `architecture.md`, and the
issue/run logs. Decoded here so a cold-start agent doesn't have to re-derive it
by grepping. Read this once, then trust the tags.

## 1. `OPC-Mx-y` tag scheme

Tracks the **OpenCode utilization/feature milestones** — the work that made
Rhythm actually consume the opencode engine's capabilities.

- **OPC** = OpenCode.
- **Mx** = milestone number. `M1` Interaction/hygiene · `M2` Message rendering ·
  `M3` Session features · `M4` Advanced (attachments, fork, MCP UI, agent
  selection). Each milestone's theme is in the `**Milestone:**` line of its
  issue file.
- **-y** = issue number within that milestone (1-based).

So `OPC-M3-5` = milestone 3, issue 5 (the session todo panel).

**Where the tags appear / how to navigate:**

- **Issue spec:** `docs/ai/generated-issues/opencode-m<x>-<y>-<slug>.md` (has
  Summary, Likely files, Acceptance criteria).
- **Branch:** `opc-m<x>-<y>-<slug>`.
- **Code:** inline `OPC-Mx-y` comments/annotations mark the symbol a milestone
  added or changed — grep the tag to jump straight to the relevant code, and
  see `repo-map.md` where each tag is pinned to its file/symbol.

A bare `#NNN` next to a tag (e.g. `OPC-M1-6 #709`) is the **GitHub issue/PR
number** for that unit.

> Not to be confused with **`OCU-NN`** in `current-plan-opencode-utilization.md`
> — that's a separate, later "Opencode Utilization" epic (OCU-01…35, #1042+)
> with its own M1–M7 milestone table. `OPC-Mx-y` = the earlier feature set;
> `OCU-NN` = the utilization epic.

## 2. local / sdk dual-ID scheme (`opencodeSessionMap`, `localId` vs `sdkId`)

Every agent session has **two** IDs:

- **`localId`** — Rhythm's own session row id (`agent_sessions.id`). Stable,
  what the Flutter client and DB use to refer to a session.
- **`sdkId`** — the opencode SDK's session id, returned when the engine creates
  a session. Every SDK/engine call (`prompt`, `dispatchCommand`, diffs, SSE
  event `sessionID`) is keyed by this.

There are two because Rhythm persists sessions in its own DB while the opencode
engine mints its own session identifiers; you constantly need to translate
between them (route user input to the right SDK session; attribute an incoming
SSE event back to a local row).

**Where the mapping lives:**

- **Ephemeral, in-memory:** `opencodeSessionMap: Map<localId, sdkId>` in
  `apps/api_server/src/services/opencode_engine.ts`. Fast path for
  routing/reverse-lookup. **Wiped on every api_server restart.**
- **Durable:** the `sdk_session_id` column on `agent_sessions`
  (`agent_sessions_repository.ts`, model field `sdkSessionId`, lookup
  `findBySdkSessionId`). When the in-memory map misses (post-restart, or before
  it's populated for a brand-new session), code falls back to this column and
  lazily repopulates the map (see the `#751` comment in
  `opencode_stream_bridge.ts`). Without the fallback, events get dropped and the
  chat freezes on "Starting".

## 3. dual-server split (agent-server vs production API)

Rhythm runs against **two servers at once** (see `architecture.md` → "Dual-server
model"):

|            | Local **agent server**                                                 | **Production API**                                                        |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Code       | `apps/api_server`                                                      | same codebase, deployed remotely                                          |
| Port / URL | `http://localhost:4001` (`AppConstants.agentLocalBaseUrl`, hard-coded) | `api.vcrcapps.com` :443 (user-configurable via `serverConfigService.url`) |
| Started by | Flutter, spawned on launch                                             | hosted on Synology NAS via Cloudflare tunnel                              |
| DB         | SQLite (`DB_CLIENT`)                                                   | Postgres                                                                  |
| Owns       | Agent sessions + the in-process opencode engine                        | all user-facing app data (tasks, rhythms, projects, PCO, etc.)            |

The agent server URL is **never** coupled to the user-configurable production
URL — `serverConfigService.url` controls the production API only.

**When a change touches one vs both:**

- **Agent/opencode-engine features** (sessions, MCP, streaming, agent-profile
  sync) are **local-only** — they run in the SQLite path and often explicitly
  **no-op under Postgres** (e.g. `agent_profile_sync.ts` returns early when
  `env.dbClient === 'postgres'`, because production has no local engine). Don't
  try to make these run in both.
- **User-facing data features** live on the production API and must handle
  **Postgres**. Per `AGENTS.md`: a new column needs an explicit backfill in the
  Postgres bootstrap path, not just a SQLite migration — SQLite/Postgres schema
  drift is a recurring bug source.
- If unsure which side a change belongs to, check for a
  `dbClient === 'postgres'` gate near the code: its presence means the feature
  is deliberately local-only.
