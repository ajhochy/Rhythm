---
date: 2026-10-06
repo: rhythm
branch: codex/rhythm-mobile-canonical-backend-20261006
pr: none
issues: []
status: source-complete-unverified-in-app
tags: [run, rhythm]
---

# Core follow-on: four Astra-accepted fixes (source only)

Plan `docs/ai/plans/2026-10-06-core-followon-reviewed.md`; review `docs/ai/review/2026-10-06-core-followon-astra-review.md`. Same persisted owner as the C3 turn; C3 hunks and the frozen `decidePermission`/async-permission hunks are untouched. No commit. No app/server/model/SDK/device operation.

## Files

Pre/post sha256 for every file: `2026-10-06-core-followon.sha256`. Source: `services/coordinator_conversation_service.ts`, `repositories/coordinator_conversations_repository.ts`, `services/async_delegation_completion_service.ts`, `server.ts` (one wiring block), `repositories/agent_memory_repository.ts`, `services/agentMemoryService.ts`. `controllers/agentMemoryController.ts` needed no change (identical hash). New tests: `coordinator_core_followon.test.ts`, `agent_memory_generic_admission_pagination.test.ts`. `agentMemoryRoutes.ts`, raw Dayflow producers/validation and admission/grants untouched.

## Behavior

1. **Direct capture.** `ordinaryForegroundGoalCandidate` (now exported as a test seam) recognizes `fix|implement|update|test` in the direct, "I/we need you to", and polite-question forms through one shared verb list. `update me` stays chat. Question/status/greeting exclusions, exact authored text and command-key replay are unchanged. Capture is not admission.
2. **Outcome projection.** `listGoalDelegationOutcomes` (bounded 64, read-only) joins each DISPATCHED goal delegation to the existing delegation row and child, re-proving current owner/project/primary root/profile/SDK (`parentSdkSessionId`), exact delegation↔child link, target profile and child parent/owner/project. Outcomes: `running`, `returned_result_unverified` (returned, no error), `failed`, `cancelled`, `unknown` (unprovable — never success). No bodies. The service shows it as `childOutcome`/outcome counts and includes qualified outcome identities in BOTH freshness fingerprints, so a change is detected with `controlRevision` unchanged. The foreground contract now states the start control is plan-root-only and the callback is status-only.
3. **Callback context.** `prepareCallbackContext` (service) derives scope from durable records, requires the dispatched command to match delegation/child/SDK, re-proves after the context-assemble await, and returns `{system, current()}`. `AsyncDelegationCompletionService` (via `setCoordinatorCallbackContext`, wired in `server.ts`) prepares it plus `prepareAutomaticMemoryPreface` ONLY for the single bound child, re-runs `current()` after both awaits, and appends to the actual `promptAsync` `system`. A stale scope drops the overlay; the wake, `routeAuthed:null`, callback reason code, idempotency and unknown-delivery paths are unchanged. No fake reservation/native message.
4. **Memory pagination.** A SQL form of the generic Dayflow admission (`source`/`tags_json`/`sources_json` case-insensitive substring) is applied before `LIMIT/OFFSET` in list, per-kind counts and search (SQLite FTS + LIKE fallback + Postgres). The service passes it and keeps the JS predicate. Raw `listAsync`/`countByKindAsync`/`searchAsync` without the option are unchanged.

## Checks (repo root)

- `npm --prefix apps/api_server run build` → pass (after the final edit).
- `... coordinator_core_followon.test.ts` → 10/10 (first run: 5 completion cases failed on the fixture's missing runnable profile and two assertion collisions; fixed in the test only).
- `... agent_memory_generic_admission_pagination.test.ts` → 6/6. **Red→green:** with the service not passing the option, 3/6 failed (limit-1 list returned `[]`, offset pages shifted, search shortlist `[]`); restored → 6/6.
- `... coordinator_core_followon, agent_memory_generic_admission_pagination, mobile_canonical_notification, coordinator_conversation_{navigation,service,repository}` → 56/56.
- `... async_delegation_wake_fence, issue_1123_contract, issue_1123_stream_bridge, issue_1575_async_delegation_worktree, agent_memory_import_controller` → 25/25.
- `git diff --check` → clean.
- NOT run, on instruction: `memory_retrieval_semantic`, `memory_injection` (the four reproduced baseline memory failures live in that suite), OpenDesign checks. The signed-boundary regression file was not identified in this tree, so it was not separately run.

## Honest scope

- New start control remains **plan-root-only**; the callback is **status-only** and cannot start another goal. The ordinary lane is one approved Coding Workflow child plus an automatic root review/report; further workflow execution happens inside that child under existing policy. The finite next ordinal remains separately admitted bounded authority. Callback status is not automatic follow-up execution; memory decomposition is not coding.
- `returned_result_unverified` ≠ verified criterion; `unknown` ≠ `failed`.

## Source-only remaining proof / known limits

- No real model/tool dispatch, bridge `linkOldestUserMessage` binding, persisted root response, or builder composed proof. The completion source test stubs only the SDK client and memory retrieval; `routeAuthed:null` is unchanged, and no missing native-identity seam was identified or altered.
- `memory_retrieval.ts` (`searchAsync` at ~460 then `automaticAdmission` post-filter) has the same shortlist shape for AUTOMATIC injection; it is outside the four permitted files, so it is unchanged. Reported as a seam for Astra/Root.
- The SQL admission is a conservative substring test (also withholds a marker that appears only in a JSON key); a marker visible only after JSON decoding (e.g. escaped letters) is still removed by the retained JS filter, which can shorten that one page. No unbounded fetch; no scan-bound-as-empty path was added.
- Replay of foreground goal capture is covered by existing tests, not re-tested here.
- GitNexus: no MCP tools in this session; no reindex. Callers reviewed by hand: `ordinaryForegroundGoalCandidate` (one call site), `foreground*Fingerprint` (contract/current), `agentMemoryService.list/search/countByKind` (controller only; MCP/other callers use the same service), `flushParentLocked` (single enqueue site).
- Denied shell forms this turn (brace/compound/pipe/`sed -i`) were avoided via dedicated tools; no allowed test command was denied.
