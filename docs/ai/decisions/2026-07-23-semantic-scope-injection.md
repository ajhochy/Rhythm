---
date: 2026-07-23
repo: rhythm
branch: claude/agent-skill-injection-semantic-0s6iv4
pr:
issues:
status: parked
tags: [decision, rhythm]
---

# Semantic prompt-scoped capability injection for agents

> **PARKED (2026-07-23).** Cost/benefit review: real surfaces are already
> 2.9K–15K tokens per role; the cheap wins are scope-by-default for unscoped
> sessions (#842), leaning on the existing deferred dispatcher for fat servers,
> and tightening inherit-all role files. Revisit the semantic scorer only as a
> drop-in replacement inside `skill_retrieval.ts` if paraphrase misses persist
> after those. Effort redirected to semantic *memory* retrieval instead.

## Context

Rhythm's in-app agents run through the vendored **OpenCode fork engine** (Bun,
`127.0.0.1:4096`), fronted by the Node `api_server` (`:4001`) as a control
plane. The full tool surface (all MCP servers + skills) is expensive — the
`tool_surface_estimator.ts` figure the team already tracks is **~136K tokens**
of tool schemas if nothing is scoped. That cost is paid on the *initial* prompt
cache of every session.

**A scoping system already exists.** This is the single most important fact for
this design — we are upgrading a ranker, not building from zero:

- **Two-layer enforcement** — `api_server` *derives* per-session allowlists;
  the fork *enforces* them.
  - Derivation: `agent_profile_scope.ts::resolveProfileScope` →
    `{ mcpRoleConfig, allowedSkillsJson, systemPrompt, ocAgent }`, expanded by
    `mcp_allowlist_expander.ts`.
  - Push: `opencode_client_service.ts::createSession` (`body.mcpAllowlist`
    ~L1017, `body.skillAllowlist` ~L1022) + per-turn PATCH via
    `updateSessionAllowlist` (~L1089) / `updateSessionSkillAllowlist` (~L1146),
    called from `ws_gateway.ts` (~L633, L649) each turn.
  - Enforcement: `opencode_fork/.../session/mcp_allowlist.ts::filterMcpToolsByAllowlist`
    (invoked `prompt.ts:639`) and `session/skill_allowlist.ts::filterSkillsByAllowlist`
    (invoked `prompt.ts:594`). `null` allowlist = unrestricted; empty/malformed
    = deny-all (fail-closed for MCP).
- **Deferred tool loading already exists** —
  `opencode_fork/.../session/mcp_deferred_tools.ts` advertises a single
  dispatcher tool when `mcpAllowlist.deferred` is set; schemas load on demand.
  This is the "lazy loading" half of the requested layered flow — it is built.
- **Per-prompt relevance ranking already exists, but is lexical** —
  `skill_retrieval.ts::buildSkillsPreface` ranks DB skills against the incoming
  message with **Jaccard token overlap** (`THRESHOLD=0.3`, `DEFAULT_TOP_N=5`)
  and injects a transient, never-persisted preface. It is a *hint*, not the
  gate (header note L16–25). `memory_retrieval.ts` is the more advanced sibling:
  FTS5 / Postgres tsvector with a `LIKE` fallback, and an **optional external
  Engraph binary** (`engraph_manager.ts`) for true semantic search over
  memories, fused with the FTS lane and falling back to FTS when Engraph is
  absent.
- **No embedding/vector libraries in-repo** — no `sqlite-vec`,
  `@xenova/transformers`, `onnxruntime`, `faiss`. Similarity today is Jaccard +
  FTS. Local generative LLM inference exists (`local_omlx_provider.ts`,
  Apple-Silicon oMLX `gpt-oss-20b`) but that is generative, not an embedder.
- **Capability registries** are DB-backed, not static files:
  - Skills → `agent_skills_repository.ts` (managed source
    `~/.config/opencode/skills/`, YAML-frontmatter `SKILL.md`).
  - MCP scopes → `.mcp-roles/*.mcp.json` (16 role templates) resolved by
    `agent_sessions_controller.ts::resolveMcpRole` (~L116).
  - Agent/subagent types → `agent_configs` table (`allowed_mcps_json`,
    `allowed_skills_json`, `is_manager`, `allowed_delegates_json`), projected to
    `~/.config/opencode/agents/*.md` by `opencode_agent_writer.ts`. Subagents
    spawned by the fork `task` tool inherit scope baked into agent `.md`
    frontmatter (`expandProfileMcpAllowlist` / `expandProfileSkillAllowlist`).

## Decision

Replace the **lexical Jaccard ranker** with a **local semantic-embedding
retriever** and generalize it from "skills only" into a single **scope router**
that ranks four capability classes against the incoming prompt — **skills, MCP
servers/tools, subagent (delegate) types, and repo/code context** — then feeds
the result into the *existing* allowlist-derivation + deferred-loading pipeline.

Confirmed constraints (from the user):

- Selection method: **semantic embeddings**.
- Embeddings: **local model, local store** (offline; respects the no-sandbox /
  ABI-fragility posture in `CLAUDE.md`).
- Scope: **skills + MCP + subagent types + repo/code context** (all four).
- Flow: **layered** — two-phase route pass up front *and* deferred loading as a
  runtime fallback.

### Architecture

```
                    incoming prompt (per turn)
                            │
                            ▼
                ┌───────────────────────────┐
                │  scope_router (api_server) │
                │  embed(prompt) → cosine    │
                │  vs capability index       │
                └───────────────────────────┘
        ┌───────────┬───────────┬───────────┬────────────┐
        ▼           ▼           ▼           ▼            ▼
     skills      MCP srv/    subagent    repo/code    (token
     top-K       tools K     delegates   context      budgeter)
        │           │           │           │            │
        └───────────┴─────┬─────┴───────────┘            │
                          ▼                              │
        resolveProfileScope + mcp_allowlist_expander  ◄──┘
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
   createSession / PATCH            deferred dispatcher
   mcpAllowlist + skillAllowlist    (mcp_deferred_tools) for
   + system preface + delegates     anything below the cut
                          │
                          ▼
            OpenCode fork enforces (unchanged gate)
```

Everything downstream of `scope_router` **reuses existing seams**. The new code
is: (1) a local embedder, (2) a small vector index + cosine ranker, (3) the
router that fans the ranking into the four classes, and (4) wiring the router
output into `resolveProfileScope` / the per-turn PATCH.

### Component choices

1. **Embedder — Transformers.js + MiniLM (ONNX), NOT oMLX.**
   `@xenova/transformers` running `Xenova/all-MiniLM-L6-v2` (384-dim, ~90 MB,
   quantized). Rationale:
   - Pure-Node, cross-platform (CI/Linux + macOS) — oMLX is Apple-Silicon-only
     and generative; the embedder must run everywhere the api_server runs.
   - No native ABI compile step, sidestepping the `better-sqlite3`
     Node-version-ABI hazard called out in `CLAUDE.md`.
   - Model file cached under the Rhythm support dir; bundled or first-run
     downloaded through the agent proxy.
   - Alternative kept open: expose an `/embed` route on the existing **Engraph**
     binary and reuse *its* embedding model, so skills/MCP and repo context
     share one vector space. Preferred *if* Engraph is present; MiniLM is the
     always-available fallback (mirrors the existing Engraph-optional pattern in
     `memory_retrieval.ts`).

2. **Vector store — SQLite BLOB + brute-force cosine in JS. No `sqlite-vec`.**
   The skills/MCP/subagent index is tiny (dozens of skills, low-hundreds of MCP
   tools, ~16 roles). Brute-force cosine over cached Float32 BLOBs is
   sub-millisecond and avoids loading a native SQLite extension (again, ABI
   risk). New table `capability_embeddings(kind, ref_id, name, text_hash,
   dim, vector BLOB, updated_at)`. Vectors are cached and only recomputed when
   `text_hash` (name+description) changes — embedding cost is paid at
   index/refresh time, not per prompt (only the prompt itself is embedded per
   turn: one ~5 ms call).

3. **Repo/code context — delegate to Engraph; do not build a second code index.**
   Engraph already loads an embedding model and serves read-only semantic search
   (`engraph_manager.ts`). Repo/code scoping = query Engraph for the top-N files
   / symbols relevant to the prompt and attach them as a context preface (same
   injection channel as the skills preface). If Engraph is absent, fall back to
   the existing FTS/`LIKE` lane — no code context rather than a wrong one.

### Selection algorithm (the "route pass")

Per turn, in `scope_router`:

1. `q = embed(promptText)` (single MiniLM/Engraph call).
2. For each class, cosine `q` against that class's cached vectors → ranked list.
3. Apply **per-class policy** (not one global top-K):
   - **Skills**: top-K (default 5) above `SKILL_THRESHOLD` (start 0.30, tuned;
     replaces the Jaccard 0.3). Union with any skills hard-pinned by the active
     agent profile.
   - **MCP servers/tools**: select servers whose best-tool score clears
     `MCP_THRESHOLD`; within a selected server, include tools above a lower
     per-tool threshold, else mark the server **deferred** (dispatcher only).
     Always union with the profile's hard-required servers (e.g. `rhythm`).
   - **Subagent delegates**: for manager profiles (`is_manager`), rank the
     `allowed_delegates` roster and keep the top few relevant delegate agent
     types; never *expand* beyond the roster (authorization stays with
     `agent_delegation_service.ts`).
   - **Repo/code**: top-N Engraph hits above a context threshold, capped by
     token budget.
4. **Token budgeter** (extends `tool_surface_estimator.ts`): sum estimated
   schema/preface tokens of the selection; if over the per-session budget, drop
   lowest-scoring MCP servers to *deferred* first, then trim repo context, then
   skills — never drop a profile-pinned capability.
5. Emit `{ skills[], mcpRoleConfig, deferredServers[], delegates[], contextRefs[] }`
   → hand to `resolveProfileScope` shaping → existing `createSession` / PATCH.

### Layering (why both phases)

- **Phase 1 (route pass, up front):** the semantic selection above sets a tight
  initial allowlist → small initial prompt cache. This is the token win.
- **Phase 2 (deferred, runtime fallback):** servers the router pushed below the
  cut are advertised via the *existing* `mcp_deferred_tools.ts` dispatcher, so
  if the router under-selected, the agent can still pull a tool schema on demand
  mid-run. Recall failures degrade to a latency cost, not a capability wall.

### Fail-safety

- Router error / embedder unavailable → **fall back to today's Jaccard/FTS
  ranker** (keep `skill_retrieval.ts` as the fallback path, do not delete it).
- MCP stays **fail-closed** as today (empty allowlist = deny-all); the router
  must always union profile-required servers so a bad embed can't strip
  `rhythm` tools.
- Repo context is **fail-open to nothing** (omit rather than mis-attach).

## Alternatives considered

- **LLM router (Haiku/oMLX classifier) instead of embeddings** — rejected per
  user (semantic embeddings chosen); also adds a per-turn generative call and
  latency. Embeddings amortize cost into a cached index.
- **`sqlite-vec` extension** — unnecessary at this registry size and adds native
  ABI risk the project explicitly fights (`better-sqlite3` note in `CLAUDE.md`).
  Revisit only if the repo/code index moves in-process at large scale.
- **Reuse oMLX gpt-oss-20b for embeddings** — wrong tool (generative,
  Apple-only). MiniLM is portable and purpose-built.
- **Build a second in-repo code-embedding index** — duplicates Engraph; rejected
  in favor of delegating repo/code context to the existing binary.
- **Replace, not augment, the deferred-tool mechanism** — rejected; the deferred
  dispatcher is the correct Phase-2 safety net and already exists.

## Consequences

- New always-available semantic ranker; Jaccard/FTS demoted to fallback.
- One new dependency (`@xenova/transformers`) + one bundled ONNX model (~90 MB)
  in `api_server`; one new SQLite table + refresh job.
- Smaller initial prompt cache per session (the stated goal): tool surface
  drops from ~136K toward the per-class budget; measure with
  `tool_surface_estimator.ts` before/after.
- Enforcement gate, deferred loading, subagent inheritance, and role templates
  are **unchanged** — lower blast radius than a rewrite.

## Open questions (for AJ)

1. **Bundle vs. first-run download** of the MiniLM model — bundle into the
   api_server dist (bigger DMG) or fetch once through the proxy on first run?
2. **Engraph as the embedder for skills/MCP too** (one shared vector space), or
   keep MiniLM for capability-ranking and Engraph only for repo/code?
3. **Repo/code context scope** — is "top-N relevant files/symbols as a preface"
   the right shape, or do you want it to also influence *which* MCP/skills get
   pulled (e.g. a Flutter-file prompt biases toward `dev` tooling)?
4. **Where the route pass runs** — inline in `ws_gateway.handleInputFrame`
   (per-turn, adds ~5 ms) vs. precomputed at session-create and refined per
   turn. Recommend per-turn; confirm the latency budget.
5. **Threshold tuning surface** — expose `SKILL_THRESHOLD` / `MCP_THRESHOLD` /
   top-K as env or as columns on the agent profile so power roles can override?
```
