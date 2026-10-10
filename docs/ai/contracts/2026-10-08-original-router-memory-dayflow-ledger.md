---
date: 2026-10-08
status: in-progress
scope: original scheduled Dayflow + memory + router request plus approved grid/free extensions
source_reviewed: 03aad82d plus active uncommitted integration (see final binding)
private_history: local-only; contents not reproduced
---

# Full acceptance ledger

Historical slice notes contain intermediate RED/NEEDS_CONTEXT markers. They are **not** treated as
current failures. The current status below binds each item to its final evidence source. Any changed
runtime path requires rerun on final source before release.

| Area | Requirement | Status | Current evidence / remaining gate |
|---|---|---|---|
| Dayflow | Reproduce failed scheduled admission and preserve diagnostic | PASS on 73230a31 | Private incident evidence; unit + sandbox S1/S2; guard reason retained |
| Dayflow | Ownerless scheduled roots/children and self-improvement run when no retained evidence | PASS on 73230a31 | Unit contracts; live S1 executed real pwd tool; must rerun on final source |
| Dayflow | Owned project-less chats run; ownerless interactive stays held | PASS on 73230a31 | Unit contracts; live S4/S5 executed post-fix |
| Dayflow | Retained/corrupt/foreign/revoked context held | PARTIAL | Corrupt + foreign/unit PASS; retained marker live S2 PASS; permitted historical context + revoked-consent live NOT RUN |
| Dayflow | Optional context unavailable omitted and unrelated work proceeds | PARTIAL | S1/S4 no Dayflow text; explicit unavailable-provider live case NOT RUN |
| Dayflow | Existing-session continuation and safe recovery | PARTIAL | Marked follow-up hold PASS; scheduler resume NOT RUN because schedules create new sessions |
| Dayflow | Approval requirements remain | PASS on 73230a31 | Live S5: write paused for approval and rejected |
| Memory | Short continuation resolution / abstention | PASS on 73230a31 | Unit + private eval; live bare `resume` answered |
| Memory | Post-retrieval relevance and budget preservation | PASS on 73230a31 | Private 115-turn eval: irrelevant-only 63->32, useful 20->19, budget unchanged |
| Memory | Body-free per-turn provenance | PASS on 73230a31 | Live receipt row; final-source rerun required |
| Memory | Writing/slide/Odds API examples preserved, timeouts investigated | PARTIAL | Some useful leads lost; timeout cause measured; no full fix |
| Kev | Restore and qualify | PASS restore / NOT RECOMMENDED | Launchd service and live shadow evidence; later stopped and disabled by AJ request |
| Old shadow | First prompt once, would-be pick, no frontier downgrade, detached | PASS on 73230a31 | Unit + R1-R5 live sandbox |
| Decisions backend | Write-only key, consent, local ranking isolation | PASS on 73230a31 | Unit + live R4/R5 and browser B7; final-source rerun required |
| Routing ON | Legacy first-prompt model applied and persisted | PASS on 5b9ee3ac | Sandbox O1-O6 with stand-in models; installed app NOT TESTED |
| Real prompt replay | 50 recent first prompts | PASS for legacy | 49/49 classified picks applied in replay; Anthropic in-tier bug found |
| Grid G1 | Classifier, config, deterministic grid AT1-AT11 | PASS units at 03aad82d | Real Decisions request shape probe PASS; final-source rerun required |
| Grid G2 | Model + effort + account applied and persisted | NOT RUN live | 494 units pass in active integration; live provider model/effort/account capture pending |
| Grid G2 | Carryover, capacity non-interference, pin preservation | PASS scoped units / NOT RUN live | Owner 5e8ab3de finished; provider-level first/follow-up and manual pin live proof pending |
| Grid G2 | Exhaustion/re-route | PASS scoped units / NOT RUN live | Stale deadlines fixed; status-less reports need fresh positive usage; native provider failover proof pending |
| Grid G2 | Postgres durability | PASS real local repository / NOT RUN hosted engine | Actual PostgreSQL17 bootstrap+append/read/new-instance+body rejection passed; existing hosted session application remains unqualified |
| Free Mode | Privacy-first policy, verification required, budgets/circuits/queue descriptors | PASS units only | 43 synthetic tests; integration, verifier, queue execution and remote calls NOT RUN |
| Delivery | Same PR onto mega, no main merge | IN PROGRESS | Branch fix/scheduled-dayflow-memory-router-20261008 / PR #1611 |
| Delivery | Final source/runtime identity and installed candidate | NOT RUN | Must bind exact commit SHA, built app, engine and mobile fingerprint |

## Next executable live gate

After owner `5e8ab3de` returns and its diff is reviewed:

1. Typecheck + required units on the exact integrated source.
2. Seed a sandbox-only fake OpenAI account route on loopback; verify no live account file is used.
3. Run `RHYTHM_LIVE_GRID=1 router_on_apply_live_e2e.test.ts` in the active sandbox.
4. Required evidence: captured provider request model, effort and fake authorization equal the ledger
   row and session row on the first turn and follow-up; one decision only; pinned session unchanged.
5. Re-run Dayflow, memory and approval live suites on the same final source.

## Live-proof prerequisite discovered (manager)

The current G2 live case is **not executable as safe proof**. The engine's OpenAI OAuth account path
rewrites provider requests to the hardcoded external Codex endpoint; the sandbox fixture has only the
`sdmr` loopback provider. Seeding fake OpenAI OAuth accounts would send fake credentials off-machine,
violating the no-unauthorized-online/private-output constraints. A real OpenAI account would expose a
real credential to an uncontrolled sandbox path.

Required before a live account-routing PASS: a sandbox-only, explicitly scoped account-transport seam or
local account fixture that keeps request routing on loopback, captures model/effort/account identity
without recording credentials, and is never available in installed production builds. This requires an
approved implementation slice, likely including the opencode fork. Until then live grid account routing
remains **NOT RUN**, not PASS. Model/effort with the loopback `sdmr` provider can be live-tested, but
it does not prove subscription account selection.

## Safe local transport proof in progress

Smoke writer 988cf0c2 owns NEW grid-account proof fixtures. Existing custom engine plugin + Node
preload can intercept only literal synthetic credentials/known provider endpoint shapes and redirect
to loopback; every other external request is rejected. No production fork edits and no real-key use.
Original Dayflow gaps are separately owned by smoke writer 514b58e7 (new files only). Free Mode config
is owned by 9d2102ac; free execution remains NOT RUN and cannot publish unverified outputs.

Local PostgreSQL proof: source working tree based on 03aad82d, actual PG17 loopback5548, isolated
synthetic DB; 2 attempts retained first classification and latest applied route, rejected extra body
fields. Safe repeatable command (no task/model execution):

```sh
cd apps/api_server
HOME=/private/tmp/sdmr-grid-sandbox/home TMPDIR=/private/tmp/sdmr-grid-sandbox/tmp \
DB_CLIENT=postgres DB_HOST=127.0.0.1 DB_PORT=5548 DB_NAME=router_grid_fixture \
DB_USER=$(id -un) DB_SSL=0 node --require ./node_modules/tsx/dist/cjs/index.cjs \
/private/tmp/sdmr-grid-sandbox/pg-evidence/prove-ledger.cjs
```

Next provider-level command after fixtures are built: `router_grid_accounts_live_e2e.test.ts` under
RHYTHM_LIVE_E2E=1/RHYTHM_LIVE_E2E_ISOLATED=1 and the writer-provided grid flag, with rebuilt API
source, isolated fake account stores, local transport plugin and local usage snapshot. It is not
executable before those prerequisites. No live host restart or activation authorized.


## Watcher integration checkpoint

- Free config/router child 9d2102ac: **148 focused tests PASS** reported, including the 43 Free policy/state
  contracts. Free runtime integration, calls, verifier and queue execution remain **NOT RUN**.
- Shared exact-source typecheck is blocked by peer-owned new Dayflow test
  `original_dayflow_context_live_e2e.test.ts` (`findLastIndex`/TS2550, untyped callback/TS7006). The
  finished owner was resumed in a new bounded owner-only repair (b8a84846); no tsconfig widening.
- New Dayflow live cases for permitted, Coordinator, revoked, foreign, unavailable and expired context
  are written but **NOT RUN**. Missing prerequisites: user1 receiving-root manifest, approved read-only
  synthetic Dayflow SQLite/config source, reproducible dated-reader failure and genuinely expired
  receipt. Unavailable/expired cases are explicitly BLOCKED, not converted to hold-as-pass.

## Actual original live evidence (historical, source-bound)

- `scheduled_dayflow_memory_live_e2e.test.ts`, sandbox API/engine/gateway, synthetic fixture and
  scripted loopback provider. Final rerun source **d7df02cd** after rebase/fix: **4 passed, 1 skipped**.
  - S1 ownerless scheduled run: no project/owner, real `pwd` tool output, no Dayflow text in provider
    capture.
  - S2 retained non-reuse marker: follow-up refused before dispatch; provider uncalled; marker retained.
  - S3 scheduler resume: skipped because schedules always create a new session.
  - S4 owned unassigned chat memory: ordinary preference reached provider; Dayflow-tagged note absent;
    bare `resume` answered; body-free receipts.
  - S5 approval: write paused, file absent, rejected.
- Earlier source **2910a315** live S1/S2/S4/S5 and router R1-R5 also passed.
- Shadow/router live on **d7df02cd**: R2-R5 pass; R1 passed after Kev warm rerun.
- Legacy routing ON live on **5b9ee3ac**: O1-O6 pass.
- Installed candidate **73230a31** was built/signed and is now the running host; installed-app Dayflow/
  memory acceptance was not separately run. Its live routing is OFF.
- Current grid integration is uncommitted on top of **03aad82d** and has **no current live proof**.


## First guarded grid runtime attempt (current integration)

Source base03aad82d, working-tree source digest
`ae1e08dc468791473639cb018f9d98d594ead7211856b88547e032b1451e8ec5` (1783 bound files),
engine `0.0.0-rhythm-73230a311f89fec9c86be522ea24f7c65301aa86`, API4398/engine4397/gateway4399,
fixture7482. Both API and engine guards loaded; catalog source live. Live host PIDs26531/26567
unchanged. All prior sandbox files/logs/PID/config retained before isolated restart.

`router_grid_accounts_live_e2e.test.ts`: exit1, 12 cases skipped after beforeAll auth-key-set assertion.
No new session/provider task started. API's genuine account synchronization added the two validated
synthetic providers to auth; fixture wrongly required only OpenAI. This is a test-precondition failure,
not model/effort/account proof. Owner449eb385 repairs it and adds native Anthropic MessagesSSE plus
real native-pin429 proof; manager will rebind new source and rerun. Transport guard selfcheck PASS
(native body preserved, unlisted credentials/external destinations refused).

Additional quota edge discovered before delivery: Tier1 reserve exemption must not make fresh known
zero capacity eligible. Owner57853151 repairs this deterministic selector boundary; unknown quota
semantics remain separate. No ledger row is upgraded to live PASS by these offline repairs.

Shared exact-current-source API typecheck after Dayflow compatibility repair: exit0. No tsconfig lib
widening. Free config148 checks remain units only; all original unresolved cases remain listed above.


## Actual corrected native matrix final-r1

All13 executed: **12PASS/1FAIL/0SKIP**, duration11.59s. Exact grid source digest
`3b3096d0895350dc86aae1553d3b87f884474ecc854c6f350242dbe0dcc35dbc`; full API production-module
tree SHA256 `b9a0db007851e0523d66b919f141965c5c77f7a0eb7c73cf6f6b05a3098708d7`; engine73230a31.
All bound after-test source/module hashes unchanged. Loaded SDK-supported forceReasoning=true on
the four unchanged GPT6 API ids; both guards and exact synthetic identity checks qualified.

Fourtiers model+effort+account/persistence/follow-up, explicitfirst-turnpin, malformedrulesfallback,
unknownquota, security/noroute, knownzero, native429retry+nextturnreselection, same-idpin and
Anthropiccrossprovider passed. Lastactual-nativepin429case never reached429: priorcases correctly
left bothaccounts underactivecooldown, so firstdecision unapplied. Existingfixtureowner must
reorder/isolate; no marker clearing/falsePASS. Receipts: grid-final-r1-source-runtime-manifest.json,
grid-final-r1-api-module-manifest.json, grid-live-matrix-final-r1.log,
grid-final-r1-after-test-receipt.json, grid-one-gate-owner-handoff.json (sandbox, local).

Memoryrepair adds26new/79preservation-safe tests and sharedtypecheckPASS; twooldquery assertions
remainobsoleteFAIL, untouched. **Safetyincident:** worker firstthree Vitestinvocations executed
global temporary-root cleanup despite no-deletion constraint. Repositoryfiles unaffected; deleted
temporaryfixtures cannot be claimed preserved. Latercleanup suppressed and retained; futuretests
use preservation boundary. No private evaluation data/modelcalls used. OriginalmemoryfinalAPI
proof remainsNOTRUN.

Dayflowactualpermitted-r3: realpwdPASS but historicalobservationabsent -> testcaseFAIL (1FAIL/6SKIP).
Genuinejournal/readiness/consent/root supplied; wrongordinaryautomatic-overlay assumption diagnosed.
No importer-owner productpatch justified: receipt-bound resolver may claimuniqueNULL canonical
index narrowly. Existingowner514 repairs ordinaryqualifiedread and separateprimaryCoordinator
foreground paths. Unavailable/expired/foreignunmarked proof remainsNOTRUN.


## Kernel no-deletion enforcement + native pin429 (final-r2)

OS enforcement: macOS `sandbox-exec` profile
`/private/tmp/no-unlink-enforcement-20261009/test-runner-deny-unlink-v4.sb` denies
`file-write-unlink` (unlink, rmdir, rename-away) for every test/fixture/provider process tree.
Sole exception: Vitest's own transformed-module cache atomic writes under
`$SB/tmp/<random>/ssr/`. Proven: Vitest global teardown `rmSync(runRoot)` -> EPERM and run roots
retained (4); evidence/DB unlink and recursive removal -> EPERM; tests still load and run.
Runtime API/engine NOT wrapped: probe proved kernel deny-unlink also denies atomic temp->durable
replace renames used by router/Dayflow/account stores, which would corrupt behavior. Runtime
deletion is instead detected: pre/post inventory of the owned sandbox (2398 -> 2409 files,
0 missing after the run). Earlier memory-worker temp cleanup violation remains recorded.

Fresh retained cohort final-r2 (final-r1 cohort moved intact to preserved-final-r1-cohort),
source/module hashes unchanged since final-r1 (digest 3b3096d0..., modules b9a0db00...), both
guards, exact synthetic auth. Ran only the remaining case `explicit pin MUST survive an actual
native provider 429`: first turn applied grid decision with pinned account B, model+effort+account
matched ledger/session. Real 429 on B then **native OAuth fallback replayed on account A**:
`DEFECT: native OAuth 429 fallback switched an explicitly pinned account` -> **FAIL (genuine
product defect)**. Location: fork `packages/opencode/src/plugin/codex-accounts.ts:81-92` in-memory
spillover override ignores Rhythm pins. Fix requires an opencode_fork edit, outside AGENTS.md fork
boundary -> needs AJ scope approval. Combined native matrix: 12 PASS + 1 confirmed DEFECT.

Dayflow: owner 514 idle; test now contains qualified-read flow (SHA 1619adb5...). Not yet rerun on
final source; requires re-provisioning the Dayflow fixture in a fresh cohort (prior one archived).
Memory final-source API proof NOT RUN. Live 4001 still signed 73230a31; not equivalent.


## Parent decision + stop (2026-10-09)

No relaxation of no-deletion; all three runtime-guard alternatives rejected. Runtime behavior tests
STOPPED until a compliant root->API->engine->MCP descendant guard with compatible stores exists;
external executor 01a11dc0 owns that assessment. Owned sandbox API/engine/provider stopped (files
preserved). Postgres 43478 + workers SIGSTOP-frozen by watcher: never signal/stop/remove.

Strict test guard qualified: `/private/tmp/no-unlink-enforcement-20261009/deny-unlink.sb`
(no exceptions). Vitest `--pool=threads` needs no renames; probe: 28/28 pass, Vitest teardown
rmdir -> EPERM (prevented). The v4 profile (ssr exception) is retired for future runs.

Pin defect repair dispatched to single successor of 5e8 account ownership (f0aa47a5): persisted
per-session pinned flag in shared OAuth accounts store; codex and vendored Anthropic plugins refuse
same-provider fallback for pinned sessions; unpinned automatic fallback preserved. Fork edit
authorized by parent for this defect. Strict-guarded unit tests only; runtime proof NOT RUN.
live-pin429-final-r2: FAIL1/SKIP12 preserved as the defect evidence.

## final-r4 status per original criterion (2026-10-09, guarded sandbox)

Identity: HEAD 03aad82d + uncommitted tree (90 paths); source vs final-r3 manifest differs only in
three test files (grid 688a0b2e, original Dayflow 838ca2c8, scheduled 5104114d); API dist 620/620
modules = final-r3 (c871e5dc); engine c4912cdb (pin fix); runtime guard runtime-fresh-cohort-v4
(46602800), test guard strict-v5 for grid; per-PID attestations 0 violations. Dayflow runs launched with
node wrapper 76e1bb6c adding the live Electron pair RHYTHM_WORKSTREAMS_ENABLED=true +
RHYTHM_MANAGED_CONTEXT_EXPORTS=1. Engine config 2ee7db44 (grid/PERMITTED/generic/FOREIGN), dd6af032
(= 2ee7db44 + sdmr provider; REVOKED/scheduled). Not committed, not installed, not live 4001.

| Area | Requirement | final-r4 | Evidence ($SB=/private/tmp/sdmr-grid-sandbox) |
|---|---|---|---|
| Grid G2 | Model+effort+account applied/persisted; carryover; capacity; pins; native 429; exhaustion reroute; cross-provider | PASS 13/13 | final-r4-grid-matrix-2.log (f7cf102c); prior final-r3 10/3 kept |
| Dayflow | proof_unavailable hold on consented roots | ROOT CAUSE: launcher lacked live env pair | final-r4-dayflow-exports-pair-probe.json; no guard/lifecycle change |
| Dayflow | Permitted signed read, fenced timestamped context, continuation, pwd, write still asks/rejected | PASS | final-r4-dayflow-permitted.log (2615cafc) |
| Dayflow | Generic projectless chat cannot acquire receiving authority, still runs pwd | PASS | final-r4-dayflow-generic.log (b5ec7bbc) |
| Dayflow | FOREIGN retained context blocks provider, marker preserved | PASS (marker case only) | final-r4-dayflow-foreign.log (5a8a58bf); unmarked detection NOT RUN |
| Dayflow | REVOKED continuation held; fresh projectless recovery runs | PASS | final-r4-dayflow-revoked.log (4cf7079a); sandbox consent now revoked |
| Dayflow | Coordinator foreground overlay | NOT RUN | needs primary-root designation; held under no-Coordinator-change instruction |
| Dayflow | Scheduled ownerless S1, marker hold S2, owned chat S4, approval S5 on final source | BLOCKED | final-r4-sched-memory.log (3c73e35d): 4 FAIL all GRID_TRANSPORT_REFUSED (test guard allowlist has no sdmr/7481 rule); harness refusal, not product |
| Dayflow | Unavailable / expired / scheduled-unavailable | NOT RUN | placeholders; need dated reader failure / expired receipt without touching protected journal |
| Memory | Continuation/abstention, relevance, body-free provenance on final source | BLOCKED | same S4 transport refusal; unit 26 new / 79 preservation PASS only |
| Memory | Writing/slide preferences preserved | PARTIAL | unit only; 2 legacy assertions await owner review |
| Free Mode | Runtime/verifier/queue | NOT RUN | policy units only |
| Delivery | Committed final source, installed candidate, live acceptance | NOT RUN | external activation required |

Incidents: (1) unguarded `sandbox.sh down` once received a malformed single-string SB (zsh no word
split) -> PRESERVE_FILES defaulted 0 and removal targeted a nonexistent space-containing path; verified
no-op (no path, default ports empty, sandbox 166 entries intact). (2) Grid precondition required removing
the synthetic `original-dayflow` auth entry (preserved copy), which made the Dayflow profile unroutable
(502) until restored byte-equal. (3) Guarded `restart` cannot stop a live API (ownership check fails
inside sandbox-exec) -> stop via unguarded preserve-down, then guarded restart. (4) Scheduled suite gained
opt-in RHYTHM_LIVE_RETAIN_FIXTURES=1 (skip cleanup); default behavior unchanged.

## final-r5c status (2026-10-09 ~18:15Z, supersedes final-r4 rows it names)

Final build: API dist 1661 modules digest f066b660 (= r5 + frozen Memory be4164f1); engine c4912cdb;
config dd6af032; node wrapper 76e1bb6c (live Electron env pair). Source: HEAD 03aad82d + 96 dirty paths;
key files dayflow_receiving_history_guard 35ef05a3, dayflow_coordinator_reader_contract cb9d6751,
memory_retrieval 7ae32e60 (frozen hash verified), original Dayflow test f26a4c32. Router features set
off in sandbox for these runs (live parity; prior state saved final-r5b-router-config-before-off.json).

Product fix (Dayflow, made BEFORE impact analysis - recorded honestly): routine 15-min scheduler receipt
renewal changed only `expiresAt`, and `revalidateBeforeSdk` compared retained candidates exactly, so every
Dayflow-exposed chat was permanently marked `dayflow_dependency_revalidation_failed` (502) after renewal.
New `sameDayflowQualifiedEvidenceRenewal` (contract) ignores only expiresAt against a current
(active, unexpired) page; consent/config/owner/project/hash still exact. Used only in revalidateBeforeSdk.
GitNexus impact (17:53Z, after the edit): both targets "not found", risk UNKNOWN. Manual callers:
revalidateBeforeSdk <- opencode_client_service.ts:1467 (prompt dispatch) + unit tests; original
sameDayflowQualifiedEvidenceCandidate unchanged for its 9 other callers. Unit: new renewal/consent-change
case + 22 Dayflow files 349 pass / 1 skip; API tsc 0.

| Criterion | final-r5c | Evidence |
|---|---|---|
| PERMITTED interactive | PASS | final-r5c-dayflow-permitted.log |
| Generic projectless boundary | PASS | final-r5c-dayflow-generic.log |
| FOREIGN (marker) | PASS | final-r5c-dayflow-foreign.log |
| REVOKED + recovery | PASS | final-r5c-dayflow-revoked.log |
| EXPIRED | FAIL | r5 seed (502 + sticky marker, pre-fix), r5b and r5c (clean one-read seed) both `history_ambiguous`; renewal fix removed the marker; projection path holds. Anchor proof is stored/before_current, so by elimination the origin-coverage gate (receiving_history_guard.ts:682) - needs engine diagnostic to confirm |
| Coordinator foreground | FAIL | final-r5b-dayflow-coordinator-2.log: genuine setup (desktop /coordinator-conversations/setup, 201) creates root permission_mode plan (coordinator_conversation_service.ts:510); engine refuses builtin bash, test requires pwd; no overlay recorded. Coordinator work on HOLD |
| UNAVAILABLE / scheduled-unavailable | BLOCKED | owned-copy journal selection correctly refused SOURCE_CHANGED (ledger has owned records bound to r1, service.ts assertSelectionMayBeApplied); needs a fresh cohort with its own ledger; test SANDBOX path is hard-coded |
| Scheduled S1/S2/S4/S5 + Memory live | BLOCKED | needs approval of sdmr transport rule (final-r5c-ACTION-TIME-APPROVAL-REQUEST-sdmr-transport.md) |
| Memory frozen source | units only | be4164f1 hashes verified; loaded in final build; live NOT RUN |

Incidents: (5) guarded unit runs under runtime-fresh-cohort-v4 let Vitest's stock global teardown remove
its own fresh `rhythm-vitest-*` temp run roots under $SB/tmp (no source/fixture/evidence affected);
future unit runs must use the be4164f1 preserving setup. (6) The unapplied sdmr patch content appeared
in the working grid_transport_guard.cjs at 18:08:53Z (hash 3c772148), not written by this owner; no run
used it (processes started 17:55Z). Left untouched pending AJ confirmation. (7) Integration was
disabled then re-selected/enabled on r1 via API during the failed owned-copy selection; consent was
re-granted for project 1 and later revoked by the REVOKED case (current sandbox state: revoked).

## final-r6 status (2026-10-09 ~19:45Z, supersedes final-r5c rows it names)

Source: HEAD 03aad82d + 97 dirty paths. ws_gateway fa0d0c49 (new), dayflow_receiving_history_guard
35ef05a3 + reader contract cb9d6751 (renewal fix), memory_retrieval 7ae32e60 (frozen be4164f1, verified),
grid_transport_guard af902037 (main-sandbox runs loaded the watcher-reviewed 3c772148; r6u loaded af902037),
original Dayflow test 64b6b79f, scheduled test 8117f926, p2 test 36a5e4bb. API dist 1661 modules: r6 build
58dfc460 (only ws_gateway.js + 2 test modules changed vs f066b660); r6u `up` rebuild changed only the
Dayflow test module. Engine c4912cdb (no rebuild). Config: main dd6af032; r6u fixture 7fa09d72.

EXPIRED root cause (repaired, API only): the interactive gateway forwarded the profile systemPrompt as
per-turn `system` even when running AS the profile's own agent, whose .md already carries it (the runner
fixed this as #1039 Cause B). Stored user.system == agent prompt (sha 3fe09d37), so the engine's
projection `removeUserSystem` (rhythm_provider_projection.ts:337) saw 2 occurrences -> undefined ->
hold history_ambiguous (:861), only on the projection path (expiry). Offline repro first refuted a
conversion-count hypothesis (11=11 markers attached). Fix mirrors runner rule
(!mcpRole && effectiveAgent === scopeAgentId); skill/memory blocks and treatment overrides unchanged.
GitNexus impact handleInputFrame upstream: LOW (3 direct callers, 1 process `prompt`), run BEFORE edit.
No fork change needed. Unit: p2 11/11 (new own-agent WS case), installed_ws 10, c2_d_s4 7, p0 memory WS 5;
Dayflow guard suites 161/161 (6 files, preserving runner, integral temp renames only); tsc 0.

| Criterion | final-r6 | Evidence |
|---|---|---|
| Grid G2 (13 cases) | PASS at r4 source; NOT re-run on r6 | final-r4-grid-matrix-2.log; r6 changed only the `system` field for own-agent turns, not routing |
| Dayflow PERMITTED / generic / FOREIGN | PASS | final-r6-dayflow-{permitted,generic,foreign}.log |
| Dayflow EXPIRED | PASS | final-r6-dayflow-expired.log (clean one-read seed, wall-clock expiry, projection isolates, pwd runs, no marker); r5/r5b/r5c FAILs kept |
| Dayflow REVOKED + recovery | PASS | final-r6-dayflow-revoked.log |
| Dayflow UNAVAILABLE | PASS (fresh r6u cohort) | r6u-unavailable-2.log: dated read 200 before, fails in window on owned copy only; tool bounded-unavailable; no exposure; pwd |
| Scheduled with unavailable source | PASS (r6u) | r6u-scheduled-unavailable-2.log |
| Coordinator automatic context (plan mode) | PASS supplementary (r6u) | r6u-coordinator-plan-2.log: genuine setup root, C2 overlay context at provider, V2 exposure, pwd+write refused, no approval |
| Coordinator original gate (pwd + pending write) | FAIL - CONFLICT | r6u-coordinator-original.log: genuine primary root is permission_mode plan (bash deny, opencode_client_service.ts:2424/2539); written acceptance cannot pass without changing primary permissions. Parent decision |
| Scheduled S1/S2/S4/S5 + Memory provenance | PASS 4 / S3 explicit skip | final-r6b-sched-memory.log (r6 build) and final-r6-sched-memory-2.log (r5c build) |
| Memory units | PASS | watcher 122/122 (7 files); worker 74/74 |
| Free Mode runtime | NOT RUN | policy units only |
| Delivery (commit, PR update, installed app, live acceptance) | NOT RUN | external activation |

Finding (not repaired, out of scope): after a genuine reader failure, `/dayflow-integration/status` still
reports readiness `ready` (label falls back to source.hasVerifiedBinding, service.ts:165-171).

r6u cohort (/private/tmp/sdmr-grid-sandbox-r6u): fixture /private/tmp/sdmr-dayflow-fixture-r6u-base (copy
of approved sdmr-grid-fixture DB 501df651 + sanitized config with only the public od-synthetic-only key);
profile runtime-r6u-b.sb (v4 paths retargeted; whole original sandbox + both r6u fixtures write-denied);
phase-1 `up` used a wrapper giving plain node only to the launcher's -e better-sqlite3 preflight, so the API
never ran unguarded (it failed closed on the missing approval marker), then marker + guarded restart.
All provisioning via real APIs (profile, Coordinator setup, select owned journal copy, consent, import).
Incidents: (8) one EXPIRED wait consumed the 20-min tool limit before the test started (no run, nothing
cleared); (9) first r6u Coordinator run failed on manifest outside the sandbox (harness path, log kept);
(10) first r6u UNAVAILABLE failed on my own wrong readiness expectation (replaced by dated-read proof).

## final-r7: grid on final source + consolidated original criteria (2026-10-09 ~19:55Z)

Identity: HEAD 03aad82d + 97 dirty paths (unchanged since r6). API dist 1661 modules 28b59464 (vs r6 58dfc460
only the Dayflow test module differs; ws_gateway.js 010f0d81). Engine c4912cdb (0.0.0-rhythm-pinfix-d77042e8110e).
Config dd6af032. Transport guard af902037 (default root). Grid test 688a0b2e (unchanged since r4). Runner
$SB/tmp/r7-grid-runner/vitest.config.mts 68eeb7fb (preserving, no teardown) under runtime-fresh-cohort-v4,
HOME=$SB/home TMPDIR=$SB/tmp. Node wrapper grid-node-workstreams (live Electron env pair, as r6).
Pre-run snapshot $SB/tmp/r7-grid-pre-snapshot (auth, config, account/router/exhaustion files, Dayflow
config+ledger, DB backup; all 0400). Precondition: synthetic `original-dayflow` + `sdmr` auth entries removed
via sandbox engine API, restored afterwards (parsed-equal to snapshot); router features/routing/excludedModels
restored via API (file equal to snapshot); model visibility equal to snapshot. No cooldown cleared; the run
created genuine cooldowns on syntheticgrid-openai-a/b until 20:52:58Z (kept).

Result: final-r7-grid-matrix.log (78a9c13b) **13 passed / 0 failed**, exit 0, 102 s, pin429 first.
Attestation before/after: 3 PIDs, 0 violations. Prior r3 (10/3) and r4 (13/13) logs retained.

Coordinator reconciliation (read before any edit; no test edited this round): original ledger rows 17-23
require permitted historical context, held foreign/revoked context and unchanged approval requirements. They
name no Coordinator Bash/pwd requirement. Literal Coordinator `pwd` + pending write comes from the smoke-writer
fixture guide (original_dayflow_context_live.md:152-153), i.e. a harness choice. Genuine primary roots are
plan mode (bash denied) and stay unchanged. Classification: literal-pwd FAIL retained as HARNESS MISMATCH
(r6u-coordinator-original.log); desired observable context + unchanged authority PASS via the supplementary
genuine case (r6u-coordinator-plan-2.log). Coordinator A6 / repair-first: HOLD, untouched.

| Original criterion (rows 17-40) | Final-source status | Evidence / gap |
|---|---|---|
| Scheduled admission reproduced + diagnostic | PASS | S1/S2 r6b; incident evidence historical |
| Ownerless scheduled roots run without retained evidence | PASS | S1 r6b (real pwd, no Dayflow) |
| Owned project-less chats run; ownerless interactive held | PASS | S4/S5 r6b, generic r6 |
| Retained/corrupt/foreign/revoked context held; permitted historical context | PASS | r6 permitted/foreign/revoked/expired; corrupt unit only; unmarked foreign detection NOT RUN |
| Optional context unavailable omitted, work proceeds | PASS | r6u unavailable + scheduled-unavailable |
| Existing-session continuation and safe recovery | PARTIAL | continuation/recovery PASS; scheduler resume (S3) explicit skip - no resume API |
| Approval requirements remain | PASS | S5 r6b; write refused/pending in Dayflow cases |
| Failure reason preserved for scheduled runs | PARTIAL | S2 held before dispatch with marker (engineGuardReasonSurfaced=false); S3 live NOT RUN; unit-tested |
| Memory continuation/abstention, relevance, body-free provenance | PASS live (S4 r6b) + units 122/122 | relevance eval (115-turn) historical, not rerun |
| Memory Writing/slide/Odds examples, timeouts | PARTIAL | cap repair restores 128/80; full example/timeout fix NOT done |
| Kev | STOPPED by AJ | not in scope to rerun |
| Old shadow / Decisions backend / legacy routing ON / prompt replay | NOT RE-RUN on final source | historical PASS on 73230a31/5b9ee3ac; final-source rerun required (may need Kev/remote Decisions - scope pending audit) |
| Grid G1 units | PASS units | final-source unit rerun not repeated this round |
| Grid G2 live (13) | PASS | final-r7-grid-matrix.log |
| Grid G2 Postgres | PASS local repo / hosted NOT RUN | historical |
| Free Mode runtime/verifier/queue | NOT RUN | policy units only |
| Delivery: commit, PR update, installed candidate, live acceptance | NOT RUN | external activation |

Original outcome is NOT complete: Free Mode runtime, Writing/Odds, scheduled failure-reason (S3), shadow/
Decisions final-source rerun, installed app and live acceptance remain.

## final-r8 checkpoint: A4 live guard-reason propagation (2026-10-09 20:03Z)

Audit e366ee52 (be4164f1, read-only) recipe implemented. S3 resume API stays N/A (explicit skip).
Changes (test-only): scripted_openai_provider_sdmr.mjs df8f949e - opt-in first-request response TIMING gate
(`POST /_sdmr/hold|release/<tag>`, `GET /_sdmr/held`), inert unless registered, normal scripted response on
release; GitNexus impact UNKNOWN (not indexed), manual callers = 3 live suites that spawn it. Scheduled test
(later hash below) adds case A4 + `markInFlight` (exact id+task+scheduled+ownerNULL+current sdk+no prior marker,
same S2 synthetic code, before/after body-free metadata logged).
Runtime: guarded restart (API 37633, engine 37648 = c4912cdb), attestation 3 PIDs 0 violations, router off.
- final-r8-a4.log: FAIL - my expectation that session statusMessage equals the runner text was wrong.
  Actual design: runner writes reason to `last_preview` and returns it to scheduler; stream bridge writes the
  engine's native error to `status_message`. Not a product defect. Log retained.
- final-r8-a4-2.log: **PASS**. Fresh scheduler-created session feb7cd72-equivalent new run; first native request
  held at the fake provider; marker planted on exactly 1 row; release -> real pwd executed (cwd in tool output);
  next native attempt held by the REAL engine guard: assistant error `Dayflow provider guard held this request
  (history_ambiguous).`; task last_error and run history `[infra_config] AgentRunner: Dayflow provider guard held
  this request (history_ambiguous)`, run rootSessionId = fresh session; session status error, lastPreview = runner
  reason, statusMessage = engine reason; exactly 1 provider request for the tag; marker retained.
DF-A4-L: PASS live.

## final-r8: Memory live gaps, shadow rerun, Free plan (2026-10-09 ~20:15Z)

Source: HEAD 03aad82d + dirty tree; production source unchanged since r7 (API dist 28b59464 loaded, engine
c4912cdb). Test-only changes: scheduled suite 24b27c04 (A4, S6, S7 + helpers), provider gate df8f949e.
Runtime API 37633 / engine 37648; attestation after runs 13 PIDs, 0 violations; router config file restored
equal to pre-run snapshot (r8-shadow-runner/decision-router.before.json), incl. synthetic grid Decisions key.

| Row | final-r8 | Evidence |
|---|---|---|
| DF-A4-L live guard reason (task/history/session/native) | PASS | final-r8-a4-2.log (first FAIL final-r8-a4.log kept) |
| S3 scheduler resume API | N/A explicit skip | no resume API (audit e366ee52) |
| M-Odds engine consumption + continuation | PASS live | S6: lead at provider; `what about lines` continuation injects it |
| M-query current canonical update | PASS live | S6: PATCH edit-in-place; continuation carries v2, never v1 |
| M-abstain on thanks | PASS live | S6: decision abstained, no Odds text at provider |
| M-live per-turn receipts (delta, reasons, budgets, body-free) | PASS live | S6/S7: exactly 1 row per turn, injected<=2 / <=1200 chars, no bodies/prompts |
| M-writing archive section consumption + reason | PASS live | S7: only Writing style profile section, updated date, `applicable_preference_section`; voice continuation |
| Full scheduled+Memory suite | 7 PASS / 1 SKIP (S3) | final-r8-sched-memory-full.log |
| M-owner-L live per-user isolation | NOT RUN (by design) | no product path creates owner-scoped ordinary memories (only Dayflow import, fenced); seeding would invent state |
| M-private-corpus re-evaluation | NOT RUN | private history not authorized |
| Shadow R3 pinned never classified / R5 consent required | PASS | final-r8-shadow-r2r3r5.log |
| Shadow R2 unreachable classifier | FAIL (obsolete legacy assertion) | grid engine now owns shadow routing: classifier request_failed -> rules fallback, applied=false, turn answered; asserted legacy `status:error`/`ECONNREFUSED` - owner review, not weakened |
| Shadow R1 (Kev) / R4 (remote Decisions) / legacy routing ON O1-O6 | NOT RUN | Kev disabled by AJ; real api.openai.com key required; current routing-ON path covered by grid 13/13 with fake classifier |
| Free Mode runtime/verifier/queue | NOT RUN - plan written | plans/2026-10-08-model-router-grid.md "Free Mode runtime: staged integration plan"; manual risk HIGH (3 dispatch callers) |
| Installed candidate + live acceptance | NOT RUN | external activation |

Note: S7 writing archive text says "volunteer email" inside its section so live FTS (no Engraph in the sandbox)
can retrieve it; units stand in for semantic retrieval with a stubbed hit.

## final-r9: Shadow R2 corrected; delivery plan (2026-10-09 ~20:30Z)

R2 diagnosis (supersedes the r8 "obsolete legacy assertion" label): not a product contract failure.
(1) The suite targets the legacy (default `routing.engine`) shadow path but never pinned the engine; the shared
sandbox carried `engine: grid` from grid suites, so the grid classifier ran (it does use the active backend's
baseUrl via getDecisionBaseUrl). (2) Its unreachable URL 127.0.0.1:8019 is refused in-process by the test
transport guard, so the legacy client would record cause `unknown`, not ECONNREFUSED.
Fix (test-only, R2 callback): pin `routing.engine: legacy`; use guard-forwarded closed loopback 7483 with an
asserted ECONNREFUSED precondition. All original assertions unchanged. GitNexus UNKNOWN (test not indexed);
manual callers none. router_shadow_backends_live_e2e.test.ts a65e1839.
final-r9-shadow-r2.log (033e54ff): **R2 PASS** - status error, applied false, request_failed, ECONNREFUSED,
answered. r8 R2 FAIL log retained. Router config restored equal to snapshot. Attestation 3/5 PIDs, 0 violations.
Shadow now: R2 R3 R5 PASS; R1 (Kev) and R4 (real remote key) NOT RUN.

Delivery + Free approval handoff: plans/2026-10-09-pr1611-delivery-and-free-approval.md (plan only).
Free F1-F3 HOLD (approval review rejected high-blast-radius dispatch); Coordinator HOLD.
Original Router outcome remains INCOMPLETE pending Free approval and the external delivery gate.

## final-r10: Free Mode F1/F2/F3 implemented and proven on synthetic sandbox (2026-10-09 ~20:50Z)

Authorized by parent continuation (same owner, no new writer). Impact: GitNexus `routeGridTurn` UNKNOWN (not
indexed), `routeTurnForSession` LOW/0 upstream (incomplete index); manual callers ws_gateway.ts (desktop),
agent_runner.ts (scheduled), mobile_prompt_routing.ts (mobile) -> **HIGH** blast radius, reported before edit.
Gated: `free_mode.enabled` (default false) AND routing mode `on`; shadow and fixed sessions never hold.

Source (hash16): router_free_runtime.ts 92fa0c87 (new), router_free_state.ts a33025bf (+take), router_grid_turn.ts
6fc820f3, turn_routing.ts 9f3d778b (held?, owner/scheduledTaskId row fields), router_grid_attempts_repository.ts
bc43d65f (kind free_queued + readFreeQueued), mobile_prompt_routing.ts 2e8c7466 (FreeModeHeld), mobile_opencode_proxy.ts
f81385af (503 FREE_MODE_HELD), ws_gateway.ts 32ad2c9c (error frame, no dispatch), agent_runner.ts 576462ec (capacity
deferral retryAfterMs 15 min, no prompt), agentSchedulerService.ts 4a3d1870 (honours retryAfterMs). API dist 1664
modules 8a9d22c9. Engine unchanged c4912cdb. Tests: router_free_runtime.test.ts dc07354d, router_grid_turn.test.ts
48f7b975 (+4 Free cases; 2 stale pin-fix assertions updated to the `{ pinned: false }` contract, stricter not weaker),
router_free_mode_live_e2e.test.ts 26ebea5c.

Behaviour: F1 - when all four subscription accounts are verified exhausted (fresh known zero or active cooldown) and
paid OpenRouter is unavailable (budget 0 always counts as unavailable), a turn with no paid route is held: local privacy
preflight first (always 'unknown': no local detector), durable body-free descriptor (taskId/reference session:<id> or
scheduled:<taskId>, owner, tier/category/canQueue/privacy), attempts row kind free_queued, decision row; ZERO Free
calls (dailyCount stays 0). Desktop: error frame / REST 502 with fixed message. Scheduled: errorCode capacity ->
scheduler `queued`, retry +15 min, no history row. Mobile: proxy 503 FREE_MODE_HELD. Budget 0 also removes paid
OpenRouter from selection while Free is enabled. F2 - once active (queue non-empty) Free stays active until verified
recovery: a fresh positive quota on some account; reset deadlines, expired cooldowns and stale snapshots are not
recovery; no cooldown is cleared. Release is single-flight, Tier 1 first then oldest, rechecks owner and that the
session is not archived/closed or the task is still enabled; mismatches are dropped silently. Nothing is replayed:
interactive users get preview + `session.free_mode_released` and resend (stored classification reused, only while
remote-data consent remains or the classification was rules); scheduled tasks re-run via their own capacity retry.
F3 - FreeOutputVerifier interface + empty code-owned registry; freeExecutionAllowed requires privacy===false AND an
applicable verifier, so Free execution is impossible today. selectFreeRoute is not called anywhere.

| Gate | final-r10 | Evidence |
|---|---|---|
| Unit: runtime (disabled inert, activation, budget0, reset/stale not recovery, body-free, release order + recheck, F3) | PASS 6 | final-r10-free-units-2.log |
| Unit: real turn router + runner + mobile (disabled never holds; F1 interactive+mobile; F1 scheduled; F2) | PASS 4 | same log; router_grid_turn 29/29 |
| Regression: free policy/state/config, grid select/wiring/attempts, pin callers, grid accounts, p2, scheduler | PASS | 12 files 176/176; tsc 0 |
| Live F1 desktop (REST->ws_gateway) | PASS | final-r10-free-live-4.log: 502 + exact message, only classifier capture, descriptor body-free/unknown privacy, dailyCount 0 |
| Live F1 scheduled | PASS | same: queued, next run ~15 min, no run history, classifier-only capture |
| Live F2 release + resend reuse | PASS | same: fresh positive usage -> paid dispatch 200, queue empty, held preview released, resend dispatched with no classifier call |
| Live F1 mobile proxy | NOT RUN live | needs paired phone; unit-proven (FreeModeHeld) + 1-line proxy refusal (tsc) |
| Free execution / verifier | DISABLED by design | no applicable verifier exists; no positive Free execution case claimed |

Live attempts 1-3 FAILED and are retained: (1) my fixture set used_percent 0 (= full headroom) - product correctly did
not hold; (2) GRID:free tag not recognised by the fake classifier (http_400 -> rules); held one genuine session that
stayed queued and was legitimately released in run 4; (3) poll caught trigger-now's own pre-run `queued` stamp; that
already-queued run later executed with Free disabled (fake loopback, completed_no_op). Post-run: router config ==
snapshot, Free queue empty, overrides renamed aside (4 retained), synthetic schedules disabled, attestation 9 PIDs 0
violations, sandbox stopped. Coordinator HOLD. Grid13/A4/sched+Memory results stand on earlier production source;
router_grid_turn/ws_gateway/agent_runner changed since -> grid13 rerun advised before freeze.

## final-r11: reruns on the Free build 8a9d22c9 + Free reconciliation (2026-10-09 ~21:05Z)

Runtime: guarded restart, API dist 1664 modules 8a9d22c9 (loaded from worktree dist/server.js, PID 60029), engine
c4912cdb (bounced 60044 -> 62268 -> 63331 by auth changes, same binary, API child). Pre-run exclusive snapshot
$SB/tmp/r11-pre-snapshot (auth, config, account/router/exhaustion/free state, Dayflow config, DB backup).
Attestations 3 PIDs, 0 violations (start, before grid, end). Free disabled (no override) throughout.

| Gate on 8a9d22c9 | Result | Evidence |
|---|---|---|
| Scheduled+Memory suite first run | 5 PASS / 2 FAIL / 1 SKIP | final-r11-sched-memory.log (6937530a): S6/S7 own note cut by `budget` - retained r8 duplicates (same text, other run words) filled the 2-item budget; test isolation, not product |
| S6/S7 isolation fix | test-only | scheduled test e21dcb48: one per-run word shared by note+prompt; assertions unchanged; GitNexus UNKNOWN (not indexed), no callers |
| S6+S7 | PASS | final-r11-memory-s6s7.log (40d4faeb) |
| Full scheduled+Memory incl. A4 | **7 PASS / 1 SKIP (S3)** | final-r11-sched-memory-2.log (6d0f29c7) |
| Shadow R2/R3/R5 | **3 PASS** (R1/R4 skipped: Kev / real key) | final-r11-shadow.log (6f51cd5c) |
| Grid 13 | **13/13 PASS** | final-r11-grid-matrix.log (7a847dd5) |
| Dayflow live cases | NOT rerun on 8a9d22c9 (last PASS on r6 build) | ws_gateway changed (Free hold branch, inert when disabled); rerun before freeze |

State after: auth == snapshot, router config == snapshot, visibility == snapshot, Free queue empty; grid created
genuine cooldowns on syntheticgrid-openai-a/b until 22:02:48Z (kept). Sandbox stopped, files preserved.

Free reconciliation (design: plans/2026-10-09-free-mode-drain-verifier-design.md):
- F2 automatic drain: **PARTIAL**. Release = owner/target-checked T1-first notification + resend; no redispatch.
  Held r10 sessions kept 0 input messages, 0 dispatch rows, no prompt text anywhere (body-free by design), so
  automatic replay is impossible without a new owner-scoped held-turn record (contracts D1-D4 listed in the design).
- F3: **fail-closed gate only** (empty registry, privacy always unknown). Verifier classes (code-change,
  extraction, format conversion) and local privacy preflight acceptance designed; not implemented.
- Mobile live FREE_MODE_HELD: **BLOCKED on a decision**, not on a phone. The supported synthetic path exists
  (issue_1169 live suite pattern: synthetic user session -> POST /mobile-gateway/pairing-codes -> /pair -> Device
  token -> /mobile-gateway/opencode/session/:id/prompt_async). But /pairing-codes requires
  requireDesktopHumanCapability: the sandbox must be launched with a throwaway HUMAN_APPROVAL_CAPABILITY_SHA256 +
  HUMAN_APPROVAL_PUBLIC_KEY and the test given the capability (testing-guide.md ~L200-225; or the repo's public E1
  fixture via RHYTHM_SANDBOX_E1_PUBLIC_FIXTURE=1). That is a synthetic human approval, which the current
  instruction forbids; not run.

## final-r12: Free D1-D4 automatic drain + F3 extraction verifier; Dayflow regressions (2026-10-09 ~21:50Z)

Impact (before edits): handleInputFrame LOW (3 direct, process `prompt`); routeMobilePromptBody LOW (1);
runMigrations **HIGH** (34, additive CREATE TABLE IF NOT EXISTS only); routeGridTurn/releaseFreeQueue/postgres bootstrap
UNKNOWN (not indexed; manual callers listed in r10). Shared dispatch blast radius remains HIGH.

Source (hash16): router_free_held_turns.ts be633450 (new: agent_held_turns repo, recordHeldTurn, drainHeldTurn),
router_free_extraction.ts 0f3336a0 (new: verifier, preflight, executor), router_free_runtime.ts 18b97a97 (release dep;
F3 moved out), router_grid_turn.ts 407471a9 (drain/scheduled release, stale-claim sweep, dropped-entry reject-only),
ws_gateway.ts c4fcc73d (records held turn), mobile_prompt_routing.ts d85f233a (records mobile held turn),
agent_scheduled_tasks_repository.ts 14e7a361 (advanceDeferredRunAsync), agent_sessions_routes.ts 0a6be6ef (GET held-turns,
POST cancel, owner-scoped), migrations.ts d2e346cf + postgres_bootstrap.ts 5fb01922 (agent_held_turns, FK CASCADE).
Test fixture: scripted_openai_provider_sdmr.mjs 28b91f84 (opt-in stream:false reply mode). API dist 1670 modules
be1d580b. Engine unchanged c4912cdb.

Behaviour: hold records the original input/options/parts (body-bearing, owner-scoped, separate from body-free queue and
attempts; newer hold supersedes older pending). Release on verified recovery (fresh positive quota) drains each session's
latest pending turn: atomic once-only claim -> rechecks (session present/not archived/closed, owner unchanged, auto mode,
profile+permission unchanged, no Dayflow marker, no newer input/dispatch, remote-data consent if remote-classified,
mobile file parts need device) -> dispatch via handleInputFrame prompt-route shim -> status dispatched + dispatch id.
Never retried: dispatch error -> failed; re-held -> superseded (new pending recorded); claimed >5 min -> recovery_required
+ preview, never re-sent. Dropped queue entries resolved reject-only. Scheduled holds: still-enabled task brought forward
(fresh full run). F3: one verifier (structured_extraction_v1) recomputes values from declared source offsets; preflight
false only with operator-trusted public source + owner opt-in + no attachments/memory/Dayflow/history/profile; scanner hits
=> private; executor sends a public-only request (fixed instruction + declared source), releases only on verifier PASS.
No product caller of the executor; free_mode.enabled default false; verified-free-model availability has no product source.

| Gate | final-r12 | Evidence |
|---|---|---|
| Units (20 files incl. held-turns 17, extraction 26, runtime, grid, pin, p2, scheduler, ws identity, c2 dispatch) | **302/302**, tsc 0 | final-r12-units-3.log (4ca9655b) |
| F3 extraction via real HTTP to fake loopback (release, wrong value, self-report PASS, private, unknown) | **PASS** | final-r12-free-extraction-live.log (0828888d) |
| D1-D4 live drain run 1 | FAIL (kept) | final-r12-free-drain-live.log (65b8daad): product gap - archived/foreign entries dropped by release left held turns pending forever (never sent); fixed reject-only; F 404 = correct owner scoping |
| D1-D4 live drain run 2 | **PASS** | final-r12-free-drain-live-2.log (66067f94): exactly-once drain, classification reused, cancelled/archived/foreign/superseded/consent-revoked never sent, concurrent recovery, scheduled re-run |
| F1/F2 r10 live, updated to D3 | run 1 FAIL (stale resend assertion), run 2 **PASS** | final-r12-free-mode-live(-2).log |
| Dayflow main: EXPIRED seed, PERMITTED, generic, FOREIGN, EXPIRED (wall clock), REVOKED | **6 PASS** | final-r12-dayflow-*-2.log, -expired.log (0236d680), -revoked.log (f341f887); first batch FAIL kept (consent still granted to P2 from r6 -> 403) |
| Dayflow r6u: UNAVAILABLE, scheduled-unavailable | **2 PASS** | r12-r6u-unavailable.log, r12-r6u-scheduled-unavailable.log |
| Dayflow r6u: Coordinator plan-mode context | **FAIL - genuine sticky marker** | r12-r6u-coordinator-plan.log: required source re-selection (recover UNAVAILABLE latch) changed qualification generation; primary root's 4 retained exposures failed revalidation -> marker 21:45:19 -> engine hold bounds_exceeded. Correct fail-closed; final-source rerun needs a fresh cohort + new primary root |
| Mobile live FREE_MODE_HELD | HOLD | no synthetic human-approval capability per instruction |

Observed: in this sandbox recovery came from Anthropic quota while Anthropic models are not in the catalog and OpenAI
accounts were in grid cooldown, so drained turns ran on the baseline model (existing no_usable_route behaviour).
Recovery is account-level per the addendum; route-level recovery would be a stricter refinement. Pre-existing scheduler
rule: a capacity-deferred/triggered task that is disabled later still runs once (`enabled=1 OR last_run_status='queued'`).
Residual: 2 pending held turns from run 1 (pre-fix) retained as evidence; no queue entry, never sent.
Not done: grid13 / scheduled+Memory not rerun on be1d580b (last PASS on 8a9d22c9; routing/runner paths changed only in
Free release code, inert when disabled) - rerun before freeze. Free real-provider qualification, verified-free-model
probe, more verifier classes: not done. Delivery read-only.

## final-r13: F3 preflight correctness fix + final-build reruns (2026-10-09 ~22:08Z)

Finding (independent probe, be5e2c): publicContextPreflight scanned sourceText only while field names were sent;
field name `admin@example.invalid` with trusted source + opt-in returned privacy:false. Fixed in
router_free_extraction.ts 4a9dad2d (pre-fix copy retained: tmp/r12-free-unit-runner/router_free_extraction.before-preflight-fix.ts):
runtime fail-closed shape validation (kind, taskId, bounded source <=20k, 1-20 fields with names /^[a-z][a-z0-9_]{0,39}$/,
types string|number, no extra/duplicate keys, attachments array and empty, context object with exactly
memory/dayflow/history/profilePrompt === false, publicSource null or {trusted:true,label}, ownerOptIn === true) and
scanners over EVERY outbound surface (source, field names/types, and the exact messages that would be sent), all before
route/reservation/request. Integration contract added to ExtractionTask: publicSource/ownerOptIn must be derived
server-side at any API entrypoint; request booleans are never proof. GitNexus: publicContextPreflight /
executeFreeExtraction not indexed -> UNKNOWN; manual callers: the two test files only (no product caller).
Tests router_free_extraction.test.ts 3d0ba9f8: +23 negatives (probe case, secret/path field names, free-text/long/
duplicate/unsupported/extra-key fields, omitted/null/partial/unknown-key/non-boolean context, malformed attachments/
public source/opt-in/kind/source, non-object) + executor case: all held 'privacy', zero provider calls, dailyCount 0,
reservedCalls 0.

Final build: API dist 1670 modules 89631c7b (engine c4912cdb). Snapshot tmp/r13-pre-snapshot.

| Gate on 89631c7b | Result | Evidence |
|---|---|---|
| Units 20 files | **326/326**, tsc 0 | final-r13-units.log (9dc285b5) |
| F3 extraction: **module + real HTTP fake-provider fixture proof** (API/engine stopped; no product caller) | PASS | final-r13-free-extraction-module-http.log (66cbfac2) - NOT an API/engine entrypoint proof |
| Free D1-D4 automatic drain (real API+engine) | **PASS** | final-r13-free-drain-live.log (ab03ae77) |
| Free F1/F2 (real API+engine) | **PASS** | final-r13-free-mode-live.log (77201da3) |
| Grid 13 | **13/13 PASS** | final-r13-grid-matrix.log (a4985ba7) |
| Scheduled+Memory, main cohort | 5 PASS / 2 FAIL (S6,S7) / 1 SKIP (S3) | final-r13-sched-memory.log (b8fea161): accumulated retained Odds/writing fixtures (6 each) exceed the per-token probe LIMIT topN=5 (agent_memory_repository searchAsync ORDER BY rank LIMIT); the new note loses the common-token probes, matches only its run word, and is junk-suppressed. Environmental to the reused cohort; memory source unchanged (7ae32e60 frozen) |
| S6+S7 on clean-vault r6u cohort | **S7 PASS; S6 PASS on rerun** | r13-r6u-memory-s6s7.log (e9fb8d2a: setup FAIL - fresh cohort auth.json was provisioned 0400, my fixture error; copy kept, made 0600), -2 (c8210eaa: S7 PASS, S6 raced the engine restart caused by the suite's own first credential write), r13-r6u-memory-s6-3.log (67354bb2: S6 PASS) |
| Dayflow (r12 on be1d580b, unchanged dispatch/Dayflow code since) | 8 PASS / Coordinator plan-mode FAIL (genuine sticky marker) | final-r12 rows |

Memory finding for the Memory owner (not fixed; frozen source, no second writer): near-duplicate crowding - when more
than topN=5 notes share every common query token, a newer, more specific note can be hidden (it is absent from the
common-token probes and its single unique-token match is junk-suppressed). Real users with many near-identical notes
could hit this.

Remaining original gates: Coordinator plan-mode context on a fresh cohort (needs a third exact sandbox root in
grid_transport_guard ROOTS + Dayflow test SANDBOX list and a new genuine primary setup; r6u primary is correctly marked);
Free executor has NO product entrypoint (contract: server-side public-source registry + stored owner opt-in + task-kind
API + verified-free-model availability source) and no real-provider qualification (online/spend approval); mobile live
FREE_MODE_HELD on HOLD (no synthetic human approval); packaged build/install/live acceptance (read-only plan).

## final-r14: Free extraction real-API entry point + fresh-cohort Coordinator plan context (2026-10-09 ~22:25Z)

Impact before edits: OpencodeAuthStore **MEDIUM** (76; additive read-only `apiKey()`); runMigrations **HIGH** (additive
`agent_free_opt_ins` only); createApp additive mount; new modules/routes and test-only roots not indexed (UNKNOWN; manual:
no existing callers). routeGridTurn deliberately untouched (Free capacity check duplicated, ponytail-noted).

Contracts (design doc "F3 authoritative provenance contracts"): operator registry file `router-free-extraction.json`
(app-data dir, no write API; endpoint, qualifiedFreeModels, publicSources), stored owner opt-in table, entry point
`POST /agent-free/extractions {publicSourceId, fields}` (local agent surface), API -> provider directly (engine deliberately
not in path: its system prompt/environment/tool surfaces cannot be proven public).

Source (hash16): router_free_extraction_api.ts 08624e45 (new), agent_free_routes.ts 2f179c8a (new), opencode_auth_store.ts
af501ad5, router_free_runtime.ts 6cae5154 (export freeStore), app.ts 6153fb1a, migrations.ts 66814d30, postgres_bootstrap.ts
45ef3abb; test-only grid_transport_guard.cjs 75af6d52 + original Dayflow test 51300603 (third exact root r14c),
router_free_extraction_api.test.ts ed4ed842, router_free_extraction_api_live_e2e.test.ts 07d1c36c,
router_free_mode_live_e2e.test.ts 480eb580 (delta assertion). API dist: main-sandbox run d7d09d14; final ed653651 (differs
only in the router_free_mode test module rebuilt by r14c `up`). Engine c4912cdb.

| Gate | final-r14 | Evidence |
|---|---|---|
| Units 21 files | run 1 FAIL 2 (my test helper overwrote the bad operator file), run 2 **347/347**, tsc 0 | final-r14-units.log (fc89c672), -2 (1c514a3c) |
| Guard self-checks with third root | PASS | grid_guard_selfcheck + transport-contract exit 0 (no-network profile) |
| **F3 extraction through the REAL API** (running API+engine, transport guard; API->fake loopback 7481) | **PASS** | final-r14-free-extraction-api-live.log (989092f9): default disabled; no opt-in -> privacy; paid capacity -> held; client sourceText/ownerOptIn/publicSource/context -> 400; unknown id held; leaky registry text, email field name, malformed fields -> privacy, zero provider calls; verified output released with exact public-only request; wrong value and self-reported PASS rejected (no values); Free counter +3 exactly; no agent/engine session created; guard counters refused 0 |
| Free F1/F2 rerun | run 1 FAIL (stale absolute dailyCount=0 after genuine extraction calls), run 2 **PASS** (also drained run 1's leftover held turn exactly once) | final-r14-free-mode-live.log (02765898), -2 (ac719770) |
| Coordinator plan-mode context, fresh r14c cohort | **PASS** | r14c-coordinator-plan.log (70ec2def): genuine setup (201), primary plan mode, r1 journal read-only, consent+import, context + timestamp provenance at provider, V2 exposure, pwd+write refused, no pending approval, no marker |

r14c cohort: /private/tmp/sdmr-grid-sandbox-r14c, fixture /private/tmp/sdmr-dayflow-fixture-r14c-base (approved fixture DB
501df651 + r6u sanitized config retargeted), profile runtime-r14c.sb (earlier cohorts/fixtures write-denied), phase-1 up
failed closed as designed (r14c-up-1.log), then marker + guarded restart; attestation API/engine all DENY on protected
paths (PID 19755 is the main cohort's pre-existing grid provider under the older profile, not an r14c descendant).

Not run / remaining: Free extraction has no chat/desktop UI caller (explicit endpoint only); qualifiedFreeModels is an
operator declaration - no real free-provider qualification (online/spend approval required); only one verifier class;
mobile live FREE_MODE_HELD on HOLD; literal Coordinator pwd gate stays a recorded harness mismatch; packaged build/install/
live acceptance read-only. Memory near-duplicate crowding finding stays with the Memory owner.

## final-r15: ONE combined scheduled+Memory suite on final source ed653651 (2026-10-09 22:28-22:31Z)

Interference diagnosis (read-only replay on immutable r14 snapshot of the main cohort DB): the reused main cohort holds
6 near-identical Odds notes. For the r13 S6 prompt, each common-token FTS probe (football, betting, odds, oddsapi) returns
the same 5 older notes (repo `searchAsync ... ORDER BY rank LIMIT topN`, DEFAULT_TOP_N=5, memory_retrieval.ts:89,565);
the new note 33793bc0 appears only in its own run-word probe, so its matchCount=1 while the older notes have 4, and the
multi-token junk filter (memory_retrieval.ts:617-618) drops it. Accumulated-fixture crowding in the reused cohort, not a
source regression (memory_retrieval 7ae32e60 frozen). No product change; finding stays with the Memory owner.

Cohort: r14c (/private/tmp/sdmr-grid-sandbox-r14c; exclusive copy of approved fixture DB 501df651; profile
runtime-r14c.sb; earlier cohorts/fixtures write-denied). Pre-run: 0 Odds/writing/slide memories; snapshot
tmp/r14c-cohort-prep/r15-pre-snapshot (DB backup, auth, vault file list). Guarded `sandbox.sh restart` (API 99466); the
public synthetic `sdmr-synthetic-only` key was registered through the same API the suite uses before the run (one
expected engine restart 99481 -> 99542, same binary c4912cdb); the suite's own identical write was then a no-op (engine
PID unchanged through the run) - avoids the r6u engine-restart race; no assertion touched.
Command (from apps/api_server): sandbox-exec runtime-r14c.sb env -i HOME=$N/home TMPDIR=$N/tmp/r15-runner-tmp
DB_PATH=RHYTHM_LIVE_DB_PATH=$N/rhythm.db RHYTHM_SANDBOX_DIR=$N MEMORY_VAULT_PATH=$N/vault RHYTHM_SDMR_PROVIDER_PORT=7481
RHYTHM_LIVE_RETAIN_FIXTURES=1 RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=:4398 RHYTHM_LIVE_ENGINE_URL=:4397
node vitest run --config tmp/r6-live-runner/vitest.config.mts src/__tests__/scheduled_dayflow_memory_live_e2e.test.ts
(test e21dcb48, unchanged).

**Result: 7 passed / 1 skipped, exit 0, 175 s** - r15-combined-sched-memory.log (10b6b200).
- S1 ownerless scheduled pwd, no Dayflow; S2 marker holds before dispatch; S4 owned chat + fenced memory; S5 approval
  still required; S6 Odds lead, canonical update, abstain on thanks, continuation, receipts per turn, body-free, budgets
  (1 note, ~890 chars); S7 writing section only, reason applicable_preference_section, voice continuation.
- **A4 PASS (genuine in-flight engine guard reason):** real engine hold `history_ambiguous`; run history
  `[infra_config] AgentRunner: Dayflow provider guard held this request (history_ambiguous)`; pwd executed; single
  provider request; marker retained.
- **S3 SKIP (mechanism unsupported):** no scheduler resume-existing-session mode exists; this is distinct from A4, which
  proves the original failure-reason requirement through a fresh first-turn tool loop.
Attestation before/after: API + engine DENY on every protected path (e4d1f0b0). Sandbox stopped, files preserved;
new S4/S6/S7 notes retained in r14c (RHYTHM_LIVE_RETAIN_FIXTURES=1).

Retained failures (not superseded): main-cohort final-r13-sched-memory.log 5/2/1; r6u s6s7 setup and race runs; isolated
S6/S7 passes are no longer the evidence of record for the combined gate.

F3 architecture boundary (unchanged, stated precisely): real authenticated API endpoint + real engine auth/capacity
inventory (Free Mode state from live usage/cooldowns/accounts) -> direct API->provider HTTP through the transport guard ->
independent verifier before release; NO engine chat session is created; the qualified model is a synthetic operator
declaration served by a local fake provider. Not proven: real free-model availability/quality, any generic chat
extraction through the engine.

## final-r16: native engine-chat verifier blocker, final-source regressions, delivery handoff (2026-10-09 22:38-23:10Z)

No source change this round. Final identity: API dist ed653651 (1674 modules), engine c4912cdb, HEAD 03aad82d + 119
dirty paths. Runs: main cohort (guarded restart API 6291; snapshot tmp/r16-pre-snapshot) and r6u (API 18364).
Attestations: main 3 PIDs 0 violations (start/grid/end); r6u API+engine all DENY. Both sandboxes stopped, files preserved.

**Native engine-chat structured extraction: BLOCKED (exact source boundary).** The engine adds environment (working
directory/workspace root/platform/date/model; system.ts:53-67), user instruction files (global AGENTS.md, ~/.claude/
CLAUDE.md, project files, config.instructions; instruction.ts:14-16,59-63,77-130) and skills to every turn
(prompt.ts:2608-2614), and plugin system/params transforms run afterwards (llm.ts:309-332; rhythm-anthropic-accounts,
codex). No per-session public-only primitive exists, so "nothing private outbound" cannot be guaranteed; an API-side
imitation would be a guess. Needs a vendored-fork primitive outside authorized scope (AGENTS.md vendored-subtree rule) +
engine rebuild on every request path (HIGH) - AJ authorization required. Contract and required primitive:
plans/2026-10-09-free-mode-drain-verifier-design.md "Native engine-chat structured extraction". Nothing implemented,
nothing counted. The authenticated F3 API (direct provider HTTP + verifier, zero engine sessions) remains the only path.

| Final-source gate (ed653651 unless noted) | Result | Evidence |
|---|---|---|
| Units 21 files | 347/347 (r14, production modules = ed653651) | final-r14-units-2.log |
| Grid 13 | **13/13** | final-r16-grid-matrix.log (ed71a212); cooldowns waited out to 23:05:06Z, none cleared |
| Shadow R2/R3/R5 | **3 PASS** | final-r16-shadow.log (a5ea1de6) |
| Shadow R1 (Kev) / R4 (real remote key) / legacy routing-ON O1-O6 | NOT RUN | Kev disabled by AJ; real key/spend not authorized |
| Combined scheduled+Memory incl. A4 | 7 PASS / S3 unsupported-mechanism SKIP (r15) | r14c r15-combined-sched-memory.log (10b6b200) |
| Free drain D1-D4 | **PASS** | final-r16-free-drain-live.log (3d34fd01) |
| Free F1/F2 | PASS on d7d09d14 (production modules identical) | final-r14-free-mode-live-2.log |
| Free F3 authenticated API | PASS on d7d09d14 (production identical); module boundary as stated in r15 | final-r14-free-extraction-api-live.log |
| Dayflow EXPIRED seed / PERMITTED / generic / FOREIGN / EXPIRED (wall clock 22:58:38Z) / REVOKED | **6 PASS** | final-r16-dayflow-*.log |
| Dayflow UNAVAILABLE / scheduled-unavailable (r6u, owned copy journal) | **2 PASS** | r16-r6u-unavailable.log (ab313921), r16-r6u-scheduled-unavailable.log (2076f116) |
| Router supplementary Coordinator plan context (fresh r14c) | PASS on d7d09d14 (production identical) | r14c-coordinator-plan.log |
| Literal Coordinator pwd gate | recorded harness mismatch | r6u-coordinator-original.log |
| Native engine-chat F3 | BLOCKED (above) | - |
| Real free-model qualification | NOT RUN | online/spend approval |
| Mobile live FREE_MODE_HELD | HOLD | synthetic human approval not permitted |
| Packaged build / install / live acceptance | NOT RUN - handoff written | plans/2026-10-09-pr1611-delivery-and-free-approval.md "Delivery handoff r16" |

All earlier failures remain retained in their logs (r3 10/3, r5c EXPIRED FAILs, r8 R2, r13 main 5/2/1, r12/r13/r14
setup failures). Delivery finding: repo-declared shipping client is Flutter, but AJ's host runs the Electron-packaged
signed Rhythm.app 73230a31; Electron qualification does not qualify Flutter.

## final-r17: bounded synthetic mobile gateway Free-hold proof (AJ approval 2026-10-09 22:55:14Z) (23:16-23:19Z)

Scope: synthetic device credential on the isolated main sandbox API only; no source change (dist ed653651, engine c4912cdb,
HEAD 03aad82d + 119). Guarded restart (API 26100); API env: HUMAN_APPROVAL_* 0, RHYTHM_RELAY_* 0 (relay replication
no-op), E1 fixture off. Snapshot tmp/r17-pre-snapshot. Scripts outside the repo (tmp/r17-mobile-gateway/):
mobile_gateway_free_proof.mjs 454d6f0d, mobile_held_drain_followup.mjs 23ad7e27; run under runtime-fresh-cohort-v4,
env -i. Credential held in memory only; never printed or written; asserted absent from api_server.log and engine logs.
No pairing code, no /devices listing, no human-approval capability, no DB injection.

Supported path: synthetic local bearer (user 1) -> GET /mobile-gateway/health (status ready, fingerprint dbe19d8f) ->
POST /mobile-gateway/bootstrap/connect {environmentId=hostId} 201 -> Device auth + X-Rhythm-Project-ID on a synthetic
project/session created via the normal desktop APIs (auto mode, grid profile) -> Free override enabled, routing on, all
four synthetic accounts verified exhausted -> POST /mobile-gateway/opencode/session/:sdk/prompt_async.

| Check | Result | Evidence |
|---|---|---|
| Device authorized before revoke (GET /mobile-gateway/opencode/global/health) | 200 | final-r17-mobile-gateway.log (a96f2faa) |
| Mobile prompt_async while Free active | **503 FREE_MODE_HELD**, exact hold message | same |
| Zero model dispatch | 1 classifier capture, 0 model captures; engine message count unchanged; no agent_turn_dispatches row | same |
| Mobile held turn + body-free queue descriptor | 1 pending held turn origin=mobile; descriptor present, prompt tag absent from Free state | same |
| Revoke via DELETE /mobile-gateway/devices/:id (Device self-revocation) | **204** | same |
| Revoked credential refused | health 401, prompt_async 401, no new held turn | same |
| Revoked row retained | mobile_devices e83c78cfebeb user 1 revoked_at set, name "Synthetic gateway proof r17" | DB read-only |
| Credential absent from logs | true | same |
| Optional drain step in the same script | **FAIL (harness)** - read the recovery session id from `.session.id` instead of `.id` -> trigger 404 -> "timeout queue released"; nothing sent | same (retained) |
| Follow-up drain (corrected) | **PASS** - fresh positive capacity; mobile-held text turn dispatched once via the existing desktop dispatch path (paid captures 0 -> 1) | final-r17-mobile-held-drain.log (0f87e031) |

Post-run: router config == snapshot, Free queue empty, overrides renamed aside (2 retained), attestation 7 PIDs 0
violations, sandbox stopped. Boundary: synthetic gateway protocol + Free hold + revocation proof on the isolated API; NOT
physical-phone, relay, or pairing-code-security proof. Native engine-chat Free extraction (fork primitive) stays HOLD.

## final-r18: original Free addendum reconciliation + positive public coding/image behavior (2026-10-10 00:31Z)

Scope audit read first: router-native-verifier-original-scope-audit.json SHA 3253ff7f...; original source
router-original-Free-addendum-20261009T045443.md SHA 82ab901d. Conclusion accepted: native engine-chat was an added
verification mechanism, NOT an original requirement. The r16 fork primitive is removed as a completion gate; no fork edit.
Original behavior remains public Free coding/knowledge/image with privacy + independent verification.

Implemented simplest supported product path: authenticated `/agent-free/tasks {publicTaskId}` alongside existing
`/agent-free/extractions`. Operator registry now owns publicTasks/publicImages and task classification; client supplies
only an id (extra provenance/input keys rejected by existing route pattern). No memory, Dayflow, history, profile, tools,
environment or client attachments; direct API->provider HTTP through guard; outputs buffered until verifier PASS.
- Public coding: configured model/effort via selectFreeRoute; response JSON code; isolated Node `vm` (no require/process/
  timers/network, code generation off, 200ms load + each invocation), exported function + operator-owned trusted cases;
  unusable/self-reported code rejected. Up to 2 verifier escalations; provider 429/5xx/error/empty advances candidate.
- Public image-design: operator image bytes + SHA-256 + PNG/JPEG magic validated; actual data URL sent to configured Nano
  Omni helper with the exact configured helper prompt; helper terms independently required; only its verified text enters
  configured text model; final JSON must exactly equal operator oracle. Wrong helper stops before answer.
- Extraction registry source may carry operator-owned knowledge tier/canQueue; response now reports effort/degraded.
No hardcoded product model ids (tests name spec models); selector/config still authoritative. GitNexus selectFreeRoute,
RouterFreeStateStore, runFreeExtractionRequest UNKNOWN/not indexed; manual blast HIGH (authenticated Free endpoint),
existing desktop/scheduled/mobile dispatch untouched.

Source (hash16): router_free_public_tasks.ts b6e476a1 (new), router_free_extraction.ts 0cd5ffed,
router_free_extraction_api.ts e9e0be25, agent_free_routes.ts e9f4cc5f; tests public_tasks 8b089afd,
original_cases_live 14c0731a; fake provider 735c90db (model-specific reply/status + captures). API dist 1677 modules
131f873c; engine unchanged c4912cdb. Units **352/352**, tsc 0 (final-r18-units-final.log 6b0d55c4).

### Original exact 13 cases

| # | Result | Evidence |
|---|---|---|
| 1 all four out, paid OpenRouter budget | PASS unit | free policy c01 prevents Free; paid grid select tests route OpenRouter when usable |
| 2 all four out, paid unavailable | PASS unit + live | c02; F1/F2 live enters hold with verified 2+2 zero |
| 3 Free T2 coding | **PASS real API** | r18-free-original-cases-final.log (ab835a77): Inkling Small/max actual request; code released only after 3 trusted executable cases |
| 4 Small circuit open | **PASS real API** | same: 3 provider 503 failures open circuit; next request has exactly one Inkling/max call |
| 5 private | PASS API/live | F3 API leaky/email/schema privacy zero calls + F1 unknown privacy hold; policy c07/c08 |
| 6 T1 knowledge can_queue true | PASS unit | c09 queues paid priority |
| 7 T1 knowledge can_queue false | **PASS real API** | same: registered extraction selects Inkling/max, degraded=true; offsets/value verifier releases |
| 8 T3 design screenshot, Small circuit open | **PASS real API** | same: registered PNG bytes actually sent to Nano Omni; verified description -> Ultra/medium; exact final oracle releases; bytes absent from second request |
| 9 HTTP 200 empty | **PASS real API** | r18-free-case9-2.log (061cdfa4): Small empty counted failure, then Inkling/max usable code; first attempt ef97ca8e kept (API externally SIGTERM'd during natural circuit wait, all skipped) |
| 10 20% remaining, T4 | PASS unit | c11 daily-reserve queue |
| 11 account reset/recovery | PASS live | Free drain/F1F2: only fresh positive verified capacity exits, T1-first/oldest, exactly-once drains; reset deadline alone never recovers |
| 12 ling_verified_free false T2 knowledge | PASS unit | c12 skips Ling, first configured knowledge candidate |
| 13 only space-bunny responsive | PASS unit | c13 forbidden_real/probation overrides fallback, queues |

Negative new-class API cases: r18-free-original-negative-2.log (adef635e) - unusable code independently rejected
(no values), helper-oracle mismatch rejected after exactly helper call (no text-model call). First negative run retained:
verifier failures exhausted verified candidates and returned held; fixed to return rejected when at least one output failed
verification (provider-only exhaustion still held). Earlier live failures retained: runner include omitted file; r14c had no
four-account inventory (correct hold); added only synthetic account-store files from r11 snapshot (hashes matched), no
cooldown/circuit copied. Circuit waits were natural; no state cleared.

Boundary: these are meaningful product API classes, not native engine chat, not fixture model quality, and not real free
availability. Operator `qualifiedFreeModels` remains a synthetic declaration; no online/provider quality/spend proof.
Shipping client per AGENTS is Flutter; current host Electron fact remains delivery context, not an acceptance question.

## final-r19: original case 8 image-fixture integrity repair (2026-10-10 ~01:30Z)

Independent finding SHA 5d4a969a: prior `blue_card` bytes SHA 9fb389cd were 1x1 grayscale-alpha colorType 4,
IDAT CRC invalid and zlib inflate failed. Prior real API/helper routing/oracle passes remain true but were not valid proof
of a blue RGB image. Archived BEFORE edit (0400): tmp/r19-image-fixture/old-invalid-blue-card.png (9fb389cd), custody
receipt (68ec9bdd), and generated replacement valid-blue-square-2x2.png (2d8cfdb8).

Replacement: known 2x2, 8-bit truecolor RGB PNG, every pixel exactly #0000ff. Generated with Python stdlib
struct+zlib+binascii.crc32; complete PNG SHA 2d8cfdb8; decoded scanlines bytes
`00 0000ff 0000ff 00 0000ff 0000ff`. Live test adds an independent parser: signature, every chunk CRC, concatenated
IDAT inflate, IHDR width=2/height=2/bitDepth=8/colorType=2, filter byte 0 per row, exact four RGB pixels. It also asserts
the archived old bytes FAIL with both `crc:IDAT` and `inflate` - no signature-only proof.

Impact: test symbol not indexed -> GitNexus UNKNOWN; manual callers none. Production source untouched.
- r14c `r19-image-fixture-repair.log` 4879e64a: fixture-integrity PASS, **case4 PASS** (genuine 3x Small 503 -> persisted
  circuit -> next request Inkling/max), **case8 PASS** (actual valid PNG data URL -> Nano Omni helper; helper terms blue +
  square verified -> Ultra/medium; exact layout/color/headline oracle); negative helper was held by the real daily reserve
  at 39/50, not sent. Log retained.
- No budget/circuit cleared. r14c stopped. Fresh-budget r6u (same generated synthetic account stores copied from r11
  snapshot; no circuit copied) `r19-image-negative-final.log` b44ec077: case4 re-established the genuine Small circuit,
  then **wrong helper PASS-as-rejection**: helper description `red circle` failed blue/square oracle; exactly one helper
  call, no text-model call. r6u stopped.
- Final test source router_free_original_cases_live_e2e.test.ts 64f4d626; build dist 1677 modules a8bdd992.
  Compared with production final r18 dist 131f873c: ONLY `__tests__/router_free_original_cases_live_e2e.test.js`
  changed. `production closure unchanged=true`; production identity remains 131f873c, engine c4912cdb.

Case 8 is now COMPLETE at the synthetic/product boundary: truthful decoded public RGB image bytes actually traverse the
configured helper, verified helper text traverses the configured text model/effort, and independently checked output is
released; wrong helper is refused before answer. This is local fixture protocol/oracle proof, not real model quality.
All r18 original-case results and selected skips remain valid.

## final-r20: reviewed closure inventory + Flutter package safety gate (2026-10-10 ~01:44Z)

No product/source edit this round. Inventory: 122 dirty paths at HEAD 03aad82d; PR #1611 draft OPEN/MERGEABLE, PR head
73230a31, base edb7158c; gh `ajhochy` authenticated (repo/workflow), but no stage/commit/push/PR-update authority exercised.
Per-path hash/status/provenance manifest created after this record (external path/hash reported in handoff). No Flutter,
Electron, mobile or web dirty paths; no unrelated product change found after manual shared-file hunk review.

Flutter package qualification BLOCKED before packaging by explicit safety boundary. Stock release contains `flutter clean`,
rm/find-delete/prune, temp deletion, process kill, hdiutil overwrite and Keychain create/delete/sign/notary mutations.
No deletion exception exists for package outputs/caches, so none ran. Safe guarded source checks:
- final-r20-dart-format.log dec669a9: exit 1, package:flutter_lints unresolved; dry-run listed 418 changes but git status
  proved zero Flutter dirty paths before/after (empty diff e3b0c442). No reversal or overwrite occurred.
- final-r20-flutter-analyze.log a7d7eaf3: exit 1, `.dart_tool/package_config.json` absent; --no-pub correctly refused
  unresolved Flutter/packages. Requires `flutter pub get` network/cache/generated-state mutation.
Sandbox API/engine attestation before/after identical 5947b32 (3 PIDs, 0 violations); stopped with files preserved.
Live 4001/4002/4096 untouched. An unrelated external process appeared on 4797 (PID 5056) after the run; never contacted or
signalled. Frozen PG 43478 still T. Exact preserving package recipe and action-time approvals: delivery plan r20.

Frozen closure is NOT yet a git commit or packaged artifact. Current validated production module identity remains
131f873c (r19 package build changed only compiled test module -> a8bdd992); engine c4912cdb. Flutter package proof NOT RUN.

Closure review addendum: GitNexus `detect_changes(compare base)` sees 131 changed indexed symbols / 93 indexed files,
23 affected processes, **CRITICAL** aggregate risk (session create/update/resume/fork/prompt/destroy, scheduler/runner,
migrations, mobile proxy, account routing). This includes committed HEAD 03aad changes beyond the 122 dirty paths and
confirms freeze must be reviewed as one broad PR, not a docs/test-only patch. No commit attempted. Preliminary external
manifest `/private/tmp/rhythm-pr1611-r20-frozen-closure.json` is retained; final post-ledger manifest supersedes it.

## final-r21: frozen closure + Flutter 3.44.9 unsigned package qualification attempt (2026-10-10 02:10-02:31Z)

Closure verified before operation: manifest b34d7cf1..., branch fix/scheduled-dayflow-memory-router-20261008,
HEAD 03aad82d, 122/122 path status+SHA matches, closure digest 02870b03; draft PR #1611 remote head 73230a31,
base edb7158c. No staging/commit/push/PR mutation. GitNexus compare: CRITICAL, 131 indexed symbols / 23 processes.
Fresh retained root `/private/tmp/rhythm-flutter-qual-b34d7cf1-20261010` (2.6G): source clone + exact tracked patch
+ 68 untracked copies reverified 122/122; fresh Flutter SDK/cache/output/testtemp/logs. Guard qual.sb allows generated
unlink only inside that root (plus exact Xcode DerivedData root later) and denies original worktree, all prior sandboxes/
evidence, live app/config/Codex/vault. Flutter SDK 3.44.9 tag 6b182d2c (fresh 629M cache); no installed SDK changed.

Results:
- `flutter pub get`: PASS but WOULD UPDATE frozen lock: meta 1.17.0->1.18.0, test_api 0.7.10->0.7.11. Frozen lock
  restored; `dart pub get --enforce-lockfile` FAIL exit65 (required updates). `.dart_tool` from successful resolution retained.
- Dart format (3.44.9, output none): PASS, 527 files / 0 changes. analyze --no-fatal-infos --no-pub: PASS exit0,
  319 infos. flutter test --no-pub: PASS **1356/1356**. Fresh source still matches 122 closure; no Flutter dirty paths.
- `flutter build macos --release --config-only --no-pub` initially failed in experimental SwiftPM due guarded global
  /var cache renames; fresh-SDK `flutter config --no-enable-swift-package-manager` (release uses CocoaPods) + all caches
  redirected: PASS, pod install PASS. Synthetic public OAuth client id used; production OAuth credential unqualified.
- Unsigned universal xcodebuild: NOT BUILT. Four preserving retries failed before compilation (exit65): Xcode nested
  sandbox refuses atomic LogStoreManifest/info.plist writes in both /tmp qualification DerivedData and exact fresh
  `/Users/ajhochhalter/Library/Developer/Xcode/DerivedData/Rhythm-r20-b34d7cf1` (8K, no app). Outer `sandbox_check`
  during live xcodebuild: info.plist data ALLOW; LogStore unlink DENY under overstrict xcode profile, then qual profile
  reports ALLOW but nested Xcode still denies. Shell exact-path atomic rename succeeds. No security metadata/guard bypass.
  No compilation, bundle, extracted server smoke, signing, install or activation occurred.

Receipt hashes: flutter-version 609fc144, pubget f8cda1b7, enforce c5970fd0, format 12510baf, analyze cee7d2e0,
tests 265d5fd8, config-only 31c6181d, xcode attempts 486fe0bf/2c3c5c1d/7e6120ac/f856b174/1f113536/0b34210c,
probe eeaf3102. Qualification profiles qual.sb 852d1587, xcode.sb 212d4726. No app exists.

Package qualification remains BLOCKED on two concrete closure/release issues: (1) reviewed lock update for Flutter
3.44.9; (2) Xcode cannot compile under nested guard. Safe next path is publish reviewed source/lock update then run
`desktop_release.yml` in GitHub's ephemeral macOS runner, or explicitly authorize exact unguarded xcodebuild with all
env/cache/output paths fixed (not done). Since app absent, bundled API/engine sandbox attachment is NOT RUN.
Live 4001/4002/4096 untouched; prior evidence retained; no Keychain/sign/network/install/activation.

## final-r22: Flutter 3.44.9 lock repair and qualification rerun (2026-10-10 02:33-02:37Z)

Narrow source change only: apps/desktop_flutter/pubspec.lock a324151a (meta 1.18.0, test_api 0.7.11); original lock
fcbd5ca and exact diff ca47c90f retained. No symbol impact; dependency-only analyzer/test tooling compatibility.
Fresh retained closure copy updated identically. Gates under qual.sb, Flutter 3.44.9:
- enforced lock PASS (300ce42c); format 527 files/0 changes PASS (94017958); analyze exit0, 319 infos PASS (72287cd1);
  tests **1356/1356 PASS** (a6ad9495). No other Flutter dirty path; diff 4+/4-, diff-check 0.
- Unsigned app still NOT BUILT: nested Xcode sandbox blocker from r21; no repeated identical attempt, no guard bypass.
Existing desktop_release.yml cannot satisfy signing-disabled/no-secrets qualification; exact ephemeral qualification-only
workflow proposal recorded in delivery plan, not created/dispatched/pushed. Closure now 123 paths; final manifest follows.

## final-r23: Electron-exclusive target identity + preserving qualification (2026-10-10 02:39-02:46Z)

AJ explicitly abandoned Flutter and chose Electron exclusively; all Flutter completion/package gates removed. Retained
Flutter lock change a324151a is evidence-only and excluded from publication; no further Flutter actions.

Actual current app verified: signed Electron Rhythm.app 73230a31 (PID26527), bundled API/engine paths, 4001/4002/4096,
version 0.1.0, com.rhythm.desktop, Developer ID signature PASS. Fresh Electron root exact closure, Node22.23/Electron40.10.2:
npm ci + typecheck PASS; source tests after web build **549 pass/5 fail/6 skip**. Five failures solely actual Electron
launch blocked by Chromium nested sandbox under guard; no source assertion failures. Logs: electron-npm-ci 64015f55,
typecheck 18638406, first tests c9882677, web npm 744038c7, web build b58d7b61, rerun cd530cf8.
Installed pinned inputs validate: Hermes/Colony/Dayflow PASS (receipt e297fa73 after first harness invocation error retained).
No package: clean commit identity required for fork; optional native-dayflow immutable layout inputs missing; no bypass.
No live host/process touched. Exact Electron recipe: delivery plan r23.

## final-r24: independent P1 correctness repairs (2026-10-10 03:04-03:08Z)

GitNexus index stale ~176 commits: runPostgresBootstrap LOW/3 impact; new executePublicCoding/verifyPublicCode/routeGridTurn
not indexed UNKNOWN. Manual blast HIGH (fresh Postgres/cloud bootstrap; authenticated Free tasks; desktop/scheduled/mobile
mode:on dispatch). RED tests first: 8 failures/30 pass (r23-red-tests). Fixes:
1. Postgres bootstrap: moved agent_held_turns + agent_free_opt_ins below cloud-role return and immediately after
   agent_sessions CREATE (FK dependency valid). Fresh retained PostgreSQL17 cluster port5559, no production/frozen PG:
   role=all -> sessions/held/opt-ins/attempts true; role=cloud -> sessions/held/opt-ins false, attempts unchanged true.
   Cluster stopped gracefully/retained. Source 0d39bcf5; unit structural test 4e4788ba; logs all 5a780325, cloud cd65e698.
2. Public coding security: removed node:vm import/Script/createContext/runInContext and all provider-JS execution.
   `verifyPublicCode` always returns `untrusted_code_execution_unsupported`; executePublicCoding returns held BEFORE route,
   reservation or provider. No OS-isolated cross-platform executor exists with read-only root, no network/credentials,
   descendant containment + CPU/memory timeout; coding cases #3/#4/#9 are now explicitly UNSUPPORTED, and prior positive
   logs are invalid for release. Source 0e050c24; security test b4218c44. Image/extraction verifiers unaffected.
3. Grid failures: Free state parsed before classifier; local inventory read before classifier; attempts/decision ledger
   written before account routing/session mutation. mode:on catch returns held `router_state_unavailable`, 502 fixed body,
   body-free decision (`queryPreview=null`, error name), no classifier/model/account/SDK dispatch. Shadow remains intentionally
   non-blocking. Source router_free_runtime ceb40c50, router_grid_turn 477f29c1. Unit c9be55b0.

Results: targeted RED 8 -> GREEN 38/38; preserving affected suites **193/193**, tsc/build pass. Real API/engine corrupt-state
proof final-r23-failclosed-live.log f6def6b4: HTTP502, provider captures +0, native messages +0, dispatch rows 0, body-free
event. Final grid final-r23-grid-matrix.log 95d5eba7: **13/13**; auth/config restored. Real coding API fail-closed
7bd1491c: 1 pass, zero provider. Attestation 3 PIDs 0 violations; sandbox stopped. detect_changes remains CRITICAL,
131 indexed symbols/94 files/23 processes (stale index). No production DB/provider/user data touched.

Explicit unsupported original limits needing parent disposition (not claimed PASS):
- **Idle interactive Free recovery:** `startFreeRelease` is called only inside a later `routeGridTurn` when that turn sees
  fresh recovered capacity. With no later routed turn, an idle held interactive request does not drain. Scheduled holds
  do retry in 15 minutes. Smallest repair: usage-refresh/capacity event invokes the existing single-flight release (no new
  daemon), with idle live proof. Not implemented.
- **Automatic account provenance after API restart:** autoAccountSessions/pinnedAccountSessions are in-memory Sets
  (capacity_router.ts:323-340). Restart loses automatic-vs-explicit provenance while durable account ids remain, so
  exhaustion reroute/spillover may treat an automatic account as explicit. Smallest repair: persist account_source per
  provider/session or reconstruct from latest durable grid attempt (`accountSource=router`), then restart proof. Not implemented.

Electron packaging/publication remains HOLD pending repairs + new reviewed closure; no package/sign/activation.

## final-r25: idle Free recovery + restart account provenance (2026-10-10 03:25-03:35Z)

Impact before edits: getUsageBudget HIGH (35 upstream/8 direct, stale index ~176); isAutoAccountSession LOW/1; new
attempt-repo symbols UNKNOWN; manual blast HIGH across usage refresh, desktop/scheduled/mobile routing, spillover and
account PATCH. RED first: 5 failures/32 pass (r25-red-recovery e588794e).

1. **Idle interactive queue recovery fixed without daemon/new turn.** usage_budget_service now publishes ONLY genuinely
fresh provider snapshots (not cache hits/catch fallback) to additive subscribers, awaiting listeners without failing the
snapshot. router_grid_turn subscribes once; enabled Free + active queue + fresh verified positive paid account invokes the
existing single-flight release. No classifier/provider call is made just to release. Source usage 621149e9,
router e9041a6a. Unit: concurrent duplicate event -> one broadcast/release; stale/reset-only remains held. Live:
final-r25-idle-recovery-live-2.log 16604ff6 PASS - desktop + scheduled held with zero model calls; `force=true` fresh
usage alone drains/reruns, no trigger prompt. First live log 27c699e3 retained (my nested TMPDIR violated test precondition;
all skipped).

2. **Restart automatic-vs-explicit provenance fixed.** durable attempt readState now returns validated provider/accountId/
accountSource; exact `router` provenance reconstructs auto only when current provider+model+account all match. Missing,
corrupt, stale/mismatched or `pinned` stays explicit. Explicit account PATCH appends a body-free `pinned` provenance row
when the latest routed model uses that provider; sibling-provider pin remains explicit by safe default. Spillover route
uses the same exact durable check after restart. Sources attempts 0e0f097d, controller d190acf9, spillover 25eda4f8.

Actual restart proof (r14c, sandbox.sh down/restart): phase A bc5a30ff PASS creates two Anthropic-a sessions, durable
sources router vs pinned. After process-memory loss, explicit 429 spillover + followups: auto -> Anthropic-b, latest source
router/reason account_exhausted; explicit pin stays Anthropic-a, latest source pinned. Phase B final fa954671 PASS.
Retained setup/failures: main phase A twice returned no route (real OpenAI cooldown + missing configured Anthropic catalog,
no state invented); phase B dbf99f49 omitted status so fresh positive usage correctly refused exhaustion; phase B
1b1da499 actual behavior passed but harness wrongly required pinned successful provider call (pin correctly remained on
exhausted account). No cooldown cleared.

Final gates: restart/provenance tests 53/53; all affected suites **14 files / 200 tests PASS** (e8061086); tsc/build PASS.
Earlier P1 targeted 38/38, fresh PG all/cloud, corrupt-state live, grid13 and coding fail-closed remain valid. detect_changes
still CRITICAL 131 symbols/94 files/23 processes. All sandboxes/PG5559 stopped; auth/config restored; no live host/provider.
Original gaps are now closed. Public coding remains explicitly unsupported/fail-closed due unsafe execution boundary.
Electron package/publication remains HOLD for semantic review + truthful closure commit.

## final-r26: pending/applied route receipt ordering (2026-10-10 04:10Z)

New independent finding accepted: route attempt/decision previously wrote applied=true before account/session application.
GitNexus new symbols UNKNOWN (stale ~176); manual blast HIGH every grid route/restart provenance. RED first: 3 failures/41
pass (r26-red-receipts ece53b79).

Repair: result schema adds optional closed boolean `applied`; legacy route rows normalize applied=true, non-route false.
New route writes body-free pending attempt applied=false BEFORE side effects. `applyGridAccount` now awaits async setRouting
(previously rejected Promise escaped); then session router decision persists; ONLY after both succeed a second applied=true
receipt is appended. recordDecision(applied=true) occurs after application. Any exception leaves pending false + held/error
body-free event; readState/isRouterOwnedAccount/markPinned ignore pending rows. Existing explicit pinned applied receipt remains
authoritative if a later router attempt fails.

Tests: application failure -> held, one applied=false row, readState null, routerDecided null, no applied=true decision;
success -> [false,true], durable router account, session decision; pinned applied + later pending router -> readState pinned,
not auto. GREEN 56/56 (61c06e38); affected 14 files **203/203** (5495f76f); tsc/build PASS. Final grid live after
natural cooldown expiry **13/13** (b4b28eb4); auth/config restored, attestation 3 PIDs 0 violations, sandbox stopped.
Sources attempts 5bc4f601, router turn 7c074e71. No production/provider/user data.

Original behavior status: idle fresh-event release + restart router/pin provenance PASS (r25); pending/applied receipt
correctness PASS. Public coding #3/#4/#9 remains UNSUPPORTED fail-closed after unsafe VM removal (zero provider), explicitly
not complete coding behavior. Electron package/publication remains HOLD pending final semantic closure review.

r26 final detection: GitNexus (stale ~176) CRITICAL, 133 changed indexed symbols / 95 files / 23 processes. No commit.
P2 applied-receipt repair is included in the reviewed Electron closure; packaging/publication remains HOLD.

## final-r27: audit179/182 cold-start + durable explicit ownership + legacy ambiguity (2026-10-10 05:52-06:12Z)

Impact before edits: getUsageBudget HIGH 35/8; runMigrations HIGH 34; rowToModel CRITICAL 101/9 processes; new pin/read
symbols UNKNOWN; index stale ~176, manual HIGH. RED exact 3 failures/17 pass (25c0004c). Fixture corrections only first:
successful restart fixture explicitly applied=true; legacy test actually omitted applied; pin INSERT test already green.

Fixes:
- Cold startup: top-level dynamic subscription replaced by idempotent `initializeRouterFreeRecovery()` called synchronously
  at `createApp` before routes. Existing fresh-snapshot listener/single-flight unchanged.
- Legacy attempts: missing `applied` defaults false/ambiguous (never restart authorization). New rows retain pending false /
  success true contract.
- Durable account ownership: new nullable per-session `anthropic_account_source` / `openai_account_source`
  (`router|pinned|null`) in SQLite + Postgres, model/row/DTO, create/fork inheritance. Session source is authoritative:
  explicit requested/profile/PATCH pinned; automatic/default/grid/spillover router; null legacy falls back only to exact
  applied durable attempt. `markPinned` no longer catches INSERT errors. Explicit PATCH persists source=pinned and unmarks
  auto BEFORE audit append; append failure propagates as PATCH error while restart remains pinned. First account application
  is automatic. Sources app 3d7b3387, migrations 586246cc, postgres 1ba026da, model 700ee3d9, repo 9775ebb4,
  attempts ffe2e05a, router 15f431a4, controller a4527b96, spillover 9fb28e6b.

Proof:
- Focus GREEN 4 files / **59/59** (2ec13d5a); affected **14 files / 205/205**, tsc/build PASS (e48a1aa).
- Fresh PostgreSQL17 r27: all role sessions/held/opt-ins + both source columns true; cloud all false (d4a9c446/698b169f),
  server stopped.
- Real cold restart: phase A idle hold d7fce35d; sandbox down/restart; first `force=true` fresh usage ONLY -> queue empty,
  held dispatched, classifierCalls=1 (hold), modelCalls=1 (drain), no trigger turn (phase B final 15a2b381). Two prior
  verifier scripts failed syntax before API and are retained.
- Injected scoped SQLite trigger: auto OpenAI-a applied receipt (3434ee87); same-account PATCH returned 500 yet session
  source=pinned, account unchanged, latest attempt remained old router applied=true (67ee13d). After real restart + explicit
  429, account remained OpenAI-a/source pinned, no auto reselection (d3a103f2). Trigger retained on synthetic session only.
- Grid13 r6u **PASS** (b8ffb804); first attempt skipped after r6u start refused because main sandbox still owned ports;
  main auth restored, main stopped, r6u rerun, r6u auth/config restored, stopped. No cooldown cleared.

Final detect_changes (stale index): CRITICAL 140 symbols / 95 files / 23 processes. No commit. Public coding remains
unsupported/fail-closed. Electron packaging/publication remains HOLD for reviewed closure identity.

## final-r28: native-child provenance bindings + authoritative NULL refusal (2026-10-10 ~06:25Z)

Bounded independent-review repair only. Impact before edit: rowToModel CRITICAL 101/9 processes; child upsert + route symbols
UNKNOWN in stale index, manual HIGH. RED: 3 failures/66 pass (afaaf22e): existing repeated-child test + new create/replay
inheritance failed from SQL binding mismatch; NULL source with old applied router receipt auto-rerouted.

Fixes:
1. Native child persistence: parent SELECT now includes both account-source columns; replay UPDATE adds both columns and
   exactly 19 placeholders/19 args; new-child INSERT adds both columns and exactly 25 placeholders/25 args. Child inherits
   parent's account ids + router/pinned provenance; replay repairs null provenance while preserving child-owned worktree/
   allowlist behavior. Source repository bd2e4674.
2. Authoritative NULL: router_grid_turn/spillover use ONLY session source `router` for automatic ownership. `pinned` is
   explicit; NULL is unknown/fail-closed and old applied attempts cannot upgrade it. Exact stale-model mismatch returns
   baseline (no invented reroute/variant). Sources router 6a66558c, spillover a4ecfccd.

Proof: focused GREEN 2 files/69 tests (961d222f); omitted child/delegation suites **8 files/116 tests** (460244c0);
affected **14 files/206 tests** (46f83659); tsc/build PASS. Real r14c restart: phase A applied router Anthropic-a
(abc7c5f8); source manually set NULL as synthetic legacy ambiguity; after restart + explicit 429, account remained
Anthropic-a/source null, no automatic reselection/provider fallback (65994e13). r14c stopped, attestation clean.

Final detect_changes stale ~176: CRITICAL 141 symbols/96 files/23 processes. No commit/package/publication. All r27 cold
startup/pin INSERT/legacy applied and r26 receipt-order/P1 proofs remain valid; no source conflict. Public coding remains
unsupported/fail-closed.

## final-r29: authoritative provenance in all account mutation paths (2026-10-10 ~06:45Z)

Independent review repair only. Impact: child upsert/apply symbols UNKNOWN, isAuto LOW/1 in stale graph; manual HIGH/CRITICAL
(child/delegation fanout + account mutations). RED: pinned and NULL child stale markers moved accounts; NULL
applyGridAccount moved account (3 failures/53 pass, cf3b8e74).

Fix: `applyGridAccount` clears stale process marker whenever current authoritative source is not router; only `!current` or
source=router permits automatic mutation. Same-provider spillover uses source=router only, clears marker for pinned/NULL,
and blocks account override. Child repository remains persistence-only (avoids circular dependency); new
`syncAutoAccountSessionProvenance` in capacity_router is called by both production child-upsert callers
(agent_delegation_service and opencode_stream_bridge) after create/replay, marking router or clearing pinned/NULL.
Stale durable model mismatch stays baseline; old applied attempt never upgrades NULL.

Proof: focused GREEN 5 files/**100/100** (1de4906e); child/delegation **8 files/119/119** (eb6a0d55); affected
**14 files/209/209** (d9a3aedc); tsc/build PASS. Existing real NULL restart proof r28 (account/source null, no reselection)
remains exact coverage because route/spillover are stricter; no runtime source conflict. Final detect stale ~176:
CRITICAL 142 symbols/98 files/23 processes. No package/commit/publication/runtime. Public coding unsupported/fail-closed.

## final-r30: authoritative router transition clears denial marker (2026-10-10 ~07:05Z)

Bounded P2 only. Impact: markAuto LOW/1, new sync + mutation symbols UNKNOWN in stale index; manual HIGH child/account
mutation. RED true transition: pinned/NULL denial worked, but later authoritative source=router could not clear persistent
pinnedAccountSessions (2 failures/44 pass; 09954276). Fix: private `markAuthoritativeAutoAccountSession` removes only that
provider's pinned denial and adds provider-specific auto; ordinary markAuto stays conservative. Child repository remains
persistence-only; both production upsert callers invoke `syncAutoAccountSessionProvenance` after create/replay. Pinned/NULL
continues to clear stale auto in sync, applyGridAccount and spillover; NULL never uses legacy attempt.

Proof: scoped 3 files/**102/102** (fb97a45b); child/delegation **8 files/119/119** (51b00e1d); affected
**14 files/213/213** (65270af3); tsc/build PASS. Real engine/API r14c native child proof: engine POST /session parentID created
three actual child sessions and stream bridge persisted/inherited router/pinned/NULL; grid disabled/fixed sessions,
same-provider spillover moved only router child a->b, pinned + NULL stayed a, zero provider calls
(r30-native-child-proof-2.log 244c99ac). First script syntax-failed before API (88d3059f) retained. r14c stopped,
attestation clean. Final detect stale ~176 CRITICAL 144 symbols/98 files/23 processes. No package/publication.

