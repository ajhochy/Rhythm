---
date: 2026-10-01
repo: Rhythm
branch: opencode/delivery-manual-trigger-20261001
pr: 1598
issues: [C1]
status: AUTHORED_NOT_RUN
tags: [run, Rhythm]
---

# C1 evidence-only live proof repair

## Files / scope

Worktree W: `/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/delivery-manual-trigger-20261001`. Baseline `c1b7e023` and MegaPR1598 are dispatch context, not independently queried. Only the C1 live test, existing contract evidence mapping, and this new receipt were edited. No controller/repository/scheduler/gateway/ToolWorkspace or other production changes. Repair counter unchanged. AJ revalidated the frozen candidate after disclosure; this is NOT another product repair. No product defect established.

Git/workflow/GitNexus/peers/runtime actions: NONE. GitNexus impact and workflow-orchestrator tools are unavailable; UNKNOWN, not LOW/PASS. Existing HTTP helper is unchanged; new test-only helpers and test callbacks have no inspected production consumers. No HIGH result was obtained or invented. No dependency installations, main symlinks, live data, credential copies, or foreign sessions accessed. Every file operation used an explicit W path. No shell command was executed.

Patch-accounting name/numstat relative to the supplied pre-repair files (NOT fresh `git diff`):

- `apps/api_server/src/__tests__/regressions_manual_trigger_live.test.ts`: +174 / -9 (67 → 232 lines).
- `docs/ai/contracts/task-c1-manual-trigger-20261001.json`: +18 / -7 (97 → 108 lines).
- `docs/ai/runs/2026-10-01-c1-live-proof-repair.md`: +74 / -0 (new receipt). Existing untracked baseline treatment remains the verifier's receipt; no new Git status claim.

## Checks / triage

**REDO** original live output proof: searching serialized transcript accepted the submitted prompt. First edit authored a minimal input-only payload reproducer before the proof replacement. Its old assertion accepts `[{role:'input',rawText:'Reply exactly C1-synthetic-proof'}]` with no answer. Second payload isolates a queued duplicate accepted by `['queued','running']` and a single history row despite two roots. These are runnable synthetic falsifications, NOT executed output or a product failure.

**KEEP** real HTTP→scheduler→AgentRunner→engine path, disabled recurrence, success OR completed_no_op classification, terminal history, later scheduler interval and test-owned terminal schedule deletion. completed_no_op is harmless nonmutating completion; it still needs an actual answer.

**REDO** output assertion now requires exact output text, excluding input/system/tool/reasoning/synthetic/ignored parts and wrong local session. Structured text parts are authoritative; raw/stripped fallback only applies when parts are absent, never when present parts are reasoning/tools. The real engine read independently requires completed assistant info with correct SDK session, no error, exact final text, and persisted output sdkMessageId matching the engine answer. Task/profile/root/SDK/run-start/terminal-run identities are bound. The API uses role `output`; engine uses role `assistant`. Bare completion, user prompt, metadata or reasoning cannot close this proof.

**REDO** immediate duplicate is only an early duplicate, not claimed queued-only or running proof. The additional duplicate occurs after authoritative running AND provider-held response, with recurrence false, stable lastRunAt/nextRunAt/root/SDK, one provider request and one eventual history run ID. There is no public in-flight run ID; the test does not invent one. Provider must remain held until release so the check cannot race a fast terminal answer.

**REDO** root count independently snapshots supported paginated catalog queries with task scope, includeArchived and fresh cursors. Literal per-test marker searches across scheduled/chats/self_improvement catch marker-matching orphan roots missing task linkage without listing unrelated sessions. Parent/lineage children are separately read; no-tools/no-delegation fixture requires none. New roots exactly one, correct task/profile/root/SDK; fresh catalog/transcript reads repeat after 65 seconds. This does not pretend to detect an arbitrary unrelated session without either task linkage or the synthetic marker.

**Added real guards (authored)** disabled/locked/retired fixture preconditions, HTTP400 actionable reason, no secret-shaped response, unchanged task/history/root reads; incomplete model override pair gets actual HTTP validation feedback. This is NOT provider unavailability, hosted auth, owner rejection or UI error visibility coverage.

**Explicit failing live gates** preserve UNVERIFIED auth/mobile-owner, provider/model terminal failure/quarantine, and actual UI reconnect/reopen. No new intercepted assertion pretends to cover these. c5 is now UNVERIFIED with prior evidence retained and added to not_tested; earlier rendered repair pass fields remain historical, not rerun. Final packaged Org Optimize/Run Now component/request/origin/build attribution and smoke remain REQUIRED future package gate, not an HTTP fixture accomplishment. No computer-control run or fallback claimed.

## Manager-only execution requirements (all NOT RUN here)

Runtime sole owner remains `attachmentf64a2052`, API4098/engine4097/gateway4099. Do NOT start/adopt/restart/down any service, manually launch an API, reuse foreign sandbox or copy credentials. Manager must arrange authorized serialized checks through the existing sandbox workflow; this receipt grants no runtime transfer. Sanitize/provision fixtures via owner authority, not this authoring session.

Manager must attest candidate API build and real fork executable attribution, `/opencode/health` status=ready, SQLite copied fixture DB, sandbox HOME/config/managed-skills/CWD, scheduler enabled and eligible despite machine power state, correct profile projection/model/scope, fixture-only local auth expectations and no live MCP/network side effects. Merely setting DB_PATH or isolated=1 does not prove the server's isolation. Engine read uses the root's recorded directory. Only owned worktree dependencies; never install through main-linked node_modules.

Required environment values below must be supplied by manager, not guessed:

- `C1_SANDBOX_HOME`, `C1_SANDBOX_TMP`, `C1_SANDBOX_PATH`, `C1_SANDBOX_DB`, `C1_SANDBOX_SKILLS`: existing owner-approved isolation paths/tooling. PATH includes the owner's compatible Node and existing own deps; no installs.
- `C1_PROFILE`: enabled, unlocked, schedulable `synthetic-*` profile projected into the real engine, using a safe local synthetic provider and fixed valid model. No tools/delegation/mutations. Provider sees `C1-<uuid>` and returns exactly that marker in final assistant text, not prompt echo.
- `C1_PROVIDER_CONTROL`: an OWNED loopback HTTP origin on a separate explicit port (NOT 4001/4002/4096–4099); no credentials. Required control protocol below is a fixture prerequisite, NOT an existing product API claim. If unavailable, STOP: BLOCKED, do not substitute sleeps/mocks or adopt a listener.
- `C1_DISABLED_TASK`, `C1_LOCKED_TASK`, `C1_RETIRED_TASK`: owner-seeded terminal-free disabled schedules named exactly `synthetic-C1-guard-DISABLED`, `synthetic-C1-guard-LOCKED`, `synthetic-C1-guard-RETIRED`, bound to `synthetic-*` profiles. Disabled profile enabled=false; locked profile locked=true; retired profile/task includes the retired optimizer grant but stays safely blocked. Seed before candidate runtime by approved fixture workflow; locked schedule cannot be created through guarded live create. No real optimizer invocation.

Held-provider control protocol: `GET /c1/holds/readiness` → `{state:'ready',requests:0}`. `GET /c1/holds/<marker>` → `{state:'waiting',requests:0}` before capture, then `{state:'held',requests:1}` after real engine request capture. Hold final response (not stream completion) until `POST /c1/holds/<marker>/release` → `{state:'released',requests:1}`; then produce valid model-protocol completed assistant marker. Subsequent GET preserves released/count. Count every captured generation for this marker, including concurrent duplicates; not just unique marker entries. No automatic hold expiry before assertions. After failed test, leave held/running evidence to owner for explicit recovery; test does not release/clean an unsuccessful run behind the evidence gate.

Exact nonserver falsification command, explicit workdir `W/apps/api_server`, only after manager authorizes sandbox tooling:

```sh
env -i HOME="$C1_SANDBOX_HOME" TMPDIR="$C1_SANDBOX_TMP" PATH="$C1_SANDBOX_PATH" npm exec --no -- vitest run src/__tests__/regressions_manual_trigger_live.test.ts -t 'C1 evidence falsification' --maxWorkers=1
```

Exact live command, same explicit workdir `W/apps/api_server`, owner only after all fixture/readiness requirements:

```sh
env -i HOME="$C1_SANDBOX_HOME" TMPDIR="$C1_SANDBOX_TMP" PATH="$C1_SANDBOX_PATH" DB_CLIENT=sqlite DB_PATH="$C1_SANDBOX_DB" RHYTHM_MANAGED_SKILLS_DIR="$C1_SANDBOX_SKILLS" RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_C1_FIXTURE_PROFILE="$C1_PROFILE" RHYTHM_C1_PROVIDER_CONTROL_URL="$C1_PROVIDER_CONTROL" RHYTHM_C1_DISABLED_TASK="$C1_DISABLED_TASK" RHYTHM_C1_LOCKED_TASK="$C1_LOCKED_TASK" RHYTHM_C1_RETIRED_TASK="$C1_RETIRED_TASK" npm exec --no -- vitest run src/__tests__/regressions_manual_trigger_live.test.ts --maxWorkers=1
```

Full live command intentionally FAILS the three UNVERIFIED gap cases until real coverage exists. A targeted dispatch/guard result may be recorded separately but cannot close the contract or waive those cases. No unit test port overrides; scheduler power override, if needed, belongs to the owner's running server environment, not proof by this test process.

## Notes / result

Execution **NOT RUN**, including pure falsification: repository policy requires sandbox checks and no sandbox testing environment/ownership was transferred. Synthetic failure isolation is authored/read-inspected only; no invented exit code. Manager must run falsification first, then compiler and live checks under owned tooling. Prior **89 API / 15 rendered** results remain historical and unchanged, not fresh passes. No production diff/hash/whitespace/compiler/JSON validation or independent GitNexus result claimed.

Harness authoring is complete for runtime review; runtime verification is BLOCKED on owner authority, held-provider fixture/control provision and guard fixtures. Full verification remains BLOCKED/UNVERIFIED on real auth/owner, provider failure/quarantine, live browser reconnect and final package gate. Do not commit or label C1 done from this receipt.
