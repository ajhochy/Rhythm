---
date: 2026-10-08
repo: Rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: null
issues: [Slice E]
status: NEEDS_CONTEXT
tags: [run, rhythm]
---

## Scope and resolved approvals

User continuation is the specialist handoff; acceptance-contract invoked first. Read the decision diff first, then AGENTS.md, project-state.md and current-plan.md. Approved: minimal OpenAI Decisions backend, necessary internal settings/client/router/status functions, additive web RouterBackend/RouterConfig/RouterConfigInput and RouterSettingsPanel; web package node unit runner/typecheck only. HIGH normalizer warning acknowledged; mitigate by legacy local/jev/custom/systemone round trips, both with and without synthetic keys. These approvals remain resolved for unchanged scope; no renewed symbol-level approval is needed.

Only this run note is authorized documentation: the acceptance contract is embedded below instead of creating another docs file. Excluded: memory_*, dayflow_*, agent_runner.ts, live tests, Flutter/mobile, other docs. No commit/push/install/server/Playwright/Electron/sandbox/port operation or real OpenAI call. No operator key file was read. Tests create and consume only synthetic settings in disposable tmp directories, with in-memory SQLite. Existing Slice D/D2 changes were preserved. The shared worktree changed concurrently (excluded live fixture became tracked, other docs appeared); those changes are not attributed to Slice E.

## Phase 0 — executable RED

Commands run from apps/api_server (displayed below with cwd):

1. `cd apps/api_server && npx vitest run src/services/decision/openai_decisions_settings.test.ts --no-file-parallelism`: exit 1, 2/2 failed. Exact failures: expected `local` to be `openai_decisions`; expected property `openaiDecisions`, received undefined.
2. `cd apps/api_server && npx vitest run src/services/decision/openai_decisions_settings.test.ts src/services/decision/openai_decisions_backend.test.ts --no-file-parallelism`: exit 1, 18 failed / 9 passed. Tier assertions received null/applied false, refusal reason was malformed_response, timeout was 400 rather than 1000 ms, no-key/no-consent attempted the wrong backend, status field missing.
3. After correcting the network stub to produce fresh Response bodies and adding parser/route coverage, `cd apps/api_server && npx vitest run src/services/decision/openai_decisions_backend.test.ts --no-file-parallelism --reporter=dot`: exit 1, 15 failed / 15 passed. Actual `/config/test` handler returned backend local/ok false instead of the scored diagnostics. All were before implementation.

Tests fake only external fetch/engine/quota boundaries; settings persistence, router, scope gates, catalog selection, logging, ranking and config route handler remain real. Parser-negative and pin tests were already green, not claimed as new RED failures. No behavioral waiver.

### Acceptance contract / criterion results

Stable IDs E1–E9 refer to the verbatim acceptance in the user handoff. Test command is the serial no-port command in Checks. All named Slice E tests are in `openai_decisions_settings.test.ts` or `openai_decisions_backend.test.ts` under src/services/decision.

| ID | Mode / result | Executable evidence / remaining clause |
|---|---|---|
| E1 | unit PASS | `preserves the new backend...`, `tolerantly defaults malformed fields...`; four `compatibility: %s saved settings round-trip unchanged with and without keys` cases serialize legacy files without the new section and compare every existing field; `write-only key survives fresh GET, omitted PUT, clears explicitly...` proves 0600, fresh read, hasApiKey, clear/retain; `rejects unsafe remote HTTP and missing consent on config merge`; failure matrix proves no-fetch guards. Existing routes require no implementation change. |
| E2 | unit PASS | `exact one-question wire contract trims/bounds raw prompt...` checks exact body, single question, three ordered levels, Bearer, AbortSignal, manual redirects. Eight `malformed score answer %j is rejected, not applied` cases plus out-of-range, refusal, HTTP and real AbortSignal timeout. Client exposes an explicit fetchImpl option; production factory uses the stubbed global network boundary in these tests. |
| E3 | unit PASS | Four `score %s maps to %s despite low API confidence` boundaries; actual API confidence 0.01 remains in result/log, bypasses fallback; exact diagnostic/cost row, catalog pick; four `pin %s never sends a prompt` cases across on/shadow; closed scope gate; detached shadow test asserts return before response, would-be pick, unchanged route and once-per-session classification. Existing on-mode/catalog/scope unit suites remain green. Scope gate receives 1 for this calibrated backend, so escalate confidence does not reintroduce the bypassed diagnostic-confidence gate. |
| E4 | unit PASS | `tool and memory candidate ranking use local reranker, including changed local settings`: real tool ranker and memory's shared rankCandidates entry point, no injected ranking client; exact endpoint sequence is three local /v1/rerank requests, no key forwarded, local settings cache refresh works. No memory_* file edited. |
| E5 | unit PASS | `status aggregates only OpenAI model-routing tiers/cost`: one cheap/standard/frontier, summed estimatedUsd, unrelated backend cost excluded. Additive summary.openaiDecisions; existing since/feature filters remain in the same query. |
| E6 | unit PASS | `actual /config/test route returns the scored diagnostics without a socket or key echo` invokes the registered Express route handler without listen; `write-only key...probe returns diagnostics` checks tier/score/probabilities/latency, then no-key probe fails without another fetch. |
| E7 | manual UNVERIFIED | Types and panel implemented; exact option/hint, URL/model, write-only typed/clear-key pattern, needsConsent, 1000 ms default, old-server section capability gate. No router-panel node-level test exists (no RouterSettingsPanel matches in tests/*.test.mjs), so none was added per user instruction. Web typecheck cannot start without dependencies. Manual target: select OpenAI in ModelRouting, assert fields/consent, save untouched key omitted, type replacement key included, clear sends empty string; no browser run authorized. |
| E8 | unit PASS / UI UNVERIFIED | Above tests cover boundary/failure matrices in both on/shadow, no throw/no route on failure, recorded status/reason, key never in config/decision rows or logger.info/logger.warn spies across tests, shadow detached, on applies, ranking isolation, probe. Panel rendering/send proof is manual as E7 explicitly permits. |
| E9 | checks FAIL/BLOCKED | Safe API suite 280 PASS; exact all-decision command NOT RUN because three existing test files bind sockets. API tsc exits 2 solely in excluded live file. Web typecheck exits 127; node runner exits 1 for missing dependencies. |

Not tested: E7 rendered behavior, E8 UI clause, E9 full socket-using suite and successful typechecks; live engine/API behavior. User explicitly forbids live tests/servers here, so live acceptance is not claimed and no live test file was changed.

## Phase 1 — bounded GitNexus review

CLI pattern: `gitnexus impact <symbol> --direction upstream --repo /Users/ajhochhalter/Documents/Rhythm-pr-worktrees/scheduled-dayflow-memory-router-20261008`. Disambiguation used --file or --uid; --summary-only used for large/interface results. Every intended existing symbol was reviewed before its implementation edits. No indexed execution processes were returned (all processes_affected = 0); that is not proof of no runtime impact.

| Target | Total / direct | Risk | Direct callers / affected surface |
|---|---|---|---|
| normaliseDecisionSettings | 38 / 2 | HIGH | mergeConfig, loadDecisionSettings; 4 modules |
| DecisionSettings | 349 / 7 | CRITICAL | imports in env, systemone_client, routing_scope, model_router, model_catalog, decision_config_service, decision_client |
| defaultDecisionSettings | 39 / 2 | HIGH | normaliseDecisionSettings, loadDecisionSettings |
| defaultTimeoutFor | 16 / 3 | HIGH | getDecisionTimeoutMs, buildConfigView, resolveConfig |
| activeBackendSection | 10 / 2 | LOW | getDecisionBaseUrl, getDecisionModel |
| buildConfigView | 6 / 2 | LOW | buildConfigViewWithCatalog, updateConfig |
| resolveConfig | 8 / 2 | LOW | buildConfigView, testConfig |
| checkUrl | 5 / 1 | LOW | mergeConfig |
| mergeConfig (decision_config_service) | 6 / 2 | LOW | updateConfig, testConfig |
| assertConsent | 5 / 1 | LOW | mergeConfig |
| testConfig | 5 / 1 | LOW | agent_decisions_routes.ts |
| ResolvedRouterConfig | 21 / 6 | MEDIUM | calibration/benchmark scripts, systemone_client, decision_engine, decision_config_service |
| buildRerankClientFromSettings | 10 / 1 | HIGH | getDefaultRerankClient |
| getDefaultRerankClient | 14 / 2 | HIGH | calibration main, rankCandidates |
| routeTurnTier | 0 / 0 | LOW | stale index omits newer detached helper/callers |
| summarizeDecisions | 5 / 1 | LOW | agent_decisions_routes.ts |
| DecisionSummary | 54 / 5 | MEDIUM | additive status type |
| RouterSettingsPanel | 1 / 1 | LOW | ModelRouting columns |
| toDraft | 4 / 2 | LOW | panel load/save |
| buildInput | 4 / 2 | LOW | panel test/save |
| keyField (web panel) | 2 / 1 | LOW | panel |
| DecisionBackend, routeClassifiedTurn, RouterBackend, RouterConfigInput | not found | UNKNOWN | bounded source inspection fallback; new helper/type aliases not indexed |
| RouterConfig (web alias) | not indexed | UNKNOWN | CLI name selected mobile interface, not applicable; mobile not edited |

Warnings reported before edits: HIGH normalizer/defaults/reranker functions; CRITICAL shared settings interface. Risk is additive typing/default expansion with wide config dependencies, not a newly requested feature. Mitigation: legacy round-trip matrix, unchanged old backend paths, local-only ranking/key protection, serial existing router suites and attempted whole-project tsc. The initial large DecisionSettings output truncated invalid JSON; summary-only retry captured authoritative counts. Ambiguous mergeConfig/toDraft/keyField were retried with file/UID.

## Files

Implementation: decision_settings.ts, decision_config_service.ts, decision_client.ts, decision_log.ts, model_router.ts; new openai_decisions_client.ts; web gateway/sessions.ts and components/tools/RouterSettingsPanel.tsx. Tests: existing RED openai_decisions_settings.test.ts extended; new openai_decisions_backend.test.ts (30 cases), plus six settings cases = 36. Only this documentation file written by this run.

Scoped working-tree diff vs HEAD: 7 tracked code files +187/-44; 3 untracked code/test files +310; this run note is additional. This includes preserved pre-existing Slice D/D2 changes in model_router.ts/decision_log.ts, not solely this run's edits. No other worktree changes are part of this handoff.

## Phase 2 — Checks / commands / repair

- `cd apps/api_server && npx vitest run src/services/decision/openai_decisions_settings.test.ts src/services/decision/openai_decisions_backend.test.ts --no-file-parallelism`: GREEN 2 files / 36 tests (6.80 s first implementation run; 7.00 s after legacy-file fixture refinement).
- First tsc found three own route-test optional-access errors and a missing next argument, plus the excluded live error. One repair: explicit assertions/non-null route lookup and typed request/response/next for direct handler invocation. Subsequent tsc has no Slice E errors. Final log-secret assertions pass in the final broader suite below.
- **Requested exact summary:** `cd apps/api_server && npx vitest run src/services/decision src/__tests__/mobile_routing_scope.test.ts --no-file-parallelism` — **NOT RUN** under no-port authorization. `decision_client.test.ts`, `decision_backends.test.ts`, `model_catalog_config.test.ts` explicitly call createServer/listen(0). No tests were deleted or altered to bypass this.
- **Safe scoped command:** `cd apps/api_server && npx vitest run src/services/decision src/__tests__/mobile_routing_scope.test.ts --no-file-parallelism --exclude '**/decision_client.test.ts' --exclude '**/decision_backends.test.ts' --exclude '**/model_catalog_config.test.ts'` — exit 0, **19 files / 280 passed**, final 29.36 s, 14:49:31. Includes all Slice E tests and registered agent-decisions config/test route-unit test. No separately named agent_decisions route test file exists.
- `cd apps/api_server && npx tsc --noEmit -p .` — exit 2, final sole diagnostic: `src/__tests__/scheduled_dayflow_memory_live_e2e.test.ts(313,7): error TS2322: Type 'string' is not assignable to type 'boolean'.` This excluded file was untouched; user reported clean baseline, but shared worktree validation now fails there. Do not claim clean API typecheck.
- `cd apps/web && npm run typecheck` (initial combined command `npm run typecheck && npm run test:unit`) — exit 127, `sh: tsc: command not found`; apps/web/node_modules absent. The chained unit run did not execute, so ran it separately.
- `cd apps/web && npm run test:unit` — exit 1, **15 passed / 7 failed**, missing `typescript` or `react`, Node v22.23.0. Exact package runner: `node --experimental-vm-modules --test --test-concurrency=1 tests/*.test.mjs`. No dev server/browser/Electron started; no dependency install attempted.
- `git diff --check` — exit 0. Git diff/stat operations do not modify or stage anything. No commit, push, deploy or live request.

## Handoff / NEEDS_CONTEXT

Slice E unit behavior is implemented and green, but cannot return READY_FOR_VERIFICATION with failed mandated typechecks. Owner must repair the excluded live-test type error and provision web dependencies externally (or provide an authorized existing installation). Resolve the full-suite socket/no-port conflict before running its exact command; no new scope approval needed for unchanged Slice E. Keep manual web and sandbox behavior pending; this is not runtime/live proof.

Exact PUT `/agent-decisions/config` body for a future separately authorized sandbox with a stub Decisions endpoint (nothing sent this run):

```json
{
  "backend": "openai_decisions",
  "openaiDecisions": {
    "baseUrl": "http://127.0.0.1:18081",
    "model": "gpt-6-luna",
    "apiKey": "synthetic-slice-e-not-a-real-key"
  },
  "timeoutMs": 1000,
  "remoteDataConsent": true,
  "features": { "model_routing": "shadow" },
  "routing": { "scope": "first_prompt" }
}
```

18081 is a proposed future sandbox-only stub origin, not a running/verified endpoint; no port was opened or contacted. The operator must authorize/configure that stub or substitute its approved origin before any live test. Unit tests instead use a non-listening port-1 URL with fetch stubs. For operator-authorized real OpenAI later, use https://api.openai.com and a key supplied by the operator; this run never reads or sends one. Assert baseline unchanged immediately, one drained model_routing row with tier/score/probabilities/cost/pickedModel, and no second classification for the session. Do not reuse this note as permission to start servers or call OpenAI.
