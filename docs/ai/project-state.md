# Project State

## Current focus

**2026-06-28 — Memory epic #801: memory moves to the Obsidian Memory-Vault as the
single source of truth, served by the LOCAL agent server (:4001) over a disposable
SQLite index.** Progress on `feature/mem-vault`: #802 (MemoryIndexService — vault →
disposable SQLite index), #803 (vault-first `remember` write path), #804 (memory
MCP tools re-routed off the prod Settings URL to :4001), and **#807 (just done) —
removed the prod Postgres `agent_memory` store; memory is now local-vault/SQLite
only**. Remaining: **#808 (guards)**. See
`docs/ai/runs/2026-06-28-issue-807-remove-prod-agent-memory-store.md` and
`docs/ai/decisions/2026-06-28-remove-prod-agent-memory-store.md`.

A separate, earlier batch — **skills unified onto the opencode engine** (issues
unify-1…7, supersedes #777) — is verified and awaiting PR/merge on branch
`feature/unify-skills-source-of-truth`. See
`docs/ai/runs/2026-06-28-unify-skills-source-of-truth.md`.

## Active branch / PR

- **Memory epic (current):** `feature/mem-vault`. #807 implemented + verified on
  worktree branch `worktree-agent-a91a2b4a1a8a49ea9` (commit `665a44203`, **not
  pushed** — worktree subagent). Stacks #802–#807. PR should `Closes #807` (and the
  other epic issues it completes) when opened; **do not merge** before human review.
- **Skills unification (separate, pending):** `feature/unify-skills-source-of-truth`
  (stacked off `fix/issue-775-skill-allowlist-guard`); PR not yet opened, do not
  merge. #775 / PR #776 remains open (smoke PASSED).

## In progress

- Memory epic: **#808 (guards)** is the only remaining issue. Nothing else actively
  coding on the memory branch.
- Awaiting: PR for `feature/mem-vault` (after #808), plus the separate skills-
  unification PR and human merge of #776.

## Risks / known issues

- **Prod role is `all`, not `cloud`:** before #807 the prod image still created the
  Postgres `agent_memory` table. With the CREATE removed, a hypothetical agent-role-
  on-Postgres deploy would 500 on `/agent-memory` — intended (memory is local-only).
- **Inert Postgres branches:** `agent_memory_repository.ts` still has Postgres
  query branches (clearAll no-op, delete). Dead paths (prod never mounts the route;
  local server is SQLite); documented, left for a later cleanup.
- **6 pre-existing failures** in `agent_trigger_watcher_test.dart` (auth-change/F2)
  — unrelated; fail in isolation, no import of changed files.
- Skills batch: visual/live smoke deferred until a signed fork rebuild; managed
  skills dir `~/.config/opencode/rhythm-managed-skills` must not collide with
  `sync-globals` paths; fork binary is gitignored + per-branch (release CI rebuilds).

## Test status

- api_server (#807, on `worktree-agent-a91a2b4a1a8a49ea9`): `tsc --noEmit` exit 0,
  `npm run build` exit 0, full `npx vitest run` **1367 pass / 162 files**. New #807
  source-contract assertion in `issue_755_role_separation.test.ts` falsification-
  verified.
- Skills batch (on `feature/unify-skills-source-of-truth`): api_server vitest
  1344 pass; fork `bun test` skill+tool 20 pass; Flutter `analyze` 0 errors,
  agents widget tests 14 pass.

## Next step

Implement **#808 (guards)** on `feature/mem-vault` to lock in the local-only memory
invariant (assert: no prod `agent_memory` table/index created; no prod-base memory
reads/writes; local SQLite store + `/agent-memory` route intact). Then open the
`feature/mem-vault` PR (draft, no merge) linking the completed epic issues. Separately,
open the skills-unification PR and human-merge #776 + that PR.

## Pending manual smoke (post-merge, against a signed build)

- **Memory epic (#807):** after a build with the local agent server running on
  :4001, confirm the Rhythm Brain / Agent Memory panel still lists, searches,
  creates, and deletes memories against :4001 (no prod calls); confirm a fresh
  install starts with an empty local store (start-fresh, no migration).
- **Skills unification:** Agent Profiles → a profile → Agent Profile sheet:
  (a) Skills picker lists the engine's live skill names; (b) a managed skill shows
  edit/delete + "New skill" round-trips; (c) external skills show no edit/delete;
  (d) MCP picker lists live server names; (e) Settings → Server URL change does not
  affect either picker; (f) a published DB skill appears and a scoped session omits
  out-of-scope skills (#775 intact).
- Carry-over (prior batch): #720 compaction divider, #723 MCP remove/sync, #731
  shell-runner removal, #736 WS tool-gating, #770 Brain mirror-sync, #737 email
  fencing.
