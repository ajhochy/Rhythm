---
date: 2026-10-08
repo: rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: 1611
issues: []
status: READY_FOR_VERIFICATION
tags: [run, rhythm]
---

## Files / ownership

Recovery replacement for failed child292d8f7f, explicit parent handoff; no duplicate writer.
Only new `apps/api_server/src/services/decision/router_free_policy.ts` and
`router_free_policy.test.ts` are implementation-owned here. This new run note is
required workflow evidence. Shared plan/current-state files read only.
Paid decision/config/account/ws/mobile files and sandbox tools belong to other agents.
No commits, pushes, installs, deletions, credential/private transcript reads, real
API/model calls, online research, process or sandbox management authorized.
Live ports untouched. Parent-approved scope is unchanged; no renewed approval needed.

## Phase 0 / executable contract

Loaded acceptance-contract first, then coding-agent; read AGENTS, project-state,
current-plan, testing-guide, package/tsconfig and the approved Free Mode plan.
Acceptance IDs c01..c17 are embedded directly in the only assigned test file,
including parameterized privacy cases (19 tests). Canonical contract lives inline
here to avoid creating another unassigned file: issue=null; date=2026-10-08;
waiver=null; mode=unit for every criterion; not_tested=[]; status=failing initially.
Each ID maps to its same-named `it` in router_free_policy.test.ts:
c01 paid capacity; c02 entry/skipPaid; c03 unknown/count; c04 fresh recovery/reset;
c05 disabled/tier4; c06 order/circuit/effort; c07 preflight; c08 classifier privacy;
c09 T1; c10 images; c11 reserve/zero; c12 Ling; c13 forbidden/probation/random;
c14 verifier; c15 full budget/helper; c16 queue priority/reference-only projection;
c17 body-free output. Tests exercise the real pure policy; no mocked SUT.

Exact contract command (working directory apps/api_server):
`env HOME=/private/tmp/sdmr-grid-sandbox/home TMPDIR=/private/tmp/sdmr-grid-sandbox/tmp DB_PATH=/private/tmp/sdmr-grid-sandbox/rhythm.db DB_CLIENT=sqlite ./node_modules/.bin/vitest run src/services/decision/router_free_policy.test.ts`

Initial result: exit 1; 1 failed file; 19 failed tests; duration 174ms.
Failure excerpt: `AssertionError: pure policy module must exist: expected null not to be null`.
Dynamic import catches only module absence to produce assertion failures, not a
test-loader error; no implementation stub written before RED.

## Phase 1 / bounded impact review

`gitnexus_impact({target:'router_free_policy', direction:'upstream', repo:'Rhythm',
file_path:'apps/api_server/src/services/decision/router_free_policy.ts'})`
returned target not found, impactedCount=0, risk=UNKNOWN (not a LOW assertion).
Both files absent on inspection, no existing symbols edited, no runtime imports
added. Inspected full intended surface up front: new types, determineFreeMode,
selectFreeRoute, queue projection/sort, synthetic tests. Necessary internal
members/functions are within approved pure policy scope.
Risks: privacy admission must precede any free call; verification must be required
on every route; reserve/budget must cover classifier/helper/answer/verifier;
stale reset/capacity cannot exit active mode. Proportionate unit contracts cover
these. State persistence, rate token refill, retries/circuits, runtime integration,
real verification and execution are explicitly excluded and manager-owned later.
No live behavioral claim: this isolated module has no HTTP/engine wiring.

## Phase 2 / checks and handoff

Implemented pure descriptors and defaults, with no dependencies or runtime wiring.
Config accepts string or `{model,effort}` Ling/random entries; string entries carry
undefined effort rather than inventing a provider effort. Grid/helper efforts are
returned unchanged. Trace uses fixed reason codes only. Queue sorting projects
only taskId/reference/enqueuedAt/whitelisted classification, preserving no body.
Budget admission reserves classifier+answer+verifier=3, plus image helper=4. State
owner supplies dailyRemaining/dailyCount/rpmCount; this module does not refill,
reserve persistently, count calls, or execute. `canVerify` denotes a configured
real verifier, not a release proof; runtime still must observe PASS before release.
Four accounts must carry positively verified exhaustion to enter; unknown is not
exhaustion. Already-active mode requires fresh verified recovery to exit. Paid
recovery has a separate explicit freshness proof. Reset crossing requests refresh
only. Explicit tier4 bypass remains subject to selection privacy/verifier admission.

First implementation acceptance run: same command, exit 0, 19/19 PASS, 190ms.
First API tsc run: exit 2, two owned fixture cast errors plus two unowned AgentKind
errors. Repair attempt 1 typed the config fixture; second API tsc still exposed
two owned Object.fromEntries casts plus the same two external errors. Repair
attempt 2 replaced casts with explicit typed synthetic grid literals. No further
repair attempts. Supplementary hardening c18 paid freshness/unknown, c19 injected
limits/defaults, c20 fallback privacy/helper forbidden, c21 invalid budgets/input
immutability added without changing implementation (these extend existing
contract risks, not new scope). Final contract status: c01..c21 PASS, 23 tests.

Final acceptance command: same exact env+vitest command above.
Observed: exit 0, `Test Files 1 passed (1); Tests 23 passed (23)`, duration 202ms.

Scoped typecheck (working directory apps/api_server):
`env HOME=/private/tmp/sdmr-grid-sandbox/home TMPDIR=/private/tmp/sdmr-grid-sandbox/tmp DB_PATH=/private/tmp/sdmr-grid-sandbox/rhythm.db DB_CLIENT=sqlite ./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module commonjs --esModuleInterop --skipLibCheck src/services/decision/router_free_policy.ts src/services/decision/router_free_policy.test.ts`
Result: exit 0, no diagnostics. Scope: ONLY the two new files and their type imports.

API-wide typecheck (same environment and cwd):
`env HOME=/private/tmp/sdmr-grid-sandbox/home TMPDIR=/private/tmp/sdmr-grid-sandbox/tmp DB_PATH=/private/tmp/sdmr-grid-sandbox/rhythm.db DB_CLIENT=sqlite ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Final result: exit 2, ONLY these unowned diagnostics:
`router_grid_spillover.test.ts(24,66): TS2322: Type '"opencode"' is not assignable to type 'AgentKind'.`
`router_grid_turn.test.ts(51,29): TS2322: Type '"opencode"' is not assignable to type 'AgentKind'.`
No API-wide PASS claim. Other writer must resolve those before manager's package gate.

Whitespace commands from repo root: `git diff --no-index --check /dev/null <path>`
individually for each of the three owned new files: no whitespace diagnostics
(no-index new-file diff returns 1). `git status --short -- <three paths>` shows
only `??` for each. No tracked files edited by this replacement; initial shared
dirty paths remain owned by other agents. No cleanup or staging performed.

Exports/signatures:
- `determineFreeMode(input: DetermineFreeModeInput): FreeModeDecision`
- `selectFreeRoute(input: SelectFreeRouteInput): FreeRouteDecision`
- `sortFreeQueue(queue: readonly FreeQueueDescriptor[]): FreeQueueDescriptor[]`
- `FREE_MODE_DEFAULTS`; exported FreeTier/Category/PrivacyState, classification,
  candidate/helper/config, account-capacity, input/decision and queue types.

Handoff: READY_FOR_VERIFICATION for this pure slice. Parent retains sole runtime
integration ownership. Persistence/circuits/refills/retry/HTTP/task execution and
live verification are NOT RUN and NOT implemented. Pure tests cannot enable Free
Mode or establish backend/runtime release qualification. Sandbox and live app
remained unmanaged and untouched; no approval expansion inferred.
