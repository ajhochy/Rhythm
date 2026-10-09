---
date: 2026-10-03
status: BLOCKED — requires human intervention
scope: repository verification environment
---

# Dayflow verification-environment blocker

## Reproduction

`ai-workflow checks --level issue` exits non-zero in the managed task
workspace. Its Flutter analyze/format checks fail because Flutter attempts to
update:

`/Users/ajhochhalter/development/flutter/bin/cache/engine.stamp`

The path is outside the granted writable roots. The API and MCP checks use
`npx tsc --noEmit`; their package lookup fails with:

`ENOTFOUND registry.npmjs.org`

Directly reproducing the same Flutter and `npx` commands produced the same
errors. These failures occur before the Dayflow source can be evaluated by
those workflow steps.

## Needed action

Run the repository workflow checks in an approved environment with a
preinitialized writable Flutter SDK and the frozen project dependencies
available locally, or explicitly authorize the required runtime/network
access. Do not solve this by changing Dayflow source, installing packages, or
relaxing the task’s no-new-app/no-new-testserver constraints.

## Verification already available

The isolated workspace’s direct frozen-dependency checks succeeded:

- API `tsc --noEmit`
- focused Dayflow Vitest suite (41 tests)
- API production build
- web typecheck and production build

The loopback HTTP Dayflow route test is also unavailable in this sandbox
because binding `127.0.0.1` returns `EPERM`; no substitute server was created.
