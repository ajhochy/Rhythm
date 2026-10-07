---
date: 2026-09-30
repo: Rhythm
branch: fix/test-temp-directory-cleanup
pr: null
issues: []
status: PASS-local
tags: [run, Rhythm]
---

## Files

**Active outcome: PASS-local for original draft PR only (2026-10-01), under hub-owned proportional classification; downstream CI pending, not merge-ready.** Run3 remains historically FAIL, not relabeled green. Cleanup c1-c6 independently pass; the isolated fork assertion is explicitly WAIVED by informed AJ approval, cause unknown/no fix. Fresh manager graph evidence is supplied; unexecuted downstream CI is justified not_tested, not waived/passed. Final local assessment below supersedes the earlier BLOCKED assessment. All historical checkpoints, retrospective and deferred-note run3 controls describe their original outcomes. No third repair.

## Explicit approval — resume

Approval answer: “Approve narrow fix (Recommended).” The exact authorized scope is failure-before-return exact-path cleanup in fixture tmpdir; its 46 normal callers must retain lifetime semantics.

AJ has now given explicit informed approval for the CRITICAL shared-symbol edit: `apps/opencode_fork/packages/opencode/test/fixture/fixture.ts::tmpdir` may be changed ONLY to remove its exact newly-created directory when initialization throws before returning the disposable fixture, preserving existing successful initialization and normal disposal lifetime.

Verified assigned top-level, branch `fix/test-temp-directory-cleanup`, HEAD/base `4f915540f700bbb403728ef8e01e0b5e02baf94f` before mutation. No concurrent owner per dispatch. API setup file impact LOW: zero graph dependents/processes; initial name lookup failed, exact File UID succeeded. Dynamic Vitest loading is outside graph coverage. Fork impact approval is unchanged, not expanded.

- `docs/ai/contracts/test-temp-directory-cleanup.json`: acceptance criteria recorded, all UNVERIFIED; no waiver, executable contract pending isolation repair.
- `docs/ai/runs/2026-09-30-test-temp-directory-cleanup.md`: this blocked handoff.
- No implementation, production, test assertion, or lifecycle-hook edits.

## Checks

- Invoked acceptance-contract skill first. Phase 0 **incomplete**: no failing acceptance test run; not waived.
- Read AGENTS.md, project-state, current-plan, testing-guide (including sandbox prerequisites), sandbox.sh startup/fixture validation section, and installed workflow-orchestrator instructions. No peer dispatched.
- Worktree: `/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/test-temp-directory-cleanup`.
- `git status --short --branch && git branch --show-current && git rev-parse HEAD origin/main && git worktree list`: supplied worktree initially clean on `opencode/test-temp-directory-cleanup`, HEAD `c1b7e023fbd85774fe447078cfe410f228dee539`, same HEAD as parent consolidation checkout; origin/main `4f915540f700bbb403728ef8e01e0b5e02baf94f`.
- `git fetch origin main && git rev-parse origin/main && git status --short --branch`: fetch successful; fresh origin/main unchanged at `4f915540f700bbb403728ef8e01e0b5e02baf94f`.
- `git switch -c fix/test-temp-directory-cleanup origin/main && git rev-parse HEAD && git status --short --branch && printenv RHYTHM_APPROVED_FIXTURE_ROOT RHYTHM_LIVE_DB_PATH RHYTHM_SANDBOX_OPENCODE_CONFIG RHYTHM_SANDBOX_DIR`: entire tool call refused by session policy (`git switch*` denied); command did not execute. No workaround attempted.
- Parent `git status --short --branch && git rev-parse HEAD`: clean `mega/2026-09-29-consolidation...origin/mega/2026-09-29-consolidation`, HEAD unchanged `c1b7e023fbd85774fe447078cfe410f228dee539`.
- Separate `printenv RHYTHM_APPROVED_FIXTURE_ROOT RHYTHM_LIVE_DB_PATH RHYTHM_SANDBOX_OPENCODE_CONFIG RHYTHM_SANDBOX_DIR`: no output, exit 1. Fixture settings not supplied. Historical run notes mention synthetic fixtures, but no current fixture was validated and no live DB/config was accessed.
- Entire-repo specialized content search `mkdtemp|mkdtempSync|os\.tmpdir\(|tmpdir\(|rhythm-vitest|opencode-test`, include `*`: 1094 matches, output truncated at 100. Fork included. Initial other discoveries: parity-matrix fixture roots, Flutter parity reference roots, React19 matrix root, web native-candidate/account fixture roots, fork zed-extensions directory; lifecycle coverage **not yet reviewed**, do not infer leaks from these matches.
- GitNexus impact: not run; no existing symbols edited. Phase 1 not started.
- Contract/check command: pending, null in contract; affected suites not run; before/after counts not collected.
- Sandbox: not started, no owned runtime to tear down; no manual server launch or live-port operations.

## Notes / handoff

**BLOCKED** at required branch isolation gate. Hub must prepare this slice on `fix/test-temp-directory-cleanup` based solely on fresh `origin/main` (recorded SHA above), then resume implementation. Do not include consolidation commits in this PR. The currently supplied worktree is unsafe as a PR base.

Sandbox fixture prerequisites remain **NEEDS_CONTEXT** until an approved existing synthetic read-only DB/config is validated and provided; do not create an unsafe fallback or access live app DB/config. API4098/engine4097 required throughout owned sandbox lifecycle.

Resume Phase 0: finish full inventory and lifecycle review, add real passing/failing test-run filesystem acceptance check with per-prefix TMPDIR counts and unowned sentinel preservation, start owned sandbox with approved fixture, record actual failing assertion before implementation. Then impact-analyze each edited shared symbol; HIGH/CRITICAL requires matching informed AJ approval via hub. No implementation has occurred.

Manual verification targets: c1 full inventory and lifecycle coverage report; c5 actual affected suite outputs and per-prefix counts; c6 test-infrastructure-only diff. Independent verifier required before hub-owned commit/push/draft PR. No commit/push/PR/merge/deploy/branch or worktree deletion performed.

Classification: test-infrastructure-only requested; production_behavior_change=false; backend_location=true; feature_live_backend_test_required=false (AJ's explicit test-only classification); real_test_run_filesystem_evidence_required=true; independent_verification_required=true; ready_for_verification=false.

## Resume dispatch — risk gate (2026-09-30)

**BLOCKED: CRITICAL shared-symbol impact requires AJ's explicit informed approval recorded by the manager for the exact symbol and scope below.** The earlier branch blocker is resolved. General authorization to edit fork test infrastructure is not informed approval of this newly measured CRITICAL blast radius.

### Checks / commands

- Invoked `acceptance-contract` first again; inspected and continued these two existing artifacts rather than recreating them. Phase 0 remains incomplete: no executable failing contract, no waiver, no implementation.
- In the assigned worktree, `pwd && git rev-parse --show-toplevel && git branch --show-current && git rev-parse HEAD && git status --short` confirmed the supplied path, branch `fix/test-temp-directory-cleanup`, exact HEAD `4f915540f700bbb403728ef8e01e0b5e02baf94f`, and only these two untracked artifacts. No command targeted the parent consolidation worktree.
- Read worktree AGENTS.md, project-state.md, current-plan.md, testing-guide.md, API setup/config, Bun preload/bunfig, fixture helper, fork test AGENTS.md, and ripgrep test lifecycle.
- Full-worktree literal search `rhythm-vitest|opencode-test` (`include: *`) returned 19 matches without truncation. Creation sites: API setup line29; Bun preload line10; fixture helper lines78/118; ripgrep test line14. Other matches are docs, fake identifiers/URLs, filtering, and the effect test's `/tmp/opencode-test` constant, not named-prefix creation. Broad mkdtemp/tmpdir inventory remains incomplete; no assertion that all unrelated leaks were reviewed.
- `ls -ld node_modules apps/api_server/node_modules apps/opencode_fork/node_modules tools/dev` found all three dependency directories absent; no install or symlink mutation attempted.
- `printenv TMPDIR RHYTHM_APPROVED_FIXTURE_ROOT RHYTHM_LIVE_DB_PATH RHYTHM_SANDBOX_OPENCODE_CONFIG RHYTHM_SANDBOX_DIR` printed only `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/`. All four fixture variables remain unset. Safe repo discovery found `tools/dev/sandbox_fixture.mjs` (generator, not an existing approved fixture) and `tools/dev/av06_native_fixture.mjs`. No live data/config inspected; no fixture generated.
- `gitnexus_list_repos` found indexed repo `Rhythm`, indexed commit `b846fdccf107d55fdef2b9208024f8cf6486e6d5`, not this exact worktree HEAD; reported counts are graph evidence with freshness/coverage limits.
- `gitnexus_impact(target: tmpdir, file_path: apps/opencode_fork/packages/opencode/test/fixture/fixture.ts, direction: upstream, includeTests: true, relationTypes: [CALLS, IMPORTS], maxDepth: 3, summaryOnly: true, repo: Rhythm)` returned **CRITICAL**, 46 direct dependents, 111 total symbols: depth1=46, depth2=40, depth3=25; 5 modules (Fixture, Server, Tui, Session, Config); zero indexed affected processes. Zero processes is not proof of no runtime test flows.
- Repeated with exact UID `Function:apps/opencode_fork/packages/opencode/test/fixture/fixture.ts:tmpdir`, maxDepth1, limit100 to disclose all 46 direct graph entries (below). No attempt to bypass the critical risk with confidence filtering or different helper edits.

### Approval scope / lifecycle findings

- Repo: `Rhythm`; branch: `fix/test-temp-directory-cleanup`; symbol: exported async `tmpdir`; file: `apps/opencode_fork/packages/opencode/test/fixture/fixture.ts`.
- Intended scope requiring informed approval: make directory allocation exclusively owned by this invocation and clean the allocated exact path if git/config/realpath/custom init fails before the async-disposable result is returned; preserve normal `await using` lifetime and custom disposal behavior. Shared lifecycle fallback, if needed after caller inventory, is expanded scope and requires renewed analysis/approval. No edits made to this symbol.
- Existing `tmpdir` already removes directories in `Symbol.asyncDispose` finally; its pre-return initialization currently has no failure cleanup. `tmpdirScoped` already installs an Effect finalizer before git/config setup. Ripgrep uses `Effect.acquireRelease` and already removes its directory on scope exit. Do not add redundant cleanup to these working scopes without evidence.
- API setup creates a unique `rhythm-vitest-*` root but has no teardown in that file. Bun preload already has `afterAll`, DB close, GC and EBUSY retry; its deterministic PID path plus recursive mkdir can reuse leftovers, so do not treat it as an exclusively newly owned directory. Ownership-safe allocation may need a separate file-level impact check/approval on resume. No implementation scope is silently expanded here.
- Remaining unrelated leaks: not established; broad inventory from previous attempt was truncated. Do not classify unreviewed temp creation as a leak.

### All direct graph dependents

Paths below are relative to `apps/opencode_fork/packages/opencode/test/`. Graph lists file-level dependents as well as named functions, not necessarily 46 distinct runtime calls. Confidence is 0.85 except the tmpdirScoped edge (0.63, potentially fuzzy).

- Functions: `git/git.test.ts:scopedTmpdir`; `cli/tui/plugin-loader.test.ts:load`; `cli/tui/thread.test.ts:check`; `config/config.test.ts:check`; `control-plane/workspace.test.ts:withInstance`; `fixture/fixture.ts:tmpdirScoped`; `server/httpapi-config.test.ts:tmpdirEffect`; `server/httpapi-query-schema-drift.test.ts:withTmp`.
- Files: `util/which.test.ts`, `util/process.test.ts`, `util/module.test.ts`, `util/glob.test.ts`, `util/filesystem.test.ts`, `plugin/meta.test.ts`, `plugin/install.test.ts`, `plugin/install-concurrency.test.ts`, `lsp/launch.test.ts`, `fixture/fixture.test.ts`, `skill/skill.test.ts`, `session/llm.test.ts`, `server/sdk-v1-smoke.test.ts`, `server/sdk-error-shape.test.ts`, `server/httpapi-raw-route-auth.test.ts`, `server/httpapi-pty.test.ts`, `server/httpapi-listen.test.ts`, `server/httpapi-file.test.ts`, `server/httpapi-event.test.ts`, `server/httpapi-event-dual-bus.test.ts`, `server/httpapi-compression.test.ts`, `provider/provider.test.ts`, `provider/amazon-bedrock.test.ts`, `lsp/client.test.ts`, `control-plane/workspace.test.ts`, `config/config.test.ts`, `acp/event-subscription.test.ts`, `cli/tui/plugin-toggle.test.ts`, `cli/tui/plugin-loader.test.ts`, `cli/tui/plugin-loader-pure.test.ts`, `cli/tui/plugin-loader-entrypoint.test.ts`, `cli/tui/plugin-lifecycle.test.ts`, `cli/tui/plugin-install.test.ts`, `cli/tui/plugin-add.test.ts`, `cli/tui/editor-context.test.tsx`, `cli/tui/editor-context-zed.test.ts`, `cli/cmd/tui/sync.test.tsx`, `cli/cmd/tui/sync-undefined-messages.test.tsx`.

### Handoff / flags

- Contract command: still null/pending. No tests run, no before/after counts measured, no false PASS or sandbox-policy blocker attributed to non-server tests. Immediate blocker is mandatory informed risk approval; missing dependencies/fixtures are separate unresolved prerequisites.
- Sandbox never started; no owned runtime to down. No API/engine started manually, no ports/signals used, no existing leftovers deleted.
- Changed files: only the two existing untracked contract/run artifacts. Production/test implementation files unchanged. No commit, push, PR, merge, deployment, peer dispatch, or branch/worktree cleanup.
- Resume requires manager handoff recording AJ's explicit informed approval for the exact `tmpdir` scope above, then finish Phase0 with a real failing filesystem contract before any implementation. Preserve working existing disposal semantics; complete other impact checks before their edits.
- `production_behavior_change=false`; `test_infrastructure_only=true`; `feature_live_backend_test_required=false`; `real_test_run_filesystem_evidence_required=true`; `phase0_complete=false`; `implementation_started=false`; `independent_verification_required=true`; `ready_for_verification=false`.

## Approved implementation / final handoff (supersedes blocked checkpoints above)

### Phase 0 — contract and RED evidence

- Acceptance criteria unchanged; six IDs retained. Two fork behavioral tests and one standalone real API setup filesystem contract/count runner added **before implementation**. No system-under-test mocks. Runner executes the complete actual setup source in Node child processes; it does not launch a server or replace its filesystem/lifecycle logic.
- `node tools/dev/test-temp-directory-cleanup.mjs` initial harness run exposed `/var` vs `/private/var` canonicalization mismatch. Finally's no-growth assertion reported `rhythm-vitest-: 12631 -> 12632`; fork counts `156/6 -> 156/6`. This harness bug left one newly-created child root without capturing its exact path in tool output. It was **not** swept/deleted; count baselines below include it. Harness repaired once by canonicalizing parent comparison inside exact-owned-path `finally`.
- Same command after harness repair, **before implementation**, exited1 with actual failing assertion `worker exit 0 leaked .../rhythm-vitest-aLGsBn`, `true !== false`. Contract finally removed only its captured root and own sentinel. Counts `12632/156/6 -> 12632/156/6`.
- From fork package: `bun test test/fixture/fixture.test.ts` exited1 before assertions: `preload not found "@opentui/solid/preload"`. Fork RED is **not established**, and fork tests remain UNVERIFIED. No waiver. Phase0 contract artifact complete; confirmed behavioral RED gate only for API. Proceeded with implementation/static validation under dispatch's explicit missing-dependency exception, not a claim that every Phase0 test ran.

### Phase 1 — bounded impact / scope

- Approval quoted verbatim above and in contract. Previously measured tmpdir CRITICAL (46 direct dependents,111 total,5 modules,no indexed processes) unchanged; no scope expansion or normal-lifetime change.
- API setup exact file UID impact LOW (0 direct,0 affected processes). Name lookup first returned target not found; exact UID lookup succeeded. Dynamic setupFiles loading means graph counts understate actual suite reach. No additional shared function edited.
- Entire tracked-repo inventory: `git grep -l -E 'mkdtemp|mkdtempSync|os\.tmpdir\(|tmpdir\(|rhythm-vitest|opencode-test' && git grep -n -E 'mkdtemp|mkdtempSync|os\.tmpdir\('`. Full output captured by tool at `/Users/ajhochhalter/.local/share/opencode/tool-output/tool_0f4c25054001XnewR671hUxBni`; display truncated, search covered all tracked paths including fork. Prior whole-worktree specialized literal search reviewed named prefixes; added untracked runner reviewed directly. Unrelated-prefix creation is not evidence of leaks and was not modified.
- Named-prefix roots: API setup lacked any teardown; fork tmpdir already had async disposal but lacked pre-return cleanup; tmpdirScoped already registers finalizer before git/config; ripgrep uses acquireRelease before init; preload already closes Database and removes its PID root with EBUSY retries. The latter three were not changed. Preload's nonexclusive PID allocation remains a known existing ownership caveat, not authorization to expand the fix.

### Phase 2 — implementation / checks

- API setup adds one exact-root `process.once('exit')` sync remover, keeping it through tests and teardown hooks, including failed test workers. Live-E2E guard untouched. Actual Vitest execution still requires confirmation; a process killed without exit handlers cannot be cleaned by this hook.
- Fork tmpdir wraps only initialization-before-return, using mkdir's returned newly-created path to guard cleanup. If the random path already existed (`created` undefined), failure cleanup does not delete it. Original successful return and async-disposal body unchanged, merely indented. Stops git fsmonitor on owned failed initialization, retries exact rm with existing helper, rethrows original initialization error. Cleanup errors ignored consistently with existing disposal; OS refusal can still leave a path.
- `node tools/dev/test-temp-directory-cleanup.mjs && node --check tools/dev/test-temp-directory-cleanup.mjs && git diff --check && git diff --numstat`: exit0. **Two child outcomes** (exit0/exit1) pass active filesystem lifetime + post-exit removal + sentinel preservation. Actual TMPDIR `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T`; counts `rhythm-vitest-12632 ->12632`, `opencode-test-156 ->156`, `opencode-test-data-6 ->6`. These are pre-existing baselines, not deleted leftovers. Prefix counts overlap (`opencode-test-` includes data); concurrent external runs can skew them.
- From API package: `node ../../tools/dev/test-temp-directory-cleanup.mjs -- npm test -- src/__tests__/c6_feature_flags.test.ts`: exit127, `vitest: command not found`; **zero Vitest tests executed**. Counts `12632/156/6 ->12632/156/6`.
- From fork package: `node ../../../../tools/dev/test-temp-directory-cleanup.mjs -- bun test test/fixture/fixture.test.ts test/file/ripgrep.test.ts`: exit1, missing preload; **zero Bun tests executed**. Counts `12632/156/6 ->12632/156/6`.
- Static syntax attempt `bun build test/fixture/fixture.ts test/fixture/fixture.test.ts --target=bun --external '*'` errored (multiple entries require outdir). Repaired command once: `bun build test/fixture/fixture.ts --target=bun --external '*' && bun build test/fixture/fixture.test.ts --target=bun --external '*'`: exit0, both transpiled to stdout, no output artifacts/dependency install. **Not typechecking or runtime proof.**
- Final `git diff --check` passed. `gitnexus_detect_changes(scope: all, worktree: assigned path, repo: Rhythm)` returned low,3 tracked files, tmpdir and tmpdirScoped touched,no processes. **tmpdirScoped is a hunk/line-shift attribution false positive:** exact reviewed diff modifies only tmpdir; tmpdirScoped source unchanged. Untracked runner/docs not covered by graph detection.
- `git diff --check && git diff --numstat && git diff -- <three tracked files> && printenv TMPDIR RHYTHM_APPROVED_FIXTURE_ROOT RHYTHM_LIVE_DB_PATH RHYTHM_SANDBOX_OPENCODE_CONFIG RHYTHM_SANDBOX_DIR`: diff checks pass; printenv prints only TMPDIR. All four safe fixture vars still unset. Existing worktree root/API/fork dependencies absent per prior check and missing runners confirmed. No repo-defined available safe dependency tree used, installed, symlinked or borrowed.

### Files / exact tracked numstat

| Path | Added | Removed |
| --- | ---: | ---: |
| apps/api_server/vitest.setup.ts | 2 | 0 |
| apps/opencode_fork/packages/opencode/test/fixture/fixture.test.ts | 44 | 0 |
| apps/opencode_fork/packages/opencode/test/fixture/fixture.ts | 40 | 32 |

Additional untracked files: `tools/dev/test-temp-directory-cleanup.mjs`, existing contract JSON, existing run note (continued in place). Exact diffs are available via `git diff` for tracked files and `git diff --no-index /dev/null <path>` for untracked files; no staging/commit performed.

### Verification handoff / flags

**READY_FOR_VERIFICATION, not PASS or done.** Independent verifier must provision an authorized safe dependency/test environment, run actual Vitest setup across affected suites and fork fixture/ripgrep plus normal caller surfaces, establish fork failing-baseline evidence if required, and rerun the maintained count wrapper around them. Manual targets c1 inventory review,c2/c3 missing fork and real Vitest lifecycle proof,c5 affected suite results,c6 test-only diff. Required sandbox fixture settings remain missing; no backend/live checks were attempted, no fixtures invented, no live app DB/config accessed. Sandbox never started; nothing owned to tear down. Do not launch API manually.

Flags: `production_behavior_change=false`; `test_infrastructure_only=true`; `feature_live_backend_test_required=false`; `real_test_run_filesystem_evidence_required=true`; `api_contract_red_then_green=true`; `fork_behavior_UNVERIFIED=true`; `phase0_all_tests_executed=false`; `static_validation_pass=true`; `sandbox_started=false`; `independent_verification_required=true`; `ready_for_verification=true`; `all_acceptance_pass=false`. No peers, commit, push, PR, merge, deploy, branch or worktree deletion. One contract-harness-created leftover remains; do not prefix-sweep it or existing leftovers.

Final commands: `git diff --no-index --numstat /dev/null <path>` measured runner58/0, contract64/0, run132/0 before this final paragraph (run now134/0); expected diff exit1. `node tools/dev/test-temp-directory-cleanup.mjs && git diff --check && git status --short && git rev-parse --show-toplevel && git branch --show-current && git rev-parse HEAD` exited0: contract PASS for both child outcomes, counts12632/156/6 unchanged, only the six intended files dirty/untracked, assigned top-level/branch/base unchanged. Final handoff numstat totals342 added/32 removed (including three untracked files).

## Independent verification — FAIL (supersedes readiness above)

Exact assigned worktree/root and branch confirmed: `fix/test-temp-directory-cleanup`, HEAD/base `4f915540f700bbb403728ef8e01e0b5e02baf94f`. Inspected complete tracked diff, all six changed/untracked files, and tracked numstats before running evidence. Only verifier changes are this run note and contract evidence/status; no implementation fixes, staging, commit, push, PR, merge, peer dispatch, live-service restart, or branch/worktree deletion.

### Environment and sandbox ownership

- Node `v22.23.0`, Vitest `4.1.1`, tsx `4.21.0`, Bun `1.3.14` (CI pin is `1.3.13`). Fresh `zsh -f` verified API tooling. Created ignored dependency symlinks for root/API/MCP/fork and fork opencode/script/core packages to existing parent dependencies; no install/rebuild/write through those links. Parent manifests/lockfiles and core/script source comparison showed no differences. Parent fork product code differs, so its built engine was not reused: sandbox built this worktree's fork.
- Synthetic generator: `node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-temp-cleanup-fixture-20260930-vg1`, exit0, `Synthetic read-only sources: ...`. No live data/config used.
- All sandbox calls used `RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-temp-cleanup-fixture-20260930-vg1`, `RHYTHM_LIVE_DB_PATH=$RHYTHM_APPROVED_FIXTURE_ROOT/rhythm.db`, `RHYTHM_SANDBOX_OPENCODE_CONFIG=$RHYTHM_APPROVED_FIXTURE_ROOT/opencode.json`, `RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-temp-cleanup-sandbox-20260930-vg1`, API4098/engine4097/gateway4099, SQLite/shadow, numbat disabled.
- `tools/dev/sandbox.sh up` exit0: fork build, API `tsc -p tsconfig.json`/postbuild and MCP `tsc -p tsconfig.json --noCheck` completed; `Sandbox ready: http://127.0.0.1:4098 (engine :4097)`. `status` proved API70336, engine70355, gateway70336. Initial transient refused connection preceded successful readiness, not a final health failure.
- Test shell: `env -i HOME=$RHYTHM_SANDBOX_DIR/home TMPDIR="$TMPDIR" PATH="$RHYTHM_SANDBOX_DIR/bin:/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" /bin/zsh -f -c '<command>'`. Preserved actual TMPDIR for acceptance, removed ambient live/test flags and server-port overrides. All suite/static commands ran while owned sandbox was up.
- Final `status` showed same listeners. `tools/dev/sandbox.sh down` exit0, sandbox absent and ports4098/4097/4099 released. Sanitized diagnostics retained at `/private/tmp/rhythm-temp-cleanup-sandbox-20260930-vg1.evidence.GFBhAr`. New fixture and ignored dependency links retained; never delete existing TMPDIR leftovers.

### Commands / actual results

Actual TMPDIR: `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T`. Count triples below are `rhythm-vitest-/opencode-test-/opencode-test-data-` (second includes third).

| Command (worktree root unless noted) | Result | Before -> after |
| --- | --- | --- |
| `node tools/dev/test-temp-directory-cleanup.mjs` | exit0; passing/failing Node setup children, active file and sentinel assertions | 12632/156/6 -> 12632/156/6 |
| `node tools/dev/test-temp-directory-cleanup.mjs -- npm --prefix apps/api_server test -- src/__tests__/c6_feature_flags.test.ts` | 4 tests pass; wrapper exit1, `rhythm-vitest- grew: 12632 -> 12633` | 12632/156/6 -> 12633/156/6 |
| identical API command, once for reproduction | 4 tests pass; wrapper exit1, `rhythm-vitest- grew: 12633 -> 12634` | 12633/156/6 -> 12634/156/6 |
| `node tools/dev/test-temp-directory-cleanup.mjs -- bun --cwd apps/opencode_fork/packages/opencode test test/fixture/fixture.test.ts test/file/ripgrep.test.ts` | exit0; 23 pass, 0 fail, 53 assertions | 12634/156/6 -> 12634/156/6 |
| `node tools/dev/test-temp-directory-cleanup.mjs -- bun --cwd apps/opencode_fork/packages/opencode test test/git/git.test.ts test/config/config.test.ts test/util/filesystem.test.ts test/util/process.test.ts test/util/glob.test.ts` | exit0; 180 pass, 0 fail, 264 assertions | 12634/156/6 -> 12634/156/6 |
| fork package: `bun run typecheck` | exit2; `test/fixture/fixture.test.ts(38,11): error TS2322`, dispose `Promise<void>` not assignable to initializer-inferred `Promise<string>` | no count wrapper (static) |
| fork package: `node ../../../../tools/dev/test-temp-directory-cleanup.mjs -- bun test test/session/ src/session/` | 408 pass, 5 skip, 1 todo, 0 assertion failures across29 files; wrapper exit1, `opencode-test- grew: 156 -> 157` | 12634/156/6 -> 12634/157/6 |
| `npm --prefix apps/api_server run lint` | exit0; only existing `TODO: add eslint` placeholder, not substantive lint | static |
| `node --check tools/dev/test-temp-directory-cleanup.mjs` and `git diff --check` | exit0 | static |
| `node tools/dev/test-temp-directory-cleanup.mjs -- node -e "process.exitCode=7"` | propagated exit7, asserted by shell `test "$failure_result" -eq 7` | 12634/156/6 -> 12634/156/6 (before session stage) |

Exact contract line4 was executed: plain child contract green, actual API count assertion red, so `&&` correctly short-circuited fork. Fork command then executed independently. An initial `bun --cwd <package> run typecheck` invocation printed help with exit0 and was explicitly rejected as evidence; reran exact `bun run typecheck` from fork package and captured real exit2 above.

### Consolidated diagnosis / boundaries

- **Test-lifecycle defect:** API `process.once('exit')` is not valid for this default Vitest teardown. Installed Vitest4.1.1 resolves default pool to `forks` (`coverage.CJ2HXVIG.js:170`); `ForksPoolWorker.stop` sends `fork.kill()` (SIGTERM), escalates after500ms (`cli-api.BUXBO6jS.js:3087-3102`). SIGTERM has no normal exit-handler guarantee. Its worker adds SIGTERM-to-processExit only for profiling flags (`init-forks.B4YYSIj4.js:11`), absent in canonical test command. Reproduced +1 root per passing invocation. Missing CLI/dependency/SQLite build problems are ruled out; four assertions execute successfully.
- **New test static defect:** added consumer-failure test infers fixture generic `string` from `init`, but supplied `dispose` returns `void`; existing `TmpDirOptions<T>` requires `Promise<T>` for both. This is the changed test, not an environment failure. Coding owner must fix within scope; verifier made no source change.
- **Additional no-growth failure, attribution UNKNOWN:** exact fork CI session command leaves one matching root despite green assertions. Not called pre-existing: identical merge-base command was not run. Current-run root not captured, so not swept. Full maintained suites/remaining CI stages were not completed after established required failures; no full-suite or PR-readiness claim.
- Sync `fs.rmSync` recursive/force/maxRetries/retryDelay options run successfully on this macOS/Node22 in both plain child exit outcomes. Failure is lifecycle invocation, not unsupported rm options. Real failed Vitest-worker teardown was not separately proven; successful default teardown already fails. SIGKILL cleanup is not claimed.
- Fork init-throw test directly asserts exact owned root removal/original error and sentinel preservation. Consumer-failure test asserts readable active content in consumer and disposal, unchanged extra value, then absent root. 180 normal caller tests cover git/config/filesystem/glob/process with no growth. Preload existing PID reuse caveat unchanged; prefix overlap is explicitly reported and does not invalidate no-growth detection.
- Wrapper reports growth even when suites are green and preserves nonzero child status; does not scan-delete anything. Counts observed after a later independent read remained12634/157/6. Original12632/156/6 leftovers, prior unidentified harness leftover, and three newly observed leaks remain untouched.
- Reran full tracked inventory `git grep -l -E 'mkdtemp|mkdtempSync|os\.tmpdir\(|tmpdir\(|rhythm-vitest|opencode-test'` and named-prefix exact lookup. Reviewed API setup, fork tmpdir/tmpdirScoped, ripgrep acquireRelease, preload afterAll, added tests and runner. No production source/config changes. Docs conditional reference reviewed; contract command and referenced test paths exist.
- Required `gitnexus_detect_changes(scope: all, worktree: exact assigned path, repo: Rhythm)` cannot be invoked: no GitNexus MCP tool exposed in this verifier session. No CLI substituted, no peers dispatched. Prior stale-index LOW/tmpdirScoped line-shift attribution is UNKNOWN, not independent approval.

### Final acceptance / ownership

Contract reconciled: c1 PASS (manual inventory), c2 FAIL (actual lifecycle/no-growth), c3 PASS (exact removal/sentinel/lifetime assertions plus diff), c4 PASS (real count check detects regressions and propagates failure), c5 PASS (actual affected executions recorded, not suite-success claim), c6 PASS (test-only scope). `not_tested=[]`; no unresolved UNVERIFIED criterion. Separate verification limits explicitly name missing GitNexus, full-suite/remaining CI evidence, failing Vitest worker and session leak attribution. Automated gate FAIL; **draft PR gate NOT clear**. Human manual smoke cannot waive these automated failures.

Tracked changes unchanged: API setup2/0; fork fixture tests44/0; fork helper40/32. Untracked owned files: runner58 lines, contract and this run note. Last pre-evidence-edit `git status --short` showed exactly these six intended files, branch/SHA unchanged. Ignored dependency links/build outputs are local verification environment only. No remediation applied to implementation.

## Focused repair attempt 1 of 2 — re-run verification-gate

### Ownership / diagnosis before edits

- Using failure-triage; no peer dispatch. Verified cwd via command workdir and `git rev-parse --show-toplevel`, branch `fix/test-temp-directory-cleanup`, `HEAD=origin/main=4f915540f700bbb403728ef8e01e0b5e02baf94f`, intended pending diff before mutation. No concurrent owner per AJ. Existing worktree retained; no commit/stage/push/PR/merge or branch/worktree deletion.
- Read this note and contract in full. Compared changed setup/test/helper with exact origin/main/base. API missing teardown is pre-existing; ineffective exit hook is the failed attempted repair. Actual default Vitest forks SIGTERM bypasses exit hook; reproduced 4 assertions passing with wrapper RED `12634/157/6 ->12635/157/6` before editing. New root left untouched.
- Fork `bun run typecheck` reproduced exact TS2322 at added line38. New test infers `T=string` from init; its disposer returned void contrary to the existing signature. Fixed only disposer return; no helper/production type changes.
- GitNexus exact file impacts for setup and fixture.test: LOW,0 direct,0 processes,0 modules. Dynamic Vitest setup reach absent from graph. Existing CRITICAL tmpdir approval is NOT expanded; helper implementation from the previous attempt unchanged in this repair.
- Native Vitest setup executes before each test-file collection (installed runner chunk-artifact.js:2437-2440). Each execution allocates one root, not one process-lifetime root. File-level setup afterAll closes over that root. Default stack ordering runs later-registered test-file afterAll first; nested suites finish before file afterAll. Actual contract below proves passing/failing-assertion teardown lifetime. Removed dead exit hook entirely; no signal handler or prefix sweep.

### Fresh synthetic sandbox / exact test environment

- `node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-temp-cleanup-fixture-20260930-repair1` exit0. New synthetic read-only DB/config only; no live data/config. Reused verifier's safe ignored dependency links without installing through them.
- Every `tools/dev/sandbox.sh up/status/down` used the same four variables: `RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-temp-cleanup-fixture-20260930-repair1`, `RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-temp-cleanup-fixture-20260930-repair1/rhythm.db`, `RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-temp-cleanup-fixture-20260930-repair1/opencode.json`, `RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-temp-cleanup-sandbox-20260930-repair1`; `DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow RHYTHM_NUMBAT_ENABLED=false`, default API4098/engine4097/gateway4099.
- `up` exit0 built API/MCP, sandbox ready. `status` listeners API76649/engine76667/gateway76649; final status same. `down` exit0 removed only owned sandbox and preserved sanitized diagnostics `/private/tmp/rhythm-temp-cleanup-sandbox-20260930-repair1.evidence.R505eZ`. Fixture and base comparison archive retained. No manual API/server launch or live-port signaling.
- ALL tests/typecheck below ran while sandbox up using `env -i HOME=/private/tmp/rhythm-temp-cleanup-sandbox-20260930-repair1/home TMPDIR="$TMPDIR" PATH="/private/tmp/rhythm-temp-cleanup-sandbox-20260930-repair1/bin:/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" /bin/zsh -f -c '<command>'`. Runtime Node22.23.0/Vitest4.1.1/Bun1.3.14 unchanged. Actual TMPDIR `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T`. No tests after down.

### Repair / actual RED-GREEN commands

Root unless explicitly marked package. Count triples rhythm-vitest/opencode-test/opencode-test-data; second includes third. Wrapper still rejects ANY growth and preserves child status; new path reporting is read-only and never deletes observed additions.

| Command | Result | Before -> after |
| --- | --- | --- |
| `node tools/dev/test-temp-directory-cleanup.mjs -- npm --prefix apps/api_server test -- src/__tests__/c6_feature_flags.test.ts` before repair |4 pass; wrapper RED exit1 |12634/157/6 ->12635/157/6 |
| fork package `bun run typecheck` before repair |RED exit2 TS2322 added disposer |static |
| `node tools/dev/test-temp-directory-cleanup.mjs` after repair |GREEN exit0; actual native Vitest1 pass then intentional1 failed assertion/exit1; both test-file teardown-active markers, exact-root absence, unowned sentinel preserved |12635/157/6 ->same |
| `node tools/dev/test-temp-directory-cleanup.mjs -- npm --prefix apps/api_server test -- src/__tests__/c6_feature_flags.test.ts` |GREEN4 pass, wrapper exit0 |12635/157/6 ->same |
| `node tools/dev/test-temp-directory-cleanup.mjs -- bun --cwd apps/opencode_fork/packages/opencode test test/fixture/fixture.test.ts test/file/ripgrep.test.ts` |GREEN23 pass/53 assertions |12635/157/6 ->same |
| fork package `bun run typecheck` after repair |GREEN exit0 `tsgo --noEmit` |static |
| `node tools/dev/test-temp-directory-cleanup.mjs -- bun --cwd apps/opencode_fork/packages/opencode test test/git/git.test.ts test/config/config.test.ts test/util/filesystem.test.ts test/util/process.test.ts test/util/glob.test.ts` |180 pass/264 assertions; count wrapper RED |12635/157/6 ->12635/159/6 |
| `node tools/dev/test-temp-directory-cleanup.mjs -- bun --cwd <base-package> test test/session/ src/session/` |408 pass/5 skip/1 todo/1154 assertions; wrapper RED exit1 |12635/159/6 ->12635/160/6 |
| `node tools/dev/test-temp-directory-cleanup.mjs -- bun --cwd apps/opencode_fork/packages/opencode test test/session/ src/session/` |identical408/5/1/1154; wrapper RED exit1 |12635/160/6 ->12635/161/6 |
| same representative command above, `<base-package>` substituted |180 pass/264 assertions; wrapper RED |12635/161/6 ->12635/173/7 |
| repaired representative command once more, capturing new paths |180 pass/264 assertions; wrapper RED |12635/173/7 ->12635/188/8 |
| `node tools/dev/test-temp-directory-cleanup.mjs -- npm --prefix apps/api_server test -- src/__tests__/c6_feature_flags.test.ts ../../tools/dev/test-temp-directory-cleanup.test.ts` |GREEN5 pass across2 files |12635/188/8 ->same |
| `node tools/dev/test-temp-directory-cleanup.mjs -- node -e "process.exitCode=7"` |exit7; shell asserted status exactly7 |12635/188/8 ->same |
| `node --check tools/dev/test-temp-directory-cleanup.mjs && git diff --check` |exit0 |static |

Contract's no-argument runner now drives REAL Vitest rather than concatenating setup into a plain Node child. Maintained regression file is normally passing; only its isolated child env enables the intentional assertion failure. It asserts active content during test-file teardown; the parent asserts absence after actual worker termination and sentinel preservation. No mock hooks, special pool/profiling flags or error-status hiding.

### Identical base attribution / deferred scope

- `<base-package>=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/temp-cleanup-base-20260930-repair1/apps/opencode_fork/packages/opencode`. Source is fresh isolated extraction using `git archive 4f915540f700bbb403728ef8e01e0b5e02baf94f apps/opencode_fork | tar -x -C <new-context>`; no second worktree or branch. Only safe existing fork/opencode/core/script dependency links added in archive, no install. Parent core/script source, manifests and bun.lock identical to base (`git diff base c1b7e023... -- <paths>` empty). Maintained worktree wrapper used for both base and branch, identical clean env/runtime, sequential commands.
- Base session exact new root `opencode-test-ciyew7oyg2i`; repaired root `opencode-test-jmzlr7c4m1s`. Both contain only `.opencode`; branch subtree has node_modules/package-lock/package.json. These roots were read only, not removed. Same +1 growth establishes pre-existing session leak, not a new initialization-throw regression.
- Representative growth also reproduces on base, but number varies; do NOT claim exact-count equivalence or no-growth PASS. Branch additions and base additions are reported by maintained wrapper; base data85477 and branch data85860 also remain. Background writes are likely: unchanged `src/config/config.ts:608-628` detaches npm installs with Effect.forkDetach, permitting recreation after fixture disposal. Exact representative writers not traced. This is normal-disposal/background-service scope, beyond existing CRITICAL approval. No production/helper lifecycle changes attempted.
- Local P2 follow-up: `docs/ai/generated-issues/2026-09-30-fork-background-temp-recreation.md`. Session pre-existing classification is resolved; broader normal-disposal cleanup deliberately deferred under AJ's instructions, not silently waived. No GitHub issue created.

### Handoff

**FIXED — re-run verification-gate.** API actual fork lifecycle and new fork static defect repaired. Contract retains last independent `verification_status=FAIL` and c2 FAIL; `repair_status` requests re-verification, not final independent PASS. c1/c3/c4/c5/c6 historical PASS retained. Broad count gate remains RED for documented pre-existing background lifecycle; manager/verifier must explicitly account for deferred scope rather than call every suite no-growth green.

No pre-existing leftovers, the three independent-verifier leaks, the repair RED leak, or any additional base/branch observed leaks deleted. No prefix deletion. SIGKILL/collection failures/throwing earlier teardown hooks/non-default hook ordering/full suites are not proven. Only minimum test-infrastructure changes; successful fork initialization and original normal disposal unchanged. Required detect_changes and final exact file/numstat review recorded below after docs validation.

### Final scope review

- `gitnexus_detect_changes(scope: all, worktree: assigned absolute path, repo: Rhythm)` returned LOW,3 tracked files,2 touched symbols,0 affected processes. tmpdirScoped is the existing line-shift attribution false positive: exact diff changes tmpdir only; tmpdirScoped unchanged. Untracked runner/test/docs excluded from graph; reviewed directly. Stale-index/dynamic-loading limits remain.
- `git diff --check` exit0; final root/branch/HEAD/origin/main unchanged. Exact name-only set (tracked plus untracked) and numstat: API setup3/0; fork fixture.test45/0; fork fixture.ts40/32; runner63/0; native regression18/0; contract81/0; deferred issue42/0; run note242/0. Eight intended files only. `git diff --no-index --numstat /dev/null <untracked>` exits1 normally and is not a validation failure.
- Initial repair counts12634/157/6; final observed12635/188/8. Reproduction and documented base/branch background leaks retained, not a no-growth summary. Sandbox down succeeded. Ready for independent re-verification of repair and manager decision on documented deferred pre-existing scope; no final PASS.

## Independent verification run2 — FAIL (supersedes repair readiness)

### Ownership / environment

- Skill verification-gate loaded first; no peers. `pwd && git rev-parse --show-toplevel && git branch --show-current && git rev-parse HEAD origin/main && git status --short && git diff --name-only && git diff --numstat && git diff --check && git diff` confirmed exact assigned worktree, branch `fix/test-temp-directory-cleanup`, HEAD/base `4f915540f700bbb403728ef8e01e0b5e02baf94f`. Nine intended pending files including separate retrospective; no production source/config changes. Reviewed all exact tracked diff and untracked files. CRITICAL tmpdir approval remains initialization-before-return exact-owned cleanup only; successful return/disposal and tmpdirScoped unchanged.
- `node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-temp-cleanup-fixture-20260930-vg2` exit0, new synthetic read-only sources, no live data/config. Same four variables on up/status/down: fixture root above, DB=`<root>/rhythm.db`, config=`<root>/opencode.json`, sandbox=`/private/tmp/rhythm-temp-cleanup-sandbox-20260930-vg2`. Explicit API4098/engine4097/gateway4099, SQLite/shadow, `RHYTHM_NUMBAT_MONITORING_DISABLED=1`.
- `tools/dev/sandbox.sh up && tools/dev/sandbox.sh status` exit0, API build/postbuild and MCP build completed; ready with API88079/engine88096/gateway88079. No manual API launch. Existing ignored dependency symlinks retained; no npm install/rebuild/write through shared trees. Node22.23.0/Vitest4.1.1/Bun1.3.14.
- Every test/static shell was `env -i HOME=/private/tmp/rhythm-temp-cleanup-sandbox-20260930-vg2/home TMPDIR="$TMPDIR" PATH=/private/tmp/rhythm-temp-cleanup-sandbox-20260930-vg2/bin:/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -f -c '<command>'`, while sandbox up. No live/test override inherited. Actual TMPDIR retained for required counts.

### Commands / captured results

Root unless explicitly marked package. `W` below expands exactly to `node tools/dev/test-temp-directory-cleanup.mjs --`; triples rhythm-vitest/opencode-test/opencode-test-data, second includes third.

| Command | Result | Before -> after |
| --- | --- | --- |
| `node tools/dev/test-temp-directory-cleanup.mjs` | exit0; actual1 passed worker then intentional1 failed assertion/exit1, both teardown-active markers; exact root absent and sentinel survives |12635/188/8 ->same |
| `W npm --prefix apps/api_server test -- src/__tests__/c6_feature_flags.test.ts` | exit0;4 pass |12635/188/8 ->same |
| `W bun --cwd apps/opencode_fork/packages/opencode test test/fixture/fixture.test.ts test/file/ripgrep.test.ts` | exit0;23 pass/53 assertions |12635/188/8 ->same |
| `W npm --prefix apps/api_server test -- src/__tests__/c6_feature_flags.test.ts ../../tools/dev/test-temp-directory-cleanup.test.ts` | exit0;5 pass/2 files |12635/188/8 ->same |
| fork package `bun run typecheck` | exit0;`tsgo --noEmit` |static |
| `W node -e "process.exitCode=7"` | exact exit7, shell `test "$child_result" -eq 7` exit0 |12635/188/8 ->same |
| `npm --prefix apps/api_server run lint` | exit0; placeholder `TODO: add eslint`, not substantive lint |static |
| `W bun --cwd apps/opencode_fork/packages/opencode test test/git/git.test.ts test/config/config.test.ts test/util/filesystem.test.ts test/util/process.test.ts test/util/glob.test.ts` |180 pass/264 assertions; wrapper exit1 |12635/188/8 ->12635/201/8 |
| `W npm --prefix apps/api_server test -- --no-file-parallelism` |6776 pass/1 fail/285 skipped; files721 pass/1 fail/148 skipped;561.16s; wrapper exit1 |12635/201/8 ->12783/201/8 |
| `W npm --prefix apps/api_server test -- src/__tests__/agent_server_memory_live.test.ts` |1 skipped; Vitest exit0, wrapper exit1 |12783/201/8 ->12784/201/8 |
| `W bun --cwd <base-package> test test/session/ src/session/` |408 pass/5 skip/1 todo/1154 assertions; wrapper exit1 |12784/201/8 ->12784/202/8 |
| `W bun --cwd apps/opencode_fork/packages/opencode test test/session/ src/session/` |same408/5/1/1154; wrapper exit1 |12784/202/8 ->12784/203/8 |
| `W npm --prefix apps/api_server test -- src/__tests__/c6_feature_flags.test.ts src/__tests__/agent_server_memory_live.test.ts` |4 pass/1 skipped; Vitest exit0, wrapper exit1 |12784/203/8 ->12785/203/8 |
| `npm --prefix apps/api_server run build` |exit0; tsc/postbuild |static |
| `npm --prefix apps/api_server test -- src/security/security_advisories.test.ts` |exit0;15 pass |not wrapped |
| representative command above substituting `<base-package>` |180 pass/264 assertions; wrapper exit1 |12785/203/8 ->12785/214/9 |
| `node --check tools/dev/test-temp-directory-cleanup.mjs` |exit0 |static |

Full API captured output: `/Users/ajhochhalter/.local/share/opencode/tool-output/tool_0f4e375be001qgCpG3mBBfQgm9`. Maintained contract command was reproduced in full, not short-circuited. Wrapper rejects growth and reports additions read-only; no sweeping. All accumulated leaks remain.

### Consolidated failures / deferred evidence

- **Required test-lifecycle gap:** full API count grows by148, matching148 all-skipped files. Smallest actual maintained skipped-file probe grows by1; mixed passing/skipped probe independently grows by1. Native per-file afterAll does not clean roots allocated for all-skipped files. Passing and intentional assertion-failure contract repairs ARE independently reproduced, but normal full test-run cleanup is incomplete. No source fix made; c2 remains FAIL, draft PR gate not clear. This is an unresolved intended API cleanup path, not the deferred fork background finding. Collection errors, forced kills and throwing/non-default teardown remain unclaimed.
- **Environment failure:** full API's only test assertion failure is `native_runtime_guard.test.ts:46`: installed better-sqlite3 is12.8.0, while unchanged API manifest requires13.0.3. Node22 loads SQLite safely, but test simulates24.21 and checks installed13.x. Updating shared symlink target would mutate another checkout/live dependencies; rebuilding12.x cannot satisfy the version assertion. No unsafe install/mutation attempted. A standalone dependency tree is needed; full API merge-base comparison was not run, so no pre-existing full-suite claim. This does not explain skipped-file cleanup growth, which reproduces with zero test failures.
- **Pre-existing fork finding confirmed, NOT blocker:** `<base-package>=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/temp-cleanup-base-20260930-repair1/apps/opencode_fork/packages/opencode`. `git rev-parse HEAD:<path>` and `git hash-object <archive-path>` independently match fixture helper (`fedbc246...`), config (`1fcb649e...`) and bun.lock (`5f07162b...`). Identical clean sequential session commands on base/branch both408 pass and+1 root; base `opencode-test-2y3iog9sfx8`, branch `opencode-test-gpi5xiav3ot`. Representative180 passes on both with variable growth(+13 branch,+11 base including1 data); no exact equivalence claim. Successful disposal unchanged; detached writers remain a hypothesis. Deferred local note explicitly says no GitHub issue created and no closure; suitable for PR's deferred/local follow-up list.
- **Missing scope evidence:** `gitnexus_detect_changes(scope: all, worktree: exact assigned path, repo: Rhythm)` unavailable because no GitNexus MCP tool is exposed. No CLI/agent substituted. Prior stale-index LOW with tmpdirScoped line-shift false positive is UNKNOWN, not independent scope clearance.
- Full fork/SDK-generation/remaining CI stages not completed after required API failure; SDK generation would modify repository source and is forbidden to this verifier. No blanket compatibility/PR-ready claim. Backend classifier is location-only; no feature live E2E required or run. Conditional reference: docs only.
- Broad tracked inventory and exact named-prefix search rerun; all five named allocation/lifecycle sites and untracked runner reviewed. Retrospective58 lines is separate historical evidence, accurate and not a production change. No architecture decision reversal or neighbor-doc change required.

### Status / teardown

- Contract reconciled c1/c3/c4/c5/c6 PASS, c2 FAIL; no waiver, `not_tested=[]`, overall FAIL. Narrow repaired checks green does not replace the full-suite count failure. Manual smoke cannot waive it; later human targets include abrupt/collection/throwing-hook limitations only if scope is expanded.
- Final `tools/dev/sandbox.sh status` same owned listeners; `curl --fail --silent http://127.0.0.1:4098/opencode/health` returned `status=ready`, bridgeLive=true. `tools/dev/sandbox.sh down` exit0, removed owned sandbox; sanitized diagnostics `/private/tmp/rhythm-temp-cleanup-sandbox-20260930-vg2.evidence.PIfWej`. Subsequent status refuses absent security shim with FileNotFoundError (expected removed runtime, not successful status proof). No tests after down.
- Only run-note/contract evidence updated by verifier. No product/test/runner edits, staging/commit/push/PR/merge, peer dispatch, live-service restart, existing/new leftover deletion, or branch/worktree deletion. Initial12635/188/8; last wrapper12785/214/9. Required gate FAIL; draft PR gate clear: **no**.

## Final focused repair attempt 2 of 2 — independent verification PENDING

### Ownership / diagnosis / bounded edit

- Using failure-triage. Verified cwd/top-level assigned existing worktree, branch `fix/test-temp-directory-cleanup`, HEAD `4f915540f700bbb403728ef8e01e0b5e02baf94f`; no concurrent owner per dispatch, no peers. Read current contract/run/diff. Prior run2 full-suite148-root leak and smallest/mixed probes are preserved above.
- Fresh focused RED before editing: `node tools/dev/test-temp-directory-cleanup.mjs -- npm --prefix apps/api_server test -- src/__tests__/agent_server_memory_live.test.ts`:1 skipped, native Vitest exit0, wrapper exit1;12785/214/9 ->12786/214/9. New exact `rhythm-vitest-6lackx` left untouched. Root cause: setupFiles allocates before collection, but Vitest does not invoke file afterAll for all-skipped files.
- Before config/setup edits GitNexus exact File UID upstream impact returned LOW,0 direct callers,0 affected processes/modules for both. Dynamic Vitest loading exceeds graph coverage; no new HIGH/CRITICAL. Approved fork helper and tests untouched in this attempt.
- Inspected installed Vitest4.1.1 types and runtime: TestProject.provide/native inject serialize context to fork workers (`cli-api.BUXBO6jS.js:2531,3665`); globalSetup return function stored as teardown (`10721-10728`), invoked at project close (`13874-13882`) after run. This avoids relying on worker exit signals or on ambient env pointer propagation.
- Added `vitest.global-setup.ts`: one `mkdtempSync` parent for this invocation, native project context handoff, returned exact-parent rm. Setup uses inject to create a unique `file-*` child each execution and exports its DB/vault/accounts paths to that worker's environment. Live-E2E guard remains unchanged. Parent captured in teardown closure, not rediscovered from mutable environment; different invocations cannot reuse an existing mkdtemp parent. Children stay alive until run teardown, preserving file/test teardown lifetime.
- Deleted obsolete API per-file afterAll and os import. No signals, prefix-delete scan, broad TMPDIR cleanup or shared database. Maintained runner now drives real pass/fail/all-skipped/mixed files, checks separate child paths under a single run parent and unique parents across invocations, exact absence after Vitest exit, and sentinel survival. It no longer deletes captured leaked roots, so a failing regression cannot erase its own leak evidence. Count gate unchanged.

### Fresh mandatory sandbox proof

- `ls -ld /private/tmp && node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-temp-cleanup-fixture-20260930-repair2` exit0; NEW synthetic read-only DB/config. No live data/config. Ignored dependency links reused without install/rebuild/mutation.
- Exact four variables on every `tools/dev/sandbox.sh up/status/down`: `RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-temp-cleanup-fixture-20260930-repair2`, `RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-temp-cleanup-fixture-20260930-repair2/rhythm.db`, `RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-temp-cleanup-fixture-20260930-repair2/opencode.json`, `RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-temp-cleanup-sandbox-20260930-repair2`. Also `DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow RHYTHM_NUMBAT_MONITORING_DISABLED=1`; defaults API4098/engine4097/gateway4099 unchanged throughout.
- `up && status` exit0; API/MCP builds passed, ready API10314/engine10332/gateway10314. Final `status && down` exit0, same listeners before down; owned sandbox removed, diagnostics `/private/tmp/rhythm-temp-cleanup-sandbox-20260930-repair2.evidence.cUkLCF`. No manual API launch, live-port operations, tests after down or deletion of observed leftovers.
- Every test command ran while sandbox up in `env -i HOME=/private/tmp/rhythm-temp-cleanup-sandbox-20260930-repair2/home TMPDIR="$TMPDIR" PATH=/private/tmp/rhythm-temp-cleanup-sandbox-20260930-repair2/bin:/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -f -c '<command>'`. Actual TMPDIR retained; Node22.23.0/Vitest4.1.1. Prefix triple order rhythm-vitest/opencode-test/opencode-test-data (second includes third).

### Actual commands / results

`W` means exactly `node tools/dev/test-temp-directory-cleanup.mjs --`; root cwd throughout.

| Command | Actual result | Counts before -> after |
| --- | --- | --- |
| `W npm --prefix apps/api_server test -- src/__tests__/agent_server_memory_live.test.ts` before edit | RED1 skipped;wrapper exit1 |12785/214/9 ->12786/214/9 |
| `node tools/dev/test-temp-directory-cleanup.mjs` | exit0: actual pass, intentional assertion failure/expected exit1, all-skipped and mixed. Exact parent/child absence, file teardown-active, isolation and sentinel assertions pass |12786/214/9 ->same |
| `W npm --prefix apps/api_server test -- src/__tests__/agent_server_memory_live.test.ts` | GREEN1 skipped;wrapper exit0 |12786/214/9 ->same |
| `W npm --prefix apps/api_server test -- src/__tests__/c6_feature_flags.test.ts src/__tests__/agent_server_memory_live.test.ts` | GREEN4 pass/1 skipped;wrapper exit0 |12786/214/9 ->same |
| `W npm --prefix apps/api_server test -- src/__tests__/c6_feature_flags.test.ts` | GREEN4 pass;wrapper exit0 |12786/214/9 ->same |
| `W npm --prefix apps/api_server test -- --no-file-parallelism` |6776 pass/1 fail/286 skip;files721 pass/1 fail/149 skip;545.46s;wrapper exit1 preserves real suite failure. **Strict cleanup count gate passes** |12786/214/9 ->same |

Full API output: `/Users/ajhochhalter/.local/share/opencode/tool-output/tool_0f4f743d00010tEsesYshcCBA8`. Additional skipped file is the maintained all-skipped regression. Actual full suite proves cleanup through skipped AND assertion-failing files; it is not an overall suite PASS.

Only full-suite failure: `native_runtime_guard.test.ts:46` loads installed12.8.0 and simulates Node24.21; unchanged manifest requires better-sqlite3^13.0.3. Read actual guard (installed package version default) and test; exact base diff empty for manifest/test/guard. Classification **environment dependency mismatch**, not lifecycle defect. No base full API suite executed or blanket pre-existing assertion; no product/dependency changes. No further repairs after this result. Fork tests/typecheck not rerun because final attempt does not edit fork; approved historical evidence and deferred local issue retained.

### Scope / final handoff

- `git diff --check` exit0. `gitnexus_detect_changes(scope: all, exact assigned worktree, repo: Rhythm)` LOW,4 tracked files,2 symbols,no affected processes. tmpdirScoped is the same prior line-shift attribution; fork diff untouched this attempt. Untracked new global setup/runner/tests/docs reviewed directly; graph index is stale/dynamic-loading limited.
- **FIXED — re-run verification-gate** for intended API lifecycle; **final independent verification PENDING, not PASS**. Historical verification_status FAIL and c2 FAIL remain until independent gate. Full-suite dependency environment needs operator-provisioned standalone compatible tree; no install through links. Next independent verification failure stops workflow under two-attempt cap; no third coding attempt or retry loop authorized.
- No commits/staging/push/PR/merge, peers, branch/worktree removal, live app operations, prefix sweep or existing/new leftover deletion. Initial12785/214/9; focused RED added1 retained; all post-repair counts12786/214/9 stable. Abrupt kills not claimed; concurrent invocations not separately stress-tested (ownership follows native context + unique mkdtemp closures).

## FINAL independent verification run3 — FAIL (controlling outcome)

### Identity / sandbox / boundaries

- Exact assigned worktree, branch `fix/test-temp-directory-cleanup`, HEAD=origin/main=base `4f915540f700bbb403728ef8e01e0b5e02baf94f` independently confirmed. Twelve intended pending files only; exact diffs inspected. No production behavior/source changes or fork normal-disposal change. Documentary volume is high because historical failure/repair evidence is retained; no functional scope bloat.
- `ls -ld /private/tmp && node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-temp-cleanup-fixture-20260930-vg3`: exit0, NEW synthetic0400 DB/config. Four exact variables on up/status/down: `RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-temp-cleanup-fixture-20260930-vg3`, `RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-temp-cleanup-fixture-20260930-vg3/rhythm.db`, `RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-temp-cleanup-fixture-20260930-vg3/opencode.json`, `RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-temp-cleanup-sandbox-20260930-vg3`; SQLite/shadow, `RHYTHM_NUMBAT_ENABLED=false`; default API4098/engine4097/gateway4099.
- `tools/dev/sandbox.sh up && tools/dev/sandbox.sh status`: exit0, API tsc/postbuild and MCP build green, ready;API18293/engine18311/gateway18293. Final status same; `curl --fail --silent http://127.0.0.1:4098/opencode/health` ready/bridgeLive=true; `down` exit0, owned runtime removed, sanitized diagnostics `/private/tmp/rhythm-temp-cleanup-sandbox-20260930-vg3.evidence.FFgM0Z` retained.
- Every test/static execution while sandbox up: `env -i HOME=/private/tmp/rhythm-temp-cleanup-sandbox-20260930-vg3/home TMPDIR="$TMPDIR" PATH="/private/tmp/rhythm-temp-cleanup-sandbox-20260930-vg3/bin:/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" /bin/zsh -f -c '<command>'`. Actual TMPDIR retained;Node22.23.0/Vitest4.1.1/Bun1.3.14. No live data/manual API, dependency installation through links, environment/product/test repair, Git mutation, peers, leftover/branch/worktree deletion.

### Independent commands / outputs / counts

`W` = `node tools/dev/test-temp-directory-cleanup.mjs --`. All root cwd unless specified. Triples rhythm-vitest/opencode-test/opencode-test-data; second includes third.

| Command | Result | Before -> after |
| --- | --- | --- |
| `node tools/dev/test-temp-directory-cleanup.mjs` |exit0; actual passing, intentional failing/expected exit1, all-skipped, mixed; active file teardown/exact removal/isolation/sentinel assertions |12786/214/9 ->same |
| `W npm --prefix apps/api_server test -- src/__tests__/c6_feature_flags.test.ts` |4 pass,exit0 |12786/214/9 ->same |
| `W npm --prefix apps/api_server test -- src/__tests__/agent_server_memory_live.test.ts` |1 skip,exit0 |12786/214/9 ->same |
| `W npm --prefix apps/api_server test -- src/__tests__/c6_feature_flags.test.ts src/__tests__/agent_server_memory_live.test.ts` |4 pass/1 skip,exit0 |12786/214/9 ->same |
| `W npm --prefix apps/api_server test -- ../../tools/dev/test-temp-directory-cleanup.test.ts ../../tools/dev/test-temp-directory-cleanup-skipped.test.ts` |1 pass/1 skip,exit0 |12786/214/9 ->same |
| `W npm --prefix apps/api_server test -- --no-file-parallelism` |6776 pass/1 environment mismatch/286 skip;files721 pass/1 fail/149 all-skipped;544.76s;exit1 propagated;STRICT cleanup count gate green |12786/214/9 ->same |
| `W bun --cwd apps/opencode_fork/packages/opencode test test/fixture/fixture.test.ts test/file/ripgrep.test.ts` |23 pass/53 assertions,exit0 |12786/214/9 ->same |
| fork package `bun run typecheck` |exit0,`tsgo --noEmit` |static |
| `W bun --cwd apps/opencode_fork/packages/opencode test test/git/git.test.ts test/config/config.test.ts test/util/filesystem.test.ts test/util/process.test.ts test/util/glob.test.ts` |180 pass/264 assertions;deferred count rejection,exit1 |12786/214/9 ->12786/227/9 |
| `W bun --cwd apps/opencode_fork/packages/opencode test test/session/ src/session/` |407 pass/1 fail/5 skip/1 todo/1154 assertions;exit1;new assertion not waived |12786/227/9 ->12786/228/9 |
| representative command above substituting retained `<base-package>` |180 pass/264 assertions;deferred count rejection,exit1 |12786/228/9 ->12786/241/10 |
| `W bun --cwd <base-package> test test/session/ src/session/` |408 pass/0 fail/5 skip/1 todo/1154 assertions;deferred count rejection,exit1 |12786/241/10 ->12786/242/10 |
| `W node /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/temp-cleanup-vg3-concurrent.mjs "$PWD/apps/api_server"` |exit0;two simultaneous real mixed Vitest invocations, distinct parents/children, content through teardown, exact absence |12786/242/10 ->same |
| `W node -e "process.exitCode=7"` |exit7;`test "$child_result" -eq 7` exit0 |12786/242/10 ->same |
| `npm --prefix apps/api_server exec -- tsc --noEmit -p apps/api_server/tsconfig.json` |exit0 |static |
| `npm --prefix apps/api_server run lint` |exit0,existing TODO placeholder,not substantive lint |static |
| `W npm --prefix apps/api_server exec -- vitest run --root apps/api_server src/security/security_advisories.test.ts` |15 pass,exit0 |12786/242/10 ->same |
| `node --check tools/dev/test-temp-directory-cleanup.mjs && git diff --check` |exit0 |static |

Full API output `/Users/ajhochhalter/.local/share/opencode/tool-output/tool_0f504d85e001gfA3ub050prJ38`; fork branch session + base representative output `/Users/ajhochhalter/.local/share/opencode/tool-output/tool_0f50eb9a30013gwRDjfZZltlcg`. Base session command output captured directly by verifier tool. `<base-package>` is `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/temp-cleanup-base-20260930-repair1/apps/opencode_fork/packages/opencode`. Hashes of archive fixture and prompt.test match exact HEAD blobs: `fedbc246bc1ec569f61b2848217374ad00dd8c27`, `1d4af371507a67b49b4080b288182b8965e12ca1`.

### Consolidated classifications / contract / draft PR checklist

- **Compatibility FAIL, cause UNKNOWN (not environment/pre-existing):** branch CI session test `shell completion resumes queued loop callers`, `prompt.test.ts:1523`, expected llm.calls1, received0. Exact base session command passes this assertion and all408 tests. A transient timing failure is possible but not established. No retry used to erase the failure, no repair attempted. This additional assertion is separate from deferred background root growth and prevents overall PASS under the mandatory merge-base rule.
- **Environment justified, not cleanup FAIL:** full API only failing assertion `native_runtime_guard.test.ts:46` simulates Node24.21 but loads installed12.8.0. `git rev-parse HEAD origin/main` identical; diffs HEAD/working and HEAD/origin/main empty for API manifest/test/guard. Objective package resolution gives shared `/Users/ajhochhalter/Documents/Rhythm/node_modules/better-sqlite3/package.json` version12.8.0 vs unchanged required^13.0.3. No unsafe shared-tree install, no whole-base API-suite PASS claimed. Cleanup passes despite suite exit1.
- **Deferred pre-existing background growth:** branch/base representative both180 pass and+13 roots this run; base includes data+1. Branch/base sessions+1 each. Prior base evidence and unchanged normal disposal support deferral, not universal no-growth. Local note accurate, no GitHub filing/closure. All newly observed roots and existing leftovers retained.
- **Contract c1-c6 narrow implementation PASS:** complete named inventory, actual API full/focused pass/fail/skipped/mixed cleanup, isolation/lifetime/sentinel assertions, exact-owned removals, fork initialization throw and unchanged normal callers, actual TMPDIR runner/child-status propagation, recorded commands, test-only diff. Overall verification_status FAIL reflects separate session compatibility assertion, not stale run2 all-skipped failure.
- **GitNexus caveat:** required MCP `gitnexus_detect_changes(scope all, exact assigned worktree, repo Rhythm)` unavailable in this session. No CLI or peer substitute; previous repeated LOW plus exact diff supports bounded scope, not fresh graph clearance. Conditional reference docs reviewed; historical controls explicitly superseded. No backend production behavior change, so no feature live E2E requirement.
- **PR checklist:** identity/owned12 files yes; API lifecycle/static/build yes; fork fixture/static/representative assertions yes; API environment exception objectively justified yes; concurrent isolation yes; fresh GitNexus unavailable; fork CI session compatibility NO. Full fork/SDK source-generating build and remaining unrelated CI stages not run after this failure. No manual smoke can waive it. **Draft PR gate: NO. Workflow stops; no third repair.**

## Final exception assessment — 2026-09-30 (historical BLOCKED assessment)

**WAIVED:** AJ replied **“Yes”** to **“explicitly accept this isolated failure as a documented verification exception, have the verifier assess that exception, and proceed with the cleanup draft PR.”** AJ was informed that the cause was unknown and no session fix had been made. This accepts only run3's `prompt.test.ts:1523` queued-loop assertion (`llm.calls` expected1/got0) for the original draft PR. It does not authorize merging, new code repair, peers, or cleanup of leftovers. Original run3 FAIL, exact-base408 pass vs branch407 pass/1fail, all subsequent receipts and the diagnostic-helper error remain untouched. Neither successful reruns nor the waiver prove flakiness or a fix.

### Independent review / reused evidence

- Entry identity command: `git rev-parse --show-toplevel && git branch --show-current && git rev-parse HEAD && git status --short && git diff --name-only && git diff --numstat && git diff 4f915540f700bbb403728ef8e01e0b5e02baf94f --name-only && git diff 4f915540f700bbb403728ef8e01e0b5e02baf94f --numstat` exit0. Exact assigned worktree, branch `fix/test-temp-directory-cleanup`, HEAD/base `4f915540f700bbb403728ef8e01e0b5e02baf94f`; four tracked and ten intended untracked files.
- Exact four-file `git diff` inspected: API config1/0, setup4/2, fork fixture tests45/0, helper40/32, matching final run3 and diagnostic review. Read global setup18 lines, maintained count runner69, passing test18 and skipped test9 directly. Successful fork lifetime/disposal unchanged except indentation; only owned initialization-before-return cleanup added. No unexpected ownership or production diff observed.
- `git diff --exit-code -- apps/opencode_fork/packages/opencode/test/session/prompt.test.ts apps/opencode_fork/packages/opencode/src apps/api_server/src apps/api_server/package.json package-lock.json` exit0. `git rev-parse HEAD:apps/opencode_fork/packages/opencode/test/session/prompt.test.ts` and `git hash-object` on restored branch/exact-base prompt files all return `1d4af371507a67b49b4080b288182b8965e12ca1`. `git diff --check` exit0. Prior notes do not contain a complete immutable blob manifest: this establishes exact inspected scope/no observed drift, not invented historical hashes.
- Reused independent run3 actual API pass/fail/skipped/mixed/concurrent cleanup assertions, full API6776 pass/1 dependency failure/286 skips with149 all-skipped files and unchanged counts, Bun fixture/ripgrep23 pass, normal callers180 pass, API tsc/lint/advisory15/build and fork typecheck. No tests rerun merely to overwrite failure history; no sandbox launched for this documentation/identity assessment.
- Read original captured API and fork receipts directly: full API failure is unchanged installed-version guard (12.8.0 vs manifest^13.0.3); fork receipt retains expected1/got0 and407 pass. API mismatch remains an objective local environment exception, not a cleanup failure or whole-base API-suite pass. Shared dependencies untouched.
- Separate diagnostic note retains3 focused and2 full samples per tree plus instrumented20 branch/20 base green assertions and counts, real `Shell -> ShellThenRun -> Running -> Idle` and one LLM request, followed by instrumentation removal. These successful observations do not explain the failed schedule.
- Background root recreation remains deferred local evidence, independently seen on exact base and branch; full count wrappers still exit1. No claim of universal no-growth, production cause proven, bug fixed, issue closed, or leftovers removed.
- Conditional reference: docs only (test infrastructure, no public API/UI/production session behavior change). Existing file/receipt paths reviewed; no architecture decision reversed or neighbor behavior documentation changed. Historical unresolved controls are clearly historical; compatibility contract active status is `WAIVED`, not Pending/FAIL.

### Structured handoff — BLOCKED, exception accepted

- Contract c1-c6 retain pass; quoted session exception explicitly justified by informed approval. No current required criterion is silently promoted from failure to test success.
- Fresh `gitnexus_detect_changes(scope: all, worktree: /Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/test-temp-directory-cleanup, repo: Rhythm)` cannot be called: MCP absent. Hub can call separately; previous LOW/stale/zero-process evidence is not fresh clearance.
- Full maintained fork suite and remaining triggered CI stages remain unexecuted in recorded evidence. `.github/workflows/opencode_fork_ci.yml` includes `bun run build:rhythm` plus generated-artifact diff; source-generating stages forbidden to this verifier. `.github/workflows/server_ci.yml` also includes optimizer guards/disposable-Postgres stages beyond the reused evidence. AJ waived the isolated assertion, not these coverage gaps. Hub must provide missing evidence or obtain a separate, explicit bounded exception before claiming integrated PASS.
- Automated integrated readiness: **BLOCKED**, not blanket suite success. Original draft PR is authorized by AJ; this verifier performs no PR/Git actions and leaves the final gate decision with the hub. No merge readiness claim.
- Human manual scope after draft PR: review exact-owned removal and retained lifetime, verify the disclosed session/environment exceptions and separate deferred recreation finding. No required backend feature journey exists in this test-only change; manual review cannot replace missing automated scope/CI evidence.
- Durable delta this assessment: the two existing contracts and two existing active run notes only. No product/test code, manifests, lockfiles, Git state, project state, runtime, or retained roots changed.

## FINAL local draft-PR readiness — 2026-10-01 (active outcome)

**PASS-local — original draft PR only; not merge-ready.** Hub owns proportional gate classification for this test-infrastructure-only diff. AJ's informed queued-loop exception remains **WAIVED**, not a test success. Original run3 FAIL, expected1/got0, exact-base comparison, all reruns and diagnostic-harness error remain unchanged. No cause, flakiness or bug fix established.

### Fresh read-only evidence / scope

- `git rev-parse --show-toplevel && git branch --show-current && git rev-parse HEAD && git status --short && git diff --name-only 4f915540 && git diff --numstat 4f915540` exit0: exact existing worktree; branch `fix/test-temp-directory-cleanup`; HEAD/base `4f915540f700bbb403728ef8e01e0b5e02baf94f`; four tracked and ten intended untracked files only.
- Inspected complete four-file diff and all four untracked implementation/check files: native `provide/inject`, unique invocation parent and per-file children, exact run-level teardown, original successful fork disposal retained, failed-init cleanup only when newly-created exact path is owned. Numstat unchanged: config1/0, setup4/2, fixture.test45/0, fixture40/32. No lifecycle/assertion edits in this assessment.
- `git diff --exit-code 4f915540 -- apps/api_server/src apps/opencode_fork/packages/opencode/src apps/opencode_fork/packages/opencode/test/session/prompt.test.ts apps/opencode_fork/packages/sdk apps/api_server/vendor apps/api_server/package.json apps/opencode_fork/package.json package.json package-lock.json apps/opencode_fork/bun.lock .github/workflows` exit0. No production/session/public API/SDK/optimizer/Postgres/manifest/lockfile/CI changes. `git rev-parse HEAD:apps/opencode_fork/packages/opencode/test/session/prompt.test.ts` and `git hash-object apps/opencode_fork/packages/opencode/test/session/prompt.test.ts` both `1d4af371507a67b49b4080b288182b8965e12ca1`; instrumentation absent. `git diff --check` exit0.
- Hub supplied fresh MCP `gitnexus_detect_changes(scope ALL, exact assigned worktree, repo Rhythm)`: risk LOW,2 symbols (`tmpdir`, `tmpdirScoped`),0 affected processes,4 tracked files. Direct diff confirms scoped body unchanged, line-shift attribution only. This satisfies manager invocation; specialist MCP unavailable here. Stale index, dynamic Vitest loading and exclusion of untracked files remain coverage caveats, not runtime safety proof.
- Reused recorded independent actual passing/failing/skipped/mixed/concurrent Vitest filesystem evidence and API full6776 pass/1 installedSQLite mismatch/286 skip (149 all-skipped files), strict counts unchanged; fixture/ripgrep23 pass/53 assertions, representative180 assertions green with deferred growth; fork typecheck and API tsc/lint/advisory15/build. Assertions catch early deletion (active content through teardown), leaked roots (exact absence), shared children/invocations (unique paths), and unowned deletion (sentinel survival). No runtime rerun to erase history or implied fresh suite pass; prior notes lack a full immutable historical blob manifest, so no invented fingerprint claim.

### Exact CI classification / remaining evidence

- `.github/workflows/opencode_fork_ci.yml:26-32` requires `bun run typecheck` and `bun test test/session/ src/session/`, both recorded (isolated assertion WAIVED). It does **not** require the entire fork suite. Lines34-43 require `bun run build:rhythm` and generated-artifact diff. Those source-generating stages are **not_tested / CIpending**, not waived or passed: SDK/public API source unchanged; evidence-only verifier cannot modify generated repository source.
- `.github/workflows/server_ci.yml:31-40` specifies lint/test/advisory/build, recorded with the disclosed installed better-sqlite3 exception (12.8.0 vs unchanged ^13.0.3; no full-suite PASS). Lines41-50 API smoke/optimizer and lines52-94 disposable PG, plus platform runtime/dependency/image preparation, are **not_tested / CIpending**, not waived or passed. No production/optimizer/Postgres source changed; prior sandbox health is not the exact platform smoke.
- `AGENTS.md:40-60` requires feature branch, draft PR and human smoke before merge; its backend-feature live gate at62-135 does not describe a production feature changed here. Testing guide documents full session/typecheck commands. No explicit repository requirement found making every platform CI stage mandatory **before draft creation**. Hub's proportional local classification supersedes the prior additional full-fork/pre-draft downstream requirement; it does not erase that historical BLOCKED decision or waive future CI.
- Remaining manual handoff: after draft, review exact-path ownership/lifetime, unchanged successful disposal, AJ's unknown-cause assertion exception, SQLite environment limitation and deferred base/branch background recreation. Abrupt kills/collection failure/throwing earlier teardown/non-default ordering remain untested. Await triggered platform CI before any merge-readiness decision. No universal no-growth, demo-readiness or merge approval.

### Durable delta / ownership

Only `docs/ai/contracts/test-temp-directory-cleanup.json`, `docs/ai/contracts/fork-shell-queued-loop.json`, this note and `docs/ai/runs/2026-09-30-fork-shell-queued-loop.md` updated. Conditional reference: docs only; commands/paths and CI line references inspected, contracts map each criterion to assertions/manual evidence or explicit exception/not_tested. Historical limits remain labeled historical. No product/test source, Git state, project state, runtime, environment, live data/config or retained roots changed. No model override, peers, install, test rerun, sandbox/server launch, commit/push/PR/merge/delete. Hub owns state update and draft creation.
