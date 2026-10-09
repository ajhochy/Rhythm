---
date: 2026-10-08
repo: rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: 1611
issues: []
status: READY_FOR_VERIFICATION
tags: [run, rhythm]
---

# Slice G1 resumed

## Scope / approvals
User dispatch approves NEW grid modules and unit tests only, plus minimal shared Decisions transport extension. Updated plan sections 5.1–5.4 resolve recursive normal step-up, stepped-tier reserve, ORIGINAL-tier fallback, no queue. Exact calibrated classifier wording and thresholds retained. No wiring to ws_gateway, turn_routing, agent_runner or mobile. No commits/push, servers/sandbox, install, key files, real APIs, or ports 4001/4002/4096. G2 owns integration and runtime verification; G1 does not claim live behavior.

## Files / Phase 0
Read worktree AGENTS.md, project-state, current-plan, testing-guide, updated grid plan, default JSON and entire intended shared source surface: Decisions client, capacity router/headroom, settings/cache, live model catalog, snapshot types. Worktree initially has ONLY user-provided untracked default JSON and plan (preserved).

RED command (apps/api_server):
`npx vitest run src/services/decision/router_grid_select.test.ts src/services/decision/router_grid_config.test.ts src/services/decision/router_grid_classifier.test.ts --no-file-parallelism`

Exit 1: 3 failed files, 46 failed / 12 passed of 58 tests. Missing new modules intentionally caught at import so failures are assertions, not loader errors: `AssertionError: grid selector export must exist: expected null not to be null`. The 12 invalid-config tests initially passed on that assertion; moved export assertion outside `toThrow` before final RED. Added exhaustion/adapter contracts before implementation.

Final pre-implementation RED:
`npx vitest run src/services/decision/router_grid_select.test.ts src/services/decision/router_grid_classifier.test.ts src/services/decision/router_grid_config.test.ts src/services/decision/router_grid_exhaustion.test.ts --no-file-parallelism --reporter=dot`
Exit 1: `Test Files 4 failed (4)`, `Tests 60 failed (60)`; every contract failed by missing-export assertion, no loader/setup errors. Contract JSON has 15 criterion IDs, 60 initial automated cases, zero manual cases. Maintained tests now use static imports so the CommonJS compiler checks them. Added 16 guard-strengthening cases after first implementation (no new scope).

## Phase 1 impact
Exact requested CLI: `gitnexus impact OpenAIDecisionsClient --direction upstream --repo /Users/ajhochhalter/Documents/Rhythm-pr-worktrees/model-router-grid-20261008` → repository not indexed. Bounded fallback `--repo Rhythm` → sibling-clone index 175 commits stale, class absent, UNKNOWN risk. `gitnexus impact score --direction upstream --repo Rhythm` → unrelated ambiguous symbols (UNKNOWN), no authoritative client result. No reindex/install performed.

`gitnexus impact accountHeadroom --direction upstream --repo Rhythm` → LOW, 5 impacted, 3 direct callers (pickAccount, chooseCapacityRoute, applyCapacityRouting), 1 create process; helper reused, NOT modified. Local exact-reference review of Decisions class/score finds model_router and decision_config_service consumers. Existing one-question API/result must remain byte-contract compatible, covered by existing decision suites. Consolidated risk: only shared transport refactoring can affect old consumers; retain all consent/key/URL/timeout/cap/redirection safeguards, body-free error reasons, old score validator, run full decision unit suite. New modules have no production callers; no runtime route or API handler is edited.

## Assumptions
- Plan/brief do not actually include category descriptions. Use short literal coding/design/knowledge descriptions in classifier contract (code/software; visual/UI; research/writing/general). Exact tier instructions/descriptions and predicate questions are supplied and copied verbatim.
- Peak hours/timezone unspecified: pure selector receives explicit `weekdayPeak` boolean from future caller, not invented clock windows.
- Snapshot rows without account IDs/unavailable rows cannot bind a connected closed account: excluded; unknown quota on identified connected accounts remains eligible.
- OpenRouter effort unspecified: return `null`; accountId `null` (key-based provider, no closed account binding).
- Choice wire contract uses `choices` with label/description, response `choice` label + confidence; predicates use `probability`. These new answer shapes are tested at the synthetic fetch boundary only; real Decisions API compatibility is not qualified in G1.
- Reserve/no-account failures do not themselves trigger step-up; any rule skip does, including mixed rule/account failures, per resolved plan's explicit condition.

## Checks / G2 handoff

Implemented 4 new modules and 4 new unit-test files; only existing source edited is `openai_decisions_client.ts`. The preexisting plan and default JSON were NOT modified. Config defaults include exact [0.1, 0.35, 2.25], recursive object override merge/array replacement, post-merge SAME_AS resolution/cycle checks, validation and mtime+size cache. Selector uses caller-supplied live provider/model IDs, caller time/peak status and cached account snapshot; no engine/usage probes. Exhaustion storage is lazy (constructing does not read/write), provider-scoped, atomic mode0600 JSON with expiry pruning, no events. No new modules are referenced by production turn/session paths. No SUT mocks; synthetic fetch and temp config/store files only.

### Commands and observed output (cwd apps/api_server)
1. First implemented focused contract run (4 files): exit0, 60/60 PASS.
2. `npx tsc --noEmit -p .`: initial exit2; only NEW test issues: TS1378 (top-level await with CommonJS), TS2493/2339 (zero-argument fetch fixture tuple), TS2322 (fixture union mutation). Repair attempt 1: static imports, typed fetch arguments, explicit response fixture shape; no compiler config/production changes. No second repair needed.
3. `npx vitest run src/services/decision --no-file-parallelism`: exit0, `Test Files 25 passed (25)`, `Tests 390 passed (390)`; first full run duration28.41s, final exact run at21:54:13 duration28.36s. All 314 preexisting decision tests stay green, plus76 new cases.
4. `npx tsc --noEmit -p .`: final exit0, no output (also passed after first repair).
5. `npx vitest run src/services/decision/router_grid_select.test.ts src/services/decision/router_grid_classifier.test.ts src/services/decision/router_grid_config.test.ts src/services/decision/router_grid_exhaustion.test.ts --no-file-parallelism --reporter=verbose`: exit0, 4 files /76 cases PASS (1.40s). Case results below.
6. `git diff --check`: exit0. Tracked stat initially shows only shared transport (+57/-9); untracked-inclusive code stat:9 files, +573/-9. Contract/run documentation additionally new; user-supplied plan/default excluded from agent diff. Nothing staged/committed/pushed. GitNexus detect_changes commit gate not applicable (no commit); unindexed new code is not graph-qualified.
7. Final maintained contract command (same4 files above, WITHOUT reporter option): `npx vitest run src/services/decision/router_grid_select.test.ts src/services/decision/router_grid_classifier.test.ts src/services/decision/router_grid_config.test.ts src/services/decision/router_grid_exhaustion.test.ts --no-file-parallelism` → exit0, `Test Files 4 passed (4)`, `Tests 76 passed (76)`, start21:56:23 duration1.58s. Final scope check confirms only listed G1 code/docs plus untouched initial plan/default; no staged changes. Final agent diff including documentation:11 files, +718/-9 (run121, contract24, code573).

### Per-test results
All PASS; exact scenario assertions are in named tests, not status-only checks.

| ID | Observed route/result |
|---|---|
| AT1 | Haiku5.5 low, a2 (80%), tier4, not degraded |
| AT2 | Luna max, o2 (80%) |
| AT3 | OpenAI10/12% skipped for reserve; Sonnet high |
| AT4 | Sonnet xhigh, a2 (12%); tier1 reserve exemption |
| AT5 | Haiku/Sol/Sol6.1 rule skips then Sonnet high at tier2 |
| AT6 | MiMo Pro degraded, canQueue=true traced, no queue |
| AT7 | MiMo Pro degraded, canQueue=false |
| AT8 | Kimi K3, OpenRouter, not degraded |
| AT9 | GPT6.1 Sol max; separate Sonnet-first test proves security skip |
| AT10 | Both OpenAI accounts exhausted fixture; independent API-key HTTP429 -> rules tier2/coding reason http_429 |
| AT11 | Quota tie -> a2 earliest reset |

Selector additional9/9: unknown quota eligible/below known0 at tier1; unavailable-model step-up with tier1 reserve exemption; OpenRouter unusable AND unavailable both none; DeepSeek weekday/off-peak order; recursive stop tier1 and original-tier fallback/body-free trace; strict15% reserve/reset expiration at now; Sonnet-first security skip/input immutability; mixed rule+account step-up; strict surcharge boundaries100K/272K.

Classifier39/39:
- Exact single POST body4 questions, full ordered literal tier wording/levels/category/predicates; 8000-char transport cap, full prompt ceil(length/4) estimate, API key absent from result/console calls. Logger info/warn/error checked for key absence after EVERY classifier case.
- Score boundaries8/8:0->4,0.0999->4,0.1->3,0.3499->3,0.35->2,2.2499->2,2.25->1,3->1.
- Predicate thresholds4/4:0.4999->false,0.5->true,1->true,0->false (both predicates).
- Failure scenarios13/13 -> rules default with exact body-free reason: no_key/no_api_key; no_consent/remote_consent_required; empty/empty; unsafe_http/https_required;429/http_429; refusal/refusal; malformed_json/malformed_json; malformed_answer/malformed_response; missing_answer/malformed_response; duplicate_answer/malformed_response; timeout/timeout_5ms; network/request_failed; large/response_too_large. Disabled guards never fetch; response/error bodies containing synthetic key never returned.
- Malformed field guards10/10: negative/string score; out-of-range confidence; missing score probabilities; unknown choice; negative choice confidence; negative/string queue probability; >1 security probability; wrong security answer type. Whole classification defaults, no partial application.
- Rules category3/3: code->coding, visual design->design, report->knowledge.

Config15/15: default thresholds/reserve/design effort/knowledge alias; partial merge/array replacement/alias tracks coding change; cache identity then changed-file reload/malformed/missing default;12 invalid merged fixtures individually rejected (reserve-1/101, unordered/>3 thresholds, queue>1/security<0, invalid rules tier, alias cycle/unknown target, unknown model, negative price, closed-provider OpenRouter fallback).

Exhaustion/adapter2/2: mark/read through fresh store, scope to provider, mode0600, expire at exact deadline and persist pruning, invalid deadline rejected, malformed file tolerated; adapter discovers IDs, min20% across windows, earliest valid reset, known exhaustion and unknown eligible account; excludes unavailable/no-ID/aggregator rows.

### G2 exports/signatures (timestamps are epoch milliseconds)
```ts
// router_grid_config
defaultRouterGridConfig(): RouterGridConfig
normaliseRouterGridConfig(raw: unknown): RouterGridConfig // throws sanitized validation error
routerGridConfigPath(): string
loadRouterGridConfig(path?: string): RouterGridConfig // malformed/missing -> full defaults
// types: GridTier=1|2|3|4, GridCategory, ClosedProvider, GridCandidate, GridFallback, RouterGridConfig

// router_grid_classifier
GRID_CLASSIFIER_QUESTIONS: DecisionQuestion[]
gridTierFromScore(score: number, thresholds: readonly number[]): GridTier
rulesGridClassification(prompt: string, config: RouterGridConfig, reason: string): GridClassificationResult
classifyRouterGrid(prompt: string, config: RouterGridConfig, client?: OpenAIDecisionsClient): Promise<GridClassificationResult>
// result: tier, category, canQueue, securitySensitive, estInputTokens, source, reason; no prompt/key

// router_grid_select
accountsFromSnapshot(snapshot: UsageBudgetSnapshot, exhaustion?: readonly GridExhaustion[]): GridAccount[]
pickGridAccount(provider: ClosedProvider, tier: GridTier, accounts: readonly GridAccount[], reservePct: number, now: number, trace?: GridTrace[]): GridAccount|null
selectRoute(input: GridRouteInput): GridRouteResult
// input: classification, config, accounts, availableModels:ReadonlySet<string>, openrouterUsable, now, weekdayPeak
// route: kind='route', model, effort:string|null, provider, accountId:string|null, degraded, tierUsed, trace
// none: kind='none', reason, trace (G2 keeps baseline route)

// router_grid_exhaustion
routerGridExhaustionPath(): string
new RouterGridExhaustionStore(path?: string, clock?: () => number)
markExhausted(provider: ClosedProvider, accountId: string, exhaustedUntil: number): void
isExhausted(provider: ClosedProvider, accountId: string): boolean
list(): GridExhaustion[] // {provider, accountId, exhaustedUntil}; expired entries pruned on disk

// minimal shared transport extension
OpenAIDecisionsClient.decide(input: string, questions: DecisionQuestion[], model?: string): Promise<MultiDecisionsResult>
// guarded URL/key/consent/cap/timeout transport shared with UNCHANGED score() public contract
```

G2 must explicitly obtain cached usage and live catalog IDs, perform source/pin/session gates, apply model/effort/account, own event wiring and ledger integration, determine pricing peak time policy, and qualify actual Decisions wire behavior and API/engine behavior under separate authorized runtime gates. None of that is implied by this unit-only READY_FOR_VERIFICATION. Prior approvals/exclusions above remain durable; no renewed approval is needed for unchanged G1 scope.
