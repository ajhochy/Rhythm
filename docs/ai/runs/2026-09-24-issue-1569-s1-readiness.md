---
date: 2026-09-24
repo: Rhythm
branch: codex/1569-s1-readiness
pr: null
issues: [1569]
status: pending
tags: [run, rhythm, issue-1569, s1]
---

# #1569 S1 names-only readiness reader

## Files

- `apps/electron/src/hermes-accounts.mjs`: new main-only static OpenCode API extractor and value-free Hermes readiness inspector. No main/preload IPC, grant mutation, child env injection, UI, or S2 policy wiring.
- `apps/electron/test/hermes-accounts.test.mjs`: synthetic temporary HOME/Hermes/grants stores for eight S1 criterion IDs (ten focused tests), including symlinked parent/path, owner mismatch, descriptor replacement, unknown auth version, SQLite non-open, secret/fingerprint absence and write-capable-open/mutation instrumentation.
- `apps/electron/test/hermes-keychain-source.test.mjs`: explicit, separate source confirmation requiring `HERMES_SOURCE_ROOT`; normal Electron CI does not depend on an adjacent fork checkout.
- `docs/ai/contracts/issue-1569.json`: S1 test paths/command/reasons updated. S2–S7 remain pending; S1 statuses remain pending because no integrated consumer is wired.

## Checks

- Pre-implementation `cd apps/electron && node --test test/hermes-accounts.test.mjs`: **RED, 0/8**, all expected `ERR_MODULE_NOT_FOUND`; `/private/tmp/rhythm-1569-s1-contract-red.log`.
- `cd apps/electron && HERMES_SOURCE_ROOT=/private/tmp/hermes-1569-s3 node --test test/hermes-accounts.test.mjs test/hermes-keychain-source.test.mjs`: **11/11 pass** after implementation. Normal focused S1 test alone passed **10/10**.
- The source-qualification test confirmed the same `Claude Code-credentials` service in Rhythm `credentials_bridge_service.ts` (SHA-256 `122219206d784be34c7d43db2d3d01ba42e7dcd562cd081367a31e72ab709ced`) and reviewed Hermes `agent/anthropic_adapter.py` (SHA-256 `bba026b747cc10c5a95d85a1384b5fd30a05ec8c00f0c23556d938eb406f3639`). An explicit checkout path is required for that separate check; its absence fails visibly rather than silently skipping.
- `node --check` on new source and both tests, contract JSON parse/criteria count, and `git diff --check`: pass.
- `cd apps/electron && npm test`: **134 pass / 9 fail**. This worktree lacks installed Electron dependencies (`@electron/fuses`, executable) and built `apps/web/dist`; those missing prerequisites explain the failure excerpts. `npm run typecheck` could not start because `tsc` is not installed in this worktree. A fallback TypeScript binary from the primary checkout with explicit type roots reported **no error in the new module**, but failed on existing Electron dependency/type resolution in this dependency-less worktree; it is not a passing package typecheck. No dependency installation, native app, or server was run.
- S1 security repair: parent-symlink swap at open reproduced with `node /private/tmp/rhythm-repair4/s1-parent-race-review.mjs` (`symlinkParentAccepted:true` before, `false` after). New focused tests first failed on parent swap and quoted empty dotenv values; after repair, `HERMES_SOURCE_ROOT=/private/tmp/hermes-1569-s3 node --test test/hermes-accounts.test.mjs test/hermes-keychain-source.test.mjs` passed **13/13**. `node --check src/hermes-accounts.mjs` and `git diff --check` passed. Growth-after-`fstat` fixture rejects descriptor `readFileSync`, instruments a bounded `readSync`, and passed after repair.

## Notes

The reader uses `O_RDONLY | O_NOFOLLOW` (when available), `lstat` for each component beneath its trusted root, owner/type/1 MiB bounds, then `fstat` device/inode/owner checks before consumption and a second descriptor/path identity and size check after reading. Symlinked file/parent, swapped inode, foreign owner and oversized files fail closed. The source never opens a store with write flags and contains no write/rename/unlink or SQLite path. Synthetic credential stores retained both hashes and inode numbers; the instrumented inspection observed zero write-capable opens, writes or renames. The main-only extractor returns approved static keys ephemerally for future broker work; the inspector returns names/states only and never claims a key is applied to a child.

Repair detail: the read now rechecks the root and every component's type/device/inode after descriptor access, and reads at most 1 MiB plus one byte through the descriptor. This catches a parent symlink left in place at open and file growth beyond the cap. Hermes' `_parse_env_value` removes paired single or double quotes, so `''` and `""` are treated as empty. A hostile process that swaps a path and restores it between checks remains a limitation of Node's path-based API; this reader does not provide an `openat`-style directory-descriptor guarantee. The repository's GitNexus index is stale and predates this untracked module: impact for `safeRead` returned target not found, while `envNames` resolved an unrelated fork symbol. No reliable indexed blast radius was available.

S1 does not implement grants, sender/confirmation IPC, S2 broker behavior, S3 fork callback, S4 UI or S7 live/installed qualification. The c2 grant-persistence clause, full c4 applied-state lifecycle and all later-slice acceptance remain pending. No real credentials, profile files, network calls, server, commit, push or deployment were touched.

## Integration replay

Parent independently reviewed all source and tests, reproduced the folder-swap defect before repair, and verified its repaired refusal. In the mega integration checkout, the portable reader suite passed 12/12, the explicit source confirmation passed 1/1, the required Electron suite (now including the reader) passed 180/180, and Electron typecheck exited 0. Logs are in `/private/tmp/rhythm-repair4/s1-integrated*.log` and copied to the durable repair4 evidence directory. The new reader has no production consumer yet; its only current callers are tests. GitNexus could not index the new symbol (`inspectHermesAccounts` not found), so indexed impact remains unknown. This is a tested foundation slice, not completed credential sharing or installed qualification.
