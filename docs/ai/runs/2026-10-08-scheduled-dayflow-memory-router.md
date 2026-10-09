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
