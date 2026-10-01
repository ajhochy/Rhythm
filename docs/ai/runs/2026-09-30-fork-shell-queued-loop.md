---
date: 2026-09-30
repo: Rhythm
branch: fix/test-temp-directory-cleanup
pr: null
issues: []
status: waived
tags: [run, rhythm]
---

# New compatibility criterion: shell completion resumes queued loop callers

**Active compatibility outcome: WAIVED by AJ's explicit informed approval; historical diagnostic BLOCKED/FAIL below retained.** Final integrated assessment (2026-10-01) is PASS-local for the original cleanup draft PR only, with downstream CI pending, not merge-ready. This is risk acceptance, not a session fix or proof of flakiness. See the cleanup contract/run note's final local assessment.

## Files / boundaries

Verified assigned worktree `/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/test-temp-directory-cleanup`, branch `fix/test-temp-directory-cleanup`, HEAD `4f915540f700bbb403728ef8e01e0b5e02baf94f`. Preserved all twelve pre-existing pending files. This triage owns only this run note and `docs/ai/contracts/fork-shell-queued-loop.json`; no code, existing run history, project state, or cleanup implementation changed. No commit/push/PR/merge/peer dispatch or leftover/worktree/branch deletion.

## Original RED (not superseded)

Controlling run3 section337+ in `2026-09-30-test-temp-directory-cleanup.md`: branch full sessions407 pass/1 fail/5 skip/1 todo; `prompt.test.ts:1523` expects llm.calls1, got0. Exact base408 pass/0 fail. Cause remains UNKNOWN; do not classify it as unrelated, pre-existing, environment-only, or established timing flakiness. The new authorization permits diagnosis of this criterion, not speculative engine edits.

## Sandbox / exact environment

Created NEW synthetic read-only sources with `ls -ld /private/tmp && node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-shell-loop-fixture-20260930-triage` (exit0).

Each `tools/dev/sandbox.sh up`, `status`, and `down` used:

```sh
env RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-shell-loop-fixture-20260930-triage RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-shell-loop-fixture-20260930-triage/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-shell-loop-fixture-20260930-triage/opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-shell-loop-sandbox-20260930-triage DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow RHYTHM_NUMBAT_ENABLED=false tools/dev/sandbox.sh <up|status|down>
```

Up/status exit0: API4098 PID37549, engine4097 PID37568, gateway4099 PID37549; API tsc/postbuild and MCP build green. All test commands ran while sandbox up, root cwd, wrapped with:

```sh
env -i HOME=/private/tmp/rhythm-shell-loop-sandbox-20260930-triage/home TMPDIR="$TMPDIR" PATH="/private/tmp/rhythm-shell-loop-sandbox-20260930-triage/bin:/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" /bin/zsh -f -c '<command>'
```

Actual TMPDIR `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T`, Node22.23.0 and Bun1.3.14 (same as original local failure; CI1.3.13 not tested). No installs, live config/data or manual API launch. Final status retained same PIDs; down exit0, `Sandbox removed: /private/tmp/rhythm-shell-loop-sandbox-20260930-triage`; sanitized diagnostics retained at `/private/tmp/rhythm-shell-loop-sandbox-20260930-triage.evidence.pCFLMQ`.

## Checks — all bounded outcomes

`W = node tools/dev/test-temp-directory-cleanup.mjs --`.
`B = apps/opencode_fork/packages/opencode`.
`A = /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/temp-cleanup-base-20260930-repair1/apps/opencode_fork/packages/opencode` (previously verified exact-base archive; not modified).

Execution order: branch full1; branch focused1/2/3; base focused1/2/3; base full1; branch full2; base full2. No further repeat attempts or repair attempts made.

| Command | Every outcome | Counts rhythm-vitest/opencode-test/opencode-test-data |
| --- | --- | --- |
| `W bun --cwd B test test/session/ src/session/` (full1; exact original failed command) |408 pass/0 fail/5 skip/1 todo/1154 assertions,59.14s; child assertions green; wrapper exit1 for background growth |12786/242/10 →12786/243/10 |
| `W bun --cwd B test test/session/prompt.test.ts -t "shell completion resumes queued loop callers"` ×3 |Each1 pass/0 fail/56 filtered/6 assertions, wrapper exit0; test1314.51/1234.17/1227.71ms |12786/243/10 →same each |
| Same focused command with `--cwd A` ×3 |Each1 pass/0 fail/56 filtered/6 assertions, wrapper exit0; test1297.38/1310.33/1261.27ms |12786/243/10 →same each |
| `W bun --cwd A test test/session/ src/session/` (full1) |408 pass/0 fail/5 skip/1 todo/1154 assertions; queued-loop608.79ms; wrapper exit1 for background growth |12786/243/10 →12786/244/10 |
| `W bun --cwd B test test/session/ src/session/` (full2) |408 pass/0 fail/5 skip/1 todo/1154 assertions,56.24s; queued-loop650.56ms; wrapper exit1 for background growth |12786/244/10 →12786/245/10 |
| `W bun --cwd A test test/session/ src/session/` (full2) |408 pass/0 fail/5 skip/1 todo/1154 assertions,54.67s; queued-loop621.85ms; wrapper exit1 for background growth |12786/245/10 →12786/246/10 |

Focused sample command was bounded nested loops `for package in B A; do for sample in 1 2 3; do W bun --cwd "$package" test test/session/prompt.test.ts -t "shell completion resumes queued loop callers"; done; done`. Remaining full sample loop used package order A B A. Aliases here denote the literal paths above; execution passed those literal paths. Full outputs for A/B/A retained at `/Users/ajhochhalter/.local/share/opencode/tool-output/tool_0f57243fc001VBUI3clvUuCrIF` (summaries lines496/1017/1538). First full and six focused receipts captured directly in triage tool output.

All full wrappers reproduced known deferred background +1 growth equally on base and branch; no wrapper exit1 was reported as an overall PASS. All matching roots remain untouched. Assertion outcomes are distinct from this count rejection.

## Flow diagnosis / remaining uncertainty

- GitNexus query `SessionPrompt shell loop SessionRun queued shell completion` and context `ensureRunning` in `src/effect/runner.ts` succeeded. Context reports no indexed incoming references or process memberships (not proof of no callers); actual source trace below supplies the service-wrapper callers.
- `SessionPrompt.shell` (`prompt.ts:2267`) → `SessionRunState.startShell` (`run-state.ts:95`) → `Runner.startShell` (`runner.ts:140`): claims Shell under SynchronizedRef; forks shell work and waits its exit.
- `SessionPrompt.loop` (`prompt.ts:2261`) → `SessionRunState.ensureRunning` (`run-state.ts:87`) → `Runner.ensureRunning` (`runner.ts:115`): first caller in Shell changes state to ShellThenRun with pending work/deferred; second coalesces onto the same deferred. Shell finalizer `finishShell` (`runner.ts:93`) starts pending work and moves to Running; run completion resolves shared deferred.
- Shell work creates synthetic user/assistant/tool records before spawning process (`prompt.ts:1121–1278`). `runLoop` reads persisted messages and either exits on a finished assistant without tool calls (`2070`) or runs processor/LLM. Successful Fiber exit alone does not prove a successful model result; tests elsewhere intentionally return assistant error messages on provider failures.
- Current test uses `sleep 0.2` and two50ms test sleeps, without observable proof shell ownership/queued registration or returned assistant error/text assertions. This is an inadequate scheduling guarantee, but source alone does NOT explain the original zero-call success. A late queue could still legitimately invoke the LLM; do not claim replacing sleeps has fixed that unexplained symptom.
- Same-environment reruns did not reproduce original assertion: intermittent behavior or uncontrolled prior state remains possible. No evidence distinguishes synchronization, a pre-request processor/provider error captured as assistant output, or other cross-test effects. Exact-base focused/full samples currently pass; original branch FAIL stays controlling.

## Handoff — BLOCKED / NEEDS_CONTEXT

No test/production patch is justified by present evidence; no symbol edits, so no pre-edit impact was needed. No HIGH/CRITICAL approval consumed. Fork typecheck after patch is not applicable (no patch), and no integrated verification gate or new draft PR clearance claimed. Leave project-state completion and draft-PR actions with hub after a genuine fix plus independent gate.

Narrow options for AJ/hub:
1. Recommended: authorize one diagnostic-only test instrumentation pass that captures shell Fiber exit, returned assistant error/text, and shell/queue ordering on failure, retaining all existing assertions. Use observable gates only after identifying the failed schedule; bounded follow-up, not endless reruns.
2. If that identifies a production runner/processor issue, report precise minimum proposal and impact, then obtain expanded fork/live-behavior authorization before edits.
3. Keep the draft PR blocked and retain these receipts until original-failure runtime details are available. Successful retries alone must not waive the compatibility criterion.

## Authorized diagnostic attempt1 (new compatibility criterion, not cleanup repair3)

Criterion: capture shell Fiber exit, assistant error/text/finish, actual Runner queue states/order, and LLM stub entry using temporary test-only observation; run up to20 focused samples per tree, stop on failure, and remove observation if unreproduced. Original RED and all preceding receipts remain controlling.

WAIVED: diagnostic-only instrumentation changes no intended behavior; verification is: unchanged queued-loop assertions, paired bounded stress receipts, instrumentation removal, and sandbox teardown.

Entry verification: `pwd && git rev-parse --show-toplevel && git branch --show-current && git rev-parse HEAD && git status --short && git diff --stat` returned assigned cwd/top-level, `fix/test-temp-directory-cleanup`, exact `4f915540f700bbb403728ef8e01e0b5e02baf94f`; all14 pending paths preserved. Memory files read without changes. No concurrent owner per dispatch. GitNexus file impact for `File:apps/opencode_fork/packages/opencode/test/session/prompt.test.ts`: LOW,0 indexed dependents/processes/modules; initial empty-UID lookup failed and was corrected with explicit file UID. No production symbol edit or HIGH/CRITICAL approval consumed.

### Diagnostic sandbox and commands

`ls -ld /private/tmp && node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-shell-loop-fixture-20260930-diag1` exit0 created new synthetic DB/config, source files mode0400; no operator sources, installs or symlink dependency writes. The maintained sandbox reused the existing fork binary and built API/MCP successfully; no new fork production behavior is claimed.

Every `up`, `status` (before and after tests), and `down` used exactly:

```sh
env RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-shell-loop-fixture-20260930-diag1 RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-shell-loop-fixture-20260930-diag1/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-shell-loop-fixture-20260930-diag1/opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-shell-loop-sandbox-20260930-diag1 DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow RHYTHM_NUMBAT_ENABLED=false tools/dev/sandbox.sh <up|status|down>
```

Up/status exit0: API4098/gateway4099 PID51760, engine4097 PID51779. Final status showed the same owned PIDs. Down exit0: `sandbox: sanitized diagnostics preserved: /private/tmp/rhythm-shell-loop-sandbox-20260930-diag1.evidence.BFPBqo`, `Sandbox removed: /private/tmp/rhythm-shell-loop-sandbox-20260930-diag1`. Synthetic fixture and all pre-existing roots retained.

Both stress invocations used the following exact root-cwd command (first invocation stopped at its first harness error; second completed all20 pairs after the single diagnostic-helper correction):

```sh
env -i HOME=/private/tmp/rhythm-shell-loop-sandbox-20260930-diag1/home TMPDIR="$TMPDIR" PATH="/private/tmp/rhythm-shell-loop-sandbox-20260930-diag1/bin:/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-shell-loop-fixture-20260930-diag1 RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-shell-loop-fixture-20260930-diag1/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-shell-loop-fixture-20260930-diag1/opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-shell-loop-sandbox-20260930-diag1 /bin/zsh -f -c 'for sample in {1..20}; do for package in apps/opencode_fork/packages/opencode /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/temp-cleanup-base-20260930-repair1/apps/opencode_fork/packages/opencode; do print -r -- "DIAGNOSTIC_SAMPLE=$sample PACKAGE=$package"; node tools/dev/test-temp-directory-cleanup.mjs -- bun --cwd "$package" test test/session/prompt.test.ts -t "shell completion resumes queued loop callers"; result=$?; print -r -- "DIAGNOSTIC_EXIT=$result"; if (( result != 0 )); then exit $result; fi; done; done'
```

TMPDIR was `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T`; Bun1.3.14. Exact-base comparison archive provenance remains its `.comparison-context` (exact4f915540, synthetic/no operator data). Identical temporary instrumentation was applied to branch and archive via apply_patch, then removed from both. Existing ignored dependency links reused, no installs.

### Temporary observation and retained harness error

Only the exact queued-loop test changed temporarily. A test-local spy delegated Runner.make to the original factory and every shell/ensureRunning call to the actual Runner; it recorded the actual state getter, work starts/exits and Fiber exits, not fabricated queue behavior or results. `llm.textMatch` recorded real request entry at the existing HTTP stub boundary. Full Exit values retained assistant info.error/finish and text parts; unchanged six assertions, original sleeps and shell command preserved. No gating, added sleeps/retries or production code edits.

First branch probe:0pass/1fail/56filtered/2assertions,962.98ms, child/wrapper exit1; shell Success, both queued Fibers Failure/Die, calls0/pending1. This is NOT the original Success-assistant/calls0 symptom. The diagnostic hook used nonexistent `Effect.tapErrorCause` in installed Effect4 beta65 (declaration lookup showed `tapCause`, not `tapErrorCause`); composing that nonexistent operator failed before ensureRunning ran. The hook was removed from both trees, the one diagnostic-helper repair. Original failing probe retained here and in tool receipt; it is excluded from the compatibility sample, not erased or called a flaky product failure.

### Every valid stress outcome

Full40-run trace/count/exit receipts: `/Users/ajhochhalter/.local/share/opencode/tool-output/tool_0f57d3ed0001VeQ7ssVntnC0t2`,600lines; each pair occupies30lines, branch first. Each invocation:1pass/0fail/56filtered/6assertions, wrapper exit0. Counts every time:12786 rhythm-vitest /246 opencode-test /10 opencode-test-data → unchanged. No fresh +1 in these focused samples; the prior equal base/branch full-session background +1 receipts above remain untouched and are not relabeled PASS.

| Pair | Branch test ms / outcome | Exact-base test ms / outcome |
| --- | --- | --- |
| 1 |1052.83 /PASS|1004.03 /PASS|
| 2 |997.63 /PASS|1047.11 /PASS|
| 3 |1013.32 /PASS|1018.33 /PASS|
| 4 |1071.60 /PASS|1018.62 /PASS|
| 5 |1089.67 /PASS|1015.36 /PASS|
| 6 |1025.50 /PASS|1089.37 /PASS|
| 7 |1371.47 /PASS|1325.35 /PASS|
| 8 |1143.79 /PASS|1024.34 /PASS|
| 9 |1013.99 /PASS|1037.20 /PASS|
| 10 |1046.21 /PASS|1008.06 /PASS|
| 11 |1000.20 /PASS|1067.46 /PASS|
| 12 |1021.79 /PASS|1016.32 /PASS|
| 13 |1027.78 /PASS|1015.01 /PASS|
| 14 |1011.02 /PASS|990.87 /PASS|
| 15 |1002.80 /PASS|1012.88 /PASS|
| 16 |1103.39 /PASS|1017.37 /PASS|
| 17 |1013.38 /PASS|1022.59 /PASS|
| 18 |1030.35 /PASS|1029.79 /PASS|
| 19 |1022.64 /PASS|1030.00 /PASS|
| 20 |1061.16 /PASS|1027.58 /PASS|

Observed successful sequence: before-loop Shell; first ensureRunning enters Shell, second ShellThenRun; after existing sleep ShellThenRun/calls0; successful shell work exits; shell Fiber Success with state Running; pending loop work starts, HTTP LLM stub enters once; successful loop result finish `stop`, text `done`, no assistant error; both callers resolve identical assistant, runner Idle/calls1/pending0. These successful traces do not prove what happened in the original full-suite failure. Instrumentation can perturb scheduling; isolated tests do not reproduce cross-test conditions.0/20 failures per tree is descriptive only (under independent identical Bernoulli trials, one-sided95% upper bound≈13.9% per tree; those assumptions are not established here).

### Removal / final diff / handoff

All instrumentation removed using apply_patch. `git diff --exit-code -- apps/opencode_fork/packages/opencode/test/session/prompt.test.ts` exit0; `git rev-parse HEAD:apps/opencode_fork/packages/opencode/test/session/prompt.test.ts` and `git hash-object` for both restored test files all returned `1d4af371507a67b49b4080b288182b8965e12ca1`. Thus both tests are byte-identical to exact HEAD/base, no permanent logs/assertion changes. No durable symbol edit and no production fix proposed.

Final `git diff --check` exit0. Tracked name-only/numstat unchanged from entry:

```text
1  0  apps/api_server/vitest.config.ts
4  2  apps/api_server/vitest.setup.ts
45 0  apps/opencode_fork/packages/opencode/test/fixture/fixture.test.ts
40 32 apps/opencode_fork/packages/opencode/test/fixture/fixture.ts
```

All ten existing untracked files also remain: API global setup; both contracts; generated background-temp issue; all three run notes; count wrapper and its two tests. This attempt's durable delta is only additions to `fork-shell-queued-loop.json` and this run note (both previously untracked). Existing cleanup implementation and failure receipts unchanged. No commit/push/PR/merge/worktree/branch/leftover deletion or peers.

Phase0 complete (diagnostic criterion + explicit waiver recorded before observation); Phase1 complete (LOW file impact); Phase2 diagnostic pass complete, implementation deliberately not performed. **BLOCKED**: original failure not reproduced; neither missing synchronization nor a production root cause established. No deterministic test-only fix, so focused-after-fix/full-after-fix/typecheck gates are not applicable; no READY_FOR_VERIFICATION or compatibility clearance. Further diagnosis needs the original assistant error/result receipt or separately authorized full-suite instrumentation, not a speculative synchronization patch.

## Explicit verification exception — 2026-09-30 (current compatibility outcome)

**WAIVED:** AJ answered **“Yes”** to **“explicitly accept this isolated failure as a documented verification exception, have the verifier assess that exception, and proceed with the cleanup draft PR.”** Approval was informed: cause unknown, no session fix made. The exact accepted failure is original run3 `prompt.test.ts:1523`, `llm.calls` expected1/received0, branch407pass/1fail vs exact-base408pass. Historical FAIL and every rerun remain intact; diagnostic success does not prove a flaky diagnosis or resolve the root cause.

Verifier independently confirms branch/base/HEAD identity and both restored prompt hashes `1d4af371507a67b49b4080b288182b8965e12ca1`; queued-loop test/product source diff empty, instrumentation absent. Scope is only this assertion's risk acceptance for the original draft PR. API installed-dependency exception and base/branch background recreation are separate findings; neither is fixed or hidden by this waiver. No further code repair, merge, peer dispatch, PR action, or leftover/worktree/branch deletion authorized or performed.

The earlier BLOCKED_NEEDS_CONTEXT was the diagnostic outcome, not an active unresolved compatibility control after approval. Cleanup integrated verification remains BLOCKED only for separately missing fresh GitNexus/full-fork/remaining CI evidence, as detailed in `test-temp-directory-cleanup.json` and its active run outcome. Hub owns any further evidence/exception routing and the authorized original draft PR.

## Final local reconciliation — 2026-10-01

The immediately preceding integrated BLOCKED assessment is historical and superseded: hub supplied fresh exact-worktree GitNexus ALL (LOW,2 symbols,0 processes,4 tracked files; scoped body unchanged, index/dynamic-loading caveats retained) and owns proportional pre-draft classification. Fork CI requires typecheck/session plus SDK generation/artifact diff, not the entire fork suite. SDK and downstream server smoke/optimizer/disposable PG remain justified **not_tested / CIpending**, neither waived nor passed; see `.github/workflows/opencode_fork_ci.yml:26-43`, `.github/workflows/server_ci.yml:31-94` and cleanup contract.

Fresh identity and read-only diff/hash evidence confirms `fix/test-temp-directory-cleanup`, HEAD/base `4f915540f700bbb403728ef8e01e0b5e02baf94f`; restored prompt remains `1d4af371507a67b49b4080b288182b8965e12ca1`, with no production/session/SDK/manifest/lockfile/CI diff. Recorded behavioral evidence reused without new reruns. Original expected1/got0 FAIL, bounded green samples, diagnostic-harness error and unknown cause all preserved. **PASS-local for original draft only** with AJ's narrow assertion **WAIVED**; no all-tests-green/flaky/fixed claim. Human ownership/lifetime/exception review and platform CI remain before merge-readiness. Evidence-only four-artifact update; no product/test/Git/runtime changes, peers/model override, PR actions or retained-root deletion.
