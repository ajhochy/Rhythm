---
date: 2026-10-08
repo: Rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: 1611
issues: [model-router-g2]
status: blocked
tags: [run, rhythm]
---

## Scope and safeguards
Assigned G2 W1–W11 only; owned paths from dispatch. No commits/pushes, servers,
sandbox, installs, credential file reads, real API calls, or live ports authorized.
Only this run note may change in docs/ai; contract mapping is recorded here rather
than creating docs/ai/contracts. Live evidence must remain NOT RUN.

## Phase 0 — RED
Loaded acceptance-contract first, then coding-agent. Read AGENTS, project-state,
current-plan and approved grid plan. Tests exercise real turn router, classifier,
catalog, selector, SQLite repository; fake engine/network/account-file boundaries.

Commands (cwd apps/api_server):
- `npx vitest run src/services/decision/router_grid_wiring.test.ts --no-file-parallelism`: 1 failed; expected routing.engine legacy, received undefined.
- `npx vitest run src/services/decision/router_grid_turn.test.ts --no-file-parallelism`: initial fixture FK error; corrected by creating a synthetic owner.
- Same turn command after fixture correction: 8 assertion failures, 2 passes; first prompt baseline instead of grid, absent variant/ledger/account and absent migration.

Contract IDs: W1 settings/shadow; W2 first prompt/pins; W3 carryover/mobile/model
change; W4 effort; W5 capacity; W6 next-message exhaustion; W8 ledger; W10 migration
are named tests in router_grid_{wiring,turn}.test.ts. Dedicated runner/security/
degradation contracts and a live extension were subsequently added. Spillover
contracts were RED before intake wiring; runner model assertion was RED before
runner wiring (after repairing icon and engine-response fixtures). Some expanded
coverage (security/degradation/replay) was added after initial implementation;
the initial RED gate was satisfied, but not every clause had an initial RED proof.
The initial mobile RED test lacked an injected legacy client and returned an
error after 5ms; that may have attempted the default loopback classifier endpoint
(8012). Later tests stub global fetch as well as engine/account boundaries. No
successful real API response was observed; do not claim zero network attempts.

## Phase 1 — impact review
CLI `gitnexus impact <symbol> --direction upstream --repo /Users/ajhochhalter/Documents/Rhythm-pr-worktrees/model-router-grid-20261008`
returned repository not found for routeTurnForSession, normaliseDecisionSettings,
defaultDecisionSettings, mergeConfig, normaliseRouterGridConfig, buildLive,
buildStatic, providerSnapshot, setRouterDecision, updateFields, clearRouterDecision,
mapRow, runMigrations, bootstrapPostgres, routeMobilePromptBody, handleSessionInput,
defaultCascadeDeps, redispatchTurn, runAgent. No risk rating returned. Used grep
caller review: desktop/mobile share turn router; repository setter has only turn
router caller; config GET/PUT delegates to config service; live catalog builders
feed both legacy router and capacity; runner has scheduler/delegation callers;
redispatch owns provider changes and replay. Reviewed intended production windows
before edits. Risks: account pins, catalog/legacy compatibility, nullable variants,
cached-only usage and nonblocking shadow. Mitigate via contract + existing suites.

## Checks / handoff

### Implementation
New router_grid_turn.ts owns the grid turn: live classifier, live-only catalog,
cached usage (15min unknown-quota handling, existing detached background refresh),
local account inventory on a cold cache, provider-specific pins, account setters
and SDK routing map, effort clamp, persisted model/variant/timestamp in one model
update, ledger, variant carryover, class-free reselection and degraded event.
Settings default legacy; normalise and config PUT/GET preserve engine. Provider
snapshot projects variant keys; catalog preserves them. Desktop sdkOpts and mobile
body consume variant each turn. Model changes clear it; identical model writes do
not. Redispatch clears persisted variant and strips replay variant. AgentRunner
routes only opt-in/no-profile runs with no modelOverride/taskKind and installs the
account routing after engine session creation. SQLite/Postgres column is additive.
Intake marks explicit 429 only, with retry-after/reset/cached reset/one-hour order;
grid sessions never auto-retry or accept the plugin's unsolicited account pick.

### Validation (cwd apps/api_server)
- First implementation: `npx tsc --noEmit -p .` failed on three G2 test fixture
  types (required variants/engine and unsupported AgentKind).
- `npx vitest run src/services/decision/router_grid_wiring.test.ts src/services/decision/router_grid_turn.test.ts --no-file-parallelism`
  initially 6 failed / 5 passed; catalog fixture lacked required capabilities.
  Corrected fixtures, not catalog eligibility policy.
- `npx vitest run src/services/decision/router_grid_spillover.test.ts --no-file-parallelism`
  RED: 3 failed (missing exhaustion and existing retry still invoked).
- `npx vitest run src/services/decision/router_grid_turn.test.ts -t 'W7:' --no-file-parallelism`
  RED: after fixture corrections, expected Anthropic Haiku, received profile's
  OpenAI Sol. Runner implementation followed this assertion failure.
- `npx vitest run src/services/decision src/__tests__/mobile_routing_scope.test.ts src/__tests__/issue_738_agent_runner.test.ts src/__tests__/issue_739_scheduler_agent_runner.test.ts --no-file-parallelism`
  first broad run: 2 failed / 467 passed, 30 passed files / 2 failed. Exact object
  expectations needed additive engine/variants. Preserved assertions and added fields.
- Intermediate typecheck also saw concurrent router_free_policy.test.ts type
  errors. Did not edit that file; its owner repaired it independently.
- FINAL `npx tsc --noEmit -p .`: exit 0, no output.
- FINAL `npx vitest run src/services/decision src/__tests__/mobile_routing_scope.test.ts src/__tests__/issue_738_agent_runner.test.ts src/__tests__/issue_739_scheduler_agent_runner.test.ts src/services/__tests__/turn_redispatch.test.ts --no-file-parallelism`:
  **33 passed files; 494 passed tests; exit 0; duration 38.52s**. Includes all
  changed unit tests (directory includes model_catalog and settings fixtures).
- Root `git diff --check && node --check apps/api_server/src/__tests__/fixtures/scripted_openai_provider_sdmr.mjs`: exit 0.
- Root `git diff --no-index --check /dev/null <each-owned-new-file>`: clean for
  five new TS files and this run note. No commit, push, server or sandbox command.
- Live suite **NOT RUN**, including no attempt to run it in skipped mode. Explicit
  user prohibition overrides the repo live-runtime verification requirement here.

### Criterion receipt
| ID | Offline result | Evidence / remaining gap |
| --- | --- | --- |
| W1 | PASS | router_grid_wiring W1; router_grid_turn W1 blocked classifier/shadow; existing legacy suites |
| W2 | PASS (SQLite) | router_grid_turn W2/W8 first prompt, pinned account/model/fixed, stale/missing cache |
| W3 | PASS (unit) | router_grid_turn W3 follow-up/mobile/model change/identical writes/off-mode carryover; desktop sdkOpts reviewed, live not run |
| W4 | PASS | router_grid_turn W4 max/xhigh clamp/no variants/lowest supported; model_catalog snapshot pass-through |
| W5 | PASS | router_grid_turn W3/W5 capacity bypass; turn_redispatch G2 W5 strips replay opts; repository clear reviewed |
| W6 | PARTIAL | router_grid_spillover 429/529/retry-after and router_grid_turn actual intake → next message → alternate account pass; production plugin status/PG ledger gaps below |
| W7 | PASS (unit) | router_grid_turn W7 actual runner listed vs unlisted pinned profile; existing 738/739 suites green; no-profile branch reviewed |
| W8 | PARTIAL | router_grid_turn W2/W8 exact ledger plus W9 degradation and W6 reason; existing decision ledger is SQLite-only |
| W9 | PASS | router_grid_turn W9 security/all closed exhausted keeps normal route; degraded flag/event assertions |
| W10 | PASS | all required unit suites green; router_grid_turn W10 migration twice; Postgres bootstrap SQL reviewed only |
| W11 | ADDED / NOT RUN | G2 live case, synthetic Decisions response, fake-only auth capture and effort capture; requires operator-seeded safe OpenAI engine/account fixture |

### Assumptions / consequential unresolved gaps
1. **HTTP status is mandatory quota evidence.** Intake accepts status/statusCode/
   httpStatus; unknown status is not treated as 429. Existing plugin reports can
   omit status (rate_limited alone cannot distinguish 429 from 529). G2 deliberately
   does not modify the excluded fork plugin. To satisfy live exhaustion, upstream
   must transmit the actual status. This needs an authorized companion slice, not
   another approval for unchanged G2 symbols.
2. **Postgres decision ledger remains unavailable.** decision_log.ts explicitly
   no-ops there, and this dispatch authorizes only router_variant database changes.
   Carryover still works without the ledger; exhausted-session reselection keeps
   the normal persisted route rather than reclassifying if saved classification is
   absent (also applies after ledger trimming). W6/W8 are not a Postgres PASS.
   AJ must approve durable Postgres ledger support or explicitly limit grid v1 to
   SQLite. No table/schema expansion was inferred.
3. Account auto provenance is conservatively in-memory, as specified; after restart
   a concrete unknown account is pinned. No persistent account-provenance columns.
4. No configured peak-pricing timezone exists: all UTC weekdays conservatively
   move peak-priced OpenRouter candidates last. No new pricing config introduced.
5. Snapshot type keeps variants optional for compatibility with existing snapshots;
   actual providerSnapshot always emits string[] and RoutableModel requires it.
6. Live G2 case uses only hardcoded fake tokens accepted by the scripted provider.
   Operator must seed openai/gpt-6-luna → loopback provider, [low,medium,high], and
   fake g2-fake-account in sanitized sandbox fixtures. The case is separately gated
   by RHYTHM_LIVE_GRID and must be run only with the safe fixture; no claim of runtime
   qualification or installed app behavior.

### GitNexus / scope receipt
Additional CLI impacts for primeUsageCache, opencodeSpilloverRouter, actual run /
handleInputFrame, and live turn/snapshot/server returned the same unindexed-repo
error. No HIGH/CRITICAL rating was produced. grep confirmed primeUsageCache's only
prior caller was readCachedSnapshot; desktop handler is called by enqueue and
session controller; spillover mounted by app. No reindex/install attempted.
No detect_changes gate needed: no commit is authorized or attempted.

Owned diff before final note update: 22 tracked files **+166/-21**, five new TS
files **+551**, plus this run note. Concurrent free-policy, sandbox and plan/run
edits were preserved and excluded from G2's owned diff. Final status **BLOCKED**
for full W6/W8 scope, despite all offline checks green. No permission denial;
the remaining questions are behavior/scope decisions, not host access requests.
