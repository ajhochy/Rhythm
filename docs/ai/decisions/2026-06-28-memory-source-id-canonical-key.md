---
date: 2026-06-28
tags: [decision, rhythm]
---

# Memory index `source_id` — one canonical vault-root-relative key

## Context

Memory epic #801 has two programmatic writers of the derived SQLite index, and
they keyed the same note differently:

- **Scan/rebuild path** (`scanVaultNotes` → `MemoryIndexService.rebuildIndexFromVault`)
  scans from the VAULT ROOT (`resolveMemoryVaultPath()`), so `source_id =
  path.relative(vaultRoot, note)` → e.g. `memory/fact/x.md` (notes live under
  `<vault>/memory/<kind>/`). This matches `MemoryIndexService`'s documented
  contract ("keyed on the vault-relative note path").
- **Vault-first write path** (`memoryVaultWriteService`, #803) writes under
  `resolveMemoryDirPath()` (= `<vault>/memory`) and stamped `source_id` relative
  to the MEMORY dir → e.g. `fact/x.md`.

A note touched by both writers therefore got two rows under two `source_id`s,
and `forget`/`removeNote` keyed on one form could miss the row keyed on the
other (flagged as follow-up task_c33c6926; discovered during #808).

## Decision

Canonicalize `source_id` to **ONE form everywhere: vault-root-relative**
(`memory/fact/x.md`) — the form the scan/rebuild path already uses and the form
`MemoryIndexService` documents.

- Added two shared helpers in `memoryVaultSyncService.ts` (the key authority,
  alongside `MEMORY_VAULT_SOURCE` and the scan):
  - `toVaultRelativeKey(vaultRoot, absNotePath)` — the canonical key.
  - `vaultKeyToMemoryDirRelative(memoryDir, vaultRelKey)` — inverse, for the
    memory-dir-confined write/delete boundary guard (vault root =
    `path.dirname(memoryDir)`).
- The write path computes its index `sourceId` (and the client-facing
  `RememberResult.path`) via `toVaultRelativeKey`. All filesystem work and the
  path-traversal guard stay confined to the memory dir, unchanged.
- `forgetFromVault` maps the incoming canonical key back to a memory-dir-relative
  path before the existing boundary guard; absolute/traversal inputs are still
  rejected.

`RememberResult.path` became canonical too (not just the index key) because the
index `source_id` and the path returned to the client must not diverge — the
`memory_injection_index` contract asserts `hit.sourceId === result.path`
directly.

## Alternatives

- **Keep `result.path` memory-dir-relative, canonicalize only the index key.**
  Rejected: it would re-introduce a second form (the returned path vs the index
  key), breaking the `hit.sourceId === result.path` contract and inviting the
  same drift class the fix is meant to close.
- **Canonicalize to memory-dir-relative instead** (`fact/x.md`). Rejected: the
  scan/rebuild path cannot know the memory subdir without extra coupling, and it
  would contradict `MemoryIndexService`'s documented vault-relative contract.

## Consequences

- Write-then-rebuild yields exactly ONE `agent_memory` row at one `source_id`;
  `forget`/`removeNote` match it. New regression tests in
  `memory_write_vault_first.test.ts` assert this and the cross-path key identity;
  falsification (revert write key to memory-dir-relative) fails them.
- Tests that locate the on-disk note now join the canonical `result.path` against
  the VAULT ROOT (not the memory dir).
- The two writers route their key through shared helpers, so they cannot drift
  apart again silently.
