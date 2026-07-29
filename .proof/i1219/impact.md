# Issue #1219 inferred blast radius

GitNexus was explicitly waived. The following impact map was inferred with
`rg` caller/import searches before and after edits. No tests or servers were
run in this execution split.

## Database bootstrap and migration blocks

- `runMigrations` (`migrations.ts`): called by `database/db.ts` on every SQLite
  boot and by the repository/service test harnesses. The additive
  `agent_memory_changes` DDL therefore affects every local startup but does not
  alter or delete existing rows. Direct regression surfaces:
  `migrations_replay_guard.test.ts`, `memory_lifecycle_index.test.ts`, and the
  new `issue_1219_memory_provenance.test.ts`.
- `runPostgresBootstrap` (`postgres_bootstrap.ts`): imported by
  `database/db.ts` and Postgres schema tests. The new projection remains after
  the existing `agentExecutionEnabled` early return, so cloud roles without
  agent execution still skip it. Static role/authority contracts in
  `issue_755_role_separation.test.ts` and `memory_vault_authority.test.ts` were
  updated for #1219 parity.

## `AgentMemoryRepository`

- Imported by `memoryVaultSyncService`, `memory_index_service`,
  `memory_retrieval`, `memory_consolidation_drafter`,
  `memoryVaultWriteService`, and memory tests.
- `rowToModel` feeds list/get/search/source-id lookup; adding
  `lifecycleState` and `unverifiable` changes those HTTP response shapes
  additively.
- `upsertBySourceAsync` is called by both `MemoryIndexService.upsertNote` and
  `syncMemoryVault`; Postgres now writes the same provenance columns as
  SQLite.
- New `appendChangeAsync` and `listChangesAsync` are called only by lifecycle
  mutation/controller paths and #1219 tests. Ledger lookup uses the stable
  vault source id as well as the current derived row id, so
  `MemoryIndexService.rebuildIndexFromVault` can replace index row ids without
  orphaning history.

Risk: medium. Repository reads are broad, but all response additions are
optional/additive and #1218 ranking inputs remain unchanged.

## Vault write and lifecycle symbols

- `rememberToVault` is called by the HTTP memory service, migration script,
  consolidation drafter, and memory contract suites. The source merge change
  only prevents existing source entries from being removed; content/dedup and
  #1218 classification/ranking code are untouched.
- `mutateMemoryLifecycle` is private and reached only through `verifyMemory`
  and `deprecateMemory`.
- `verifyMemory`/`deprecateMemory` are called by `agentMemoryService` and
  lifecycle tests. They now append enriched frontmatter verification entries
  and a matching audit row after the canonical vault write and index refresh.
- `syncMemoryVault` is called by the sync job, controller, rebuild/injection
  tests, and #1218 contracts. Its implementation was not changed; it already
  projects generated/verified/sources/trust fields from canonical
  frontmatter.

Risk: medium. The mutation remains vault-first and non-destructive; audit
failure can surface after the canonical note/index have been updated, matching
the existing post-write failure posture.

## `AgentMemoryController`

- Instantiated only by `routes/agentMemoryRoutes.ts`.
- `get`, `verify`, `deprecate`, and `agentLifecycle` now return
  `auditHistory` in addition to the memory row. Existing status codes and route
  paths are unchanged.
- `memoryWithAudit` is private to the controller.

Risk: low. Additive response fields only.

## MCP `registerAgentMemoryTools`

- Imported by `apps/mcp_server/src/index.ts` and MCP registration tests.
- The existing `rhythm_verify_memory` handler and schema are unchanged; its
  description now documents the actual append-only audit response. The
  handler still targets only `/agent-memory/:id/agent-lifecycle` using the
  server-controlled machine actor.

Risk: low. Documentation/test strengthening only.

## Flutter memory model and list UI

- `AgentMemoryEntry.fromJson` is used by all four memory data-source methods
  (list/search/create/update), and direct constructors are used by controller
  tests. New constructor fields have defaults, preserving existing callers.
- `AgentMemoryView` is opened from `_agents_nav_column.dart`; `_MemoryTile`
  renders every listed/search result. Lifecycle is always visible, while
  provenance details are read-only and shown only in the existing expanded
  state.

Risk: low. No controller/repository mutation or navigation changes; the UI
adds labels to an existing tile.

## Explicit non-impact

- `memory_retrieval.ts`, including curated-vs-synthesis scoring and ordering,
  was not edited.
- `classifyVaultNoteKind` and the #1218 live/contract tests were read before
  implementation and remain unchanged.
- No delete/forget semantics, production ports, process launch, or remote
  state were touched.

## Verification-gate repair impact

- `enqueueMemoryVaultLog` callers were traced across
  `memoryVaultWriteService`, `memory_consolidation_drafter`, and
  `memory_vault_log.test.ts`. The function now returns its existing serialized
  promise; all product mutation callers await it, while direct queue tests
  remain compatible with `flushMemoryVaultLog`.
- `findLatestChangeBySourceIdAsync` is used only by the lifecycle mutation
  path. It replaces full-history reads on every append and keeps rollback
  targeting constant-time.
- The lifecycle lock implementation itself was not changed: inspection showed
  its `finally` always releases the gate. The timeout came from recursively
  nested `priorState.verified` payload growth, now replaced by a bounded prior
  verification summary.
