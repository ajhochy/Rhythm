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

- **Memory index dual-writer source_id divergence (follow-up task_c33c6926):**
  the vault-first write path keys the index `source_id` relative to
  `<vault>/memory` (`fact/x.md`) while the rebuild scan keys it relative to the
  vault root (`memory/fact/x.md`). Both recall the note, but a note touched by
  both writers can be double-indexed (two rows). Out of scope for #808; flagged.
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
