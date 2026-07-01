---
date: 2026-06-28
repo: Rhythm
branch: worktree-agent-a5d6958c7697ba0fd
pr: pending
issues: [808, 801]
status: verified-pending-pr
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Run — #808 memory guards + smoke (memory epic #801, 7/7, FINAL)

Final guard issue of the memory-vault epic. Test/infra only — **no production
code changed**. Machine-checks the two decision-doc promises (index is
rebuildable/disposable; vault is sole authority) plus the corrected #807
prod-removal constraint and the single-writer / :4001 no-divergence invariant.

## Base

Based on the **local** `Feature/mem-vault` (has #802–#807), not the dispatch's
`origin/feature/mem-vault` (that remote ref only carries #802–#804; the
#805/#806/#807 merges are unpushed). The spec correction's facts — prod store
removed, `/agent-memory` local-only, #807 seed assertion in
`issue_755_role_separation.test.ts` — only hold on the local branch. See
`docs/ai/decisions/2026-06-28-issue-808-base-and-guards.md`.

## Files changed

- `apps/api_server/src/__tests__/memory_vault_authority.test.ts` (new) — three
  guard groups: (a) sole-authority (edit-on-disk + re-index changes recall;
  delete-on-disk + re-index removes it AND leaves no `obsidian-memory` row; a
  FALSIFY proving the re-index enforces it); (b) prod-removal corrected per #807
  (bootstrap creates no `agent_memory` table / no `idx_agent_memory_*` / no index
  ON agent_memory; `/agent-memory` mounted only inside the
  `env.agentExecutionEnabled` gate; local SQLite store intact; migrations
  additive); (c) no-divergence (mcp `index.ts` wires memory tools at
  `RHYTHM_AGENT_URL` default :4001, not `RHYTHM_API_URL`; Flutter
  `agent_memory_data_source.dart` bases on `AppConstants.agentLocalBaseUrl` =
  :4001, never `serverConfig`).
- `apps/api_server/src/__tests__/memory_index_rebuild.test.ts` (extended) —
  "rebuildable guard (#808)": capture `searchAsync` top-N → `clearAllAsync` (drop
  ALL rows) → `rebuildIndexFromVault` → identical top-N (path+content projection;
  row id excluded, it's a fresh UUID per index) + a FALSIFY (removing a vault
  note before rebuild changes the top-N).
- `apps/api_server/scripts/smoke_memory_authority.sh` (new) — boots the bundled
  LOCAL server (`dist/server.js`, `AGENT_LOCAL=true`) on a private port against a
  TEMP vault + TEMP SQLite (`RHYTHM_API_URL` forced bogus); writes via
  `POST /agent-memory`, asserts a vault note + recall, DELETES the SQLite DB file,
  restarts, rebuilds via `POST /agent-memory/sync`, asserts identical recall (by
  an authored MARKER in content). Never touches prod; asserts by id/path, no body
  dump.
- `.github/workflows/desktop_release.yml` — new "Smoke memory vault authority
  (#808 guard)" step after "Smoke-test bundled CLI server", before the Bun/fork
  build.
- `docs/ai/decisions/2026-06-28-issue-808-base-and-guards.md` (new).

## Checks run

- Targeted: `npx vitest run memory_vault_authority memory_index_rebuild
  issue_755_role_separation memory_injection_index` → **51/51**, exit 0.
- Full api_server: `npx vitest run` → **1394/1394**, exit 0 (a prior run flaked on
  `real_server.test.ts`, a keep-alive anti-flake helper sensitive to parallel
  socket contention; passes in isolation; not caused by this test-only change).
- mcp_server no-divergence companion: `npx vitest run agentMemory_local_base` →
  **5/5**, exit 0.
- `npm run build` (tsc) → exit 0.
- Smoke: `bash -n` OK; `bash scripts/smoke_memory_authority.sh dist/server.js` →
  exit 0 end-to-end.
- `desktop_release.yml` YAML lint OK.

## Falsifications (all confirmed, then restored)

1. Re-add a prod `agent_memory` table+index in `postgres_bootstrap.ts` → 2
   prod-removal tests FAIL.
2. Couple the Flutter memory data source to `serverConfig.url` → the
   no-divergence test FAILS.
3. Destroy the vault alongside the index in the smoke → smoke FAILS ("vault is
   not authority").
4. Rebuildable FALSIFY: removing a vault note before rebuild changes the top-N.

## Notes

- Recall identity across a rebuild is asserted by note CONTENT (smoke) /
  path+content (unit), NOT the SQLite row id — `upsertBySourceAsync` assigns a
  fresh `randomUUID()` per (re)index, so the row id is not stable.
- Deviation from the stale issue body: AC3/AC4 said "prod dormant, NOT removed";
  implemented the maintainer correction (assert prod store REMOVED + route
  local-only). The #807 prod-removal seed assertion already exists in
  `issue_755_role_separation.test.ts`; the new file restates the promise from the
  memory suite rather than duplicating the role-gating tests.
- **Follow-up (flagged, out of scope):** the two index writers record different
  `source_id` for the same note — `rememberToVault` keys relative to
  `<vault>/memory` (`fact/x.md`) while `syncMemoryVault` keys relative to the
  vault root (`memory/fact/x.md`). Both recall the note, but a note touched by
  both writers could be double-indexed. Spawned as task_c33c6926.
- **Memory epic #801 is now complete** (all 7 issues #802–#808).
