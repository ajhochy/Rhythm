# Project State

## Current focus

**2026-06-28 — Memory-vault rebuild COMPLETE (epic #801, all 7 issues
#802–#808).** Agent memory is now local-vault-only: the Obsidian Memory-Vault is
the single source of truth, the SQLite `agent_memory` + `agent_memory_fts` store
is a disposable index fully rebuildable from a vault scan, the vault-first write
path writes the note before the index, per-prompt injection reads the index
(works with Obsidian closed), the prod Postgres `agent_memory` store was removed
(start-fresh, no migration) and `/agent-memory` is local-only behind the
`env.agentExecutionEnabled` gate (served on :4001), and both the memory MCP tools
and the Flutter memory data source resolve to localhost:4001. #808 (final) adds
the guards that make all of this machine-checked: rebuildable index, vault sole
authority, prod-store-removed, and no-divergence, plus a local-only smoke wired
into release CI. See `docs/ai/runs/2026-06-28-issue-808-memory-guards.md`.

A separate, prior track (skills unified onto the opencode engine,
`feature/unify-skills-source-of-truth`, `Closes #777`) is still awaiting human
review/merge — see `docs/ai/runs/2026-06-28-unify-skills-source-of-truth.md`.

## Active branch / PR

- **Memory epic:** integration branch `Feature/mem-vault` carries #802–#807;
  #808's guards are committed on worktree branch
  `worktree-agent-a5d6958c7697ba0fd` (@ d3922d762) based on `Feature/mem-vault`.
  `Feature/mem-vault` is **not yet pushed** to `origin` (the remote
  `feature/mem-vault` ref only has #802–#804). No PR open yet for the epic; **do
  not merge** — human review + manual smoke first.
- **Skills unification:** `feature/unify-skills-source-of-truth` — PR pending
  against `main` (`Closes #777`); do not merge. Stacked over #775 / PR #776.

## In progress

- Nothing actively coding on the memory epic — #808 is verified, pending the
  push of `Feature/mem-vault` + a PR.
- Awaiting human review/merge of the skills-unification PR and PR #776.

## Risks / known issues

- **Memory index dual-writer source_id divergence (follow-up task_c33c6926) —
  RESOLVED** on worktree branch `worktree-agent-a14e04ea39cb3021b` (based on
  `Feature/mem-vault` @ 755070279, not yet pushed/merged). Both index writers now
  stamp the ONE canonical VAULT-ROOT-relative key (`memory/fact/x.md`) via shared
  helpers in `memoryVaultSyncService.ts`; the write path's returned
  `RememberResult.path` is now that canonical key too. See the run entry below.
- **#808 base / push ordering:** the prod-removal guard asserts the #807 state.
  If `origin/feature/mem-vault` (the older #802–#804 ref) is pushed/merged
  *without* #805–#807, the guard will correctly FAIL until those land — intended
  safety behaviour, not a guard bug. Push `Feature/mem-vault` (the #802–#807
  branch) as the epic base.
- **Flaky `real_server.test.ts`** in the full api_server suite (keep-alive
  anti-flake helper, parallel-socket contention) — passes in isolation; verified
  full run was 1394/1394. Not memory-related.
- Skills-unification visual/live smoke deferred (needs a signed fork rebuild).
- **6 pre-existing failures** in `agent_trigger_watcher_test.dart` (auth-change/F2)
  — unrelated; fail in isolation; follow-up spawned earlier.

## Test status

- api_server: `npm run build` (tsc) exit 0; full `npx vitest run`
  **1394 pass**. #808 targeted set
  (`memory_vault_authority memory_index_rebuild issue_755_role_separation
  memory_injection_index`) **51 pass**.
- mcp_server: `agentMemory_local_base` **5 pass** (memory tools resolve to :4001).
- Smoke: `smoke_memory_authority.sh` passes end-to-end against the bundled
  `dist/server.js` (local-only; temp vault + temp SQLite; never prod) — wired
  into `desktop_release.yml`.
- Falsifications confirmed for all four #808 guards (re-add prod table; couple
  Flutter to serverConfig; destroy vault in smoke; drop a vault note before
  rebuild).

## Next step

Push `Feature/mem-vault` (#802–#808) and open the epic PR against `main` with
`Closes #801, #802, #803, #804, #805, #806, #807, #808` (draft, **no merge**) —
then human review + manual smoke against a signed build. The
`feature/unify-skills-source-of-truth` PR (`Closes #777`) and PR #776 remain open
for human merge on their own track.

## Recent coding-agent runs

### 2026-06-28 — fix: canonicalize memory source_id to vault-root-relative (#802+#803, follow-up task_c33c6926)
- Files modified:
  - `apps/api_server/src/services/memoryVaultSyncService.ts` — added shared helpers `toVaultRelativeKey(vaultRoot, abs)` and `vaultKeyToMemoryDirRelative(memoryDir, key)` so both index writers compute the ONE canonical vault-root-relative key (e.g. `memory/fact/x.md`).
  - `apps/api_server/src/services/memoryVaultWriteService.ts` — write path now stamps the index `sourceId` and returns `RememberResult.path` as the canonical vault-root-relative key (FS ops + path-traversal guard still memory-dir-confined, unchanged); `forgetFromVault` maps the incoming canonical key back to a memory-dir-relative path before the boundary guard (absolute/traversal inputs still rejected).
  - Tests: `memory_write_vault_first.test.ts` (vault-root-aware `fileFor`/`allNoteFiles`; new "source_id canonicalization — write & rebuild agree" describe with 2 tests), `memory_injection_index.test.ts` + `memory_vault_authority.test.ts` (file-access now joins `vaultRoot`, since `result.path` is canonical).
- Checks run: targeted memory set (`memory_write_vault_first memory_index_rebuild memory_vault_authority memory_injection_index memory_consolidation_seed`) **50 pass**; `npm run build` (tsc) **exit 0**; full `npx vitest run` **1396 pass / 165 files**.
- Falsification: reverting the write key to `relPath` (memory-dir-relative) makes the new "write then rebuild = one row, identical source_id" test FAIL (write key `fact/x.md` ≠ canonical `memory/...`, and post-rebuild row ≠ `result.path`), plus the forget/file-access guards fail — proving the assertions are load-bearing.
- Decisions made: canonical key = vault-root-relative (matches the scan/rebuild path + MemoryIndexService's documented contract); the memory dir stays the FS path-traversal boundary. See `docs/ai/decisions/2026-06-28-memory-source-id-canonical-key.md`.
- Deviations from spec: none. (Spec suggested updating the write path's `sourceId`; the cleanest single-form fix also required making `RememberResult.path` canonical so the index `source_id` and the client-facing path can't diverge — covered by the existing `hit.sourceId === result.path` contract in `memory_injection_index`.)
- Concerns: pre-existing unused import `MEMORY_VAULT_SOURCE` in `memoryVaultWriteService.ts` left as-is (out of scope; tsc tolerates it). Branch is NOT pushed.
