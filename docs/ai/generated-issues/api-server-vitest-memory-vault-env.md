# API-server Vitest inherits an empty memory-layout selector

## Failure

The unqualified API-server Vitest gate fails 18 memory-vault tests when the
host exports `MEMORY_VAULT_SUBDIR=`.

## Repro Command

```bash
cd apps/api_server
npm test --silent
```

## Expected

The suite must use the legacy `<vault>/memory` layout constructed by its memory
tests, independent of the developer shell's layout setting.

## Actual

Six suites fail because an explicitly empty selector makes the application use
the clean layout; result paths are `fact/...` while tests expect `memory/fact/...`.

## Relevant Output

`18 failed, 2677 passed`; setting `MEMORY_VAULT_SUBDIR=memory` yields `2695
passed, 0 failed`.

## Likely Cause

Test fixtures do not pin the layout variable, so the inherited clean-layout
selector changes their contract.

## Likely Files

- `apps/api_server/src/__tests__/memory_write_vault_first.test.ts`
- `apps/api_server/src/__tests__/memory_vault_authority.test.ts`
- `apps/api_server/src/__tests__/memory_injection_index.test.ts`
- `apps/api_server/src/__tests__/memory_merge_on_capture.test.ts`
- `apps/api_server/src/__tests__/memory_update_edit_in_place.test.ts`
- `apps/api_server/src/__tests__/memory_consolidation_drafter.test.ts`

## Required Fix

Owner: API-server test maintainer. Pin and restore `MEMORY_VAULT_SUBDIR=memory`
inside the legacy-layout test fixtures (or centrally for that test class); do
not change runtime clean-layout behavior.

## Required Tests / Evaluation

Run the six affected suites and the full API gate with an externally empty
`MEMORY_VAULT_SUBDIR` value; both must pass.
