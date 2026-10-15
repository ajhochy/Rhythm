---
date: 2026-10-01
repo: Rhythm
branch: opencode/delivery-manual-trigger-20261001
pr: 1598
issues: [C1, C2]
status: FAIL
tags: [run, Rhythm, verification]
---

# C1+C2 independent real-runtime re-verification

## Decision and ownership

**FAIL — required evidence gaps, not a newly established product defect.** The strengthened C1 runtime core advanced beyond the historical null-profile barrier and exercised every subsequent core assertion. The unfiltered authored live command still fails its three explicit missing-evidence placeholders. C2 identity evidence independently re-executed on this combined focused candidate. No full feature/native/Mega readiness claim.

W = `/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/delivery-manual-trigger-20261001`.
Branch verified `opencode/delivery-manual-trigger-20261001`; HEAD verified `9b3115ff7d4dcf0b3ee4b5f60ca1781366a96c3f`. Candidate is **HEAD plus the frozen uncommitted C1 patch**, not final integrated Mega HEAD. Historical C2 whole-API 7082 and upstream18705742 receipts are preserved, never relabeled as this execution.

Only this unique run receipt and verification metadata in [C1 contract](../contracts/task-c1-manual-trigger-20261001.json) and [C2 contract](../contracts/c2-authoritative-profile-identity.json) were intentionally changed. All source/test/helper/compiler/dependency/lock/manifest files remained byte-identical. No source/test repair, new dependency, peers, Git mutation, commit, push, PR, merge, deployment, live credential/data copy or foreign service operation. No TodoWrite/agent dispatch (prohibited). GitNexus tools absent in this verifier; manager-only evidence remains a separate requirement.

Loaded verification-gate first, then backend-live, security, API, UI, documentation and packaged-runtime references. Read AGENTS, testing-guide, C1 independent/live-proof/provisioning receipts, current C1 and prerequisite contracts, C2 final receipt/contract, authored tests/provider and lifecycle source before execution. Contracts map criteria to executable tests or explicit missing-evidence/manual reasons; UNVERIFIED did not block referenced execution. No WAIVED acceptance.

## Exact environment, commands and retained outputs

E = `/private/tmp/rhythm-c1-c2-verification-20261001-owned` (owned mode0700).
Disposable SB = `/private/tmp/rhythm-c1-c2-sandbox-20261001-owned`.
Verification-only `E/verify.py` retains exact subprocess argument arrays, explicit W/package cwd, literal clean environment, branch/SHA, stdout/stderr, exit and elapsed time per stage. It is not a product/test rewrite. Every Bash command used explicit owned W cwd; subprocesses use explicit owned W/package cwd. Exact expanded commands are also retained in each `E/*.log` header.

Same literal sandbox environment S for `tools/dev/sandbox.sh up`, `status`, and `down`:

```sh
env -i HOME=/private/tmp/rhythm-c1-evidence-home-20261001-sole TMPDIR=/private/tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-c1-fixtures-20261001-owned RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-c1-fixtures-20261001-owned/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-c1-fixtures-20261001-owned/opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-c1-c2-sandbox-20261001-owned RHYTHM_SANDBOX_API_PORT=4098 RHYTHM_SANDBOX_ENGINE_PORT=4097 RHYTHM_SANDBOX_GATEWAY_PORT=4099 RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1 DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1 tools/dev/sandbox.sh <up|status|down>
```

Reused ONLY authorized original C synthetic read-only sources, not the failed-running transfer DB. Four variables explicit; source DB/config0400 owned outside new SB; nonempty local-command MCP points to W's actual built `apps/mcp_server/dist/index.js`, loopback4098, public fake token. Established sandbox validates these before launch, copies SQLite, disables copied schedules, supplies isolated HOME/XDG/config/skills/tmp/storage/engine DB, offline npm/Keychain blocker and local policy. No source fixture rewrite or live/foreign adoption. Existing fork/API/MCP dependency directories are real C-owned directories; no install.

Unit/static environment U = `env -i HOME=$SB/home TMPDIR=$SB/tmp PATH=$SB/bin:/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin PLAYWRIGHT_BROWSERS_PATH=/Users/ajhochhalter/Library/Caches/ms-playwright`. Live flags/DB/ports absent from full API/unit shell; focused command alone adds documented `AGENT_SCHEDULER_IGNORE_POWER_STATE=1`. The server did not require a power bypass.

Live environment L = U plus `DB_CLIENT=sqlite DB_PATH=$SB/rhythm.db RHYTHM_MANAGED_SKILLS_DIR=$SB/home/.config/opencode/skills RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_C1_FIXTURE_PROFILE=synthetic-c1-proof RHYTHM_C1_DISABLED_TASK=synthetic-c1-guard-disabled RHYTHM_C1_LOCKED_TASK=synthetic-c1-guard-locked RHYTHM_C1_RETIRED_TASK=synthetic-c1-guard-retired RHYTHM_C2_EVIDENCE_FILE=$E/c2-live.jsonl`.

| Executed command (package cwd noted) | Actual result | Raw output |
|---|---|---|
| W: `git rev-parse --show-toplevel && git branch --show-current && git rev-parse HEAD && git status --short && git diff --name-only && git show --stat --oneline HEAD` | assigned candidate/inventory; exit0 | tool capture; final inventory below |
| W: `git diff c1b7e023 -- <six product files + fixture generator>`; `git diff --check`; manifest/lock diff | C1 five original product files + C2 runner4/-2 + generator5/-1; clean; package/lock diff empty | tool capture |
| W: `python3 $E/verify.py before`; same `after` | 8675 source/test/tool/workflow/manifest files; identical full SHA256 map, zero differences | `before-hashes.json`, `after-hashes.json` |
| W, S: `tools/dev/sandbox.sh up`; same `status` | exit0; API/MCP rebuild clean, ready listeners | `sandbox-up.log`, `sandbox-status.log` |
| W: `curl --fail --silent --show-error http://127.0.0.1:4098/health`; `/opencode/health`; engine4097 `/global/health`; `lsof -a -p 77467 -d txt -Fn`; `ps -p 77450,77467 -o pid,ppid,command` | API ok, bridge ready, native healthy; actual C executable/process paths | tool capture + `runtime-metadata.json` |
| W/apps/api_server, L: `npm exec --no -- vitest run src/__tests__/regressions_manual_trigger_live.test.ts --maxWorkers=1` | **exit1; 9 passed/3 explicit gap failures/0 skipped**, 125.45s; core test123341ms | `c1-live.log`, `c1-observed-http.jsonl`, `c1-summary.json` |
| same cwd/L: `npm exec --no -- vitest run src/__tests__/c2_runner_profile_identity_live.test.ts --maxWorkers=1` | **exit0; 2 actual live passed/0 skipped**, 12.47s | `c2-live.log`, `c2-live.jsonl` |
| same cwd/U+power flag: `npm exec --no -- vitest run src/__tests__/{regressions_manual_trigger_contract,regressions_manual_trigger_live,agent_schedules_trigger_now_contract,scheduler_dispatch_contract,issue_739_scheduler_agent_runner,issue_1214_scheduler_quarantine,scheduler_wake_gate,r3_scheduled_engine_readiness,issue_1222_startup_burst_engine_wait,scheduled_task_stale_running_reaper,scheduled_run_status_classifier,c2_runner_profile_identity}.test.ts --maxWorkers=1` | **exit0;12 files,101 passed/8 gated live skips**,14.81s; C2 SQLite8 included | `focused.log` (expanded argv, not shell brace assumption) |
| same cwd/U: `npm exec --no -- tsc --noEmit`; `npm run build` | both exit0; API tsc/postbuild | `api-noemit.log`, `api-build.log` |
| W/apps/mcp_server/U: `npm run build` | exit0; maintained **--noCheck** build, not full MCP typecheck | `mcp-build.log` |
| W/apps/api_server/U fresh clean shell: `npm test -- --maxWorkers=1` | **exit0;750 files passed/150 skipped;7093 tests passed/297 skipped**,821.14s | `api-full.log`; tool_0f8beb241001rdlkKdvkTvqCg4 |
| same cwd/U: `npm run lint` | exit0, only maintained `TODO: add eslint`; no ESLint claim | `api-lint.log` |
| same cwd/U: `npm exec --no -- vitest run src/security/security_advisories.test.ts` | exit0,15 passed/0 skips | `security.log` |
| W/U: `tools/release/smoke_org_optimizer.sh` | exit0, exact CI auto-revert/high-risk/note/fail-injection/thin-history guards | `optimizer-ci-exact.log` |
| W/apps/web/U: `npm run typecheck`; `npm run build`; `npm run test:dist-smoke` | all exit0;1758 modules;2 relative assets; existing large-chunk warning | `web-typecheck.log`, `web-build.log`, `web-dist-smoke.log` |
| same cwd/U: `npm exec --no -- playwright test --config tests/regressions-manual-trigger-playwright.config.ts --grep-invert 'C1 repair polling failure' --workers=1 --output $E/playwright-output` | exit0, **14 intercepted rendered cases**,25.9s; not15/full-web/live-UI | `c1-rendered-14.log` |
| W: `python3 $E/verify.py capture-final` | binding/config/engine/model assertions clean; actual auth probes; readonly owned DB backups | `runtime-metadata.json`, `api-final.db`, `engine-final.db`, `c1-summary.json` |
| W/S: `tools/dev/sandbox.sh status`; same `down` | exit0; own sandbox removed, sanitized logs preserved | `sandbox-status.log`, `sandbox-down.log` |
| W: `lsof -nP -iTCP:4097 -iTCP:4098 -iTCP:4099 -iTCP:50561 -iTCP:51594 -iTCP:52773 -iTCP:57275 -iTCP:5273 -sTCP:LISTEN; test "$?" = 1` | exit0 wrapper, no listeners on all listed owned/control/browser ports | tool capture |

### Verifier invocation errors, not product defects

Initial broad `git ls-files | git hash-object --stdin-paths` failed hashing a vendored **directory symlink** (`apps/opencode_fork/packages/console/app/public/email`). The verification fingerprint captures symlink text rather than traversing it; resulting 8675-file maps match. No source or environment repair was needed.

Mistyped verifier command `npm exec --no -- vitest run src/__tests__/optimizer_phase8_safety_ci_smoke.test.ts` failed exit1: **No test files found**. Failure-triage loaded, exact invocation reproduced in `optimizer-typo-reproduced.log`, isolated to nonexistent verifier-supplied path. The checked-in CI actually runs `tools/release/smoke_org_optimizer.sh`; that exact script subsequently exited0. No invented test, skip, product repair or pre-existing-base classification. Native/toolchain repairs: NONE.

## Actual C1 criterion bindings

Core test lines159–242 fully executed, unchanged 281-line source. Real HTTP → scheduler → AgentRunner → real native fork → synthetic external Anthropic text transport → actual persisted/API and SDK messages. The provider is test-owned, ephemeral loopback **50561**, readiness/waiting/held/released protocol; not fake backend or fabricated engine. Authored helper selects a free port, so52773 was not required/reused. Final marker captured/released **requests=1**; test afterAll closes only its own provider. No tool/delegation/model account/network entitlement claim.

| Binding | Observed outcome / bug caught |
|---|---|
| Disabled recurrence (c2) | POST returns queued with enabled=false; recurrence remains false during dispatch/terminal and after65s. Catches accepted-but-never-dispatched disabled queue and accidental enablement. |
| Running duplicate (c4) | Duplicate issued only after authoritative running+held provider; same lastRunAt/nextRunAt, one root/SDK and generation count1. Catches running reset/re-dispatch or second provider generation. |
| Durable root/run/no-orphan | task-linked paginated catalog and literal marker searches across scheduled/chats/self_improvement show exactly one root, no children; one final run/start/root. Repeated after65s. Detects task-linked or marker-matching orphan roots, not arbitrary unrelated roots. |
| Real completed answer | exact local role=output text and real SDK completed/error-free role=assistant marker with matching sdkMessageId/session; input/reasoning/tool/synthetic/ignored proof rejected. Catches prompt-echo false pass and wrong-message/session attribution. |
| Durable reopen (backend portion c3) | fresh task/history/catalog/transcript reads after65s preserve final answer/root and exactly one run with disabled recurrence. This is NOT an actual browser reconnect. |
| Guards (portion c5) | actual disabled/locked/retiredHTTP400 actionable reasons, unchanged task/history/root; model pair HTTP400 instruction; no secret-shaped guard response. |

Concrete identities (raw `c1-summary.json`):

- marker `C1-1e9cbdb0-d1ca-4835-927f-07a39c6349c1`; task `23caaf43-6773-4a80-b9e5-a7f89154f711`.
- local root `449ce0e3-7fa5-4e10-bdba-9c4633bd5853`; authoritative profile **`synthetic-c1-proof`**; actual profile `ocAgent` and root `opencodeAgentId` **`build`**, not assumed equal to profile ID.
- SDK `ses_f0750e35bffe5pFvQFiLiO6fcs`; completed assistant/local SDK-message `msg_0f8af1d4e001lY4TbAPVrZFknN`.
- durable run `330859aa-8399-45f2-b79b-adb14e46888b`, started`2026-10-01T18:17:00.800Z`, ended`2026-10-01T18:17:19.921Z`, **completed_no_op**, errornull. This is legitimate no-mutation completion **with actual answer**, not empty success or provider-teardown artifact.
- Independent observer retained running/terminal HTTP+SDK snapshots. The source test directly asserts queued/running/barrier/65s conditions; observer timestamps alone are not claimed to prove65s. Only the successful test-owned terminal schedule was deleted by the authored harness after assertions; captured terminal history retained outside runtime.

Historical `root.profileId=null` barrier no longer reproduces with C2 present. No harness equality assumption required changing and no assertion weakened.

## C2 actual re-execution

Unchanged source SHA256 `0707542fe1bbad42cfe47db8c23e50baa044645295cf390c4e22d09e5eaff130`; unchanged SQLite/live tests `bf83e78257ec3f4b63625f4e5f7f7b27a02150037fa55b5aeaa1c1efd00178e5` / `a46cf066e4b41b3fb0ba34c13d897f6a3448edd46363138a1fdaa85c9a9ac008`.

Eight SQLite assertions independently re-executed configured ordinary/scheduled/explicit/model override, default omission, two unconfigured legacy and reviewer special case. Real SQLite persists config UUID separately from plan agent, owner2/parent/depth/task/category and SDK. External engine transport is fake ONLY in these integration tests; prompt spies are supporting compatibility, not actual runtime evidence.

Two real-native live cases independently assert API/reopened profile UUID `869234dd-d314-46f4-8f7b-2fdedba42cb4`, resolved build engine, provider/model, task/owner/parent/depth/category, exact completed assistant and local message ID, one request per marker. Provider51594 PID77853 was test-owned and closed by afterAll.

- scheduled root `ddd57cd5-922b-401b-9326-f09020b2eddb`, SDK`ses_f074f10fdffee25rNKJCZWV8GC`, task`604c6357-70b6-4d32-8413-470d835e5e00`, marker`C2-d066b4bf-f889-4dd7-a230-9c3390f9cd2d`.
- ordinary cookbook root `9f775a7d-f105-45dc-ae85-ad74059aa9f6`, SDK`ses_f074f0e5effezQb5JUdMw4Lmml`, marker`C2-7d26bc9a-3b4c-4257-a6ca-99e16dd29211`.

C2 acceptance execution remains sound; this does not convert overall C1 or final Mega/native acceptance to PASS.

## Interface, security, UI, documentation and provenance

API change is compatible behavior/guard tightening using the existing full `AgentScheduledTask` response and400 envelope, no new route/field/schema/version. Exact registered path `agentSchedulesRoutes.ts:17`; route localpolicy atline9 intentionally bypasses schedule auth underAGENT_LOCAL. Controller retains mobileDevice owner-scoped lookup before queue, profile/grant validations before mutation; parameterized SQL retained. C2 stores authoritative existing nullable profile/engine fields, not a schema migration. Literal consumer lookup found web ToolWorkspace/gateway/endpoint map, Flutter schedule datasource/repository/controller/view, MCP `tools/agentSchedule.ts`, mobile rhythm-tools-service/mobile route, API callers/tests. API/web compilers and maintained MCP build ran; Flutter/mobile consumer compilers/native surface not independently qualified.

Actual **supported local** credential probe used existing C1 root's `GET /agent-sessions/:id/prompt-log` (route requiresPromptAuth even in local mode): no token401/Missing bearer token; invalid synthetic token401/Invalid session token; public fixture token200 with exact sessionId/injections[]; UNAUTHORIZED envelope and no stack. This proves that specific guard, **not** schedule-hosted authorization/mobile-owner rejection. No hosted assertion invented for intentionally tokenless local schedule API. Owner rejection direct-controller integration and broad auth compatibility tests do not replace the missing real mobile schedule proof.

Changed diff contains no real credential; model/MCP tokens are deliberately public synthetic values. No new SQL/shell/HTML interpolation, remote content execution or broadened grant. Authored negative provider-control parser rejects malformed states/counts. API full suite/security advisory command pass but no blanket native security qualification.

Fourteen **intercepted Chromium rendered** cases freshly exercised duplicates/progress/reload, disabled recurrence rendering, safe errors/retry, task isolation, Enter/Space/mounted live-region/busy/focus and ambiguous accepted-network reconciliation. No actual browser-to-running-backend reconnect, keyboard Tab/computed focus visibility, screen-reader speech, contrast/zoom/responsive/sibling-control or signed package claim. Vite server launched from assigned W by dedicated config with no reuse; changed source hash matched. A separate fetch-of-changed-file stale-serve probe was not captured, so that reference clause remains incomplete.

The polling-recovery case writes immutable existing `docs/ai/artifacts/c1-manual-trigger-20261001/recovered-failed.png`; it was explicitly excluded to obey receipt/contracts-only write authority. Existing screenshot was opened and shows rendered synthetic disabled schedule/failed-model repair; no fresh screenshot/15-case claim. Its healthy banner is intercepted fixture data, not real runtime health. **Full maintained web `npm test` not run**: default discovery includes this screenshot-writing case and dedicated slice runners have additional lifecycle/port/artifact ownership not transferred. Focused14/typecheck/build/dist smoke do not substitute for full compatibility. Manager must arrange artifact/lifecycle-safe complete web evidence; no waiver inferred.

Native executable was existing owned real fork, hash`6608437aec531cd00a5806eff80f9f0af75c4e59aa6958bb56796fd16d36c6a6`; executed version`0.0.0-opencode/delivery-manual-trigger-20261001-202610011652`. Independent listener attribution shows enginePID77467 using that W binary and owned engine DB; API/gatewayPID77450 executes freshly built W/dist/server.js; native bootId`accef766-de85-4e1a-8b2b-226810ca5fbf`. Fork tree has no C1/C2 changes; existing artifact independently executed, not falsely presented as a fresh signed/native package build. API/MCP were rebuilt by sandbox then static checks. Raw environment/profile/build hashes, actual health and readonly API/engine DB backups retained inE. No adoption/restart/manual API/engine launch.

CI exact lint/security/build/safety script executed. Maintained lint only printsTODO. Manual CI API startup was **not** run locally; sandbox health is the safe replacement. Disposable live-Postgres bootstrap not run: no disposable PostgreSQL ownership/URL supplied, unsafe to substitute a live database; opt-in skips not qualification. No unrelated failed check labeled pre-existing without merge-base evidence; no merge-base mutation/execution attempted.

Docs/contracts reference real paths/tests and separate historical versus fresh claims. No architecture reversal/ADR needed for evidence-only updates. Broader native Hermes `/api/cron/jobs` trigger is distinct from C1 `/agent-schedules`; no OrgOptimize installed literal method/URL/origin/build attribution, final signed packaged smoke, release cards or TestFlight qualification.

## Remaining required gates / consolidated classification

| Missing/failing gate | Classification / exact missing evidence |
|---|---|
| C1 full live placeholder atline279: auth/mobile non-owner | **Evidence/fixture gap**, not established product defect. Approved real paired-device/schedule auth rejection fixture and no-mutation binding absent. Local prompt-log credential probes cannot close it. |
| C1 full live placeholder atline279: unavailable provider/model terminal error/quarantine | **Evidence/fixture gap**. No owner-provisioned safe error fixture driving persisted actionable terminal error/quarantine. Successful synthetic reply and old teardownECONNRESET are not evidence. |
| C1 full live placeholder atline279: actual UI reconnect/reopen | **Automation gap**. Existing rendered harness intercepts HTTP; no live browser integration/actual reconnect test. |
| Exact installed action / failure visibility / native qualification | **Packaged evidence blocked**, future literal OrgOptimize/RunNow provenance and signed packaged smoke; HTTP and14 fixture cases not substitute. |
| Full web, screenshot-writing polling case, stale-serve fetch, wider accessibility | **Execution/evidence blocked** by current readonly artifact/lifecycle authority or missing automation; historical image/result kept. |
| Normal recurring live scheduler, hosted/Postgres and other opt-in suites | **Not qualified**. Current unit compatibility and manual scheduled live core do not claim all live behavior. |
| Fresh manager GitNexus | **Unavailable here**. Request `detect_changes({repo:"Rhythm",scope:"all",worktree:W})` and `detect_changes({repo:"Rhythm",scope:"compare",base_ref:"main",worktree:W})`, include untracked Git inventory separately. Supplied C1LOW20/mapped6 and C2LOW1/direct11 are manager context, not newly executed verifier MCP. Inherited MegaCRITICAL is not downgraded to new C1 risk. |
| Final integrated Mega commit/checks | **Future integration gate**, this focused9b3115ff+C1 candidate not final Mega state. |

## Frozen hashes and cleanup handoff

Complete8675-file source/test/helper/tool/workflow/manifest inventory SHA256 before/after: **`ffe9d33311c48f05a85dbf286ba3f3458aafc82422e1720f47c44de9abf1b208`**; zero differences. Maps cover tracked AND untracked tests/helpers (symlinks hashed as links, never traversed). Existing artifacts/receipt docs outside source inventory separately preserved; only declared new run + two contract metadata edits.

Frozen original five Git blob hashes, path order controller/repository/scheduler/ToolWorkspace/gateway:
`566b0941f526ebbb240c0f226b3e165b4f3acc6a`, `eaae933a4505ca97264534147529fb6c41e1859f`, `e9f5aa0c9c9a607158358636f9478ae419c5b8f3`, `0fc648a6414468e989625b2fc009f0b30817e1fa`, `129f9ab69035f32c24eff9a504e17b26dd35a37b`.
Live test/provider/generator/C1 seed helper: `17676ad1e628218638cd691bc2a7a7e834aeb7ec`, `ccfd1a8bcfbcc6b4ea8b49369c700ff2c5e2a185`, `a8666ed32976b24ae74a16db74eb06453da9da2b`, `af63909f3d6b81bfc74faaefcb185fdde6c22b84`.

Sandbox `down` exited0, removed only ownedSB and retained sanitized diagnostics `/private/tmp/rhythm-c1-c2-sandbox-20261001-owned.evidence.dZgKFi`. Original read-only synthetic source fixture andE retained. Both providers closed by their test afterAll; browser server closed by Playwright. Final listener probe shows4097/4098/4099/50561/51594/52773/57275/5273 free. No signal to4001/4096/739x/819x/829x or foreign process. **Runtime ownership returned to manager for E1/W6/M**, no active C backend/provider to adopt.

Return status **FAIL (required evidence gaps), with successful core evidence and blocked future gates separated**. No fresh product repair authorization, no “done”, no readiness inflation.
