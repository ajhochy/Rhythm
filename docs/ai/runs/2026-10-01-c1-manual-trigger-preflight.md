---
date: 2026-10-01
repo: Rhythm
branch: opencode/delivery-manual-trigger-20261001
pr: 1598
issues: [C1]
status: READY_FOR_VERIFICATION
tags: [run, Rhythm]
---

# C1 manual trigger — pre-implementation receipt

## Files / scope

- Added `apps/api_server/src/__tests__/regressions_manual_trigger_contract.test.ts`: real in-memory SQLite and real schedule repository, no mocked system under test.
- Added `docs/ai/contracts/task-c1-manual-trigger-20261001.json`: all six parent C1 acceptance clauses, with two failing prerequisite contracts and remaining coverage explicitly UNVERIFIED.
- This unique receipt. No product implementation edits. Phase 0 is **partial**, not complete; Phase 1 has preliminary LOW analyses; Phase 2 not started.
- Root verified as the allocated `delivery-manual-trigger-20261001` worktree, branch above, clean at Mega `c1b7e023fbd85774fe447078cfe410f228dee539` before test additions.
- Read full parent `regressions-delivery-plan-2026-09-30/docs/ai/current-plan.md` and `docs/ai/handoffs/2026-09-30-regressions-delivery-context.md`, plus local state/plan and supplied AGENTS instructions. Historical local state is not treated as readiness evidence.

## Checks / commands

1. `git rev-parse --show-toplevel && git branch --show-current && git rev-parse HEAD && git status --short`: expected root/branch/baseline, clean status.
2. Verified API package directory and approved temporary parent with `ls`. Created fresh isolated HOME `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/c1-manual-trigger-home-20261001`.
3. In owned `apps/api_server`: `HOME=<isolated HOME> npm ci --no-audit --no-fund`: exit 0, added 185 packages. npm printed root workspace `rhythm@2.0.0` postinstall (chmod node-pty helper); no symlink to main or install in another worktree was requested. No tracked dependency/manifest changes observed in final status.
4. In owned `apps/api_server`: `HOME=<isolated HOME> npm exec --no -- vitest run src/__tests__/regressions_manual_trigger_contract.test.ts --maxWorkers=1`: exit 1, **2 tests failed by assertion**, not harness errors; duration 439ms.
   - Disabled recurrence: expected due IDs `[<synthetic task UUID>]`, received `[]` after `queueNowAsync`; initial disabled/no-due state explicitly asserted.
   - Duplicate: expected persisted `lastRunStatus = running`, received `queued` after another queue request. Test additionally requires unchanged start timestamp and next-run value.
5. GitNexus upstream, repo `Rhythm`, depth 3, production callers:
   - `AgentScheduledTasksRepository.findDueAsync`, `apps/api_server/src/repositories/agent_scheduled_tasks_repository.ts`: LOW; 1 direct caller `checkDueTasks`; 3 total impacted symbols, no indexed processes. Indirect `startAgentSchedulerJob` and cron callback `task`.
   - `AgentScheduledTasksRepository.queueNowAsync`, same file: LOW; 1 direct caller controller `triggerNow`; 2 total impacted symbols, no indexed processes; route file indirect.
   - `checkDueTasks`, `apps/api_server/src/services/agentSchedulerService.ts`: LOW; 2 direct callers `startAgentSchedulerJob` and cron callback `task`; 2 total impacted symbols, no indexed processes.
   - `LiveSchedulesTool`, `apps/web/src/components/ToolWorkspace.tsx`: LOW; direct caller `ToolWorkspace`, indirect `App` / `renderGateway`; 3 total impacted symbols, no indexed processes.
   No HIGH/CRITICAL result obtained. No existing symbol/handler edited; API impact is still required before any eventual handler edit.
6. Source reads confirm the real repository mismatch and controller queue-only path. Literal lookup in owned source does not establish an exact Org Optimize / Run Now button. Read-only installed artifact inspection: `/Applications/Rhythm.app/Contents/Resources/hermes-desktop/install-stamp.json` declares clean Hermes commit `d747cbd9e81870704347738cb702d3f229818557`, built `2026-09-29T23:36:47.642Z`, source local. It is artifact metadata, **not** a running window/request/build-provenance receipt. Installed asset search did not establish the click handler; no claim of absence from minified assets.

7. Final `git diff --check` exited 0 for tracked changes; `git status --short` shows only the three new untracked evidence files above (no tracked product/dependency edits). Tracked `git diff --name-only` / `--numstat` are empty. `git diff --no-index --numstat /dev/null <each evidence file>` reports test 39/0, contract 57/0, run note 53/0 after this receipt update; exit 1 means added-file differences, not a test failure.

## Root cause / UI attribution

Proved prerequisite defects: `queueNowAsync` unconditionally overwrites status and stamps next-run; `findDueAsync` only selects enabled recurrence. A disabled task can be accepted as queued but never selected. A duplicate can overwrite in-flight state. The normal scheduler routes selected rows through AgentRunner (local) or existing pending triggers, with engine/power readiness and Postgres ownership quarantine. None of those protections was bypassed.

Owned source attribution: `ToolWorkspace.LiveSchedulesTool.triggerNow` → `gateway/schedules.ts` → `POST /agent-schedules/:id/trigger-now` → `AgentSchedulesController.triggerNow` → `queueNowAsync`. The source button says **Trigger now**, not the reported **Org Optimize / Run Now**. The separate fixture schedules surface only updates local synthetic state and receipt text; it is not proof of dispatch. This source trace is not proof that the installed reported action invokes that endpoint.

## Blocker / parent handoff

**BLOCKED: mandatory P0 exact installed action attribution is unresolved.** The parent plan explicitly requires capturing component, request, origin and build stamp before choosing the handler; substituting a generic schedule contract would leave the exact reported journey unproved. There is no supplied click receipt. A separately pinned Hermes surface may be responsible; mutating installed artifacts or silently expanding into an external renderer repo is out of scope.

Safe next stage for the parent/runtime owner: obtain the exact Org Optimize / Run Now action's sanitized component/URL/method/origin/build receipt against synthetic intercepted requests or its owned fixture, without triggering a live schedule. If it reaches `/agent-schedules/:id/trigger-now`, continue C1 failing contracts with shared dispatch, atomic claim/dedupe, recurrence-off preservation, guard and rendered feedback coverage. If it reaches a different integration, transfer that concrete scope dependency instead of claiming the generic schedule fix closes C1. No new user approval interview requested.

Required unperformed verification targets: exact action one POST/one root session; persisted queued/running/terminal and reopened UI; inflight duplicate; disabled recurrence remaining off; unavailable/retired/locked/permission actionable errors; unchanged normal scheduler and Postgres quarantine. Add the planned `regressions_manual_trigger_live.test.ts` against actual API+engine before implementation readiness; it has **not been authored/run** in this blocked stage. Live remains parent-pending, NOT PASS.

No backend/engine/sandbox lifecycle commands, live trigger, live data/credentials, commits, pushes, PR writes, merge, deployment or packaged delivery claim. Runtime owner `attachments93bb037a-656f-40d7-8879-2a79b8a581dc`, ports 4098/4097/4099, remains untouched. Dirty main, its dependencies, protected cleanup worktree, mobile/fork/WS/stream/shared manifests were not edited by this stage; byte-identical preservation was not independently hashed and is not claimed.

## Continuation — manager decision and phase completion

The latest C1 manager dispatch explicitly removes installed-attribution as a blocker for independently proven shared defects. It does **not** remove the installed literal-button acceptance requirement. Earlier BLOCKED statements above are historical, superseded for implementation only. No installed Org Optimize action is marked passed.

Root/branch/HEAD reverified: isolated `delivery-manual-trigger-20261001`, `opencode/delivery-manual-trigger-20261001`, baseline `c1b7e023fbd85774fe447078cfe410f228dee539`; only the predecessor's three untracked test/evidence files existed. Full parent ownership/acceptance plan and `docs/ai/handoffs/2026-09-30-regressions-delivery-context.md` read, plus local AGENTS/state/plan. The dispatch's abbreviated handoff path without `docs/ai/` was absent; the canonical full path was read successfully. Historical project-state claims were not adopted.

### Phase 0 — COMPLETE for this implementation slice

- Acceptance-contract invoked first. Before product edits, repeated the predecessor's exact isolated-HOME API contract command: **2/2 assertion failures**, disabled queued row absent and running overwritten with queued.
- Expanded real SQLite/controller contracts before edits: **6 failures / 1 pass**, including running re-selection and disabled/locked/retired configurations accepted without error. The unchanged enabled/future/disabled selection control passed.
- Created source rendered ToolWorkspace contracts and ran them before edits: **2/2 assertion failures**, pending trigger button stayed enabled and no persistent actionable-error element existed.
- All six parent clauses remain mapped in the contract JSON. Installed attribution and actual runtime outcomes are explicit pending gates; not waived or passed. New guard/owner tests use real repositories/database/controller; rendered tests fake only the external HTTP boundary.

### Phase 1 — COMPLETE

Fresh upstream GitNexus results, repo `Rhythm`, depth3, branch above:

| Symbol/file | Risk | Direct callers | Indexed processes / total blast radius |
|---|---|---|---|
| `findDueAsync`, schedule repository | LOW | `checkDueTasks` (1) | 0 / 3 symbols |
| `queueNowAsync`, schedule repository | LOW | controller `triggerNow` (1) | 0 / 2 symbols |
| `checkDueTasks`, scheduler service | LOW | `startAgentSchedulerJob`, cron callback (2) | 0 / 2 symbols |
| controller `triggerNow` | LOW | schedule route file (1) | 0 / 1 symbol |
| `LiveSchedulesTool`, ToolWorkspace | LOW | `ToolWorkspace` (1) | 0 / 3 symbols |
| UI `triggerNow`, ToolWorkspace | LOW | `LiveSchedulesTool` (1) | 0 / 3 symbols |
| `response`, schedules gateway | MEDIUM | list/create/update/remove/triggerNow/runs/rootSession (7) | 0 / 7 symbols |

API impact's full prefixed route lookup found no indexed route; handler route-file lookup returned `/:id/trigger-now` LOW, one approximate consumer, no flows/shape keys. Source cross-check established the actual POST path, conditional requireAuth, mobile-owner lookup, full-task response and gateway consumer; graph middleware/shape extraction is incomplete, not proof of no auth. No HIGH/CRITICAL result. Risks and the gateway's expanded error-consumption blast radius were announced before edits.

### Phase 2 — COMPLETE; READY_FOR_VERIFICATION, not live acceptance PASS

Root fixes:

- Explicit queued tasks are eligible even with recurrence off; unrequested disabled/future jobs remain ineligible. `running` cannot be selected again.
- Conditional queue UPDATE does not overwrite queued/running attempt state; duplicates receive the fresh existing task. Recurrence `enabled` is never changed by trigger.
- Single-owner scheduler serializes selection/dispatch with a try/finally guard, while existing asynchronous runs remain independent. Explicit queues are not discarded by missed-recurrence staleness. This is intentionally a one-process owner lock; multi-process scheduling would require a database claim. Existing power/readiness/capacity/profile/model/scope/permission/notification/history runner path is reused unchanged.
- Trigger preflight returns actionable disabled/locked/delegation-only/retired configuration errors, rejects hosted Postgres quarantine, and reuses known-grant validation. No retired tool restoration, new grant, profile edit, or live schedule edit.
- Actual source ToolWorkspace uses synchronous per-task click guard, disabled/loading button, persisted queued/running/terminal feedback and in-flight-only refresh polling. Full-task statuses survive reopen; terminal history/session navigation is existing behavior. Configuration/conflict HTTP messages survive the schedule gateway; 401/403/404 remain non-disclosing.

Files: five product paths (`agentSchedulesController.ts`, `agent_scheduled_tasks_repository.ts`, `agentSchedulerService.ts`, `ToolWorkspace.tsx`, `gateway/schedules.ts`); two C1 API tests; rendered C1 spec/config; existing C1 contract/run receipt. No fork/mobile/WS/stream/shared manifest changes.

## Continuation checks — exact commands and observed results

Every command used explicit tool workdir in the isolated root or its named API/web package. All npm/test/build commands used `HOME=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/c1-manual-trigger-home-20261001` (called `H` below). Web parent verified with `ls .`, then `HOME=H npm ci --no-audit --no-fund`: exit0, 80 packages installed solely in owned web tree. No main dependency provisioning or symlink reification.

1. API first implementation validation: `HOME=H AGENT_SCHEDULER_IGNORE_POWER_STATE=1 npm exec --no -- vitest run src/__tests__/{regressions_manual_trigger_contract,agent_schedules_trigger_now_contract,scheduler_dispatch_contract,issue_739_scheduler_agent_runner,issue_1214_scheduler_quarantine}.test.ts --maxWorkers=1`: **31 passed**. `HOME=H npm run build` failed on the predecessor test's `nextRunAt:null` intersection type; corrected fixture by omitting the already-null field (no production type expansion).
2. Web first implementation validation: `HOME=H npm exec --no -- playwright test --config tests/regressions-manual-trigger-playwright.config.ts`: **1 passed / 1 failed**, actionable 400 text was discarded by the gateway. Repaired the actual response consumer, not the rendered assertion. Repeat: **2 passed**; API repeat **31 passed / 1 live skipped**, API/web builds exit0.
3. Extended owner control initially failed its FK fixture (missing synthetic user rows); created real synthetic owner/other users instead of disabling FK enforcement. This was a fixture-only repair, no further product change. Root command initially used a nonexistent web npm workspace; corrected to `npm exec --prefix apps/web` and gave this test config an explicit owned web cwd. No shared workspace manifest changed.
4. Final API command, isolated root:

   `HOME=H AGENT_SCHEDULER_IGNORE_POWER_STATE=1 npm exec --workspace=rhythm-api-server --no -- vitest run src/__tests__/regressions_manual_trigger_contract.test.ts src/__tests__/regressions_manual_trigger_live.test.ts src/__tests__/agent_schedules_trigger_now_contract.test.ts src/__tests__/scheduler_dispatch_contract.test.ts src/__tests__/issue_739_scheduler_agent_runner.test.ts src/__tests__/issue_1214_scheduler_quarantine.test.ts src/__tests__/scheduler_wake_gate.test.ts src/__tests__/r3_scheduled_engine_readiness.test.ts src/__tests__/issue_1222_startup_burst_engine_wait.test.ts src/__tests__/scheduled_task_stale_running_reaper.test.ts src/__tests__/scheduled_run_status_classifier.test.ts --maxWorkers=1`

   **89 passed, 1 live test skipped; 10 files passed, 1 skipped; exit0.** Local power-state override is for deterministic unit checks only; no runtime setting changed.
5. Final rendered command, isolated root: `HOME=H npm exec --prefix apps/web --no -- playwright test --config apps/web/tests/regressions-manual-trigger-playwright.config.ts`: **6 passed, exit0**. Safe owned Vite server on5273 only, reuse false/strictPort; all API/engine requests intercepted by existing harness. No request sent to the parent's backend. Fixture seeds cover held loading, queued, running/reopen, terminal/reopen, and five failure identities/statuses. Source UI is not the installed literal-button proof.
6. Final API build, isolated root: `HOME=H npm run build --workspace=rhythm-api-server`: **exit0**, tsc/postbuild succeeded.
7. Web package: `HOME=H npm run build && HOME=H npm run test:dist-smoke`: **exit0**, tsc/Vite build and index/two-relative-assets smoke passed. Existing >500kB bundle advisory only, not a failure. No broad bundle refactor.
8. `git diff --check`: exit0. `gitnexus_detect_changes(scope:all, worktree:<C1 isolated root>, repo:Rhythm)`: LOW, five tracked product files, zero affected indexed processes. The graph reports nearby boundary symbols (`updateAsync`, start job, removeTask, WebhooksTool, fixture gateway) due to hunk attribution; raw diff confirms their implementations unchanged. Untracked C1 tests/docs are reviewed separately, not covered by graph's tracked-diff report.

## Remaining verification / parent handoff

- `regressions_manual_trigger_live.test.ts` is **authored, compiled, normally skipped, NOT RUN LIVE / NOT PASS**. Parent runtime owner alone runs it on4098 after integrating this patch, with `RHYTHM_LIVE_E2E=1`, `RHYTHM_LIVE_E2E_ISOLATED=1`, its sandbox `DB_PATH`, `RHYTHM_LIVE_URL=http://127.0.0.1:4098`, and approved runnable `RHYTHM_C1_FIXTURE_PROFILE=synthetic-...`. The test refuses unsafe URL/non-synthetic profile, checks real engine readiness, creates only its own once/future synthetic schedule through REST, turns recurrence off, triggers/duplicates, reads exactly one successful/no-op history root plus marker transcript, and waits another scheduler interval to reject a second run. No provider/profile/grant/credential mutation; terminal synthetic schedule cleanup only. Failed/in-flight fixture evidence remains for owner inspection.
- Full actual running-duplicate/root-count, unavailable-model/permission/locked/retired/owner runtime guard matrix and actual API+engine failure feedback remain verification targets. Unit/rendered checks are not substituted for these.
- Final packaged Electron literal **Org Optimize / Run Now** attribution still requires component/request/origin/build stamp and exactly one POST → one run/session, recurrence still off, persisted progress/reopen and honest terminal/actionable outcomes. The current source says Trigger now; if the installed pinned Hermes owns another handler, report the concrete external scope dependency. Do not mutate signed/installed assets or claim attribution based on this prototype.
- No backend start/adopt/restart/down/manual API, foreign sandbox use, live data/credentials, commits, push, PR, merge, deployment or installation. Runtime owner `attachments93bb037a-656f-40d7-8879-2a79b8a581dc` remains sole owner of4098/4097/4099. No claim of byte-hashed main preservation; all mutations were confined to the verified isolated worktree and approved test HOME.

## Diff receipt

`git diff --check && git diff --numstat` plus `git diff --no-index --numstat /dev/null <each untracked C1 file>` captured the following. No-index exit1 means an added-file difference, not a failed gate. No staging or commit.

| File (package-relative) | Added / removed |
|---|---:|
| API `controllers/agentSchedulesController.ts` | 16 / 0 |
| API `repositories/agent_scheduled_tasks_repository.ts` | 13 / 9 |
| API `services/agentSchedulerService.ts` | 10 / 1 |
| web `components/ToolWorkspace.tsx` | 38 / 6 |
| web `gateway/schedules.ts` | 9 / 1 |
| API `__tests__/regressions_manual_trigger_contract.test.ts` (untracked) | 94 / 0 |
| API `__tests__/regressions_manual_trigger_live.test.ts` (untracked) | 67 / 0 |
| web `tests/regressions-manual-trigger-playwright.config.ts` (untracked) | 16 / 0 |
| web `tests/regressions-manual-trigger.spec.ts` (untracked) | 63 / 0 |
| `docs/ai/contracts/task-c1-manual-trigger-20261001.json` (untracked) | 57 / 0 |
| This run receipt (untracked, before this diff block) | 118 / 0 |

Final canonical contract JSON `test_command` executed as one combined invocation from the isolated root at22:04 local: **89 API passed / 1 live skipped, 6 rendered passed, exit0**. Chained final `git diff --check` exit0 and status contained only the five product paths and six C1 untracked test/evidence paths listed above. No actual live or installed test executed.

## Focused quality repair attempt 1 continuation

Reviewer findings and the parent repair dispatch are addressed in `2026-10-01-c1-quality-repair-attempt1.md`. Existing product/API/tests/receipt contents above retained. Fresh result: **89 API passed / 1 live skipped; 15 rendered passed (original six plus nine repair cases)**; API/web builds, dist smoke and whitespace check pass. Canonical contract adds five repair IDs without promoting pending live/installed clauses. Genuine inspected synthetic browser evidence: `docs/ai/artifacts/c1-manual-trigger-20261001/recovered-failed.png`. This continuation is READY_FOR_VERIFICATION for source repair, not actual API+engine or installed Org Optimize acceptance. Process/evidence-path deviations are explicitly recorded in the new receipt; no backend lifecycle or commit/push/PR/merge/deploy.
