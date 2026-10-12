---
date: 2026-10-08
repo: rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: draft (see branch)
issues: []
status: draft-pr-ready-for-manual-smoke
tags: [run, rhythm]
---

# Scheduled Dayflow regression, memory relevance, Kev + OpenAI Decisions shadow routing

Base: `origin/mega/2026-09-29-consolidation`, first `3f5f4e9c` (contains the deployed signed
build `237f54db`), then rebased onto `ac056260` after mega integrated the #1610-line
scheduled-root admission; the Dayflow change now widens that path to all system AgentRunner
sessions instead of adding a parallel one.
The original checkout (18705742, dirty) was not touched. Private prompts, transcripts and
per-turn judgements stay in the operator's private audit folder; this record holds aggregates.

## Files

- Dayflow admission: `dayflow_receiving_context_repository.ts` (`unbound` lookup for system runs and owned unassigned chats,
  null-id guard), `dayflow_receiving_history_guard.ts` (kind rename only), `agent_runner.ts`
  (guard reason, generic memory fence); the `coding_workflow_provider_receiving_session.test.ts` fixture
  schema gap found here was fixed on mega in 8c003765 (mega version kept).
  Decision: `decisions/2026-10-08-unbound-session-dayflow-admission.md`.
- Memory: `memory_retrieval.ts`, `automatic_memory_preface.ts`,
  `agent_session_messages_repository.ts`, new `agent_memory_turn_receipts_repository.ts`,
  SQLite-only table `agent_memory_turn_receipts` in `migrations.ts`.
  Decision: `decisions/2026-10-08-automatic-memory-displayed-text-relevance.md`.
- Router: `decision/model_router.ts`, `decision_log.ts`, `systemone_client.ts`,
  `decision_settings.ts`, `decision_config_service.ts`, `decision_client.ts`, new
  `openai_decisions_client.ts`; web `RouterSettingsPanel.tsx`, `gateway/sessions.ts`.
  Docs: `decision-engine-setup.md` (Kev service, shadow semantics, Decisions backend).
- Live tests (env-gated): `scheduled_dayflow_memory_live_e2e.test.ts`,
  `router_shadow_backends_live_e2e.test.ts`, `fixtures/scripted_openai_provider_sdmr.mjs`.
- Specialist slice notes: `runs/2026-10-08-slice-{a,b,d,d2,e}-*.md`.

## Diagnosis

- 62 AgentRunner sessions since the 2026-10-07 build (11 scheduled, 51 self-improvement)
  were held `history_ambiguous` before the provider ran: no owner/project made
  `lookupProviderSession` return `ambiguous` and admission held before checking for
  retained Dayflow evidence. One further scheduled failure (`nfl_mcp` required MCP
  unavailable) is separate and is not addressed here; the service is running now.
- Memory: semantic hits bypassed every relevance check; the lexical gate scored whole note
  bodies; short follow-ups searched with their own words. Replay of the audited 71 turns
  through the deployed dist reproduced 53/71 blocks byte-for-byte.
- Router: Kev was not running (24/24 `request_failed`). Shadow classified every
  continuation as a first prompt, never recorded the concrete pick, waited on the
  classifier inside the turn, and an unsure answer could downgrade a frontier baseline.

## Checks (exact)

Unit/type (apps/api_server unless noted):

- `npx tsc --noEmit -p .` -> exit 0. (Earlier `"configured"` errors were a worktree
  setup artifact: a symlinked `node_modules` pointed at an older vendored SDK.)
- Dayflow + memory + runner: `npx vitest run src/__tests__/dayflow_ src/__tests__/memory_
  src/services/memory_retrieval src/contract/p0_memory_injection_relevance.test.ts
  src/__tests__/issue_1573_semantic_degradation.test.ts src/__tests__/core_boundary_admission.test.ts
  src/__tests__/coordinator_core_followon.test.ts src/__tests__/issue_738_agent_runner.test.ts
  ... --no-file-parallelism` -> 71 files / 834 tests passed (before final memory tweaks); after
  them the memory/runner subset -> 46 files / 480 passed.
- Router: `npx vitest run src/services/decision src/__tests__/mobile_routing_scope.test.ts
  src/__tests__/router_shadow_backends_live_e2e.test.ts --no-file-parallelism` -> 22 passed,
  1 skipped file; 325 passed, 5 skipped tests.
- Web: `npm run typecheck` -> exit 0; `npm run test:unit` -> 61/64, the same 3 failures
  (coordinator-composer-draft, coordinator-workflow-issuance, rhythm-primary-entry) with the
  router edits stashed, i.e. pre-existing.
- GitNexus `detect-changes` (unstaged, before commits): 25 files, 58 symbols, 0 affected
  processes, risk low. Impact before edits: lookupProviderSession/decide/_runOnce LOW;
  AgentSessionMessagesRepository CRITICAL and runMigrations HIGH (mitigated: one additive
  read method; idempotent CREATE TABLE/INDEX only); normaliseDecisionSettings HIGH
  (mitigated: round-trip tests for every existing backend with/without keys).

Live behavioral (tools/dev/sandbox.sh, synthetic fixture `sandbox_fixture.mjs` + scripted
loopback provider; API 4398, engine 4397, gateway 4399; live 4001/4002/4096 untouched).
First on `2910a315` (pre-rebase), then again on the final rebased source `d7df02cd`: S1, S2,
S4, S5 passed (S3 skip); R2-R5 passed; R1 timed out once on Kev's first call after idling
(recorded `timeout`, turn still answered in 0.5 s) and passed on rerun with Kev warm. After
the rebase S4/S5 first failed because an owned chat with no project was held
`history_ambiguous` (also true of the deployed build); fixed in `d7df02cd`.

```bash
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/sdmr-fixture-20261008 \
  RHYTHM_LIVE_DB_PATH=$RHYTHM_APPROVED_FIXTURE_ROOT/rhythm.db \
  RHYTHM_SANDBOX_OPENCODE_CONFIG=$RHYTHM_APPROVED_FIXTURE_ROOT/oc \
  RHYTHM_SANDBOX_DIR=/private/tmp/sdmr-sandbox-20261008 RHYTHM_SANDBOX_API_PORT=4398 \
  RHYTHM_SANDBOX_ENGINE_PORT=4397 RHYTHM_SANDBOX_GATEWAY_PORT=4399
tools/dev/sandbox.sh up
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4398 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4397 RHYTHM_LIVE_DB_PATH=$SB/rhythm.db DB_PATH=$SB/rhythm.db \
  RHYTHM_SANDBOX_DIR=$SB MEMORY_VAULT_PATH=$SB/vault RHYTHM_SDMR_PROVIDER_PORT=7481 \
  npx vitest run src/__tests__/scheduled_dayflow_memory_live_e2e.test.ts      # 4 passed, 1 skipped
OPENAI_DECISIONS_API_KEY=<from keys folder, env only> RHYTHM_LIVE_ROUTER=1 ... \
  npx vitest run src/__tests__/router_shadow_backends_live_e2e.test.ts         # 5 passed
tools/dev/sandbox.sh down
```

| Case | Observed (what the model received / outcome) |
|---|---|
| S1 scheduled, no owner/project, no Dayflow | ran; `pwd` executed via the real tool path and returned the session directory; transcript `SDMR_DONE`; no Dayflow text in the provider-captured system prompt |
| S2 retained non-reuse marker on that session | follow-up refused before dispatch (HTTP 502 "Could not enqueue prompt"); provider never received it; marker unchanged |
| S3 scheduler resume of a marked session | skipped: schedules always create a new session; guard-reason mapping unit-tested |
| S4 interactive owned chat | ordinary slide preference injected (receipt: fts, 5 shared words); Dayflow-tagged note never a candidate and absent from the system prompt; bare `resume` answered with no injection; provenance and receipts body-free. Memories created via API are instance-wide (owner null) |
| S5 harmless write | engine asked `bash touch ...` permission; file absent; no tool result; rejected via API |
| R1 Kev (shadow) | classified once (standard, 0.51 -> standard fallback), would-pick `sdmr/scripted`, classifier 3.6-14 s while the turn answered in 0.5 s; continuation not reclassified; session model unchanged |
| R2 classifier unreachable | row `request_failed`, cause `ECONNREFUSED`; turn answered |
| R3 fixed (pinned) session | never classified |
| R4 OpenAI Decisions (shadow) | once per session; frontier (score 1.17-1.43), 295 input tokens, 0.34-0.99 s, would-pick `opencode/big-pickle`; key absent from GET, rows and logs |
| R5 no consent | selecting the backend refused `consent_required`; key cleared |

Routing ON, live (separate sandbox on `c900cfa5`, fixture `/private/tmp/sdmr-fixture-on-20261008`
with three local stand-in models `sdmr/scripted-cheap|scripted|scripted-frontier`, one per tier;
backend `openai_decisions` with a real key; scope `first_prompt`; non-sdmr models excluded so no
real model was called; `router_on_apply_live_e2e.test.ts`, 6/6 passed). The scripted provider
recorded the model id each engine request was sent with:

| Case | Decisions score -> tier | Model on first turn | Session model | Follow-up |
|---|---|---|---|---|
| O1 "What is 15 percent of 80?" | 0.01 -> cheap (903 ms) | scripted-cheap | scripted-cheap | scripted-cheap, not reclassified |
| O2 volunteer email | 0.42 -> standard (248 ms) | scripted (= baseline) | scripted | scripted |
| O3 calendar-sync architecture | 1.53 -> frontier (287 ms) | scripted-frontier | scripted-frontier | scripted-frontier |
| O5 same hard prompt, fixed session | not classified | scripted | - | - |
| O6 classifier unreachable | request_failed | scripted (baseline) | not persisted | - |

First turns including the Decisions call took 0.8-1.5 s. Afterwards the sandbox router
settings were back to off with the key cleared; no key in logs or sandbox files. The first
Decisions call took 903 ms, close to the 1,000 ms default timeout (a timeout leaves the
baseline). Not tested: real paid models, or the installed app.

Installed app: NOT tested. The installed `/Applications`/signed 237f build still has the
regression; nothing here was deployed or swapped in.

Independent verification gate (sandboxed, HEAD c731cf49 pre-rebase): API tsc 0; decision 325
passed; Dayflow/memory/runner 813 passed; live 4 + skip; web typecheck/build 0, web unit 81/81;
detect-changes 0 affected processes. Verdict FAIL on evidence only: no browser proof of the
new router setting (now `router:B7`, 6/6 router settings browser tests pass in Chrome) and a
missing issue contract (the run was wrongly tagged #1609; no issue applies). Full-suite
better-sqlite3 version failure and 5 `composer-model` browser failures reproduce on base.
Post-rebase on `d7df02cd`: API tsc 0, 96 files / 1,196 tests (pre-fix) and Dayflow 372 tests
(post-fix) passed, web typecheck 0.

## Evaluation (private detail in the audit folder)

Memory, 115 turns (71 audited + 7 missed slide turns + 37 held-out), deployed dist vs branch,
copied DB + read-only Engraph copy, back-to-back: irrelevant-only turns 63 -> 32; turns with a
useful lead 20 -> 19; weak-only 22 -> 13; empty 10 -> 51; budget unchanged (<=1,200 chars);
memory step p50 325 -> 357 ms. Lost leads: preferences living only inside the chat archive
(writing style) or sharing one word with the request. Semantic timeouts are pre-existing
(production provenance ~45% since Oct 7) and grow with query length (~300 ms at 64 chars,
~500 at 128, ~830 at 200 under load).

Router, 74 hand-labelled real first prompts (one judge; two sets; each scored with
thresholds tuned on the other): Decisions score question 55/74 (6 too small, 13 too big);
Kev 50/74 (14/10); always standard 46/74 (14/14); current per-agent choices 38/74 (15/21).
Kev cold first call 4.5 s, >15 s stalls after idle. Qwen3.5-4B, Qwen3.8-27B and GPT-6 Luna
via Responses were worse; Qwen 3.6 (not installed) and Haiku (OpenRouter balance negative)
were not tested.

## Kev service

`~/.local/share/kev/kev` (upstream main), model `jaredpalmer/kev-4b@139fdd94...` from the HF
cache (offline), 127.0.0.1:8009, launch agent `com.ajhochhalter.kev`, logs
`~/Library/Logs/kev/`. Start/stop/status in `decision-engine-setup.md`. Routing mode on the
live app was not changed (Shadow).

## Notes / remaining limits

- Not merged, deployed, or switched On. Enablement needs a separate evidence-backed approval.
- The scheduled-run diagnostic now carries the guard reason; for an interactive follow-up
  Rhythm's earlier retained-history check refuses first with the generic enqueue message.
- Memory API cannot create user-owned notes; owner isolation is unit-tested only.
- Sandbox catalog has only cheap models; live would-be picks used tier overrides.
- Decisions thresholds/wording are calibrated on this user's prompts with one judge.
- Web unit suite has 3 pre-existing failures; desktop Flutter/mobile untouched.


## 2026-10-09 continuation after AJ 14:57 UTC fake-data exception (actual starts/commands/results)

Guards (kernel, macOS sandbox-exec; profiles in /private/tmp/no-unlink-enforcement-20261009):
- test-runner-strict-v5.sb (849f1404...): no unlink/rmdir/rename-away anywhere; protected evidence,
  preserved cohorts, frozen PG, original fixtures and live user data are write-denied.
- runtime-fresh-cohort-v4.sb (46602800...): same protections; unlink allowed only inside the fresh
  fake-data cohort ($SB/home,tmp,vault,live-artifacts,media-artifacts,dayflow-integration, DB sidecars)
  and bash here-doc temps /private/var/tmp/sh-thd*. Qualified by probes (replace/lock allowed only in
  fresh cohort; all protected paths EPERM) and per-PID `sandbox_check` attestation of the whole
  root->API->engine->MCP->provider tree (unguarded control = ALLOW, all tree PIDs = DENY on evidence).
- engine-build-v1.sb: unlink only in the build's fresh temp dir + fresh dist.
Preserved by move (no deletion): $SB/preserved-final-r2-cohort; old engine dist kept as
dist-preserved-signed-73230a31-copy. Frozen PG 43478 untouched (SIGSTOP).

Built (guarded): API/MCP dist (tsc 0); engine 0.0.0-rhythm-pinfix-d77042e8110e (sha c4912cdb...,
--single --skip-install --skip-embed-web-ui) containing the pin fix.

final-r3 cohort, source digest 3497fc52..., API module tree c871e5dc..., engine c4912cdb...:
- Grid native matrix (13): 10 PASS / 3 FAIL. tier2 + malformed: captured effort xhigh vs expected
  high (rebuilt engine advertises gpt-6.1-sol [none..xhigh]; mapping max->xhigh is per design; test
  expectation stale -> owner 09ebc1e5 deriving expectation from engine-advertised variants).
  native pin 429: precondition failed (prior cases left valid cooldowns) -> same owner moving case first.
- Dayflow PERMITTED interactive: FAIL. With genuine Rhythm integration (RHYTHM_AGENT_URL) every guarded
  attempt is held `proof_unavailable` (runner generation missing) before admission; reproduced on the
  signed 73230a31 engine (A/B) and on REST + WS paths. Initial config used RHYTHM_API_URL (manager
  fixture error -> integration undefined -> sessions unguarded; explains prior 'pwd ran, no evidence').
  Read-only triage 10aaca20 dispatched. Not converted to PASS.
- Memory final-source API proof: NOT RUN. Live 4001: still signed 73230a31, not equivalent.

## 2026-10-09 final-r4 grid matrix (actual, guarded)

Same preserved final-r3 cohort, restarted via `sandbox-exec runtime-fresh-cohort-v4.sb ->
tools/dev/sandbox.sh restart` (PRESERVE_FILES=1, grid-node preload, 4398/4397/4399). Test run via
`strict-run.sh` (strict-v5), `vitest run src/__tests__/router_grid_accounts_live_e2e.test.ts
--pool=threads --no-file-parallelism`, RHYTHM_LIVE_E2E/_ISOLATED/_GRID_ACCOUNTS=1.

- Identity: 2800 source files vs final-r3 -> only the test differs (sha 688a0b2e...); 620/620 API
  modules identical; engine c4912cdb... (pin fix); home config 2ee7db44... (corrected
  RHYTHM_AGENT_URL, API-merged); no router-grid override.
- Preconditions: genuine final-r3 cooldowns on syntheticgrid-openai-a/b waited out (expired
  16:13:51Z); nothing cleared. Provider guard flags are sticky, so new api/engine guard
  registrations were required and observed after launch, refresh and engine bounce.
- Attempt 1 (final-r4-grid-matrix.log): beforeAll FAIL, 13 skipped, 0 run - auth.json held an extra
  synthetic `original-dayflow` api entry (public `od-synthetic-only`, added by Dayflow
  provisioning; also present as config apiKey). Preserved as final-r4-auth-before-dayflow-key-removal.json,
  removed via sandbox engine `DELETE /auth/original-dayflow`; API watcher bounced engine to PID 47831
  (same binary). Test unchanged.
- Attempt 2 (final-r4-grid-matrix-2.log, sha f7cf102c...): **13 passed / 0 failed**, exit 0, 102 s.
  Native pin429 first: B429 only, no A attempt, pin persisted, 1 ledger row, 1 classifier.
  Effort oracle from advertised variants (Luna/Astra high, Sol medium, 6.1-Sol xhigh, Sonnet high)
  matched capture, routerVariant and ledger effortApplied on every proof.
- Kernel attestation after run: 27 PIDs (API, engine, provider, 24 MCP children), 0 violations.
  Live 4001/4002/4096 untouched; 4797-4799 not contacted; PG 43478 still T.
- Prior final-r3 10 PASS / 3 FAIL log preserved unchanged. Manifest:
  $SB/final-r4-grid-source-runtime-manifest.json. Not an installed-app or live acceptance.

## 2026-10-09 Dayflow proof_unavailable root cause (single-variable probe)

- Triage 10aaca20: generation-missing was NOT proven (10 hold sites share the reason).
  Planning efe4e22c named the exports gate: API `getDayflowProviderFrame` (opencode_client_service.ts:1323)
  and fork frame route (handlers/session.ts:238) return null/404 unless `RHYTHM_MANAGED_CONTEXT_EXPORTS=1`.
- Live signed app is Electron; `apps/electron/src/agent-server.mjs:147-150` sets
  `RHYTHM_WORKSTREAMS_ENABLED=true` + `RHYTHM_MANAGED_CONTEXT_EXPORTS=1` (manual-workstreams preference).
  Live API 26531 / engine 26567 carry both; sandbox.sh `env -i` passes neither.
- Probe: same cohort/config/engine c4912cdb, auth.json byte-equal to the A/B state, only change = node
  wrapper `/private/tmp/original-dayflow-runtime-final-r4/grid-node-workstreams` adding the pair.
  Fresh consented probe root 2f0cb42f, harmless REST prompt: rhythm MCP connected, no hold, LLM stream
  reached provider (connection refused: scripted 7483 intentionally down). Before: held proof_unavailable
  pre-provider. Receipt: $SB/final-r4-dayflow-exports-pair-probe.json.
- Classification: sandbox launcher non-equivalence (missing live env pair), not a runner-lifecycle defect;
  no lifecycle/guard change made. Product note for AJ: launches without the pair (workstreams preference
  off, or any launcher not setting it) hold Dayflow-consented turns fail-closed.
- Side note: the grid auth precondition removal of the synthetic `original-dayflow` auth entry made the
  Dayflow profile unroutable (502 no-route); restored via sandbox engine auth.set, byte-equal to preserved copy.
- Full PERMITTED interactive live case: pending the test read-race fix (dispatch binding read at 91 ms).

## 2026-10-09 final-r4 Dayflow + memory runs (actual)

Test fix: coding-agent ee026f15 polled the async dispatch-binding read (same predicate/label), file
sha 838ca2c8, run note runs/2026-10-09-dayflow-binding-poll.md; offline 8 skipped under runtime guard
(strict guard blocks vitest's own temp rename - known artifact). Commands: runtime-fresh-cohort-v4
sandbox-exec, `vitest run src/__tests__/original_dayflow_context_live_e2e.test.ts -t <case>
--pool=threads --no-file-parallelism`, manifests final-r4-dayflow{,-foreign,-revoked}-manifest.json.

- PERMITTED interactive: 1 passed / 7 skipped (final-r4-dayflow-permitted.log).
- generic interactive boundary: 1 passed / 7 skipped (final-r4-dayflow-generic.log).
- FOREIGN (synthetic foreign project 79aab581): 1 passed / 7 skipped (final-r4-dayflow-foreign.log).
- REVOKED: 1 passed / 7 skipped (final-r4-dayflow-revoked.log); sandbox consent now revoked.
- Coordinator: NOT RUN (primary-root designation withheld per no-Coordinator-change instruction).
- Unavailable/expired/scheduled-unavailable: NOT RUN (placeholders).
- Scheduled S1/S2/S4/S5 + memory (`scheduled_dayflow_memory_live_e2e.test.ts`, new opt-in
  RHYTHM_LIVE_RETAIN_FIXTURES=1, sdmr provider added to fresh-cohort config dd6af032, port 7481):
  4 failed / 1 skipped (final-r4-sched-memory.log) - every session error GRID_TRANSPORT_REFUSED; the
  test-only transport guard allows only 4398/4397/4399/7482/7483 with fixed synthetic bearers. BLOCKED on
  an AJ decision to add a narrow sdmr rule; guard left unchanged.
- Per-criterion table and incidents: contracts/2026-10-08-original-router-memory-dayflow-ledger.md
  "final-r4 status". Sandbox stopped with files preserved; final attestation 5 PIDs, 0 violations.

## 2026-10-09 final-r5/r5b/r5c (actual)

Renewal-revalidation fix + frozen Memory be4164f1 built (dist f066b660) and loaded under the runtime guard.
Final-build Dayflow: PERMITTED, generic, FOREIGN, REVOKED PASS; EXPIRED FAIL (history_ambiguous on the
expiry projection path, three attempts retained); Coordinator FAIL (plan-mode root refuses bash);
UNAVAILABLE/scheduled-unavailable BLOCKED (source binding); scheduled/Memory live BLOCKED (transport
approval). Memory units (pre-freeze) 93/3 retained in final-r5-memory-units-2.log; frozen worker run 74/74.
Full table, identities, impact reconciliation and incidents: ledger "final-r5c status".

## 2026-10-09 final-r6 + fresh r6u cohort (actual)

Watcher-applied sdmr transport rule (3c772148) loaded by guarded restart at 18:20Z. EXPIRED root cause:
duplicated profile prompt in interactive `system` broke the projection's single-occurrence removal;
fixed in ws_gateway.ts by mirroring agent_runner #1039 (impact LOW, run before edit). r6 build: PERMITTED,
generic, FOREIGN, EXPIRED, REVOKED PASS; scheduled S1/S2/S4/S5 + Memory provenance PASS (S3 skip).
Fresh guarded cohort r6u (bounded test-only root af902037): UNAVAILABLE PASS, scheduled-unavailable PASS,
Coordinator plan-mode context PASS (supplementary), original Coordinator pwd gate FAIL = plan-mode
conflict for parent. Grid matrix not re-run on r6. Details: ledger "final-r6 status".

## 2026-10-09 final-r7 grid on final source (actual)

Pre-run snapshot, guarded restart (API 31364, engine 31380 -> 31593 -> 33116 after auth bounces), synthetic
auth precondition via engine API, preserving grid runner under runtime-fresh-cohort-v4. Result
**13 passed / 0 failed** (final-r7-grid-matrix.log 78a9c13b). Auth, router config and visibility restored
to snapshot; new genuine cooldowns kept. Coordinator literal-pwd FAIL reclassified as harness mismatch
(original rows name no Bash requirement); no test edited. Consolidated criterion table: ledger "final-r7".

## 2026-10-09 final-r8 (actual)

A4 live guard-reason propagation PASS via audit recipe (provider first-request timing gate + exact in-flight
marker); first attempt FAIL kept (wrong session-field expectation). New live Memory cases S6 (Odds, canonical
update, abstain, receipts) and S7 (writing archive section, voice continuation) PASS; full scheduled suite
7 PASS / 1 SKIP. Shadow R3/R5 PASS, R2 FAIL as obsolete legacy assertion (grid owns shadow routing).
Free Mode runtime staged plan written (manual risk HIGH). Details: ledger "final-r8".

## 2026-10-09 final-r10 Free Mode F1/F2/F3 (actual)

Implemented hold/queue (zero Free calls, budget 0, privacy unknown, body-free descriptor), verified-recovery release
(T1 first, owner/target recheck, no replay, classification reuse) and the F3 verifier gate (empty registry). Units 12
files 176/176, tsc 0. Live synthetic proof PASS on attempt 4 (desktop hold, scheduled 15-min deferral, release, resend
without reclassification); attempts 1-3 failed on my fixture/poll mistakes and are retained. Mobile live NOT RUN.
Details: ledger "final-r10".

## 2026-10-09 final-r11 reruns on 8a9d22c9 (actual)

Scheduled+Memory first run 5/2/1 (S6/S7 retained-duplicate budget collision, kept); test isolation fix; full suite
7 PASS / 1 SKIP incl. A4; shadow R2/R3/R5 PASS; grid 13/13. State restored to snapshot; new cooldowns kept.
Free F2 classified partial (notification, no automatic redispatch; held turns keep no replayable record), F3
fail-closed gate only; designs written. Mobile live blocked on synthetic human-approval capability decision.
Details: ledger "final-r11".

## 2026-10-09 final-r12 Free D1-D4 + F3 + Dayflow regressions (actual)

Automatic drain implemented and live-proven (run 1 found and fixed dropped-entry gap); F3 structured-extraction verifier
and public-context preflight proven against a fake loopback provider; units 302/302. Dayflow on be1d580b: 8 PASS;
Coordinator plan-mode FAIL from a genuine sticky marker after required source re-selection. Details: ledger "final-r12".

## 2026-10-09 final-r13 (actual)

F3 preflight fixed after independent probe (field names now scanned; strict fail-closed task validation); units 326/326.
On final build 89631c7b: Free drain + F1/F2 live PASS, grid 13/13, scheduled+Memory 5/2/1 in the reused cohort (S6/S7
fixture crowding), S6+S7 PASS in the clean-vault r6u cohort. Extraction proof labelled module+HTTP fixture only.
Details: ledger "final-r13".

## 2026-10-09 final-r14 (actual)

Free structured extraction now has a real API entry point with server-side provenance (operator registry + stored owner
opt-in); live PASS through the running sandbox API and transport guard. Coordinator plan-mode context PASS in fresh cohort
r14c. Units 347/347; Free F1/F2 rerun PASS after a stale-assertion fix. Details: ledger "final-r14".

## 2026-10-09 final-r15 (actual)

Main-cohort S6/S7 failures diagnosed precisely (top-5 FTS probe crowding by 6 retained near-identical notes + junk filter).
ONE combined scheduled+Memory run in clean cohort r14c on final build ed653651: 7 PASS / 1 SKIP (S3 unsupported
mechanism; A4 genuine guard reason PASS). Details: ledger "final-r15".

## 2026-10-09 final-r16 (actual)

Native engine-chat Free extraction: blocked by unconditional engine environment/instruction/plugin system injection
(needs a fork primitive; AJ authorization). On final ed653651: grid 13/13, shadow R2/R3/R5 PASS, drain PASS, Dayflow 6
main + 2 r6u PASS. Delivery handoff written (Electron vs Flutter shipping client stated). Details: ledger "final-r16".

## 2026-10-09 final-r17 (actual)

Approved bounded synthetic mobile gateway test on isolated API ed653651: bootstrap/connect 201, mobile prompt_async held
503 FREE_MODE_HELD with zero model dispatch, credential revoked 204 then refused 401, revoked row retained, credential
absent from logs. Script's optional drain step failed on my session-id parsing (retained); corrected follow-up drained
the mobile-held turn exactly once. Details: ledger "final-r17".

## 2026-10-10 final-r18 (actual)

Original audit removed invented native-engine transport gate. Added meaningful registered public coding and image-design
classes through authenticated API; original positive cases 3/4/7/8 PASS live, case9 empty fallback PASS; units 352/352.
All 13 original Free acceptance cases mapped PASS (positive executions real API/local fake provider; deterministic
capacity/privacy/limits cases unit/live). Details: ledger final-r18.

## 2026-10-10 final-r19 (actual)

Replaced invalid 1x1 grayscale-alpha/bad-CRC image fixture with independently validated 2x2 RGB solid-blue PNG; archived
old bytes first. Case4+case8 pass with genuine circuit/helper path; wrong helper rejected before text-model call in fresh
budget cohort. Production module closure unchanged; only compiled test module differs. Details: ledger final-r19.

## 2026-10-10 final-r20 (actual)

Inventoried 122-path closure; no unrelated or Flutter client changes found. Flutter guarded format/analyze both blocked by
missing package_config (no pub get allowed); no Flutter file changed. Stock package/sign pipeline reviewed and blocked by
unapproved deletion/cache/network/Keychain operations. Preserving recipe in delivery plan; details ledger final-r20.

GitNexus pre-freeze change detection: CRITICAL aggregate risk, 131 changed indexed symbols / 23 processes. No commit.
Final closure manifest generated after canonical logging; see final handoff.

## 2026-10-10 final-r21 (actual)

Frozen 122-path closure cloned exactly into retained fresh root; Flutter 3.44.9 format/analyze/1356 tests PASS. Pub lock
requires 2 transitive updates (frozen lock restored). Config-only/CocoaPods PASS. Unsigned Xcode build blocked before
compile by nested sandbox refusing its own DerivedData atomics despite outer ALLOW; no app/bundle/smoke. Details ledger
final-r21; all logs retained under /private/tmp/rhythm-flutter-qual-b34d7cf1-20261010/logs.

## 2026-10-10 final-r22 (actual)

Applied exact Flutter 3.44.9 lock compatibility update only (meta/test_api). Enforced lock, format, analyze and 1356 tests
PASS. Local unsigned app remains blocked by nested Xcode sandbox; signing-disabled/no-secrets ephemeral workflow proposal
written, not dispatched. Details ledger final-r22.

## 2026-10-10 final-r23 (actual)

AJ switched exclusively to Electron; Flutter work stopped and lock diff quarantined from publication. Verified running
Electron 73230a31 identity/signature. Fresh Electron root: npm/typecheck/web build pass, source tests 549/5/6 (only five
actual-launch nested-sandbox failures). Installed Hermes/Colony/Dayflow package inputs validate. Final package blocked on
reviewed clean closure commit identity; no bypass/package/launch. Details ledger final-r23.

## 2026-10-10 final-r24 P1 repairs (actual)

Fixed Postgres bootstrap ordering/cloud-role leak; removed unsafe Node VM code execution (public coding now explicit
unsupported hold, zero provider calls); grid mode:on errors now fail closed before classifier/model/SDK, with body-free
error decision. RED 8 failures -> GREEN targeted 38/38; affected 193/193; fresh Postgres all/cloud PASS; live corrupt
state 502/zero dispatch PASS; grid13 PASS; coding fail-closed API PASS. Idle interactive queue recovery and automatic
account provenance after restart remain explicitly unsupported; details ledger final-r24.

## 2026-10-10 final-r25 recovery/provenance (actual)

Fresh usage event now drains idle Free queue single-flight without a new turn (live PASS). Durable router/pinned account
source reconstructs exactly after API restart; real restart proof auto a->b while explicit pin stays a. RED 5 -> GREEN,
14 affected files/200 tests PASS. Setup/harness failures retained. Details ledger final-r25.

## 2026-10-10 final-r26 applied receipt ordering (actual)

Route journal now pending applied=false before side effects and applied=true only after awaited account + session success;
failed application holds with no success authorization, explicit pin survives. RED 3 -> GREEN 56; affected 203 tests and
final grid13 PASS. Details ledger final-r26.

Final detect_changes after r26: CRITICAL, 133 symbols / 95 indexed files / 23 processes; no commit/package/publication.

## 2026-10-10 final-r27 audit179/182 (actual)

Cold-start listener now initialized by createApp; real cold restart idle hold drains on fresh usage without a prompt.
Durable per-provider session source preserves explicit pin across injected attempts INSERT failure + real restart; legacy
missing applied is ambiguous/false. RED 3 -> GREEN 59; affected 205 tests, fresh PG all/cloud, grid13 pass. Details ledger
final-r27.

## 2026-10-10 final-r28 review repair (actual)

Fixed native-child SELECT/UPDATE/INSERT provenance columns/placeholders and made NULL account source authoritative unknown.
RED 3 -> GREEN 69; child/delegation 116, affected 206, real restart NULL refusal PASS. Details ledger final-r28.

## 2026-10-10 final-r29 authoritative mutation paths (actual)

Stale in-memory auto markers can no longer override inherited pinned/NULL provenance in applyGridAccount or same-provider
spillover; both production child-upsert callers synchronize markers after inheritance/replay. RED 3 -> GREEN 100;
child/delegation 119, affected 209, build/typecheck pass. Details ledger final-r29.

## 2026-10-10 final-r30 authoritative router transition (actual)

Authoritative router child transition now clears persistent provider denial and marks auto; pinned/NULL still block all
mutation. RED 2 -> GREEN 102; child 119, affected 213. Real engine child/API spillover: router a->b, pinned/NULL stay a,
zero provider calls. Details ledger final-r30.
