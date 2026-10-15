---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: 1617
issues: [fork-fetch-test-typing]
status: FAIL
tags: [run, rhythm]
---

## Files / approved scope

AJ explicit `do1`: only line 8 of
`apps/opencode_fork/packages/opencode/src/plugin/codex-accounts.pinned.test.ts`,
inserting `unknown as `, plus this dedicated note. No production code, assertions,
formatting, deps/lock/workflow changes. Preserve all five initial untracked Mac
helper/run files. No stage/commit/push/merge, desktop/app replacement/relaunch,
live provider/user data/Keychain/Pi/relay/Tailscale operations or restart approval.
HEAD `b4ba00e671a1dafd9c7b89bc46cd0bc2f97570e1`; initially tracked clean.

## Checks — Phase 0

Loaded acceptance-contract then coding-agent; read AGENTS, project-state,
current-plan, regression-registry and Oct10 deliverables-completion-source before
forming a diagnosis. Oct10 line44 already records the same fetch.preconnect error.
Current `.github/workflows/opencode_fork_ci.yml` pins Bun1.3.13 and the commands below.

Contract: make unchanged `bun run typecheck` pass, unchanged five pinned tests pass,
run exact CI session/tool suite and SDK build/check, prove reversing only the
insertion recovers original bytes; no widened repair. Parent independently reviews
and executes checks, then owns commit/push and GitHub CI; no independent pass claimed.
WAIVED: new live behavioral test, because this is exclusively a type annotation;
the requested compiler RED was nevertheless reproduced before implementation.

Canonical fixture builder:
`env -i PATH="$PWD/tools/dev/.hermes-shipping-runtime/node/bin:/opt/homebrew/bin:/usr/bin:/bin" HOME=/private/tmp tools/dev/.hermes-shipping-runtime/node/bin/node tools/dev/sandbox_fixture.mjs /private/tmp/hermes-fork-typing-20261014-fixture`
— exit0, synthetic read-only sources. Added safe local MCP config targeting5398,
mode0400; dummy public fixture token only. No live files copied.

Envelope retained at `/private/tmp/hermes-fork-typing-20261014-fixture/envelope.sh`:
four required vars root=that fixture, DB=`rhythm.db`, config=`fork-opencode-config.json`,
SB=`/private/tmp/hermes-fork-typing-20261014-sandbox`; ports5398/5397/5399,
sqlite/shadow, PURE/default plugins disabled/models fetch disabled/monitor disabled.
Private Node22.23.0 `tools/dev/.hermes-shipping-runtime/node/bin/node`;
engine reuse skip1, SHA256 `d60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072`.
Stock `bash tools/dev/sandbox.sh up` and `status` exit0: API71246, engine71409.
Canonical API/MCP builds exit0; no manually launched Rhythm server.

Setup attempt1: global Bun1.3.14 is not CI version. Downloaded official pinned
`https://github.com/oven-sh/bun/releases/download/bun-v1.3.13/bun-darwin-aarch64.zip`
with curl --fail --location --max-time90 into private fixture; unzip; version1.3.13.
An initial invocation of the runtime `node` directory produced shell permission
denied, not a security-policy denial; corrected to its existing `bin/node`, no mode change.
Shipping fork has no node_modules. Root Rhythm dependency realpaths were inspected;
its bun.lock differs (XML packages), so not reused, linked or mutated.
Setup attempt2: `git archive HEAD apps/opencode_fork apps/api_server/vendor/opencode-ai-sdk`
extracted to private fixture `source/`; `bun install --frozen-lockfile --ignore-scripts`
in snapshot fork with private HOME/TMP/cache — exit0,4675 packages,31.87s.
No install through symlinks or shared/global update. Ignore-scripts is recorded as
a local setup difference, not equivalent to the full CI install lifecycle.

All fork commands use `source .../envelope.sh` then
`export HOME="$RHYTHM_SANDBOX_DIR/home" TMPDIR="$RHYTHM_SANDBOX_DIR/tmp"`.
Private snapshot package cwd (not shipping cwd, because it lacks dependencies):
`/private/tmp/hermes-fork-typing-20261014-fixture/source/apps/opencode_fork/packages/opencode`.
RED `bun run typecheck` emits `$ tsgo --noEmit`, exits nonzero:
`src/plugin/codex-accounts.pinned.test.ts(8,20): error TS2352`;
Mock to typeof fetch lacks required `preconnect`, compiler recommends unknown first.
No other diagnostic. Original SHA256
`db92d9c2992738f6ba1b0d5161ce36af5876487f9760094a9e8fce00ee5ffa8c`.

## Phase 1 — bounded impact / safety

GitNexus upstream impact(globalThis.fetch,file_path exact test,includeTests=true,
repo Rhythm) returned Target not found / UNKNOWN. Not zero callers or risk.
Manual surface: whole38-line test, fixture preload, codex-accounts112 lines,
workflow and SDK build scripts read. Test-global mock is consumed by
markCodexSpillover's fire-and-forget fetch at codex-accounts.ts95, exercised by
c2 and c3; five tests reset account cache/store in beforeEach. No preconnect call.
Existing global mock/module lifecycle unchanged; separate pinned-test process
prevents affecting CI suite's global fetch. Compiler cast erases at runtime.
Preload puts auth/account stores and XDG into private TMP, DB in memory and
clears provider credentials. Unit suite uses owned temporary project/LLM/MCP
fixtures; no real provider env inherited. SDK GenerateCommand calls Server.openapi,
not serve/listen; generator hardcodes4096 only as generated client default text.
SDK build deletes/rewrites generated paths, so it must run in the private source
snapshot, never the shipping worktree. Unexpected failures/drift are reported,
not fixed or rebased. Scope approval unchanged; no rename or production symbol edit.

## Phase 2 — actual results

Implementation attempt1: inserted only `unknown as ` in the shipping line8 and
its byte-identical private validation snapshot. No second implementation repair,
no assertions edited. Compiler acceptance is GREEN; overall fork qualification
is **FAIL**, because the required unchanged CI suite has five failures. No baseline
waiver or complete fork CI pass claimed; no speculative production fix attempted.

Private snapshot opencode cwd, same four fixture vars and private Bun1.3.13:
`source /private/tmp/hermes-fork-typing-20261014-fixture/envelope.sh && export HOME="$RHYTHM_SANDBOX_DIR/home" TMPDIR="$RHYTHM_SANDBOX_DIR/tmp" && bun run typecheck && bun test src/plugin/codex-accounts.pinned.test.ts`
— typecheck exit0, `$ tsgo --noEmit`, no diagnostic; pinned5 pass/0 fail,
6 expect calls,1file,1497ms. Fresh env-i repeat after SDK also typecheck exit0,
pinned5 pass/0fail,6expect calls,836ms. All c1/c2/c14/c3/c4 assertions unchanged.

Exact CI suite invocation in that same cwd:
```bash
env -i PATH=/usr/bin:/bin /bin/bash -c 'source /private/tmp/hermes-fork-typing-20261014-fixture/envelope.sh; export HOME="$RHYTHM_SANDBOX_DIR/home" TMPDIR="$RHYTHM_SANDBOX_DIR/tmp" OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_EXTERNAL_SKILLS=1; bun test test/session/ src/session/ test/tool/task.test.ts test/server/httpapi-rhythm-provider-guard.test.ts test/snapshot/ test/bus/'
```
Nonzero: **635pass,6skip,1todo,5fail;3485expect calls;647tests,47files;154.33s**.
Full captured output:
`/Users/ajhochhalter/.local/share/opencode/tool-output/tool_13c89e4ca001JC7Wb46qUNxtBl`.
Failures (actual implementation is exercised by the unchanged tests):
- `test/session/mcp_allowlist_e2e.test.ts:1122`: Case L deferred builtin path
  denial during awaited before hook; `g.__lazyBefore.entered` expectedtrue/false.
- same file1441: Case P canonical execute revocation; `g.__discoveryBefore.entered`
  expectedtrue/false.
- same file1502: Sol same-key changed origin/schema replacement;
  `state.replaced` expectedtrue/false.
- same file1540: Case Q schema-only replacement; `state.replaced` expectedtrue/false.
- `test/session/llm.test.ts:1108`: OpenAI responses payload
  `maxTokens` expectedundefined, received32000.
No assertion or SUT repair for these failures is authorized by do1. Root cause
not diagnosed in this type-only assignment; these are not dismissed as baseline.
Skips: unicode filenames modification/restore; four StructuredOutput integration
cases; issue1352 live MCP Apps negotiation. Todo: remote Instruction config URL
fetch via HttpClient. None is counted as a pass.

SDK exact `bun run build:rhythm` in private
`.../source/apps/opencode_fork/packages/sdk/js`, env-i envelope + private HOME/TMP/XDG,
OPENCODE_DISABLE_AUTOUPDATE/EXTERNAL_SKILLS=1 and
`MODELS_DEV_API_JSON="$PWD/../../opencode/test/tool/fixtures/models-api.json"`:
exit0. Logs: one-time private SQLite migration done; @hey-api/sdk instance
deprecation warning; openapi-ts0.90.10 generated; complete artifact refreshed in
private `source/apps/api_server/vendor/opencode-ai-sdk`. Server.openapi is pure
schema emission (server.ts53–55); no SDK engine listener/restart initiated.

Exact CI generated-path diff with explicit read-only Git metadata and private
worktree (because archive intentionally has no .git):
```bash
git --git-dir="$(git rev-parse --absolute-git-dir)" --work-tree=/private/tmp/hermes-fork-typing-20261014-fixture/source -C /private/tmp/hermes-fork-typing-20261014-fixture/source/apps/opencode_fork diff --exit-code -- packages/sdk/openapi.json packages/sdk/js/src/v2/gen ../api_server/vendor/opencode-ai-sdk
```
Exit0, no output; generated SDK is current. All outputs stayed in private
snapshot; no shipping overwrite/cleanup/rebaseline needed. Linux GitHub CI was
not run by this agent; private macOS checks are not a substitute for parent CI.

### Identity predicates / runtime qualification boundary

`python3 -I /private/tmp/hermes-fork-typing-20261014-fixture/proof.py` exit0:
- Original SHA256 `db92d9c2992738f6ba1b0d5161ce36af5876487f9760094a9e8fce00ee5ffa8c`.
- Patched SHA256 `11e9ce22d9821bd5c5c4c15a618abca962b012c68b600d7f2c45a36a5ae6848e`.
- Normalize ONLY the exact line8 insertion back: original SHA recovered byte-for-byte.
- Shipping and snapshot patched file identical. All4978 tracked fork paths and
  all81 tracked vendored SDK paths byte-identical between shipping and snapshot
  after SDK generation, including symlink text. No lock/dependency/workflow drift.
- Sole tracked diff is the test; staged index empty. All app production paths
  identical to `31906d37d2f61cd964d66372c79a8ba59c14c60d` excluding only exact test.
Initial proof helper hit IsADirectoryError on existing tracked email symlink;
fixed the private proof to compare symlink text, not its target directory; rerun
PASS. This was not a product/test repair or permission change.

Under env-i private envelope, Bun.Transpiler({loader:"ts"}).transformSync of
patched versus original normalized text produced **identical JavaScript bytes**,
SHA256 `5db19906d72e8631806cd32b8e2a6ca16b61fea1656f909313c6092a46694d93`.
This checks the real compiler, not a mock system under test. Runtime fetch
fixture, cache/reset calls, all five assertions and production code unchanged.
`git diff -- apps/opencode_fork/packages/opencode/src` shows precisely one line.
Workflow, bun.lock, API/MCP/native and shipping SDK diff commands exit0;
`git diff --check`, cached diff exit0. HEAD unchanged b4ba00e6.
Source319 runtime identity is preserved; no signed0.18.77 artifact mutation or
new artifact upload/packaging/signing/notarization qualification claimed.

### Teardown / handoff

Same envelope, `bash tools/dev/sandbox.sh status` then `down` exit0. Status
retained API71246/engine71409, ports5398/5397/5399; canonical ownership-checked
down removed only this disposable sandbox, preserved sanitized diagnostics at
`/private/tmp/hermes-fork-typing-20261014-sandbox.evidence.cV55aE`.
Sandbox directory absent and no owned-port listeners after down. Separate lsof
checks emitted an unrelated SMB mount stat warning (incomplete mount metadata),
not a test pass; stock launcher stop verified its three ports. Private fixture,
source snapshot, proof/envelope and Bun retained for review; no broad cleanup.

Return **FAIL** for required full fork qualification, despite correct verified
one-line typefix. Parent independently reviews the patch/run and reruns unchanged
commands against a separately prepared canonical sandbox; review must not require
write access to this shipping test artifact. Parent owns any authorized commit/
push and requires GitHub fork CI GREEN including the previously skipped downstream
jobs. Newly discovered five suite failures need separately bounded diagnosis,
not extra edits in this assignment. New full-app restart/replace/relaunch remains
**NOT APPROVED**; do1 never authorized step2. Five initial untracked Mac helper/run
files remain present and were neither edited nor staged. No peers dispatched.

## Parent independent step1 gate

Verifier01669b0c-c135-4d64-968a-865bf8a478ad returned **PASS_STEP1_TYPEFIX**.
Fresh private Bun1.3.13: typecheck exit0, pinned tests5pass/0fail/6expects,
SDK build exit0 and exact generated-path comparison exit0. The private snapshot
matched4978 tracked fork paths and81 vendor SDK paths. Reversing only the
`unknown as` insertion recovered originalSHA db92d9c2992738f6ba1b0d5161ce36af5876487f9760094a9e8fce00ee5ffa8c;
patchedSHA11e9ce22d9821bd5c5c4c15a618abca962b012c68b600d7f2c45a36a5ae6848e.
Actual Bun-transpiled JS was byte-identical, SHA5db19906d72e8631806cd32b8e2a6ca16b61fea1656f909313c6092a46694d93.
Canonical5398/5397/5399 lifecycle and teardown passed; diagnostics retained at
/private/tmp/hermes-fork-typing-20261014-sandbox.evidence.2TjV0S.

The broader suite was not rerun by the verifier; retained raw output independently
confirmed635pass,6skip,1todo,5fail across647tests/47files. Four awaited-hook/MCP
replacement failures and one OpenAI max_output_tokens expectation remain
unclassified and unwaived. This commit repairs only the approved test typing;
actual new-head GitHub CI must qualify the formerly skipped stages. Existing
rollout helper/test/run files are unrelated and remain untracked/preserved.
AJ approved step1 only. Restart, app replacement and relaunch are NOT APPROVED.
No merge, deployment or new packaging is implied by this type-only fix.
