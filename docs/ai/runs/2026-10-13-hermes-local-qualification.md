---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-authenticated-approvals-20261012
pr: 1615
issues: []
status: FAIL_LOCAL_GATE_QUALIFIED_COMPARISON
tags: [run, Rhythm, hermes, verification, baseline]
---

# Independent LOCAL11 qualification

## Result / boundaries

**FAIL for the unchanged isolated-settings test gate; controlled comparison completed successfully.** Ten failures reproduce identically on an executed baseline and candidate. The historical eleventh assertion passes on both with a private manifest-compliant SQLite dependency. Default-fixture-only subprocess runs pass all 34 assertions on both revisions. This is focused qualification, not an all-green full-suite, live-feature, desktop, or merge approval.

Full API `npm test` comparison: **NOT RUN, zero attempts**. The unrestricted suite includes desktop/human-signature tests excluded by this assignment; no broad command was substituted for the allowed four-file qualification. Real SDK live17: **NOT RERUN**; earlier passes remain historical, not new evidence here. No mixed signed tests, desktop decisions, cards, production requests, real Tailscale commands, relay/network changes, Hermes restart, deploy/merge, or external communications. Parent reports PR1615's four CI checks green; CI is contextual information, not the executed baseline.

Only repository write: this new document. No product/test/mocks/guards, manifests, lockfiles, shared dependencies, or Git state changed. Writer `f13020db` and other-worktree ports4898/4897/4899 were excluded; scope notification was provided in the verifier handoff channel, not through an external action. Workflow-orchestrator owns any further routing.

Loaded `verification-gate` first, then its backend-live reference for launcher/readiness constraints. Universal identity/diff checks were executed independently. No new backend behavior was implemented; mocked comparisons are not presented as live approval evidence.

## Files / identities

- Assigned clean starting HEAD: `f2fe38e6a8cc643a2822087aa0fdb3d1f11e6320`.
- Executed baseline: `4f915540f700bbb403728ef8e01e0b5e02baf94f`.
- Disposable archive/dependency/evidence root, retained: `/private/tmp/hermes-local-qualification-20261013` (Q below).
- `git archive 4f915540 | tar -x -C Q/base`; `git archive HEAD | tar -x -C Q/candidate`. No checkout, worktree creation/removal, branch deletion, commit, push, or other Git mutation.
- `git diff --check 4f915540..HEAD`: exit0/no output. `git status --short` initially empty. `git diff --stat 4f915540..HEAD`:19files,1442insertions,2deletions.
- `git diff --exit-code 4f915540..HEAD --` the four named tests: exit0/no output. API/root manifests and locks, launcher, and fork tree also identical between revisions.
- Independent `python3 Q/verify-identities.py`: exit0; **1570 baseline /1577 candidate** source/vendor/manifest/lock/launcher Git blobs match their respective revisions after installs/builds/tests. These identity checks establish unchanged inputs, not correctness by themselves.
- Actual comparison Node: `/Users/ajhochhalter/.local/bin/node`, **22.23.0**; npm **10.9.8**. API engines require `>=20 <25`.
- Both private trees: better-sqlite3 **13.0.3**, node-pty **1.1.0**, TypeScript **5.9.3**, Vitest **4.1.1**. SQLite query `select 1 as x` returned `{x:1}` in both sandbox environments.
- Private SQLite resolutions: `Q/base/node_modules/better-sqlite3/lib/index.js` and `Q/candidate/node_modules/better-sqlite3/lib/index.js`, never shared/live dependency paths.
- Shared SQLite identity, read-only resolution via main API `createRequire`: `/Users/ajhochhalter/Documents/Rhythm/node_modules/better-sqlite3/package.json`, version **12.8.0**. Left untouched.
- Same previously built engine used by launcher on both revisions, with identical fork source tree: assigned worktree `apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode`; SHA256 `bc4e60c7617f8de58b3b2333cfe037f3d3695dd6b001327ad9c481b19972c7a3`. Engine health version `0.0.0-feat/hermes-authenticated-approvals-20261012-202610130450`. Reuse through existing approved `RHYTHM_SANDBOX_ENGINE_DIR` / skip-build seam, no binary/source edit.
- Disposable runner SHA256 `7f701fb4430add73230d7253e2540dbd1700c821c9e7d365f2de3fb262c29070`; comparison checker SHA256 `396999822c2e844d58298ab3eedcafebe55cbe614c07eeb093022faf808e49df`. Runner/checker do not modify assertions or SUT.

## Environment repair: private only

Executed from `Q/base/apps/api_server`:
```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org --cache=/private/tmp/hermes-local-qualification-20261013/npm-cache --fetch-retries=0 --fetch-timeout=60000
npm rebuild better-sqlite3 node-pty esbuild --registry=https://registry.npmjs.org --cache=/private/tmp/hermes-local-qualification-20261013/npm-cache --fetch-retries=0 --fetch-timeout=60000
```
Outputs:185packages added/audited188 in5s,18 reported vulnerabilities; native rebuild successful. From `Q/base/apps/mcp_server`, same `npm ci` options:142packages added/audited143 in2s,19 reported vulnerabilities; `npm rebuild esbuild --registry=https://registry.npmjs.org --cache=Q/npm-cache` successful. No audit fix or dependency upgrade beyond the lockfile. Normal registry downloads only. Installs/rebuilds were disposable prerequisite preparation; all server builds/tests used the canonical sandbox.

Copied only the newly created private API, MCP, and hoisted root `node_modules` to matching candidate archive directories with `cp -R`. No install through existing/shared symlinks. Workspace npm hoists SQLite to the private root; manifest and lock identities verified unchanged afterward. Counts:2ci installs,2native rebuild commands,3private dependency-copy commands; no shared install/rename/removal.

Two diagnostic setup errors are retained, not test regressions:
1. Fresh `/bin/bash -lc` selected Node26.5.0/npm11.17.0 (unsupported) and an explicit `../api_server/node_modules/better-sqlite3` path returned MODULE_NOT_FOUND because SQLite is hoisted. No tests/server launched. Small repair: pin supported Node22 via explicit PATH and `RHYTHM_SANDBOX_NODE_BIN`; resolve dependencies with Node's normal API package resolution. Fresh `/bin/bash -c 'export PATH=/Users/ajhochhalter/.local/bin:$PATH; node --version; npm --version; node -e ...'` verified22.23.0/10.9.8/SQLite13.0.3 and actual in-memory native query. Shell configuration untouched.
2. Later read-only shared-version diagnostic used `/Rhythm/apps/api_server/node_modules/better-sqlite3/package.json` and returned MODULE_NOT_FOUND; corrected to `createRequire('/Users/ajhochhalter/Documents/Rhythm/apps/api_server/package.json')`, resolving hoisted shared12.8.0. Comparison had already passed; no dependency mutation needed.

## Exact controlled launcher / test commands

Full executable command and expanded command/output transcripts are retained in `Q/run-comparison.sh`, `Q/base-command-output.log`, `Q/candidate-command-output.log`. The script sets these explicit inputs for **both** sequential launches:
```sh
export PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export RHYTHM_SANDBOX_NODE_BIN=/Users/ajhochhalter/.local/bin/node
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-approvals-20261012-fixture
export RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-approvals-20261012-fixture/rhythm.db
export RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-approvals-20261012-fixture/opencode.json
# literal resolved paths: Q/sandbox-base, then Q/sandbox-candidate
export RHYTHM_SANDBOX_DIR=/private/tmp/hermes-local-qualification-20261013/sandbox-base
export RHYTHM_SANDBOX_API_PORT=4198 RHYTHM_SANDBOX_ENGINE_PORT=4197 RHYTHM_SANDBOX_GATEWAY_PORT=4199
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1
export RHYTHM_SANDBOX_ENGINE_DIR=/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-authenticated-approvals-20261012/apps/opencode_fork/packages/opencode
export OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1
```
Existing approved fixture remains read-only and outside both sandbox directories. The launcher validates this before launching. Only label/source-root/owned-sandbox paths differ; Node/dependencies/fixture/settings/ports identical.

From absolute cwd `Q/base`, then after its teardown from `Q/candidate`:
```sh
/bin/bash /private/tmp/hermes-local-qualification-20261013/run-comparison.sh base > /private/tmp/hermes-local-qualification-20261013/base-command-output.log 2>&1
/bin/bash /private/tmp/hermes-local-qualification-20261013/run-comparison.sh candidate > /private/tmp/hermes-local-qualification-20261013/candidate-command-output.log 2>&1
```
Both wrapper exits0 mean comparison orchestration/teardown completed, **not** that isolated tests passed. Each sources the unchanged canonical `tools/dev/sandbox.sh`, calls `up; status`, and later `down`. Launcher API/MCP builds pass on both. Engine prebuild reused. Readiness probes:
```sh
curl --fail --silent --max-time 10 http://127.0.0.1:4198/health
curl --fail --silent --max-time 10 http://127.0.0.1:4198/opencode/health
curl --fail --silent --max-time 10 http://127.0.0.1:4197/global/health
```
Observed API `status:ok`, SDK `status:ready,bridgeLive:true`, engine `healthy:true`; same SDK readiness after default-fixture child tests. Baseline API98408/engine98506/gateway98408; candidate API2858/engine2961/gateway2858. Before/after child tests preserve these respective PIDs/isolated listeners. Health identity's `commit:dev` is non-authoritative for archive revision; Git archive/blob checks above provide source identity.

From each archive's `apps/api_server`, arrays and direct Node/Vitest invocation:
```sh
files=(src/__tests__/issue_655_contract.test.ts src/__tests__/opc_rhythm_mcp_ensure.test.ts src/services/__tests__/tailscale_serve_service.test.ts src/__tests__/native_runtime_guard.test.ts)
env -i "${runtime_env[@]}" RHYTHM_API_URL=http://127.0.0.1:4198 "$NODE_BIN" node_modules/vitest/vitest.mjs run "${files[@]}" --no-file-parallelism --reporter=verbose --reporter=json --outputFile.json=/private/tmp/hermes-local-qualification-20261013/base-isolated.json
```
Candidate output argument is `.../candidate-isolated.json`, otherwise identical. **Both exit1:3failed/1passed files;10failed/24passed tests,34total.** Baseline715ms. No timeout/resource failure.

Then, inside the still-running sandbox, only the **test subprocess** restores three expected module default fixtures:
```sh
env -i "${runtime_env[@]}" RHYTHM_API_URL=http://127.0.0.1:4198 /usr/bin/env -u RHYTHM_OPENCODE_ENGINE_PORT -u RHYTHM_AGENT_URL -u RHYTHM_MOBILE_GATEWAY_PORT "$NODE_BIN" node_modules/vitest/vitest.mjs run "${files[@]}" --no-file-parallelism --reporter=verbose --reporter=json --outputFile.json=/private/tmp/hermes-local-qualification-20261013/base-default-fixtures.json
```
Candidate output argument is `.../candidate-default-fixtures.json`. **Both exit0:4passed files;34passed tests,0failed.** Baseline650ms. No assertions changed or skipped. OS stale-process calls use existing injected `StalePortDeps`; Tailscale tests always inject command runners; MCP config tests use disposable config files and injected SDK registration. This subprocess does not launch a server or perform real Tailscale configuration. Actual servers never use defaults4001/4002/4096; launcher runtime remains isolated and unchanged.

Counts:2sequential `up/status/down` lifecycles,4focused Vitest invocations,136 assertion executions (20failed,116passed across four runs);0full-suite attempts,0live approval/desktop invocations. Two isolated failures are preserved, not hidden by the orchestration exit.

## All eleven historical assertions / classification

Read prior CI repair run and full retained original log `QPbK6i/ci-repair-full-api.log`, specifically lines31665–31857:4failed/718passed/151skipped files;11failed/6770passed/302skipped tests. It remains untouched at `/private/tmp/hermes-approvals-20261012-sandbox.evidence.QPbK6i/ci-repair-full-api.log`.

| Historical assertion | Executed BASE / CANDIDATE under isolation | Default-fixture child BASE / CANDIDATE | Classification / observed output |
| --- | --- | --- | --- |
| issue655 kills stale process | FAIL / FAIL | PASS / PASS | Injected command4096 vs module4197; refuses PID99123 as non-matching-port process |
| issue655 escalates TERM→KILL | FAIL / FAIL | PASS / PASS | Same mismatch; refuses injected PID42 |
| issue655 consults ps after PID | FAIL / FAIL | PASS / PASS | Same mismatch; refuses injected PID7 |
| issue655 defaults engine port | FAIL / FAIL | PASS / PASS | `expected 4197 to be 4096` |
| MCP ensure adds config | FAIL / FAIL | PASS / PASS | `expected 'http://127.0.0.1:4198' to be 'http://localhost:4001'` |
| MCP ensure local URL vs prod | FAIL / FAIL | PASS / PASS | Same URL assertion |
| MCP ensure no-op matching config | FAIL / FAIL | PASS / PASS | `expected true to be false`, fixture embeds default local URL |
| Tailscale normalized target | FAIL / FAIL | PASS / PASS | `wrongTarget` vs `healthy`; injected4002 differs from expected4199 |
| Tailscale configure then verify | FAIL / FAIL | PASS / PASS | `expected 'wrongTarget' to be 'healthy'` |
| Tailscale already healthy no configure | FAIL / FAIL | PASS / PASS | Unexpected extra injected runner call, undefined `exitCode`; no real configure |
| Native installed13.x assertion | PASS / PASS | PASS / PASS | Private installed13.0.3 meets manifest; guard and refusal predicates preserved |

`python3 Q/compare.py > Q/comparison-output.log 2>&1`: exit0. It compares all34 test names/statuses and all ten **complete JSON failureMessages**, normalizing only ANSI and archive/sandbox path prefixes. All ten messages identical between executed revisions; all eleven historical test names accounted for. Full original11 failures and both current10 failures remain retained.

Native caveat, not a waiver: historical exact error names synthetic Node24.21.0 with installedSQLite12.8.0 and nodejs/node#65446. This invocation did **not** execute an installed12.8 baseline: installing/using non-manifest dependencies was excluded. Instead identical unchanged tests/guard were executed on both revisions with compliant13.0.3; the installed-version assertion and existing synthetic unsafe-version refusal tests pass. Together with read-only shared12.8 identity and retained exact error, this qualifies a stale dependency cause; it is not a claim that all eleven failures were freshly reproduced. Actual sandbox Node22.23.0, not synthetic24.21.0.

The ten environment/default-fixture failures are now **executed-baseline reproduced**, rather than only inferred from unchanged files. No new focused regression found. Removing their subprocess overrides proves expected default fixtures, but does not make an unchanged sandbox-settings `npm test` green or excuse a full-suite failure.

## Evidence / teardown / handoff

Retained under Q:
- `base/`, `candidate/`: exact source archives plus private dependency trees/build artifacts.
- `run-comparison.sh`, `compare.py`, `verify-identities.py`.
- `base-command-output.log`, `candidate-command-output.log`: full expanded commands/build/health/test/failure/teardown output.
- `base-isolated.json`, `candidate-isolated.json`, `base-default-fixtures.json`, `candidate-default-fixtures.json`: unabridged assertion reports.
- `comparison-output.log`, `identities-output.log`.
- `sandbox-base.evidence.WvwE1P/`, `sandbox-candidate.evidence.A38OKR/`: canonical retained sanitized runtime diagnostics.

Both canonical `down` calls succeeded. `test ! -e Q/sandbox-base && test ! -e Q/sandbox-candidate` exit0. `(lsof -nP -iTCP:4198 -iTCP:4197 -iTCP:4199 -sTCP:LISTEN || test "$?" = 1)` exit0/no listeners. Approved fixture and originalQPbK6i log preserved. No active owned sandbox remains; no other worktree or live services restarted/touched.

Engine/launcher-enforced constraints: explicit safe fixture validation, free/owned isolated ports, Keychain shim, process ownership checks and teardown. Verifier discipline (not runtime guarantees): revision/dependency equality, subprocess-only fixture normalization, exclusions, exact failure comparison, and honest NOT RUN claims.

Smallest next action: parent may accept this **focused failure qualification** and route separately for any full API gate or real desktop/live acceptance permitted by AJ. Do not label the full local gate PASS, infer a full baseline from these four files, edit tests/guards to hide failures, or merge/deploy from this report.
