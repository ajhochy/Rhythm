---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, Rhythm]
---

## Files

- `apps/api_server/src/shared_agents/bridge/registrar.ts` forwards rejected asynchronous registrar handlers into the Express error boundary. Only a trusted `AUTH_UNAVAILABLE` 503 from bearer resolution becomes the opaque bridge `503 bridge_unavailable`; unexpected failures use the existing opaque 500 handler.
- `apps/api_server/src/__tests__/shared_agents_bridge.test.ts` verifies the real HTTP 503 response, absence of a new grant, preservation of an existing grant generation, and opaque 500 for unrelated resolver errors. The synthetic invalid-token 403 case has an isolated Cloud verifier stub so its contract does not depend on external Cloud availability.
- `tools/dev/sandbox.sh` and `tools/dev/sandbox_auth_fixture_test.sh` add an opt-in, loopback-only auth fixture URL for isolated bridge tests, with explicit bridge fixture and port guards.
- `apps/api_server/src/__tests__/shared_agent_auth_outage_live_e2e.test.ts` is an env-gated sandbox API/engine gate. It requires the approved synthetic fixture, a protected registrar reference and an owned loopback service that resets `/auth/me` connections. It has not yet been run.

## Checks

- Full serial API aggregate before repair: 884 passed files, 1 failed, 185 skipped; 8,827 passed tests, 1 failed, 390 skipped. SA-AUTH-1 timed out at 15 seconds and Vitest captured an unhandled `AUTH_UNAVAILABLE` rejection from `registerGrantHandler`. Log: `/private/tmp/rhythm-api-post-startup-cwd-20261020.log`.
- Isolated original SA-AUTH-1 before repair: 1 passed in 482 ms. Guarded command: `npm run build:guard -- env RHYTHM_LIVE_E2E=0 npm --prefix apps/api_server test --silent -- src/__tests__/shared_agents_bridge.test.ts -t 'SA-AUTH-1 enforces registrar credentials and binds grants to the resolved local id' --fileParallelism=false`.
- New HTTP regression RED before repair: request aborted after 3 seconds with the same unhandled `AUTH_UNAVAILABLE` rejection. The focused guarded Vitest command targeted `returns a bounded 503 without a grant when cloud identity verification is unavailable`.
- Repaired bridge file: 16 passed, 0 failed, guarded serial Vitest. API TypeScript `tsc --noEmit -p apps/api_server/tsconfig.json`: exit 0.
- The new live test is discovered and skipped when its explicit flag is absent: 1 skipped, 0 failures.
- Pure sandbox auth fixture preflight: 20 passed, 0 failed. Existing sandbox copied-data guard: 24 passed, 0 failed. Both ran under `npm run build:guard`.

## Notes

- The original invalid-token test was nondeterministic because it used a real Cloud fallback. The product defect is separate: Express 4 did not forward the rejected asynchronous registrar promise, leaving the HTTP request pending.
- An HTTP 503 from the Cloud upstream is interpreted as an invalid bearer by the current Cloud identity service. The live gate instead uses a loopback connection reset to produce `AUTH_UNAVAILABLE` without contacting an operator account or external service.
- GitNexus reported LOW for the registrar symbols but warned that its index is 309 commits stale; it could not index the shell functions. Manual scope is HIGH because the registrar mints Hermes shared-agent bridge capabilities and the sandbox composes API/engine runtime environment. No production authentication, account, model, or provider source was changed.
- The live API/engine gate, fresh full API aggregate and exact local package checks remain pending; this run does not claim backend completion.
