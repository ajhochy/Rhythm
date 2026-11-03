---
date: 2026-10-05
repo: Rhythm
branch: codex/memory-search-cloud-auth-20261005
pr: null
issues: []
status: unverified
tags: [run, rhythm]
---

### 2026-10-05 — memory-search-cloud-auth

- Owner: Astra task `01a10e57-1288-7565-a84f-fb7afdff6024`, exclusive route/test ownership acknowledged by builder `01a0fabb-ceb0-75fd-ac7a-6e6be2cb1009`.
- Base: installed source `5da2f764b5f240bb9650c58ce558a32aac2381e1`; isolated checkout under task-4. No running app changes.
- Cause: MCP memory search first POSTs to `/agent-memory/search-select`. Its mandatory `requireAuth` accepted only locally issued sessions. The signed desktop uses a Cloud bearer, accepted by adjacent session/coordinator routes through the existing Cloud-aware identity resolver. Live 23:17 UTC: same bearer received selector401 and root/coordinator200.
- Files modified: `apps/api_server/src/routes/agentMemoryRoutes.ts` selects `requireLocalOrCloudAuth` for the two memory-search entry routes in `AGENT_LOCAL` mode only. Hosted auth, human trust elevation, signatures, owner checks, profiles and grants remain untouched. Added `apps/api_server/src/__tests__/memory_search_cloud_auth.test.ts`.
- Regression before implementation: 13 cases, 5 failed on Cloud identity with401; 8 passed. An initial in-process HTTP harness settlement issue was corrected before recording this red result.
- Checks: `node node_modules/vitest/vitest.mjs run src/__tests__/memory_search_cloud_auth.test.ts src/__tests__/managed_workstream_evidence_capture.test.ts src/contract/local_agent_cloud_token_auth.test.ts --no-file-parallelism`: 3 files / 51 tests passed. `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`: exit0. Logs live in task-4 `auth-red.log`, `auth-green.log`, `auth-typecheck.log`.
- GitNexus impact and detect_changes commands attempted; `.gitnexus/run.cjs` is absent from this source. Manual caller review finds one production factory mount in `app.ts`, plus default export/test callers. Change is restricted to two router middleware positions; shared middleware/service are unchanged. Graph blast-radius confidence remains unavailable.
- Verification limitation: not installed or live-proven. Builder owns composition, the existing isolated API/engine sandbox, signing, activation and the normal-app acceptance sequence. No second runtime was started. After composition, normal signed MCP `rhythm_search_memory` must succeed while missing/invalid bearer and invalid signed-call proofs remain refused. Do not treat a selector-only HTTP probe as full MCP success.
- Deviations: none in requested route scope. User explicitly requested focused affected checks and no broad concurrent stress retest; full unrelated suites were not run.
- Concerns: memory retrieval still has separate Dayflow qualification/expiry handling; foreground context/admission/capability repairs belong to the existing core owner, not this patch.
