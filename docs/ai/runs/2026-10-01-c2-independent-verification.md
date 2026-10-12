---
date: 2026-10-01
repo: Rhythm
branch: opencode/delivery-scheduled-profile-identity-20261001
pr: 1598
issues: [C2]
status: BLOCKED
tags: [run, Rhythm, verification]
---

# Independent C2 verification

## Result / boundary

**BLOCKED before commit/integration: required independent manager GitNexus MCP evidence unavailable in this session.** No GitNexus tools are exposed; neither upstream impact nor `detect_changes(scope=compare, base_ref=main, worktree=<W>)` can be executed. No CLI substitution, peer dispatch, inferred LOW, or reuse of prior-owner graph results. Source search independently confirms `_runOnce` has one direct caller, `run` (agent_runner.ts:872). Graph upstream count/process coverage/risk remain UNKNOWN. Parent must obtain explicit-owned-worktree graph evidence before advancing.

All five C2 source contract criteria have independently executed binding evidence below. This is not an unrestricted gate PASS. No product/test/dependency/compiler/Git-state edits, installs, symlinks, external communication, commit, push, PR, merge, deployment or release. Only this evidence file and contract verification status were edited. Source/test hashes are unchanged. Full API maintained suite was independently executed, not inferred from focused checks.

Whole-run C1, same-integrated-SHA verification, E1/W6, packaged/native UI, provider entitlement/authentication and TestFlight remain separate pending qualifications. No screenshot/rendered UI or packaged qualification is required by C2's backend metadata-only acceptance. Synthetic provider transport proves real local API/engine metadata persistence, not hosted/mobile authorization or provider entitlement.

## Files / scope / baseline

W = `/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/delivery-scheduled-profile-identity-20261001`.
All commands explicitly used W or W/apps/api_server as tool workdir. Branch `opencode/delivery-scheduled-profile-identity-20261001`, HEAD/baseline `1870574248c4f48883fd828263615cff6e9e5871`; candidate is uncommitted atop that SHA.

Initial `git rev-parse --show-toplevel && git branch --show-current && git rev-parse HEAD && git status --short && git diff --numstat && git diff --check && git diff -- apps/api_server/src/services/agent_runner.ts` exit0 showed exactly the dispatched five files: agent_runner.ts **4 additions/2 deletions**; new SQLite test98 lines, live test112 lines, contract14 lines, prior receipt78 lines. No unexpected deletion. This report becomes the sixth file; contract grows only verification metadata.

`gh api repos/ajhochy/Rhythm/commits/main --jq .sha && gh pr view 1598 --repo ajhochy/Rhythm --json state,isDraft,baseRefName,headRefName,headRefOid` exit0: remote main `4f915540f700bbb403728ef8e01e0b5e02baf94f`; PR1598 OPEN/draft, head `mega/2026-09-29-consolidation` at1870574. Local main and merge base equal4f91554. `git diff main --numstat` therefore includes inherited mega changes, not C2 ownership expansion. `git diff 1870574248c4f48883fd828263615cff6e9e5871 --numstat` independently isolates production4/2. No fetch or Git mutation.

## Commands / observed output

The literal sandbox prefix S was identical for up/status/down (W cwd):

```sh
env -i HOME=/private/tmp/rhythm-c2-check-home-20261001 TMPDIR=/private/tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-c2-fixtures-20261001-owned RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-c2-fixtures-20261001-owned/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-c2-fixtures-20261001-owned/opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-c2-independent-sandbox-20261001-owned RHYTHM_SANDBOX_API_PORT=4098 RHYTHM_SANDBOX_ENGINE_PORT=4097 RHYTHM_SANDBOX_GATEWAY_PORT=4099 RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1 DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1
```

Preflight `ls -ld` verified /private/tmp and owned HOME/fixture/dependency directories; API/MCP/fork node_modules were real directories, not symlinks. `ls -l` verified original DB/config0400, MCP dist in W, native executable in W. Read sanitized config: nonempty local MCP `node <W>/apps/mcp_server/dist/index.js`, sandbox API4098 and deliberately public synthetic fixture token; no live credentials. Original inputs are outside the new sandbox, under approved root. `lsof -nP -iTCP:4097 -iTCP:4098 -iTCP:4099 -iTCP:56474 -iTCP:60551 -sTCP:LISTEN` exit1/no listeners before launch; no runtime adoption.

| Stage | Exact command (prefix defined here) | Observed result |
|---|---|---|
| Provision | `S tools/dev/sandbox.sh up` | exit0; API `tsc -p tsconfig.json`+postbuild and MCP `tsc -p tsconfig.json --noCheck` executed successfully; Sandbox ready4098/4097. One initial connection-refused readiness retry was followed by actual ready, not treated as a failure. |
| Readiness | `S tools/dev/sandbox.sh status` | exit0; API/gateway PID65378, engine65395. |
| Probes | `curl --fail --max-time 10 http://127.0.0.1:4098/health`, same command4098/opencode/health and4097/global/health | each exit0; API statusok, SDK ready/bridgeLivetrue, engine healthytrue/version/PID/bootId below. |
| Actual C2 | L below | exit0, **2 passed/0 skipped**,19.46s,10:34:55; real native completed assistants for both paths. |
| Static / compatibility | P below, then `/bin/zsh -f -c 'node --version && npm run lint && npm exec --no -- tsc --noEmit && npm exec --no -- vitest run src/__tests__/c2_runner_profile_identity.test.ts src/__tests__/c2_runner_profile_identity_live.test.ts src/__tests__/issue_738_agent_runner.test.ts src/__tests__/issue_739_scheduler_agent_runner.test.ts src/__tests__/issue_1556_agent_runner_project.test.ts src/__tests__/issue_1040_agent_runner_streaming.test.ts src/__tests__/c1_agent_runner_pre_dispatch_enrollment.test.ts src/__tests__/scheduler_dispatch_contract.test.ts src/__tests__/agent_schedules_trigger_now_contract.test.ts src/__tests__/issue_1214_scheduler_quarantine.test.ts src/__tests__/r3_scheduled_engine_readiness.test.ts src/__tests__/scheduled_run_status_classifier.test.ts --maxWorkers=1'` (API cwd) | exit0; Node22.23.0; lint maintained placeholder prints TODO (not real ESLint); noEmit clean; **98 passed/2 gated live skips**,11 files passed/1 skipped,11.45s. Live skips qualified by separate actual run, not counted as runtime evidence. |
| Complete API suite | `P /bin/zsh -f -c 'npm test -- --maxWorkers=1 --no-file-parallelism'` (API cwd) | exit0; **749 files passed/151 skipped;7082 tests passed/290 skipped**,677.98s,10:36:21. Fresh shell with no live/port/power-state overrides. Other opt-in flows skipped are not qualified. |
| Security/advisory/build | `P /bin/zsh -f -c 'npm exec --no -- vitest run src/security/security_advisories.test.ts src/__tests__/issue_738_agent_runner.test.ts src/__tests__/agent_delegation_auth.test.ts src/__tests__/issue_1286_projectless_profile_state.test.ts --maxWorkers=1 --no-file-parallelism && npm run build'` (API cwd) | exit0; **57 passed/0 skipped**,4 files,6.58s; API tsc/postbuild clean. |
| Exact CI guard smoke | `P tools/release/smoke_org_optimizer.sh` (W cwd) | exit0; auto-path revert, all6 high-risk gate invariants, note-required, fail injection and thin-history guards passed. |
| Native attribution | `lsof -a -p 65395 -d txt -Fn`; `P apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode --version` | exit0; listener executable equals owned W built fork; version matches runtime. Existing unchanged native artifact executed independently, not independently rebuilt or packaged/signed. |
| Cleanup | `curl --fail --max-time 10 -X DELETE http://127.0.0.1:4098/agent-schedules/aa7831ac-f8f4-4a5e-8e59-47616b1b50e1` | exit0/204 after terminal actual completion; only this test-owned schedule removed. |
| Teardown | `S tools/dev/sandbox.sh down` | exit0; owned sandbox removed, sanitized diagnostics preserved at path below. |
| Ports | `(lsof -nP -iTCP:4097 -iTCP:4098 -iTCP:4099 -iTCP:57275 -sTCP:LISTEN; test "$?" -eq 1)` | exit0 wrapping expected lsof1/no listeners; test helper closed sole provider itself. |

P (clean relevant shell used while own sandbox was active):

```sh
env -i HOME=/private/tmp/rhythm-c2-independent-sandbox-20261001-owned/home TMPDIR=/private/tmp/rhythm-c2-independent-sandbox-20261001-owned/tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

L (W cwd, actual command):

```sh
env -i HOME=/private/tmp/rhythm-c2-independent-sandbox-20261001-owned/home TMPDIR=/private/tmp/rhythm-c2-independent-sandbox-20261001-owned/tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin DB_CLIENT=sqlite DB_PATH=/private/tmp/rhythm-c2-independent-sandbox-20261001-owned/rhythm.db RHYTHM_MANAGED_SKILLS_DIR=/private/tmp/rhythm-c2-independent-sandbox-20261001-owned/home/.config/opencode/skills RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_C2_EVIDENCE_FILE=/private/tmp/rhythm-c2-fixtures-20261001-owned/independent-live.jsonl npm --workspace=apps/api_server exec --no -- vitest run src/__tests__/c2_runner_profile_identity_live.test.ts --maxWorkers=1
```

Full captured terminal outputs: compatibility `/Users/ajhochhalter/.local/share/opencode/tool-output/tool_0f889a3820016SeXHXKqmGLTc6`; full API `/Users/ajhochhalter/.local/share/opencode/tool-output/tool_0f88a10b2001zgP8mb60wb9Jx2`; security/build `/Users/ajhochhalter/.local/share/opencode/tool-output/tool_0f8953393001RbFV217ZnwAKPg`. None reported a failing assertion or test error. Existing mock warnings (missing stream methods, nonfatal outcome recording, dynamic-import callback) are not substituted for live readiness.

Server CI triggers on this diff. Maintained lint, advisory, full API suite, build and optimizer smoke executed; API CI's hand-launch4000 smoke intentionally replaced by sandbox health/actual live flow. No installs/docker image pulls/live Postgres provisioning: dependency versions remain frozen. Separate live Postgres CI and Linux pinned-runtime reproduction are not claimed by local SQLite C2 evidence. Fork/MCP source and UI/package changes are absent from C2; their full suites/package gates are not C2 acceptance.

## Contract / evidence strength / security / API / docs

Contract [c2-authoritative-profile-identity.json](../contracts/c2-authoritative-profile-identity.json) was present/well-formed before execution and mapped every criterion to executable new tests; prior pass statuses were ignored until independent execution.

| Criterion | Binding assertion and plausible regression caught | Independent result |
|---|---|---|
| C2-c1 | SQLite test lines40–67: exact UUID vs plan engine, owner2, actual persisted parent/depth1 (scheduled root null/depth0), schedule task ID/category, sdk-c2; outbound exact configured model or explicit override. Fresh repository read would fail if UUID remained null/alias, owner/lineage were lost, or override routing changed. Unit provider/model columns intentionally null until SSE; live below proves actual persisted values. | 4 cases green |
| C2-c2 | lines69–76: exact UUID with raw agent_mode=null and outbound agent omitted; catches invented build identity for default config. | green |
| C2-c3 | lines79–85: unknown/absent profile raw profile_id/agent_mode null and no outbound engine override; catches fabricated profile or legacy mode. | 2 cases green |
| C2-c4 | lines87–96: OrgReviewer exact special profile/engine and default permission persistence/outbound; catches overwritten reviewer alias or permission regression. | green |
| C2-c5 | live lines70–110: real enabled once recurrence manual trigger and ordinary cookbook; exact authoritative GET profile/engine/schedule/owner/root/model; completed actual SDK assistant same SDK ID/model/engine/marker; local output bound to actual assistant SDK message ID; exactly1 matching provider request; reopened fresh GET same identity. Catches metadata-null, root mixup, stale optimistic GET, missing actual completion or wrong model/SDK projection. | 2 actual green, zero skips |

Diff is metadata preservation within pre-existing security lookup only: capture `config.id`, not caller text/engine alias; use already-resolved `effectiveOcAgent`, no guessed engine name or extra scope resolver/query. Repository getById lines380–384 uses parameterized exact config ID lookup; this repository does not implement alias lookup, so no alias resolution capability is invented. Capturing returned config.id remains correct if a supported lookup wrapper resolves an alias. Existing lock rejection precedes scope/model/slot/session work. `run` remains the sole direct `_runOnce` caller. No input/schema/route/model grant/permission/scope/MCP/profile/config mutation in production diff; owner/parent threading unchanged.

Security-negative evidence: issue738 locked-profile case returns errorCodeprofile_unavailable before session/engine work; delegation auth rejects spoofed caller IDs, unauthorized/self delegation, locked profiles and malformed/unauthorized/hidden model overrides; issue1286 rejects other-owner/project reads. All rerun in57-test command. No new trust boundary/input exists; current guard behavior preserved, not a new authorization entitlement. Local live root ownernull is matched to actual caller attribution; authenticated owner2 is exact SQLite evidence, not hosted/mobile live proof. Synthetic API key/token are deliberate public fixtures, not live secrets; no external network provider exercised.

API compatibility: existing nullable profileId/opencodeAgentId fields and branded types already define identity separation in models/agent_session.ts:65–70; no schema addition required, no new status/error shape. This corrects field semantics within existing contract; legacy fallback remains covered by C2-c2/c3. Consumers found by repo-wide `opencodeAgentId` search: API repository/controller/mobile proxy/catalog/org-reviewer service, web types/gateway session projection, mobile gateway/provider/utils/configuration UI, Flutter chat model. API callers compile and maintained suite passes; UI clients are not modified or visually qualified by this backend-only gate. Round trip is the actual C2 HTTP GET, not a storage-only assertion.

Conditional references loaded only backend-live, security, API, docs. New tests/contract/receipt paths exist and commands were independently exercised with new isolated directory. Earlier receipt remains historical, not independent evidence. No architecture/ADR reversal, rename/removal or packaging behavior change. Original receipt explicitly preserves whole-run/integration limitations; this report preserves them too. All C2 acceptance results resolved; missing graph evidence remains an explicit gate blocker rather than hidden UNVERIFIED source behavior.

## Runtime transfer / immutable hashes

Independent actual scheduled root `db6f6abf-4cb8-4ee6-a48c-784717899387`, SDK `ses_f0777588bffe3DySOpkcOjgIX7`, owned task `aa7831ac-f8f4-4a5e-8e59-47616b1b50e1` (deleted after terminal); ordinary root `a4069d2c-f223-4f4e-a518-c03719b829c2`, SDK `ses_f07771f99ffePmScR0fjOPBasA`. Both profileUUID869234dd-d314-46f4-8f7b-2fdedba42cb4/enginebuild/provider synthetic-c2/modeltext, parentnull/depth0/owner null. Each exact output bound to completed actual assistant,1 matching synthetic request. Provider loopback57275/PID65592 was test-owned and closed; not a reusable runnable origin.

Boot engine PID65395, API/gateway65378, bootId `c71402d0-8888-476e-80dc-93a469725eff`, version `0.0.0-opencode/delivery-scheduled-profile-identity-20261001-202610011715`. Independent diagnostics `/private/tmp/rhythm-c2-independent-sandbox-20261001-owned.evidence.P1as6a`; independent full root/messages/engine JSONL `/private/tmp/rhythm-c2-fixtures-20261001-owned/independent-live.jsonl`. Approved original read-only fixtures and prior-owner snapshots remain intact; prior environment.json describes prior owner, not this run. This report records the independent environment. New runtime removed, all4097/4098/4099/57275 free at handoff. Parent may reprovision from same four source variables with a new sole-owned directory/provider. No foreign739x/819x/829x,4001 or4096 managed/probed/signaled.

`shasum -a 256` before launch and after teardown matched exactly:

```text
0707542fe1bbad42cfe47db8c23e50baa044645295cf390c4e22d09e5eaff130  agent_runner.ts
bf83e78257ec3f4b63625f4e5f7f7b27a02150037fa55b5aeaa1c1efd00178e5  c2_runner_profile_identity.test.ts
a46cf066e4b41b3fb0ba34c13d897f6a3448edd46363138a1fdaa85c9a9ac008  c2_runner_profile_identity_live.test.ts
7ac205f1aea774666703a4de6980248d4253e61300e0e1fbb48feac43263ddd2  original rhythm.db
37a186476baaf17ce624b758d2797ce49a5c664f67c40c89bfb6516fec6ef5e4  original opencode.json
1ecea995868af102c607ec8ffd8ca4758310d283e0bb1cbf0c5c2adbacf5c4ac  owned native fork
```

Independent rebuilt artifact hashes: API dist/services/agent_runner.js `702786362bee4ccae5f6170661e30f1fd1ec9047262f968cecca2caf175fcbdf`; MCP dist/index.js `42ffde719c45842bbb066dc7c5d5969caa13e45dd6e24de29d131697d8212ad1`. Manifests/locks/version source diff empty. No environment repair required or attempted.
