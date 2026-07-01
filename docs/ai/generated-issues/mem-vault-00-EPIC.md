# EPIC: Rebuild agent memory — Obsidian vault as the source of truth (local-first)

**Decision:** `docs/ai/decisions/2026-06-28-memory-vault-as-source-of-truth.md`
**Plan:** `docs/ai/plan-memory-vault.md`

## Problem

Agent memory is stored in a **database**, not the vault, and the topology is split:
the memory MCP tools (`apps/mcp_server/src/tools/agentMemory.ts`) hit
`RHYTHM_API_URL` = **production** Postgres, while the Flutter memory UI
(`agent_memory_data_source.dart`) reads the **local** agent server (`:4001`). The same
`/agent-memory` routes resolve to two different stores — the agent and the UI never see
the same memories. #770 added a one-way vault→DB mirror but the DB is still the
authority, and the seeded consolidation task references a `rhythm_list_sessions` tool
that does not exist.

## Decision (locked)

The **Obsidian vault is the single source of truth**, local-first, per-device. A local
SQLite FTS index is a **disposable derivation** of the vault (rebuildable on demand).
Memory MCP tools re-route to the local agent server (`:4001`). Prod `agent_memory` is
migrated out then left dormant (not removed — prod boot must not break). Multi-device
sync is the user's concern via Obsidian Sync/iCloud/git.

## Sub-issues (in dependency order)

- [ ] **mem-vault-01** — Derived index foundation + `rebuildIndexFromVault()` (no deps)
- [ ] **mem-vault-02** — Vault-first write path for `remember` (deps: 01)
- [ ] **mem-vault-03** — Re-route memory MCP tools to `:4001`, not prod (deps: 02)
- [ ] **mem-vault-04** — Injection reads the derived index + cron/file-watch refresh (deps: 02; after 03)
- [ ] **mem-vault-05** — `rhythm_list_sessions` tool + consolidation writes vault notes (deps: 02, 03)
- [ ] **mem-vault-06** — One-time prod→vault migration (deps: 01, 02)
- [ ] **mem-vault-07** — Guards: sole-authority / rebuildable / don't-break-prod (deps: 01–06)

## Open questions for the maintainer (block nothing; confirm before/with impl)

1. Frontmatter schema fields (`id` ULID? `summary` vs full body?).
2. Vault folder layout (`memory/<kind>/<slug>.md` vs flat; exact root).
3. Fate of prod `/agent-memory` — dormant now (planned) vs remove now.
4. `rhythm_list_sessions` field set + whether consolidation reads full transcripts.
5. Dedup key — frontmatter `id` vs normalized-content hash (plan: id-first + fallback).

## Guardrails

- SQLite migrations additive only; `postgres_bootstrap.ts` untouched; prod routes stay
  responsive (dormant).
- Memory traffic never coupled to `serverConfigService.url` (dual-endpoint rule).
- Injection must work with Obsidian closed (direct FS + local SQLite, never the obsidian REST plugin).
- Private memory: never log note bodies; never push the vault or local DB to prod/git.
