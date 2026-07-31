---
date: 2026-07-30
repo: Rhythm
status: triaged
priority: P2
tags: [issue, Rhythm, test-flake, api-server]
---

# Stabilize intermittent agent-designs finished-artifact 404

## Failure

The PR-level repository gate intermittently fails the table-driven
`agent_designs.test.ts` finished-artifact acceptance test. One full run returned
HTTP 404 for the built-in `.tif` case while the surrounding extensions passed.

## Repro command

```bash
cd apps/api_server
npm test -- --fileParallelism=false
```

## Expected

Every supported finished-artifact extension, including `.tif`, returns HTTP 201
and the normalized artifact type.

## Actual

One PR-gate run returned 404 for `.tif`. The exact full-suite command then
passed 441 files and 3,695 tests, and the isolated file passed all 31 tests.
The failure is not reproducible deterministically.

## Relevant output

`agent_designs.test.ts:241` expected 201 and received 404 for
`accepts built-in finished tif output`.

## Likely cause

Intermittent full-suite test-harness state or real-server lifecycle leakage.
The ownership branch does not modify agent-design routes, artifact validation,
database schema, or the test helper, and both exact and isolated reruns pass.
The unexpected 404 response body and responsible middleware have not yet been
captured, so a product-code diagnosis would be speculative.

## Likely files

- `apps/api_server/src/__tests__/agent_designs.test.ts`
- `apps/api_server/src/__tests__/helpers/real_server.ts`
- `apps/api_server/src/app.ts`
- Agent-design route/controller error mapping

## Required fix

Instrument the failing assertion to capture the response body and route/error
identity on failure, then run a bounded repeated full-suite stress test. Fix the
identified shared-state or lifecycle leak; do not merely retry in CI or weaken
the 201 assertion.

## Required tests / evaluation

- Reproduce with the serial full API suite and retain the first response body.
- Run the isolated file repeatedly before and after the fix.
- Run the full PR gate without retry-based masking.
