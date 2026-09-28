---
date: 2026-09-24
repo: Rhythm
branch: codex/1569-s5-vault-safety
pr: null
issues: [1569]
status: synthetic-pass-live-unrun
tags: [run, Rhythm]
---

## Files

- `apps/api_server/src/services/memoryVaultWriteService.ts`: serialize in-process vault mutations, reject unmanaged notes, and use optimistic digest checks before atomic note replacement or deletion.
- `apps/api_server/src/services/memory_vault_index_writer.ts` and `memoryVaultSyncService.ts`: publish navigation indexes and a create-once ownership README atomically; exclude README from note scanning.
- `apps/api_server/src/__tests__/memory_vault_external_edit.test.ts`: synthetic temporary-vault acceptance cases for S5 c1-c7, including managed delete conflict and temporary-HOME Hermes working-file preservation.
- Existing memory tests: exclude the owned README from note counts, observe the atomic rename, and expect unmanaged legacy edit refusal.
- `docs/ai/contracts/issue-1569.json`: only S5 c1-c7 marked passed; all other slices retain their prior status.

## Checks

- Initial S5 contract run: 12 failed, 1 passed (`/private/tmp/rhythm-1569-s5-contract-red.log`).
- Managed delete conflict test before fix: 1 failed; forget resolved after an external edit (`/private/tmp/rhythm-1569-s5-forget-red.log`).
- Kind-move and CRLF-frontmatter tests before fix: 2 failed (`/private/tmp/rhythm-1569-s5-kind-crlf-red.log`).
- `cd apps/api_server && ./node_modules/.bin/vitest run --maxWorkers=2 src/__tests__/memory*.test.ts --reporter=dot`: 36 files, 314 tests passed (`/private/tmp/rhythm-1569-s5-memory-review-final.log`).
- `cd apps/api_server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`: exit 0 (`/private/tmp/rhythm-1569-s5-typecheck-review-final.log`).
- `cd apps/api_server && npm run build`: exit 0 (`/private/tmp/rhythm-1569-s5-build-review-final.log`).
- No real vault, credentials, running backend, or live Hermes process was used. The live behavioral gate was not run.

## Notes

- Digest checks preserve conflicts observed before the final check. A non-cooperating external writer can still edit after the final check and before rename/unlink; this is not a cross-process lock.
- The legacy #886 id-less note edit path now refuses mutation because the note lacks valid Rhythm-managed frontmatter. Read-only scan remains available.
- The kind-change path checks the old source after the race barrier and again before unlink. A late source conflict removes only an unchanged destination created by this operation, then refuses the move. The residual external-writer race remains.

## Integration replay

Parent reviewed every product/test diff and independently replayed 29 targeted tests. After integration, the full memory group passed 36 files / 314 tests, and `npm run build` exited 0. Logs: `/private/tmp/rhythm-repair4/s5-integrated-memory.log` and `s5-integrated-build.log`. An attempted ESLint command could not run because ESLint is not installed; the package's configured lint script is only `echo 'TODO: add eslint'`, so no ESLint qualification is claimed. GitNexus updateMemoryInVault reports one direct caller, three upstream nodes, LOW indexed risk; the index remains stale. Live API/Hermes and combined feature qualification remain pending.
