# Follow-up: flaky `tasks_controller.test.ts > GET /tasks?overdue=yes returns 400`

**Type:** test-infra flake (pre-existing) · **Priority:** low · **Discovered:** 2026-06-24 during the agent-scoping run (P0–P3 verification-gate).

## Symptom
Intermittently (~1 in 7 full-suite runs, observed once via `ai-workflow checks --level pr`), `tasks_controller.test.ts > GET /tasks?overdue=yes returns 400` fails with `expected 200 to be 400` — the `overdue` query validation (`src/controllers/tasks_controller.ts:84-93`) does not fire, so the request is accepted instead of rejected. Did **not** reproduce in 7 consecutive `npm test` runs afterward; passes 26/26 in isolation.

## Not caused by the agent-scoping work
None of the P0–P3 changed files (`agent_profile_scope.ts`, `agent_runner.ts`, `ws_gateway.ts`, `skill_retrieval.ts`, `agent_profile_sync.ts`, migrations test) touch tasks routing/validation. The flake is order/parallelism dependent and pre-existing.

## Likely root cause (lead)
`tasks_controller.test.ts` (`beforeAll`, ~line 150) calls `setDb(makeDb())`, mutating the **module-level `_db` singleton** in `src/database/db.ts`, and spawns a real HTTP server via `createApp().listen(0)`. Other integration test files do the same. Under vitest's parallel file scheduling, the shared `_db` singleton (and/or `listen(0)` servers) can bleed state across files, so a request occasionally resolves against unexpected state and the validation path is bypassed.

## Suggested fix (for whoever picks this up)
- Make integration tests that use `setDb` restore the prior db in `afterAll`, or run HTTP-server integration files with `--no-file-parallelism` / a dedicated pool, or inject a per-test DB rather than the module singleton.
- Add a deterministic repro by forcing a fixed `--sequence.seed` that reproduces the failing order before fixing.

## Acceptance
- The test passes deterministically across ≥20 consecutive full-suite runs (or with a seeded order that previously failed).
- Root cause (shared `_db` singleton vs. parallel servers) documented in the fix.
