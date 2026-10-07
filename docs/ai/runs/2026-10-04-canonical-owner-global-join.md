---
date: 2026-10-04
repo: Rhythm
branch: codex/owner-join-terra-local-20261004
pr: null
issues: []
status: unverified
tags: [run, rhythm, source-only, memory]
---

# Canonical owner/global join

## Files

- `apps/api_server/src/repositories/agent_memory_repository.ts`
- `apps/api_server/src/__tests__/agent_memory_repository_owner_join.test.ts`

## Change

`findBySourceIdsAsync` now includes null-owner instance-global rows alongside
the authenticated caller's rows only when joining canonical
`obsidian-memory` source IDs. Other sources remain strictly caller-owned for
authenticated requests. Null and undefined callers remain global-only for all
sources. The query continues to return both own and global duplicate rows so
downstream canonical ambiguity rejection remains fail-closed.

## Checks

- Base verified before editing: `69f672005feefe278e7edbda24e9ce6c3c293f1a`.
- GitNexus pre-edit impact, using the registered absolute Rhythm repository:
  `gitnexus impact findBySourceIdsAsync --repo /Users/ajhochhalter/Documents/Rhythm --file apps/api_server/src/repositories/agent_memory_repository.ts --direction upstream --summary-only`
  reported LOW risk, one direct caller, five total relationships. The existing
  index was not rebuilt.
- RED before the source edit, in a fresh `env -i` process with fresh `HOME` and
  `TMPDIR`:
  `node node_modules/vitest/vitest.mjs run src/__tests__/agent_memory_repository_owner_join.test.ts`
  produced the expected four failures: SQLite canonical global join, Postgres
  predicate contract, the synthetic native-to-preface path, and the direct
  canonical join all rejected the global row under the old strict predicate.
- GREEN after the source edit, with the same isolated command shape: four new
  synthetic tests passed. They exercise in-memory SQLite, a bound-parameter
  Postgres pool fake, and a fake native HTTP response through the actual
  repository SQL, canonical file validation, receipt path, and fenced preface
  assembly. The automatic native request remains bounded while the original
  request reaches preface assembly. No server or native process was started.
- Focused existing non-server suites were inspected for listener/process calls
  before execution, then run under fresh `env -i`, `HOME`, and `TMPDIR`:
  `node node_modules/vitest/vitest.mjs run src/__tests__/agent_memory_repository_owner_join.test.ts src/__tests__/memory_retrieval_semantic.test.ts src/__tests__/memory_lifecycle_index.test.ts src/__tests__/memory_vault_authority.test.ts src/__tests__/workstream_artifact_verifier.test.ts src/contract/issue_1219_memory_provenance.test.ts`
  Result: 75 of 76 tests passed. The sole failure is an unrelated stale static
  route-string assertion in `memory_vault_authority`; it expects the old router
  variable form while the checked-in application uses the current factory form.
  It was not changed in this bounded repair.
- Isolated type check passed:
  `node node_modules/typescript/bin/tsc --noEmit --incremental false`
- `git diff --check` passed.

## Limits

This is source-only, synthetic-fixture evidence. No private vault, database,
environment, provider, native service, API, application runtime, server, or
model proof call was accessed. No deployment, commit, index rebuild, or
ownership reassignment occurred. Consequently this run is unverified for live
automatic injection; runtime qualification remains for the supervising review
and approved normal-builder workflow.
