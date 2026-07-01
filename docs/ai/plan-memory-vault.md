---
date: 2026-06-28
repo: Rhythm
branch: worktree-agent-a55505da52f6aaf37 (plan only)
status: planning
tags: [plan, Rhythm]
---

# Plan — Rebuild agent memory with the Obsidian vault as the source of truth (local-first)

> Decision of record: `docs/ai/decisions/2026-06-28-memory-vault-as-source-of-truth.md`.
> This plan is decomposed into issue files under `docs/ai/generated-issues/mem-vault-NN-*.md`.

## Intent (one sentence)

Make the local Obsidian vault the single source of truth for agent memory, with a
disposable local SQLite FTS index for fast per-prompt injection, and re-route the
memory MCP tools to the local agent server (`:4001`) so the agent and the desktop
UI finally read/write the same store.

## In scope

- Vault-first write path for `rhythm_remember_memory` (dedup, frontmatter schema).
- Local SQLite FTS index rebuilt-from-vault on startup + incrementally on write +
  refreshed by cron/file-watch; injection reads the index.
- Re-route memory MCP tools from `RHYTHM_API_URL` (prod) to the local agent
  server (`:4001`).
- A `rhythm_list_sessions` MCP tool over the existing local `/agent-sessions`
  endpoints, and consolidation writing facts as vault notes.
- One-time migration of prod `agent_memory` rows into vault notes.
- Guards: index-is-rebuildable, vault-is-sole-authority, don't-break-prod.

## Out of scope (non-goals)

- Multi-device vault sync / conflict-free merge — the user owns this via Obsidian
  Sync / iCloud / git.
- Two-way DB↔vault sync or any second authority.
- Obsidian REST API (MCP) on the agent hot path — direct filesystem only.
- Removing the prod Postgres `agent_memory` table or routes now (left dormant; a
  later cleanup PR may remove once confirmed unused).
- Reworking the skills store (separate, already-shipped effort).

## Hard constraints

- **Don't break prod boot:** `postgres_bootstrap.ts` `agent_memory` DDL stays;
  prod `/agent-memory` routes keep responding so stale clients don't 500.
- **SQLite migrations additive only** (per `project_postgres_sqlite_schema_drift`).
- **Topology rule:** memory tools must not be coupled to `serverConfig.url`; they
  point at `localhost:4001` like agent sessions do.
- **Injection must work with Obsidian closed** → direct FS + local SQLite, never
  the obsidian REST plugin on the hot path.
- `dart format .` + `flutter analyze --no-fatal-infos` for any Flutter change;
  `tsc --noEmit` + `vitest run` green for api_server.

## Design tensions

- **Fast per-prompt injection** vs **vault-is-truth** → resolved by a derived
  SQLite FTS cache; vault authoritative, index rebuildable.
- **User edits in Obsidian** vs **single programmatic writer** → file-level
  last-write-wins; index always re-derives from files.
- **Local-first simplicity** vs **not stranding existing prod memories** → one-time
  migration before prod is treated as dormant.

## Cheapest version that proves the idea

The index + write-to-vault + tool re-route (issues 1–4) is the end-to-end MVP: an
agent calls `rhythm_remember_memory`, a markdown note appears in the vault, the
index updates, and the next prompt's injection recalls it from the index — all on
`:4001`, nothing touching prod. Consolidation, migration, and guards layer on top.

## Clarification interview

Skipped the interactive `AskUserQuestion` round — the maintainer's brief locks the
architecture (vault-as-home, local-first), the index design, the topology re-route,
the migration, and the prod-fate decision. The genuinely open points are design
details, not scope ambiguities, and are listed under **Known Ambiguities** for the
maintainer to confirm before/with implementation rather than blocking the plan.

## Known Ambiguities (confirm with maintainer)

1. **Frontmatter schema specifics** — proposed: `id`, `kind`
   (fact|person|project|preference|context), `tags`, `created`, `updated`,
   `source`. Confirm field names, whether `id` is a ULID, and whether the body is
   the full content or a `summary:` field is wanted.
2. **Vault folder layout** — proposed `memory/<kind>/<slug>.md` under
   `MEMORY_VAULT_PATH`. Confirm subfolder-per-kind vs flat, and the exact root
   (`~/Documents/Memory-Vault/memory/` vs reusing the existing flat dir).
3. **Fate of prod `/agent-memory`** — plan leaves routes + table dormant. Confirm
   "dormant now, remove later" vs "remove now" (latter risks stale-client 500s).
4. **`rhythm_list_sessions` tool design** — what fields it returns (session id,
   name, agentKind, message count, last-activity, recent message bodies?), and
   whether consolidation reads full transcripts or just summaries.
5. **Dedup key** — frontmatter `id` (stable, requires the tool to pass/lookup it)
   vs normalized-content hash (no id needed but fuzzy). Plan assumes id-first with
   content-key fallback.

## Prior Art

Swarm skipped: the pattern is already established **inside this repo** — the
just-shipped skills-unification work (`decisions/2026-06-28-unify-skills-source-of-truth.md`,
`generated-issues/unify-0*.md`) is the same shape (filesystem store = source of
truth, app proxies/derives, pickers read live, guards against name drift). #770's
`memoryVaultSyncService` already proves direct-FS frontmatter parsing + tombstoning
in this codebase. Borrow: the "managed dir + reload + no-X-lost guard" issue
structure from skills-unification; reuse #770's parser. Anti-pattern to avoid: the
retired `obsidian_post_file` second log (divergence) — hence the rebuildable-index
guarantee.

## Phased plan

| Phase | Goal | Issues |
|---|---|---|
| 0 — Derived index foundation | Mark the SQLite store as a derived/disposable index; add full-vault rebuild | mem-vault-01 |
| 1 — Vault-first write | `remember` writes a vault note first (schema + dedup), then index | mem-vault-02 |
| 2 — Topology re-route | Memory MCP tools → `:4001` local server, not prod | mem-vault-03 |
| 3 — Search/injection from index | Injection reads the derived index; results trace to vault notes; cron/file-watch refresh | mem-vault-04 |
| 4 — Consolidation + sessions | `rhythm_list_sessions` tool + consolidation writes vault notes | mem-vault-05 |
| 5 — Migration | One-time prod `agent_memory` → vault export | mem-vault-06 |
| 6 — Guards | Index-rebuildable / vault-sole-authority / no-divergence + don't-break-prod smoke | mem-vault-07 |

## Issue table

| Order | Title | Goal | Likely files | Tests / evaluation | Dependencies |
|---|---|---|---|---|---|
| 1 | Derived memory index + vault rebuild | Treat SQLite `agent_memory` as a disposable index; add `rebuildIndexFromVault()` full-scan | `agent_memory_repository.ts`, `memoryVaultSyncService.ts`, `services/memory_index_service.ts` (new), `migrations.ts` (additive marker only) | unit: rebuild from temp vault → rows match; rebuild is idempotent; drop+rebuild reproduces search | — |
| 2 | Vault-first write path for `remember` | New local endpoint + service that dedups, writes the vault note first, then upserts the index | `agentMemoryService.ts`, `agentMemoryController.ts`, `agentMemoryRoutes.ts`, `memory_index_service.ts`, `config/env.ts` | unit: write creates a note w/ valid frontmatter; dedup updates in place; index updated; path-escape rejected | 1 |
| 3 | Re-route memory MCP tools to `:4001` | Memory tools use the local agent base (`RHYTHM_AGENT_URL`/localhost:4001), not `RHYTHM_API_URL`/prod | `apps/mcp_server/src/tools/agentMemory.ts`, `apps/mcp_server/src/index.ts`, `settings_view.dart` (config snippet), `opencode_client_service.ts` env write | unit: tool base resolves to `:4001`; changing prod URL doesn't change it; existing mcp tests updated | 2 |
| 4 | Injection reads derived index + refresh | `getRelevantMemories` reads the index; results carry note path; cron + file-watch re-index on user edits | `memory_retrieval.ts`, `memory_index_service.ts`, `jobs/memory_vault_sync_job.ts`, `server.ts` | unit: injection recalls a freshly-written note; user-edited note re-indexed; injection works with index-only (Obsidian closed) | 2 (3 recommended) |
| 5 | `rhythm_list_sessions` tool + consolidation→vault | Add session-read MCP tool over local `/agent-sessions`; consolidation writes facts as vault notes | `apps/mcp_server/src/tools/agentSessions.ts` (new), `apps/mcp_server/src/index.ts`, `agentMemoryService.ts` (`seedConsolidationTask` prompt) | unit: tool lists local sessions + messages; consolidation prompt references real tools; seeded task unchanged-idempotent | 2, 3 |
| 6 | One-time prod→vault migration | Export prod `agent_memory` rows (owner-scoped) to vault notes; idempotent; opt-in trigger | `services/memory_migration_service.ts` (new), `agentMemoryRoutes.ts` (one-shot route or CLI), `agent_memory_repository.ts` (read-only use) | unit: rows → notes round-trip; re-run is a no-op (dedup); empty prod = no-op | 1, 2 |
| 7 | Guards: sole-authority + rebuildable + don't-break-prod | Smoke/tests asserting index is rebuildable, vault is the only authority, prod boot intact | `__tests__/memory_vault_authority.test.ts` (new), `__tests__/memory_index_rebuild.test.ts` (new), a `smoke_memory_*.sh`, `postgres_bootstrap.ts` (assert DDL untouched) | smoke: drop index→rebuild→same top-N; prod `/agent-memory` still 200; SQLite migration additive | 1–6 |

## Data-safety notes

- **Private memory data** lives in the user's vault — never log note bodies; never
  push the vault or the local SQLite DB to prod or git.
- **Migration reads prod** owner-scoped only (the signed-in user); it must not
  exfiltrate other users' rows.
- **No secrets** in memory notes; the frontmatter schema carries no tokens.
- **File-watch** must ignore the index DB's own writes to avoid rebuild loops and
  must debounce.

## Next step

Hand to `issue-writer` (done — files written) → maintainer confirms the 5 Known
Ambiguities → `workflow-orchestrator` for branch/PR + first-issue dispatch.
