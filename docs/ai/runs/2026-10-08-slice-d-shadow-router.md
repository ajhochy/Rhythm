---
date: 2026-10-08
repo: Rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: null
issues: [slice-d]
status: ready_for_verification
tags: [run, Rhythm]
---

## Scope / approvals

Assigned Slice D only: shadow first-prompt log guard, would-be concrete catalog selection, non-downgrading uncertain tier fallback, bounded System One failure cause, stale Auto-mode comment, unit tests. No commits/push/install, servers/sandbox/ports, host settings/env changes, migrations, runner/dayflow edits. Test-local existing configuration fixtures are isolated and restored. Required developer run logging takes precedence over user docs exclusion; only this run note is added. Live API/engine verification is NOT RUN because the user explicitly prohibits servers/sandbox; this handoff is unit-level readiness, not live completion.

## Phase 0 — RED

Acceptance contracts are the D1/D2/D3/D4/D6-named tests and extended shadow session/mobile tests; D5 is comment inspection, D7 is exact command validation.

Command (in apps/api_server):
`npx vitest run src/services/decision/model_router.test.ts src/services/decision/turn_routing.test.ts src/services/decision/model_catalog_routing.test.ts --no-file-parallelism`

Before implementation: exit 1, `Test Files 3 failed (3)`, `Tests 16 failed | 47 passed (63)`, `Duration 9.65s`.
Behavioral failures (not import/harness errors): continuation reason was `shadow` instead of `shadow_continuation`; wrapper classifier called 2 times rather than 1; frontier fallback returned/chose standard; shadow log omitted catalog/pickedModel/catalogLatencyMs and shadow_catalog_error; request_failed log omitted ECONNREFUSED/ENOTFOUND/ETIMEDOUT/unknown cause.

## Phase 1 — intended surface / CLI impact

All commands use `gitnexus impact <symbol> --direction upstream --repo /Users/ajhochhalter/Documents/Rhythm-pr-worktrees/scheduled-dayflow-memory-router-20261008`.

- routeTurnTier: LOW, exact, 0 direct/total, 0 processes/modules. Graph misses callers confirmed by supplied trace and inspected turn/mobile composition; test those paths explicitly.
- choose: initially ambiguous (6 matches); resolved using `--uid 'Method:apps/api_server/src/services/decision/systemone_client.ts:SystemOneClient.choose#3'`: LOW, lower-bound interface dispatch, 2 direct, 5 total, 0 processes, 1 module. Direct: testSystemOne and classifyWithChoice; indirect testConfig, routeTurnTier, agent_decisions_routes. Additive failure metadata only, timeout and other status semantics preserved.
- hasDecisionForSession: not found (new additive helper), no existing dependents. Read-only parameterized SELECT; Postgres/read failures return false.
- recordDecision (review only, unchanged): LOW, 4 direct/6 total, 0 processes, 2 modules. Callers capacity routing, model routing, tool ranking, memory retrieval; no changes to shared write behavior.
- classifyWithChoice (review only, unchanged): LOW, 1 direct/total (routeTurnTier), 0 processes, 1 module. Failure result already passes through unchanged.
- RouteTurnTierInput (comment only): MEDIUM, 4 direct imports/62 total, 0 processes/modules; decision_calibrate, agent_runner, turn_routing, decision_config_service. No interface shape change.
- ChoiceResult: not indexed; additive optional failure cause only; choose-method analysis covers its concrete production surface.

Read intended modules and composing tests before choosing implementation. turn_routing/routing_scope/model_catalog production code need no changes. Existing pins precede guard/catalog work. Log-based suppression is shadow + first_prompt + sessionId only; on mode stays timestamp-managed. Fixed-source agent_default callers get the same central guard. No HIGH/CRITICAL rating.

## Files / checks / handoff

### Phase 0 additional mobile RED

`npx vitest run src/__tests__/mobile_routing_scope.test.ts -t 'shadow mode' --no-file-parallelism`: exit 1, `Test Files 1 failed (1)`, `Tests 1 failed | 10 skipped (11)`, `Duration 2.25s`. Observable failure: two classifier calls instead of one through the real mobile proxy composition with external engine/fetch boundaries faked.

### Phase 2 implementation

- decision_log.ts: new parameterized read-only existence helper, SQLite-only; fail-open on read error/Postgres.
- model_router.ts: central shadow + first_prompt + session guard; same catalog pick path for usable/gate-eligible shadow turns, log-only diagnostics/error/timing; frontier baseline preserved under uncertain standard policy; failure cause carried to detail; unset Auto comment corrected to shadow. No session timestamp/model/account writes.
- systemone_client.ts: optional failure cause, strictly whitelist ECONNREFUSED/ENOTFOUND/ETIMEDOUT/unknown from code/cause.code/name, never exception messages or bodies. Existing abort/timeout classification unchanged.
- model_router.test.ts, turn_routing.test.ts, model_catalog_routing.test.ts, mobile_routing_scope.test.ts: executable D1–D4/D6 contracts. Real SQLite migrations, log reads, session repository, tier/classification/scope/catalog functions run; only external engine/quota/fetch are faked. Catalog picker spy is observation-only (no replacement implementation).

### Repair loop / exact checks

All validation commands run in `apps/api_server`; no install/build/server/sandbox command was run.

Attempt 1:
`npx vitest run src/services/decision src/__tests__/mobile_routing_scope.test.ts --no-file-parallelism`
Exit 1: `Test Files 1 failed | 19 passed (20)`, `Tests 2 failed | 277 passed (279)`, `Duration 22.59s`.
Both failures were test-boundary assumptions: curation warm-up makes another providerSnapshot call; a valid live catalog does not require static auth recovery. Repaired only fixtures: explicitly warm the real catalog then assert no additional snapshot calls, and fail both external engine snapshot and auth recovery for catalog-error coverage. No production repair needed.

Attempt 2 / final required test command:
`npx vitest run src/services/decision src/__tests__/mobile_routing_scope.test.ts --no-file-parallelism`
Exit 0:
```text
 Test Files  20 passed (20)
      Tests  279 passed (279)
   Start at  11:49:50
   Duration  23.18s (transform 1.57s, setup 95ms, import 3.56s, tests 17.82s, environment 1ms)
```

`npx tsc --noEmit -p .` was run in both attempts; exit 2 both times. TSC emits no summary line. Final exact diagnostics:
```text
src/__tests__/dayflow_unbound_session_admission.test.ts(14,24): error TS2322: Type 'Database' is not assignable to type 'Awaitable<void>'.
src/__tests__/dayflow_unbound_session_admission.test.ts(61,28): error TS2339: Property 'basisDigest' does not exist on type 'ProviderAdmissionResponse | (WorkflowProviderDecision & { readonly overlay?: undefined; })'.
  Property 'basisDigest' does not exist on type 'WorkflowProviderDecision & { readonly overlay?: undefined; }'.
src/__tests__/dayflow_unbound_session_admission.test.ts(61,62): error TS2339: Property 'basisDigest' does not exist on type 'ProviderAdmissionResponse | (WorkflowProviderDecision & { readonly overlay?: undefined; })'.
  Property 'basisDigest' does not exist on type 'WorkflowProviderDecision & { readonly overlay?: undefined; }'.
src/__tests__/issue_1132_generated_types.typecheck.ts(33,44): error TS2322: Type '"configured"' is not assignable to type '"disabled" | "failed" | "connected" | "needs_auth" | "needs_client_registration"'.
src/services/agent_runner.ts(1320,43): error TS2367: This comparison appears to be unintentional because the types '"disabled" | "failed" | "needs_auth" | "needs_client_registration"' and '"configured"' have no overlap.
src/services/opencode_client_service.ts(5688,11): error TS2367: This comparison appears to be unintentional because the types '"disabled" | "failed" | "connected" | "needs_auth" | "needs_client_registration"' and '"configured"' have no overlap.
```
No diagnostic names an owned Slice D file. Runner/Dayflow are explicitly owned by peers; generated-status consumers are also outside this slice. Do not fix or revert them here. First runner diagnostic was at 1317; final at 1320 as concurrent edits progressed.

`git diff --check`: exit 0. Owned-file `git diff --stat`: 7 files changed, 235 insertions(+), 23 deletions(-). Mandatory run note is additional/untracked; existing AGENTS.md/CLAUDE.md and concurrent runner/Dayflow changes were neither edited nor reverted.

Timing probe: `npx vitest run src/services/decision/model_catalog_routing.test.ts -t 'D2: shadow computes' --no-file-parallelism --silent=false`: exit 0, `Test Files 1 passed (1)`, `Tests 1 passed | 17 skipped (18)`, `Duration 1.08s`. Test records a finite nonnegative high-resolution `catalogLatencyMs` using the warmed real catalog and proves no additional engine snapshot. Successful stdout was not surfaced by the runner, so no exact cached-latency figure is claimed. An error-fixture run with a valid live catalog reported 0.5167079999999942 ms (not the final warmed-cache fixture measurement).

### Criteria / verification handoff

- D1 PASS: `D1: shadow first prompt for %s classifies and logs exactly once` (auto + agent_default); prior-status matrix; feature/session isolation; read-failure and Postgres fail-open; repeat classification for on/every_prompt/escalate_only/no_session; wrapper and mobile continuation assertions.
- D2 PASS: `D2: shadow computes the same concrete live pick without changing route or session`; `D2: shadow catalog failure is recorded and swallowed`; `D2: a closed shadow gate never evaluates the catalog`; static wrapper/mobile details. Returned baseline and entire session row unchanged; live pickedModel and routeReason asserted; elapsed catalog timing asserted.
- D3 PASS: `D3: low confidence keeps a frontier baseline under the standard policy`; `D3: low-confidence baseline matrix in %s` (on/shadow × frontier/standard/cheap); `D3: confident frontier to standard classification remains a permitted downgrade`. Existing keep/default/threshold/gate tests remain green.
- D4 PASS: `D4: request_failed records only a bounded body-free cause (%j)` (direct ECONNREFUSED, nested ENOTFOUND, ETIMEDOUT, unknown unsafe code). Real SystemOneClient with stubbed fetch; no actual connection to a port.
- D5 PASS: inspected env behavior and corrected only the stale Auto-mode comment; existing unset-env Auto shadow test passes.
- D6 PASS: above contracts plus `D6: pinned %s never classifies or calls the catalog picker` (turn_override/session/agent_config in on/shadow), existing on-mode scope/persistence/curation/capacity/mobile tests green.
- D7 commands executed and exact output recorded; Vitest PASS, whole-repo TSC FAIL outside owned paths. Verifier must rerun after peer/generated-type fixes; do not call the whole repo green.

READY_FOR_VERIFICATION for this unit-tested Slice D implementation. Whole-repo typecheck and real live-engine behavior remain unverified/blocked, respectively by unrelated errors and explicit server prohibition. No commit/push/merge/deploy/host settings changes. No renewed scope approval needed for unchanged slice; do not expand into peers' files.

Risk: shadow catalog evaluation adds awaited latency (cached-path timing is covered, not a production latency estimate). Retention and simultaneous first turns can permit later/repeated evaluations; criterion is presence of an existing log row, not a new lock or permanent session state. Postgres intentionally preserves repeated classification because decision logs are SQLite-only. On mode retains timestamp-based first-prompt semantics.
