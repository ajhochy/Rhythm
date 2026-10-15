---
date: 2026-10-01
repo: Rhythm
branch: opencode/delivery-scheduled-profile-identity-20261001
pr: 1598
issues: [C2]
status: READY_FOR_VERIFICATION
tags: [run, Rhythm]
---

# C2 authoritative runner profile identity — first focused repair

## Files / scope

Baseline 1870574248c4f48883fd828263615cff6e9e5871 verified clean in this isolated worktree. Parent specialist handoff authorizes only agent_runner.ts record-session identity and new C2 tests/contract/receipt. No C1 edits or budget reset. AGENTS/project-state/current-plan and C1 runtime evidence read. No peers, questions, commit/push/PR/merge/deploy or foreign worktree/dependency/process mutation.

## Checks

Phase 0 acceptance-contract invoked first. New real-SQLite runner contract created before implementation; engine transport is the only fake boundary. Baseline execution recorded below.

Actual baseline red: API cwd `P npm exec --no -- vitest run src/__tests__/c2_runner_profile_identity.test.ts --maxWorkers=1` at10:14:47 exit1: **5 assertion failures /3 compatibility passes**, no test errors. Ordinary/scheduled/explicit-config/model-override expect UUID profile and plan engine; received null profile and compatibility agentKind fallback. Default configured engine expects UUID, received null. Earlier10:13:14/10:13:42 harness runs disclosed missing parent name/create vs createAsync and unrealistic model-persistence expectations; fixed BEFORE implementation. Runner stores no model until real SSE bridge updates it: unit asserts unchanged null columns plus exact outbound chosen model; live asserts actual persisted model. Phase0 red complete. No production edits yet.

Actual baseline live red at10:20:16: two assertion failures,0 skipped,85.52s. Real native engine completed both marker responses exactly once. Scheduled root17b031e4-9d91-44bd-9e04-08f1630ad2e6 SDKses_f07842964ffeHeQjO98WOwDvXu task280d42b1-90d8-4f72-8dd0-576f35ad11c6; ordinary root7cfea924-5a9f-4b49-ac65-98a5666189c9 SDKses_f07838ad8ffeENb6GjQBlb7xnG. Both profileId=null, opencodeAgentId=UUID compatibility fallback, raw agentMode=null; expected actual UUID869234dd-d314-46f4-8f7b-2fdedba42cb4 and actual engine build. Model synthetic-c2/text and root lineage persisted correctly. /private/tmp/rhythm-c2-fixtures-20261001-owned/baseline-live.jsonl preserves authoritative root/messages/engine snapshots. Provider56474 PID57669 closed in afterAll. Sandbox API57321/engine57382 stopped via exact same environment sandbox.sh down; sanitized logs /private/tmp/rhythm-c2-sandbox-20261001-owned.evidence.zP7nvk. lsof4097/4098/4099/56474 no listeners. Implementation starts only after this red.

Phase 1 recheck: GitNexus repo name Rhythm ambiguous; retried with /Users/ajhochhalter/Documents/Rhythm. _runOnce apps/api_server/src/services/agent_runner.ts upstream depth3 includeTests=true: LOW, direct caller run (1), total11, Services/Controllers (2), no indexed processes. Reported before edits. No HIGH authorization inferred.

Own dependencies initially absent and own parents verified with ls. Prefix P: `env -i HOME=/private/tmp/rhythm-c2-check-home-20261001 TMPDIR=/private/tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin`. Created owned HOME after checking /private/tmp. API `P npm ci` exit0 185 packages; 16 existing advisories (2 low/7 moderate/7 high). MCP `P npm ci && P npm run build` exit0 142 packages; 15 existing advisories (1 low/6 moderate/7 high/1 critical); maintained build uses --noCheck. Fork root `P npm exec --yes --package=bun@1.3.13 -- bun --version && P npm exec --yes --package=bun@1.3.13 -- bun install --frozen-lockfile` exit0 version1.3.13,4659 packages. Global Bun1.3.14 not used to install/build. No manifests/locks/versions/symlinks changed.

## Notes / trace

effectiveConfigId is agentConfigId ?? agentKind; security lookup already reads actual config. resolveProfileScope reads model/scope and engine ocAgent, not profile ID. Engine agent name may differ from UUID config ID; Org Reviewer forces its own special engine name. _recordSession writes profile_id and agent_mode through the real repository; row reload exposes profileId separately from compatibility agentKind. Null agent_mode has a compatibility fallback on read, so default-engine tests assert the raw stored column too. No guessed build ID or duplicate scope resolution permitted. Runtime ownership 4097/4098/4099 accepted; initial lsof found no listeners. C1 failed fixtures remain untouched.

## Executed builds, runtime and focused green

All cwd paths are this worktree W unless explicitly API or fork package cwd. No source in C1 or main used for execution; C1 provider protocol read-only reused in a new C2 inline helper. Existing offline fixture generator reused unchanged; no C1-specific fixture patches imported.

1. Fork package cwd: `P OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_AUTOUPDATE=1 npm exec --yes --package=bun@1.3.13 -- bun run build --single --skip-install` exit0; web embedded build10.13s; native opencode-darwin-arm64 smoke PASS version `0.0.0-opencode/delivery-scheduled-profile-identity-20261001-202610011715`. Mach-O64 arm64 SHA256 `1ecea995868af102c607ec8ffd8ca4758310d283e0bb1cbf0c5c2adbacf5c4ac`. Full build output `/Users/ajhochhalter/.local/share/opencode/tool-output/tool_0f876a719001SFcfg7oKp64yXE`.
2. Baseline API build first failed on test-only required taskId and unknown structured-part narrowing; both corrected before production edit. A root-cwd `npm run build` failed Missing script, no fixture generated by that chained command. Correct API cwd `P npm run build` exit0 tsc/postbuild. W `P node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-c2-fixtures-20261001-owned` exit0; generated read-only0400 DB/config from scratch (two synthetic users/workspace/token, all original schedules disabled), safe local MCP points into this own MCP dist. No live DB/config/credential copies.
3. Sandbox prefix S below used byte-for-byte for every up/status/down. W `S tools/dev/sandbox.sh up`; `S tools/dev/sandbox.sh status` exit0; baseline API57321 engine57382 gateway57321. Native/API/MCP real builds, no hand-launched API. Baseline proof command L below with evidence basename baseline-live.jsonl: exit1,2 failures as above.
4. W `S tools/dev/sandbox.sh down; lsof -nP -iTCP:4097 -iTCP:4098 -iTCP:4099 -iTCP:56474 -sTCP:LISTEN`: down exit0 logs retained, final lsof exit1/no listeners. First and only production repair: **4 additions/2 deletions**, capture actual config.id in the pre-existing security lookup (no extra query/resolve), pass that profile identity and already-resolved effectiveOcAgent to _recordSession; keep OrgReviewer special profile identity. Unknown/unconfigured legacy remains null. No permissions/scope/prompt/catalog/schema/API type changes.
5. API cwd `P npm exec --no -- vitest run src/__tests__/c2_runner_profile_identity.test.ts src/__tests__/c2_runner_profile_identity_live.test.ts --maxWorkers=1 && P npm run build` at10:22:48 exit0: **8 SQLite assertions pass/2 env-gated skips**, tsc/postbuild green. Skips are not live evidence.
6. W `S tools/dev/sandbox.sh up && S tools/dev/sandbox.sh status` exit0; clean new runtime from original untouched read-only source fixtures, API60324/engine60341/gateway60324. Candidate proof L below, API cwd at10:24:18: **2 live PASS/0 skipped**,57.95s. Provider60551 PID60668 test-owned ephemeral loopback; closes in afterAll. No tools/delegation/optimizer action or added grants.
7. W `P node /private/tmp/rhythm-c2-capture-20261001.mjs` exit0: read-only SQLite backup of owned candidate API/engine DB, synthetic config and environment/PIDs/native hash saved to fixture root. W `S tools/dev/sandbox.sh down; lsof -nP -iTCP:4097 -iTCP:4098 -iTCP:4099 -iTCP:60551 -sTCP:LISTEN`: down exit0, sanitized logs `/private/tmp/rhythm-c2-sandbox-20261001-owned.evidence.18AP08`; final lsof exit1/no listeners. No foreign739x/819x/829x or live4001/4096 signals or mutations.
8. API cwd compatibility command below at10:26:33 exit0: **98 pass/2 env-gated skips,11 files pass/1 skipped**,18.64s. Includes8 C2 SQLite checks; live already independently executed. Existing tests warn about mocked stream subscriptions/repository methods and controller `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`; these are mocked compatibility evidence, not runtime readiness. Output `/Users/ajhochhalter/.local/share/opencode/tool-output/tool_0f880f607001D4xgEaLW9EvrDP`.
9. `git diff --check` exit0; tracked production diff only agent_runner.ts _runOnce4/2. GitNexus detect_changes scopeall with explicit own worktree:1 changed symbol _runOnce,0 indexed affected processes,low risk. Untracked new C2 tests/contract/receipt reviewed separately; graph does not cover new tests. Manifest/lock/version diff empty for API/MCP/fork. No commit/staging/push performed.

Exact S:

```sh
env -i HOME=/private/tmp/rhythm-c2-check-home-20261001 TMPDIR=/private/tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-c2-fixtures-20261001-owned RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-c2-fixtures-20261001-owned/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-c2-fixtures-20261001-owned/opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-c2-sandbox-20261001-owned RHYTHM_SANDBOX_API_PORT=4098 RHYTHM_SANDBOX_ENGINE_PORT=4097 RHYTHM_SANDBOX_GATEWAY_PORT=4099 RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1 DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1
```

Exact L (API cwd; baseline substituted baseline-live.jsonl and used equivalent npm --workspace=apps/api_server from W):

```sh
env -i HOME=/private/tmp/rhythm-c2-sandbox-20261001-owned/home TMPDIR=/private/tmp/rhythm-c2-sandbox-20261001-owned/tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin DB_CLIENT=sqlite DB_PATH=/private/tmp/rhythm-c2-sandbox-20261001-owned/rhythm.db RHYTHM_MANAGED_SKILLS_DIR=/private/tmp/rhythm-c2-sandbox-20261001-owned/home/.config/opencode/skills RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_C2_EVIDENCE_FILE=/private/tmp/rhythm-c2-fixtures-20261001-owned/candidate-live.jsonl npm exec --no -- vitest run src/__tests__/c2_runner_profile_identity_live.test.ts --maxWorkers=1
```

Exact compatibility command (API cwd):

```sh
env -i HOME=/private/tmp/rhythm-c2-check-home-20261001 TMPDIR=/private/tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin AGENT_SCHEDULER_IGNORE_POWER_STATE=1 npm exec --no -- vitest run src/__tests__/c2_runner_profile_identity.test.ts src/__tests__/c2_runner_profile_identity_live.test.ts src/__tests__/issue_738_agent_runner.test.ts src/__tests__/issue_739_scheduler_agent_runner.test.ts src/__tests__/issue_1556_agent_runner_project.test.ts src/__tests__/issue_1040_agent_runner_streaming.test.ts src/__tests__/c1_agent_runner_pre_dispatch_enrollment.test.ts src/__tests__/scheduler_dispatch_contract.test.ts src/__tests__/agent_schedules_trigger_now_contract.test.ts src/__tests__/issue_1214_scheduler_quarantine.test.ts src/__tests__/r3_scheduled_engine_readiness.test.ts src/__tests__/scheduled_run_status_classifier.test.ts --maxWorkers=1
```

## Actual green metadata / transfer

| Path | Local root | SDK session | Task |
|---|---|---|---|
| enabled scheduled manual |0196b2b0-ce03-468b-a7b0-91b4720c9fa0|ses_f07807fe2ffeBlJPj3boXd4EX4|d9973e8f-8c20-48f4-8fd8-1ee3689ad66c|
| ordinary cookbook |4f0d3d22-e5e5-4f70-9f57-1e8f0f0e261f|ses_f07804561ffe3QYswtKpUmjaXf|null|

Both authoritative GETs/reopened reads: profileId869234dd-d314-46f4-8f7b-2fdedba42cb4, opencodeAgentIdbuild, engine completed assistant agentbuild, providersynthetic-c2/modeltext, parentSessionIdnull/delegationDepth0/ownerUserIdnull (matches actual local caller attribution); exact marker output bound to actual SDK assistant message ID,1 real provider request each. Configured UUID vs different plan engine, explicit config override, actual owner2+parent/depth1, root scheduled linkage, default engine omission, unknown/no-profile legacy, OrgReviewer special identity/default permissions proved separately through real SQLite runner contract. No hosted/mobile authentication claim from local null owner.

Fixture/evidence transfer root **/private/tmp/rhythm-c2-fixtures-20261001-owned** retains original0400 sources, baseline-live.jsonl, candidate-live.jsonl, candidate-runtime.db, candidate-engine.db, candidate-config.json, environment.json. Sandbox runtime removed after capture; all four original source variables remain valid for independent fresh provisioning with a new test-owned provider. Do not treat stopped provider origins as runnable. Native executable/dependencies remain only in this owned worktree; no symlinks. C1 original snapshots and source untouched.

**READY_FOR_VERIFICATION for C2 only.** Phase0 actual SQLite+live red complete; Phase1 LOW complete; Phase2 first focused4/2 repair,8 SQLite+2 live green,98 focused compatibility and required builds complete. No TodoWrite (explicit developer prohibition). Parent must independently gate, integrate this minimal patch into existing mega and rerun C1 whole live suite; C1 disabled-queue/running-dedupe, remaining auth/provider/UI/native qualifications and prior repair budgets stay unresolved/unchanged. No overall MegaPR qualification or full-suite pass inferred.

Final five-file scope/numstat: services/agent_runner.ts4/2; __tests__/c2_runner_profile_identity.test.ts98/0; __tests__/c2_runner_profile_identity_live.test.ts112/0; docs/ai/contracts/c2-authoritative-profile-identity.json14/0; this receipt78/0. Untracked-file counts obtained with `git diff --no-index --numstat /dev/null <path>` (expected exit1 for a nonempty diff), no staging. Final `git diff --check` clean and lsof4097/4098/4099/56474/60551 no listeners, exit1/no matches.
