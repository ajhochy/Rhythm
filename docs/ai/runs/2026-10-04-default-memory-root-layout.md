---
date: 2026-10-04
repo: Rhythm
branch: codex/root-layout-terra-local-20261004
pr: null
issues: []
status: unverified
tags: [run, rhythm, source-only]
---

# Default memory-root layout

## Files

- `apps/api_server/src/services/memoryVaultSyncService.ts` aligns the canonical
  vault-root fallback with the authoritative memory-dir fallback when both
  memory layout variables are absent.
- `apps/api_server/src/__tests__/memory_vault_default_path.test.ts` adds
  synthetic unset-default and map/inverse round-trip coverage, while retaining
  explicit legacy and explicit-empty layout checks.
- `apps/api_server/src/__tests__/memory_retrieval_semantic.test.ts` covers a
  heading-only first native hit followed by a valid multiline, truncated,
  space-containing synthetic candidate.

## Checks

- RED before the source edit:
  `env HOME=/private/tmp/rhythm-root-layout-red.0q24ms/home TMPDIR=/private/tmp/rhythm-root-layout-red.0q24ms/tmp node node_modules/vitest/vitest.mjs run src/__tests__/memory_vault_default_path.test.ts`
  — expected regression failure: 8 passed, 1 failed.
- GREEN focused synthetic suites:
  `env -i PATH=/usr/bin:/bin HOME=/private/tmp/rhythm-root-layout-isolated.fR1gsE/home TMPDIR=/private/tmp/rhythm-root-layout-isolated.fR1gsE/tmp /Users/ajhochhalter/.local/bin/node node_modules/vitest/vitest.mjs run src/__tests__/memory_vault_default_path.test.ts src/__tests__/memory_retrieval_semantic.test.ts`
  — 2 files, 56 tests passed.
- API TypeScript:
  `env -i PATH=/usr/bin:/bin HOME=/private/tmp/rhythm-root-layout-isolated.fR1gsE/home TMPDIR=/private/tmp/rhythm-root-layout-isolated.fR1gsE/tmp /Users/ajhochhalter/.local/bin/node node_modules/typescript/bin/tsc --noEmit --incremental false`
  — exited 0.
- `git diff --check` — exited 0 after the run note was added.

## Notes

- Source base inspected: `afb0fbc21b623a1b894e023af7213427ad1f71a2`.
- Existing GitNexus data was stale and was not rebuilt. The resolver impact was
  HIGH (7 direct / 35 total callers); reviewed callers only derive canonical
  keys from already memory-dir-confined paths.
- This is source-only qualification. The selected tests use fake fetches and
  isolated synthetic filesystem fixtures; no server, app, native service,
  provider, private vault, database, process environment, or private-context
  assembly was accessed.
- No deadline, candidate limit, owner/global filtering, active/injectable
  checks, canonical validation/receipts, fencing, fallback order, or prompt
  query contract was changed.
- No live automatic-injection result is claimed. Runtime/default-configuration
  confirmation and independent review remain outside this run.
