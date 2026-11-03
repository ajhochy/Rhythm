---
date: 2026-10-08
repo: rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: 1611
issues: []
status: READY_FOR_VERIFICATION
tags: [run, rhythm]
---

## Files / approval and exclusions

Explicit continuation after parent-confirmed finished policy child28e740b5; no
active policy writer. Assigned worktree: `/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/model-router-grid-20261008`.
Own only decision `router_free_policy.ts/.test.ts`, NEW `router_free_state.ts/.test.ts`,
and this mandatory durable run evidence. All other decision/app files belong to
paid wiring writer; sandbox-tools writer finished. Existing dirty files preserved.
Root config/default JSON, shared plan/current-state files remain untouched.
No peer dispatch, commits/push, installs, online/API/model/key/private-data reads,
server/process/sandbox management or file deletions. Approved scope unchanged;
no new authorization needed or inferred. Runtime NOT RUN; Free Mode NOT finished.

## Phase 0 — acceptance contract

Loaded acceptance-contract FIRST, then coding-agent. Read assigned AGENTS,
project-state/current-plan, regression registry, testing guide, prior policy run,
owned source/tests and package metadata. Prior policy evidence had 23 cases.
Preserved all existing tests; changed only exhausted-account fixture to provide
identity/provider. Added c22 stale exhaustion, c23 duplicate/invalid identity or
wrong provider counts, c24 random duplicate ordering/degraded behavior. Added
state s01..s13 (17 cases with the five-code failure matrix). No SUT mocks: real
filesystem persistence, injected clock only. Temporary synthetic evidence retained
under the assigned isolated TMPDIR; no test cleanup/deletion calls.

Canonical contract is embedded here, rather than creating another unowned file:
issue=null, date=2026-10-08, waiver=null. Test command below. Criteria c01..c24
map to the same-named tests in router_free_policy.test.ts (26 cases); s01..s13 map
to router_free_state.test.ts (17 cases). All are unit/state-file integration mode,
final status=pass. Runtime qualification/integration is manual, UNVERIFIED and
explicitly prohibited for this dispatch (not_tested=[runtime-integration]).

New criteria / assertion binding:
- c22 positively verified FRESH exhaustion: stale accounts yield active=false.
- c23 required2+2: duplicate/empty IDs or four OpenAI accounts yield active=false.
- c24 random only at end even grid/Ling duplicates: free-b first; otherwise random
  effort unchanged, degraded=true; blocked random emits circuit_open exactly once.
- s01 atomic full bundle: simultaneous four-call requests yield lease then rpm hold.
- s02 attempted calls vs cancellation: exactly two committed, release exactly two
  unused, repeat release=0, invalid commit=false; fresh instance dailyCount=2.
- s03 persisted active reservations: refreshed RPM cannot bypass daily held calls;
  release restores all unused; dailyCount remains zero.
- s04 token refill: held permits cannot refill into new admissions; commit consumes
  one; release returns only three; 15 seconds refills one at configured RPM4.
- s05 explicit UTC reset: 05:29 retains count; 05:30 resets, retains three reserved;
  fresh store observes reset and later attempt count=1.
- s06 required limit validation and invalid call counts: throws or explicit hold;
  invalid call input leaves persisted bytes unchanged.
- s07 rolling3-in10min/open15min config: oldest failure expires at exact window;
  third current failure opens; reload observes open; success cannot shorten it;
  exact deadline expires it.
- s08 code matrix429/5xx/empty/error_body/truncated (including HTTP200 failures
  supplied as codes): open on configured threshold1; cancellation/unknown body
  rejected; serialized state contains code, no supplied body/cancel marker.
- s09 reportSuccess clears sliding failure history only.
- s10 request retry: 59,999ms holds, 60,000ms same-list once; reload -> random once
  -> queue forever. No timer, task or model invocation performed.
- s11 descriptor queue persistence/projection/order: T1 then age; projected keys
  only; dequeue atomically returns four-permit lease + descriptor; held admission
  does not lose remaining descriptors; persisted bytes have no prompt/password.
- s12 missing owner/malformed classification rejected; max1 overflow explicitly
  holds while fresh store still contains first entry.
- s13 state file0600, parseable committed count, evidence directory retained.

Exact test command, cwd `apps/api_server`:
`env HOME=/private/tmp/sdmr-grid-sandbox/home TMPDIR=/private/tmp/sdmr-grid-sandbox/tmp DB_PATH=/private/tmp/sdmr-grid-sandbox/rhythm.db DB_CLIENT=sqlite ./node_modules/.bin/vitest run src/services/decision/router_free_policy.test.ts src/services/decision/router_free_state.test.ts`

RED before implementation: exit1, 2 failed files, 20 failed / 23 passed (43),
183ms. Policy c22/c23: `expected true to be false`; c24: expected free-b, got random.
All17 state cases: `state store must exist: expected null not to be null`.
Dynamic import catches absent module to yield assertions rather than loader errors.

## Phase 1 — bounded consolidated impact review

GitNexus upstream impact run for router_free_policy.ts, determineFreeMode,
selectFreeRoute, sortFreeQueue (repo Rhythm; symbol calls include owned path).
All returned target not found / impactedCount0 / risk UNKNOWN. This is NOT LOW.
New store has no existing indexed symbol. Exact source search for all four names
showed only owned policy implementation/tests, no runtime callers. No reindex,
network, or repeated tool retries. Reviewed the whole intended surface before
implementation: entry identity/freshness, fallback sequencing, queue projection;
new state config/leases/counters/UTC period/token refill/atomic persistence,
failure windows/deadline/retry transitions/queue admission+descriptor dequeue.

Risk review: fresh exhaustion must not be confused with cached verified status;
duplicate/provider-mismatched counts cannot prove2+2. Random must not be selected
early via alias lists. State must not mint permits while reservations remain held,
double-count cancellation, lose ownership/body projection, or execute private work.
The executable contracts above proportionately address these risks. Separate API
process/multi-writer file sharing would require new locking/DB scope: not supported.

## Phase 2 — implementation / checks

Small isolated modules; no runtime imports/wiring added. Entry now requires4 unique
nonempty IDs, two anthropic + two openai, and every exhaustion positively verified
and fresh. Existing explicit tier4 opt-in and active-mode recovery behavior retained.
Random ID excluded from ordered grid and optionalLing candidates; fallback effort
comes from configured final candidate, never an earlier duplicate. Numeric/model
defaults/config migration remains root-owned; state limits are all REQUIRED injected.

State uses synchronous reload+mutation+write, unique exclusive0600 same-directory
temp, fsync, close and atomic rename. Errors throw before returning a permit;
failed temp evidence remains. There is no unlink/rm, cleanup hook or task scheduler.
Parent directory must already exist and be operator-owned. Constructor validates
limits/clock and rejects invalid persisted schema instead of starting empty.
Disk reads and queue writes project allowed fields only. Queue overflow holds,
never evicts; queue/dequeue return copied descriptors only.

Token semantics: bucket tracks total unspent tokens; available = total minus held
calls. Refill capped at configured RPM so held permits cannot refill into another
reservation. Commit consumes one held permit AND one bucket token and increments
current UTC-period dailyCount; release removes ONLY unused holds. Active leases
survive reset/restart. A cancellation before attempted-call boundary only releases;
committed failed/provider attempts count. Crash between commit and dispatch is
conservatively counted; abandoned persisted leases require caller recovery/release.

First GREEN: exact test command above, exit0, 2 files / 43 tests passed, 803ms.
Scoped typecheck command, cwd `apps/api_server`:
`env HOME=/private/tmp/sdmr-grid-sandbox/home TMPDIR=/private/tmp/sdmr-grid-sandbox/tmp DB_PATH=/private/tmp/sdmr-grid-sandbox/rhythm.db DB_CLIENT=sqlite ./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module commonjs --esModuleInterop --skipLibCheck src/services/decision/router_free_policy.ts src/services/decision/router_free_policy.test.ts src/services/decision/router_free_state.ts src/services/decision/router_free_state.test.ts`
Result: exit0, no diagnostics. No repair attempt required.

Final revalidation: same exact test command followed by scoped tsc command with
`&&`, exit0; `Test Files 2 passed (2); Tests 43 passed (43)`, duration672ms;
scoped tsc again produced no diagnostics. Supplemental c24 assertions cover
unverified Ling alias not poisoning final random and a blocked duplicate random
being evaluated exactly once. No runtime/model calls were used for this result.

Whitespace/scope, cwd repo root: `git diff --check -- <four owned files> <this note>`
and `git diff --no-index --check /dev/null <path>` for each of the same five paths:
no whitespace diagnostics (no-index new-file comparisons return1). Scoped
`git status --short -- <same five paths>` shows only `??` for those five paths.
All five remain untracked, unstaged; policy pair were already untracked from prior
writer. No other files edited, no cleanup or deletion actions performed. Existing
other-writer dirty files and prior policy evidence remain intact.

API-wide checks NOT RUN per explicit own-tests+scoped-tsc instruction. Prior policy
run (not a current result) reported unowned AgentKind errors in router_grid_spillover
and router_grid_turn tests. Paid wiring writer/manager owns current API-wide checks.

## Exports / integration handoff

Policy: `determineFreeMode(DetermineFreeModeInput): FreeModeDecision`,
`selectFreeRoute(SelectFreeRouteInput): FreeRouteDecision`,
`sortFreeQueue(readonly FreeQueueDescriptor[]): FreeQueueDescriptor[]`,
FREE_MODE_DEFAULTS and existing exported types. Account capacity now requires
`id:string, provider:'anthropic'|'openai'`; pure sorter owner optional for legacy
23-test compatibility, persistent queue requires ownerUserId.

New: `RouterFreeStateStore({statePath, clock:()=>number, config:RouterFreeLimits})`.
RouterFreeLimits: rpm_limit, daily_request_limit, daily_reset_hour_utc,
daily_reset_minute_utc, breaker_failures, failure_window_ms, breaker_open_ms,
retry_delay_ms, queue_max_entries; all required, validated, no guessed reset/defaults.
Exported FreeFailureCode, FreeLease, FreeAdmission, OwnedFreeQueueDescriptor,
FreeRetryDecision, RouterFreeStateOptions.
- `tryReserve(requiredCalls:number): FreeAdmission` — lease{id,remainingCalls} or
  hold{reason:invalid_calls|daily_budget|rpm_budget}; reserves entire bundle.
- `commitAttempt(leaseId:string):boolean` — must succeed BEFORE EACH actual call.
- `release(leaseId:string):number` — unused calls released, repeat/unknown=0.
- `usage():{dailyCount,reservedCalls,availableTokens,dailyRemaining}`.
- `recordFailure(model:string,code:FreeFailureCode):boolean`; unsupported code/
  cancellation rejected with false and no mutation; no provider response body input.
- `reportSuccess(model:string):void` — clears failures only; active breaker deadline
  unchanged, openCircuits expires it exactly by clock.
- `openCircuits():ReadonlySet<string>`.
- `nextRetry(requestId:string):FreeRetryDecision` — call after initial ordered list
  exhaustion; hold until configured delay, same-list once, random once, then queue.
  The next transition is requested only AFTER previous attempt list completes.
  Decision grants NO permit; request IDs must be stable opaque IDs, not text.
- `enqueue(unknown):queued|hold(invalid_descriptor|already_queued|queue_full)`.
- `queue():OwnedFreeQueueDescriptor[]` — projected priority-sorted copy.
- `dequeue(requiredCalls:number):dequeued{descriptor,lease}|admission hold|queue_empty`.

Assumptions/ceiling: one API-process owner, trusted fixed injected config and opaque
model/request/task/user/reference IDs, existing owned state directory, millisecond
UTC clock. Shared single instance recommended; synchronous reload protects sequential
same-process instance reads but NOT multiprocess writes. No permission checks, task
execution, response validation parsing or actual provider classification in this
module. Caller MUST locally preflight privacy before ALL free calls, obtain bundle
reservation before starting, commit each individual attempt, release unused permits,
verify result before publication and validate task ownership/permissions on dequeue.
Runtime/engine/API/model/provider-semantic verification NOT RUN and not authorized.
READY_FOR_VERIFICATION only for owned module slice, not Free Mode completion.
