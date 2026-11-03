---
date: 2026-10-06
repo: rhythm
branch: codex/rhythm-mobile-canonical-backend-20261006
pr: none
issues: []
status: source-complete-unverified-composed
tags: [run, rhythm]
---

# Core boundary repair: items 1 and 2 (source only)

Authority: `docs/ai/review/2026-10-06-core-boundary-astra-review.md` and `docs/ai/plans/2026-10-06-core-boundary-reviewed.md` (items 1 and 2 only). **Item 3 (automatic Dayflow bodies/history/manifest representation/fork/WS/mobile) was NOT implemented.** Preserved: frozen C3 `c05bd024…25c7`, core follow-on `65c150c6…c273`, the composed lazy API4 packet (no lazy default/permission/measurement/outer-mcp-dispatch hunk touched), C3 repository outer-commit/outbox/notification/relay source, `decidePermission`, auth routes, Dayflow validation/TTL/renewal/deletion. No commit; no live/engine/server/model/UI/device operation.

## Files (pre/post sha256 in `2026-10-06-core-boundary-repair.sha256`)

New source: `contracts/coordinator_callback_marker.ts`, `utils/generic_memory_admission.ts`.
Changed source: `repositories/model_provenance_repository.ts`, `repositories/coordinator_conversations_repository.ts`, `services/opencode_client_service.ts`, `services/async_delegation_completion_service.ts`, `services/automatic_memory_preface.ts`, `services/memory_retrieval.ts`, `repositories/agent_memory_repository.ts`, `database/db.ts`. (`services/agentMemoryService.ts` needed no change.)
Tests: new `core_boundary_callback.test.ts`, `core_boundary_admission.test.ts`, `core_boundary_admission_pg.test.ts`; Sol's `sol_core_followon_boundary_verification.test.ts` is byte-identical (assertions kept).

## Item 1 — callback durable provenance

- One shared strict marker (`c2_goal_callback:<delegation-id>`, id `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`): `encode`/`parse`/`isCoordinatorCallbackProvenance`. The producer (`coordinatorDelegationCallbackReason`), the provenance insert and the callback lookup (`findDelegationCallbackMcpDispatch`) all use it.
- `ModelProvenanceRepository.insert` accepts the marker ONLY with origin `delegation_completion` + requestedSource `agent_config`; every other reason code keeps the generic shape rule. Marker is shape, never authority: the lookup still re-proves owner/project/root/SDK/cwd, the exact dispatched goal↔delegation↔child, the waking/notified delegation row and the accepted dispatch's late-linked native user message; `routeAuthed` stays null; the callback stays status-only; no startGoal/continuation grant/fake foreground reservation.
- **Concrete late-await gap reproduced and fixed:** with retained history the client awaits the Dayflow guard after the completion service's last overlay recheck; revoking access in that await still sent the stale coordinator contract. New internal-only `coordinator_callback_v1` hook (11th `promptAsync` parameter, valid only with exact marker provenance, routeAuthed null, no managed/foreground) re-runs the overlay's `current()` after the last await and, if stale, settles the dispatch rejected and withholds the whole send (re-prepared from current state on the next flush). Ordinary completions keep the exact historical 8-argument call shape (an earlier draft changed the arity and broke `issue_1123_contract`; fixed before the final run).

## Item 2 — exact decoded generic admission

- `utils/generic_memory_admission.ts` is the one pure policy (JSON.parse + Object.values over decoded values, nested/root/duplicate-key semantics, malformed-literal fallback, keys are not values), extracted verbatim from `automatic_memory_preface`; the JS guard stays as defense.
- `database/db.ts` registers deterministic scalar `rhythm_generic_memory_admitted(source, tags_json, sources_json)` in `initDb` and on every handle given to `setDb` (guarded for partial stand-ins). `agent_memory_repository` replaces the earlier substring SQL with it for list, per-kind count and search (SQLite FTS and LIKE), before LIMIT/OFFSET. Owner/global/lifecycle/kind/rank/order and RAW qualified reads unchanged.
- Retrieval: `prepareAutomaticMemoryPreface` now passes `genericAdmission: true`, threaded in `memory_retrieval` to the lexical lane (`searchAsync` option), the hybrid FTS fallback, the native-reference join (`releaseAdmission`, before the topN slice), link expansion (a withheld link no longer consumes a slot) and the rerank pool (before `RERANK_POOL_MAX`, plus the Engraph rank-only join). Ranking/relevance architecture untouched; `automaticAdmission` remains the final defense.
- PostgreSQL (no migration, function or abstraction): the same policy over ordered finite batches (200 rows × 25 batches = 5,000 candidates) via `admittedWindow`; list/search/count are exact within the bound and otherwise throw `GenericAdmissionScanIncompleteError` — never a partial count, short page or full-looking empty page. The search query gained a deterministic `, id` tiebreak and OFFSET for stable paging.

## Commands and results (repo root)

- `npm --prefix apps/api_server run build` → pass (after the final edit).
- **Red first:** `... sol_core_followon_boundary_verification.test.ts` → 3 failed / 2 passed (escaped value, key-only, callback missing durable row with `Invalid dispatch reason code`); search-starvation and positive foreground identity already passed.
- After repair: Sol file 5/5. `core_boundary_callback.test.ts` 10/10 (its late-await case was red before the hook: stale contract reached the SDK) → green. `core_boundary_admission.test.ts` 10/10. `core_boundary_admission_pg.test.ts` 5/5 (one case corrected: exactly-BOUND corpus is conservatively held). Existing `agent_memory_generic_admission_pagination.test.ts` 6/6.
- Regression group A (client/provenance/lazy): `core_boundary_*`, Sol, pagination, `opencode_client_service` (both files), `lazy_tool_loading_default`, `issue_1576_projection/dispatch_writes/b1_ledger` → 169/170; the one failure, `issue_1576_b1_ledger` "c2 roundtrips…", is a `SELECT *` column-count mismatch from the earlier managed/Dayflow context columns, unrelated to these seams (no column or schema change here).
- Regression group B (coordinator/completion/C3): `coordinator_core_followon`, `coordinator_conversation_{navigation,repository,service}`, `async_delegation_wake_fence`, `issue_1123_contract`, `issue_1575_async_delegation_worktree`, `async_delegation_permission_gate/scope`, `c3_backend_followon`, `mobile_canonical_notification`, `core_boundary_callback`, Sol → 115/115.
- Memory regressions: `memory_retrieval_semantic` 47/48, `agent_memory_import_controller`, `memory_search_cloud_auth` pass; `memory_injection` selected by name (`automatic generic-memory Dayflow admission|buildMemoryPreface|OWNER-SCOPED`) 17/20. The 1 + 3 failures carry the already-classified baseline signature (`memory_ranking` shadow default: retrieval called twice / "Retrieved memory references" format) and were not changed, masked or skipped.
- `git diff --check` → clean. OpenDesign not run. GitNexus unavailable; manual caller review: `promptAsync` call sites (completion service only passes the hook for the prepared callback), `ModelProvenanceRepository.insert` (client `beginDispatch`/foreground/managed paths unchanged), `genericAdmissionOnly` consumers (`agentMemoryService`, retrieval only), `getRelevantMemories`/`expandLinkedMemories` callers (new parameters are optional, trailing).

## Known bounds and honest limits

- **Mac (SQLite):** exact decoded admission before every limit/count/search budget; scalar must exist on the handle (a handle never passed through `initDb`/`setDb` fails closed with "no such function", not an unfiltered read).
- **Hosted (PostgreSQL):** exact only within 5,000 candidates per call; beyond that the request fails with an explicit incomplete error (the controller surfaces it as a normal error). A corpus of exactly 5,000 rows is also held (a full final batch cannot prove exhaustion). No hosted deployment/real-pool proof; tested with a synthetic LIMIT/OFFSET pool. Does not block the Mac release.
- **Native (Engraph) lane:** admission applies when hits are joined to rows, before the topN slice, but Engraph's own hit budget (`NATIVE_REFERENCE_CANDIDATE_LIMIT`) is external ranking and can still be consumed by withheld notes; this was not redesigned. Link-expansion and rerank-pool admission are covered by code path and existing regressions, not by dedicated new cases.
- **Callback source proof vs composed:** proven through the real client provenance insert, real completion service, real repository lookup and the bridge's actual `linkOldestUserMessage` method (the bridge's event loop itself was not driven). Not proven: real engine/fork request, a real model choosing a status tool, composed API, normal app. `routeAuthed:null` unchanged.
- Item 3 (automatic Dayflow bodies/manifest/fork/WS/mobile), calendar and cross-project context remain explicitly unfinished.
