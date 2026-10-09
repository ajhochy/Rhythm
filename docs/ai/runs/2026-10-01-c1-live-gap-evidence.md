---
date: 2026-10-01
repo: Rhythm
branch: opencode/delivery-manual-trigger-20261001
pr: 1598
issues: [C1]
status: BLOCKED_PRODUCT_DEFECT
tags: [run, Rhythm, smoke-test]
---

# C1 live gaps — actual mobile negative proof, provider false completion STOP

**BLOCKED — product defect, not an unavailable fixture or contract-only gap.** A bounded actual provider test received a genuine SDK nonretryable401 error, but the scheduler persisted `completed_no_op` with `error=null`. No product/test-threshold repair or counter reset attempted. Actual browser reconnect and fresh full core/compatibility execution were withheld at the explicit product-defect STOP; previous green results are NOT fresh results from this run.

## Files / ownership

W = `/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/delivery-manual-trigger-20261001`.
Verified branch above and HEAD `9b3115ff7d4dcf0b3ee4b5f60ca1781366a96c3f`; candidate is HEAD plus frozen C1 working diff, NOT separately preserved upstream18705742/Mega final.

Read integrated-runtime, live-proof and provisioning receipts, C1 and prerequisite contracts, testing guide, actual schedule/mobile routes/controller, pairing/auth repository/service and scheduler/runner before assertions. Loaded smoke-test-writer first. Workflow-orchestrator and GitNexus tools unavailable in this session; no claimed graph result. No existing product/helper/test symbol modified. New test-local helper corrections have only their new local test callers, graph risk UNKNOWN, not a claimed LOW gate. Manager can impact `_runOnce` / `AgentRunner.run` in `apps/api_server/src/services/agent_runner.ts` before any separately authorized repair. No peers/TodoWrite, installs, main/foreign dependencies, Git mutations, commit/push/PR/merge/deploy, real credentials or operator data.

Only four new fixture/test files, C1 contract evidence metadata and this unique receipt authored:

- `tools/dev/sandbox_fixture_c1_auth.mjs`: canonical cold initDb, existing C1 guard seed, original synthetic admin/member/workspace roles/scopes, session seeds, **existing MobilePairingService createPairingCode/pair** for two user-bound devices. No auth middleware mocks, permission grants or signer. Fresh sources sealed0400 before sandbox up.
- `apps/api_server/src/__tests__/c1_gap_auth_live.test.ts`: genuine mobile negative schedule POSTs and unchanged task/history/root, positive owner read and scoped non-owner listing.
- `apps/api_server/src/__tests__/_c1_error_provider.ts`: reuses existing held provider via external transport adapter,401 SDK-compatible error JSON ONLY for an explicitly registered per-test marker. No actual API/session interception. Both provider servers closed in afterAll.
- `apps/api_server/src/__tests__/c1_gap_provider_live.test.ts`: real API→scheduler→AgentRunner→native fork→controlled external provider→durable error assertion; records task/root/history/SDK evidence BEFORE failing and BEFORE provider closure.

Existing tests triage: **KEEP** strengthened actual core profile/assistant/duplicate/65-second proof. **KEEP** existing explicit gap placeholders until their full replacement gate is proven; unchanged, not skipped/deleted to fabricate pass. **KEEP, limited scope** intercepted rendered tests for rendering regressions, not actual reconnect. New auth test initially compared catalog cursor expiry; corrected to unchanged full task/history plus empty sessions/resumable/ancestors and hasMore=false/nextCursor=null. Cursor expiry is snapshot metadata, not durable mutation; no behavioral threshold reduced.

## Checks / exact commands and local dependencies

E = `/private/tmp/rhythm-c1-gap-evidence-20261001-owned` (0700).
F = `/private/tmp/rhythm-c1-gap-fixtures-20261001-owned` (fresh, synthetic only).
SB = `/private/tmp/rhythm-c1-gap-sandbox-20261001-owned` (sole-owned disposable runtime, now removed).
External operational runner = `/private/tmp/rhythm-c1-gap-evidence-runner-20261001.py`; explicit W/package cwd, clean literal env and argv, exit and elapsed saved per stage. `E/environment.json` retains S/U/L. No frontend/browser launched.

Same S for every `tools/dev/sandbox.sh up|status|down`:

```sh
env -i HOME=/private/tmp/rhythm-c1-evidence-home-20261001-sole TMPDIR=/private/tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-c1-gap-fixtures-20261001-owned RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-c1-gap-fixtures-20261001-owned/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-c1-gap-fixtures-20261001-owned/opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-c1-gap-sandbox-20261001-owned RHYTHM_SANDBOX_API_PORT=4098 RHYTHM_SANDBOX_ENGINE_PORT=4097 RHYTHM_SANDBOX_GATEWAY_PORT=4099 RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1 DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1 tools/dev/sandbox.sh <up|status|down>
```

All four required fixture/path variables supplied. DB/config read-only outsideSB; nonempty local MCP executes only W's actual built `apps/mcp_server/dist/index.js` with4098 and public synthetic token. Original prior fixtures remain untouched. Existing C-owned dependency directories reused, no install or manifest changes. Existing native fork reused, sandbox rebuilds API and maintained MCP `--noCheck`; no new packaged/native build claim. Sandbox sets isolated HOME/XDG/DB/engine DB/skills/tmp/storage and offline Keychain/npm guards. No manual API/engine launch, no live4001/4096 or foreign739x/819x/829x adoption/signal.

Actual test prefix L (cwd **W/apps/api_server**):

```sh
env -i HOME=/private/tmp/rhythm-c1-gap-sandbox-20261001-owned/home TMPDIR=/private/tmp/rhythm-c1-gap-sandbox-20261001-owned/tmp PATH=/private/tmp/rhythm-c1-gap-sandbox-20261001-owned/bin:/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin PLAYWRIGHT_BROWSERS_PATH=/Users/ajhochhalter/Library/Caches/ms-playwright DB_CLIENT=sqlite DB_PATH=/private/tmp/rhythm-c1-gap-sandbox-20261001-owned/rhythm.db RHYTHM_MANAGED_SKILLS_DIR=/private/tmp/rhythm-c1-gap-sandbox-20261001-owned/home/.config/opencode/skills RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_C1_FIXTURE_PROFILE=synthetic-c1-proof RHYTHM_C1_DISABLED_TASK=synthetic-c1-guard-disabled RHYTHM_C1_LOCKED_TASK=synthetic-c1-guard-locked RHYTHM_C1_RETIRED_TASK=synthetic-c1-guard-retired RHYTHM_C1_DEVICES_FILE=/private/tmp/rhythm-c1-gap-fixtures-20261001-owned/devices.json RHYTHM_C1_GAP_EVIDENCE=/private/tmp/rhythm-c1-gap-evidence-20261001-owned npm exec --no -- vitest run src/__tests__/<c1_gap_auth_live|c1_gap_provider_live>.test.ts --maxWorkers=1
```

| Executed stage | Result / retained evidence |
|---|---|
| git branch/SHA/status, real dependency dirs,409x free | assigned candidate, all owned ports free before launch |
| runner `init` | old8675-file map identical; then8677 with first two new test/fixture files |
| runner `fixture` (`node tools/dev/sandbox_fixture_c1_auth.mjs F`) | exit0,1.65s; original roles/scopes and genuine service pairings; `fixture.log` |
| first `up` | exit2, new auth helper unknown JSON typing TS18046; no successful runtime claim; diagnostics `.evidence.3xY5Mf` |
| immediate reuse attempt | exit1, existingSB refused; canonical `down` then fresh `up`, no hand cleanup |
| first auth against launched runtime | fails ONLY differing catalog `pageInfo.expiresAt`, not task/run/root mutation; raw tool output retained |
| follow-up auth across shell calls | ECONNREFUSED4099, all prior listeners/PIDs gone; environmental lifetime interruption, not asserted product cause. Subsequent entire up→tests→down kept in ONE shell tool lifetime |
| final `up/status` | API/MCP build exit0, ready; API/gatewayPID87504, actual fork enginePID87526; `sandbox-up.log`, `sandbox-status.log` |
| final auth L | **exit0,1 real test PASS/0skip**,215ms assertions,1.94s command; `auth-live.log`, `auth-live.json` |
| provider L | **exit1,1 real test FAIL/0skip**,49.93s assertions,51.74s command; `provider-live.log`, `provider-live.json` |
| same S `down` immediately after STOP | exit0,4.28s; only own sandbox removed, diagnostics `.evidence.IwWD5d` retained |
| runner `after`, git diff --check/frozen hashes/final lsof | original8675 files unchanged; four new files; whitespace clean;4097/4098/4099/53464 no listeners |

Initial invocation/harness failures are not hidden or labeled product failures. `*.log` stage files retain latest successful/final invocation for each stage; earlier failed logs were superseded, their exact output remains tool captures and this receipt. No fresh focused/full/core/browser results are counted after provider product STOP.

## Actual authority boundary: PASS, honestly limited

Source contract inspected BEFORE probing:

- `agentSchedulesRoutes.ts:9`: `AGENT_LOCAL` intentionally trusts the native loopback route, not per-task bearer ownership.
- `mobile_gateway_routes.ts:412–415`: real `/tools` mount requires `requireMobileDevice`.
- `mobile_device_auth.ts:26–43`: Device token verifier lookup; missing/invalid denied before router.
- `mobile_tools_routes.ts:71–78,145,228–269`: trigger-now explicitly allowed, schedule owner-scoped, real paired user attached.
- `agentSchedulesController.ts:275–281`: owner lookup BEFORE queue mutation, genuine non-owner404; no fake path or unrelated prompt-log substitution.

Actual owner user1 created task `e9eca555-7d29-404e-8e48-88ecba56c61d` via gateway4099; `createdByUserId=1`. Task future2099, recurrence disabled via supported localPATCH. Owner mobileGET of that SAME task returned exactly the authoritative nativeGET object; user2's valid mobile list excludes it. Then real POSTs to `/mobile-gateway/tools/agent-schedules/<id>/trigger-now`:

- Missing credential →401 `UNAUTHORIZED / Missing device token` (21ms including no-mutation reads).
- Invalid synthetic Device credential →401 `UNAUTHORIZED / Invalid or revoked device token` (11ms).
- Valid paired user2, non-owner →404 `NOT_FOUND / AgentScheduledTask not found` (28ms).

Each asserts identical full task/history and empty fresh paginated task-linked root/resumable/ancestor catalog, no queue/session mutation. Safe envelopes contain no stack/token/secret. This closes the **actual mobile HTTP negative boundary** evidence only; not hosted bearer auth, mobile/native package, relay/Tailscale deployment, WS/MCP authority or positive mobile schedule execution qualification.

## Actual provider defect: FAIL BEFORE teardown

Transport was test-owned ephemeral loopback53464; existing held provider reused by adapter, both closed after failed assertion. Only marker `C1-64d438e6-f5e5-4756-b847-fd93ed861fc2` registered for failure. One actual model POST receives:

```json
{"type":"error","error":{"type":"authentication_error","message":"Synthetic C1 provider unavailable: review model settings."}}
```

HTTP401 `application/json`; no real provider/account credential, unreachable-provider retry guess, fabricated session/backend, or teardown-inducedECONNRESET. Engine captured **APIError statusCode401,isRetryable=false,parts=[]**, completed assistant message `msg_0f8d59102001wEJ48yypeB7yC9`. Counts exactly1, recurrence stayedfalse through queued/running/terminal. Actual binding:

- Task `c42f6a11-7caa-42c0-b2f0-6fe291ec89a7`.
- Root `c8e7842c-8fcc-413b-8e47-f7ca2d040283`, profile `synthetic-c1-proof`, engineagent `build`, SDK `ses_f072a7004fferqfHZlVkw0qS02`.
- Run `50b880d2-d906-4572-84e1-0853976c3890`, start`18:59:00.624Z`, end`18:59:29.868Z` =29.244s dispatch→terminal. Manual acceptance`18:58:41.398Z`→terminal48.470s. Engine message created`18:59:00.994Z`→completed`18:59:29.841Z`; these are engine/persisted event times, not invented provider latency.
- **Actual run/task terminal `completed_no_op`, run.error=null, task.lastError=null**. Root status`idle`, statusMessage contains provider error. Local transcript has empty output and role=system error, no completed marker answer.

Expected durable terminal error assertion at new testline56 fails (`error` vs `completed_no_op`) after capturing fresh authoritative task/history/catalog/root/SDK data. Provider still running at capture/failure; afterAll only then closes it. Therefore not the earlier teardownfalse-success artifact.

Read-only root-cause hints, no repair: `_runOnce` in `agent_runner.ts:1745` rejects only absent response; subsequent code extracts parts/final assistant without checking `response.info.error`, flips idle at1833 and returns `status:'done'` at1913. Scheduler `agentSchedulerService.ts:872–913` classifies a done/no-mutation run as completed_no_op with no failure. Engine log actually publishes `session.error` then idle; API logs runner "completed" and scheduler no-op. Candidate omission is consistent with observed false completion; blast radius requires manager GitNexus before editing the shared runner, not a test-only status allowance or schedule-only patch.

Raw SDK proof `provider-live.json:5863–5911`; transcript error5795–5831; sanitized runtime logs `/private/tmp/rhythm-c1-gap-sandbox-20261001-owned.evidence.IwWD5d/api_server.log:83–97` and engine log159–170. All data synthetic. No claims that later no-orphan/65-second/manual-retry/browser-error assertions passed; they were not reached.

## Quarantine / remaining gaps / next action

Source inspection mandatory distinction honored: `agentSchedulesController.ts:286–288` rejects manual trigger on Postgres with quarantined/local-owner instruction; `agentSchedulerService.ts:997–1031` never starts ticking for Postgres. SQLite provider failure does NOT imply automatic quarantine or task-disable policy. No approved disposable Postgres URL/ownership supplied; did not provision/use production DB. **Recommend parent split provider-terminal failure from Postgres deployment quarantine in the contract; do not drop/waive either criterion here.**

Actual UI reconnect/reopen remains required and UNVERIFIED: no new unexecuted Playwright protocol scaffold added after product STOP. Existing explicit failing placeholder unchanged. After separately authorized root-cause repair, cheapest compliant continuation: rerun this actual provider regression first; then complete manual retry/durable failure reopen, real built webclient4098 integration with only external provider stub and actual schedule/root/transcript reads, controlled offline/reconnect, one UI POST/durable attempt, repeat-click suppression, fresh selection/scroll; retain artifacts outside repo. Browser is NOT signed packaged native/Hermes cron/TestFlight qualification. Full web/accessibility and installed OrgOptimize request/origin/build/native gates remain later delivery requirements.

Current C1 full live/core/compatibility command NOT rerun after STOP; prior9pass3gapfail and fullAPI7093 are historical evidence only. Contract keeps all three gaps/not_tested and adds actual negative proof plus failing provider binding, never claims C1 COMPLETE/READY.

## Frozen source / cleanup transfer

Prior **8675-file source/test/helper/workflow/manifest digest `ffe9d33311c48f05a85dbf286ba3f3458aafc82422e1720f47c44de9abf1b208` remains intact with ZERO changed/deleted original files**. Final8679-file map adds only the four declared new files, digest`8a1f94f6d395227aa1fabe790fbfa93e453ec6ca911607f907465880846e3a0d`; maps retained inE. Existing live test/provider/generator/guard blobs remain `17676ad1e628218638cd691bc2a7a7e834aeb7ec` / `ccfd1a8bcfbcc6b4ea8b49369c700ff2c5e2a185` / `a8666ed32976b24ae74a16db74eb06453da9da2b` / `af63909f3d6b81bfc74faaefcb185fdde6c22b84`. Product controller/repository/scheduler/ToolWorkspace/gateway hashes exactly match prior receipt; runner blob`335075e2581c7d9fe98333ad0cb66793634517fa` unchanged.

Sandbox down exited0 and removed onlySB; sanitized `.evidence.IwWD5d`, E and fresh read-onlyF retained for independent verification. Auth negative and failing provider task/root/history/engine HTTP projections captured; no operational repair/delete/reset. Both external provider servers awaited closure in afterAll; no frontend/browser was started. Final lsof shows4097/4098/4099/53464 free; secondary held-provider ephemeral port was not separately logged, its close is guaranteed by awaited adapter cleanup, not a separate port-probe claim. Runtime ownership returned to parent, no active runtime to adopt.

**Return: BLOCKED_PRODUCT_PROVIDER_FALSE_COMPLETION. Cheapest compliant next action: parent independently review captured SDK401 vs durable no-op and authorize a shared runner error-propagation repair separately, with impact analysis; no repair granted or performed by this evidence-only run.**
