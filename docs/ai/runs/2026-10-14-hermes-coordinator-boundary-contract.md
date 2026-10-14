---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: null
issues: [NOTIFY-HERMES]
status: READY_COORDINDEPENDENTGATE
tags: [run, rhythm]
---

## Files / scope

Explicit parent TESTONLY handoff authorizes stronger strict denial, not production repair.
Write only `apps/api_server/src/__tests__/hermes_coordinator_notify_boundaries.test.ts`
and this new note. Shipping HEAD c74f4392a6df61979fbe33e620a0077ebb6e0b4b;
canonical checkout HEAD 1870574248c4f48883fd828263615cff6e9e5871 (not edited).
Source owner bfe4 finished; no competing source writer. CLI2453/tools4898 remain
outside this scope. No source/backend/product/release edits, shared dependency
install, providers/native execution, real cards/actions, live4001/4096, Pi/SSH,
credentials, app install/restart, deployment, destructive cleanup, commit or push.
Own canonical sandbox4998/4997/4999 only. Full shipping artifact remains STALE;
parent must rerun source/tools against final freeze after all workers end.

## Phase 0 — RED complete

Loaded acceptance-contract first, coding-agent second; read AGENTS, project-state,
current-plan, regression registry and nearest revocation-round1 note before code.
This is explicit resolution of the older test contract, not a waiver of authority.
Acceptance: same four lineage cases. Owner/project/delegation canonical UNKNOWN
must deny entire retained run/history with exact AppError404 NOT_FOUND and deny
accepted/visible V2 ACK and V1 ACK using pre-revocation event IDs; no journal or
DB-byte mutation, raw private/reference disclosure, late foreign-card publication
or approval consumption. Undeclared spoofed sibling leaves declared authority
valid: original no-completion/no-card and verification-pending progress assertions
stay intact. All other identity/cursor/auth/model-text assertions remain intact.
Frozen completion4/bridge3/revocation10 and both live tests are independent checks,
not editable acceptance targets. Parent independently reruns them without editing
the resulting source; this specialist does not self-certify shipping readiness.

RED command from shipping `apps/api_server` (also GREEN command):
```sh
env -i PATH="/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014/tools/dev/.hermes-shipping-runtime/node/bin:/usr/bin:/bin:/opt/homebrew/bin" HOME=/private/tmp TMPDIR=/private/tmp DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=4997 RHYTHM_MOBILE_GATEWAY_PORT=4999 RHYTHM_OPTIMIZER_MODE=shadow ./node_modules/.bin/vitest run src/__tests__/hermes_coordinator_notify_contract.test.ts src/__tests__/hermes_coordinator_notify_boundaries.test.ts src/__tests__/hermes_coordinator_notify_live.test.ts src/__tests__/hermes_source_contract.test.ts src/__tests__/hermes_approvals.test.ts src/__tests__/coordinator_conversation_repository.test.ts src/__tests__/coordinator_workflow_runs.test.ts src/__tests__/hermes_coordinator_notify_revocation.test.ts --no-file-parallelism
```
Before repair: exit1, 40 passed / 3 failed / 1 skipped, duration10.41s.
The three exact `rejects foreign card lineage: owner|project|delegation` failures
are AppError Workflow not found at listRun220 / boundary75, because older tests
expected progress arrays after structural UNKNOWN. Other checks pass. No artificial
failing assertion or source mutation was introduced; the assigned work is to repair
this already executable failing test contract against explicitly superseding criteria.

## Phase 1 — bounded impact review complete

GitNexus upstream impact of `hermes_coordinator_notify_boundaries.test.ts` in
Rhythm with includeTests:true: target not found, risk UNKNOWN. Direct callers and
affected processes are unavailable, not proven zero. Entire boundary file reviewed;
change is confined to the existing four-case callback plus AppError import.
Reviewed full frozen notifier and revocation fixtures: current bridge authority
precedes listRun/ackRun, append/ingest and card projection; V1 excludes bridges.
Exact AppError fields are statusCode404/code NOT_FOUND, not403. Canonical UNKNOWN
is checked via actual repository. Main risk: accidentally suppressing legitimate
pending authority or silently permitting V1 fallback after revocation. Retained
undeclared positive assertions and unchanged source/live revocation contracts cover
those boundaries. Snapshot excludes legitimate source job completion from journal
comparison; full SQLite bytes are captured AFTER fixture mutations, before probes.
No consequential new scope/risk discovered; existing parent approval applies.

## Phase 2 — single contract repair attempt

Conditional preserves original four test count and undeclared assertions. For the
other three, seed authorized progress plus existing child card before mutation;
assert canonical UNKNOWN, exact typed404 for history and ACK, no references/raw text
in error objects, retained journal/origins equality and full SQLite-byte equality.
Late foreign card remains pending/unconsumed; probes cannot publish its reference.
No approval resolve/consume call. Remaining original test bodies unchanged.

### Focused validation — GREEN

Exact Phase0 command rerun after one repair: exit0, **43 passed / 1 skipped**,
duration11.11s, seven source files passing plus original live-gated file skipped.
Boundary8 (same four parameter cases plus four other tests), frozen completion4,
bridge3, revocation10, approvals5, conversation6 and workflow7 pass. No failed
checks hidden, no second repair attempt, no new skip. Source-unit lineage UNKNOWN,
late-card exclusion, pending/unconsumed cards and undeclared positive all pass.
Other original identity/cursor/reopen/auth/model-text assertions retained.
Strict TypeScript exit0/no output:
```sh
env -i PATH="/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014/tools/dev/.hermes-shipping-runtime/node/bin:/usr/bin:/bin:/opt/homebrew/bin" HOME=/private/tmp TMPDIR=/private/tmp DB_CLIENT=sqlite ./node_modules/.bin/tsc -p tsconfig.json --noEmit
```

### Actual compiled HTTP/engine metadata validation

From shipping root, run this exact command separately with ACTION=up, status,
then down (same four fixture variables, private Node/engine, all three ports):
```sh
env RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-coordinator-notify-20261014-fixture RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-coordinator-notify-20261014-fixture/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-coordinator-notify-20261014-fixture/coordinator-opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/hermes-coordinator-notify-20261014-sandbox RHYTHM_SANDBOX_API_PORT=4998 RHYTHM_SANDBOX_ENGINE_PORT=4997 RHYTHM_SANDBOX_GATEWAY_PORT=4999 DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow RHYTHM_SANDBOX_NODE_BIN="$PWD/tools/dev/.hermes-shipping-runtime/node/bin/node" RHYTHM_SANDBOX_ENGINE_DIR="$PWD/tools/dev/.hermes-shipping-runtime" RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1 bash tools/dev/sandbox.sh ACTION
```
Up exit0: API strict build/postbuild and existing MCP noCheck build pass; initial
health connection refusal followed by Sandbox ready. Approved sanitized read-only
fixtures reused; private prebuilt engine retained per assignment. Status exit0:
API/gateway PID15603 on4998/4999, enginePID15769 on4997. Peer4898 untouched.

From shipping apps/api_server, exact live command:
```sh
env -i PATH="/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014/tools/dev/.hermes-shipping-runtime/node/bin:/usr/bin:/bin:/opt/homebrew/bin" HOME=/private/tmp/hermes-coordinator-notify-20261014-sandbox/home TMPDIR=/private/tmp/hermes-coordinator-notify-20261014-sandbox/tmp DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=4997 RHYTHM_MOBILE_GATEWAY_PORT=4999 RHYTHM_OPTIMIZER_MODE=shadow RHYTHM_LIVE_E2E=1 RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-coordinator-notify-20261014-fixture RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-coordinator-notify-20261014-fixture/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-coordinator-notify-20261014-fixture/coordinator-opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/hermes-coordinator-notify-20261014-sandbox ./node_modules/.bin/vitest run src/__tests__/hermes_coordinator_notify_live.test.ts src/__tests__/hermes_coordinator_revocation_live.test.ts --no-file-parallelism
```
Exit0: **2 passed**, duration1.04s. Original live test109ms; revocation live411ms.
Each of child-owner, child-project, child-parent, delegation-target, root-sdk
prints `canonical UNKNOWN, HTTP list/SSE/ACK404, journal unchanged`. Existing
ordinary no-goal and captured/pending positives pass; expired card excluded.
Actual engine session metadata/abort and compiled HTTP notifier exercised, no
provider/native execution or claimed real question producer. Synthetic durable
question row remains a retained-history fixture. No source notifier import/mock
in live tests; source boundary tests use real SQLite and repositories.

### Frozen identities / diff / teardown

`shasum -a 256` before and after source validation confirms these frozen inputs:

| File | SHA256 |
| --- | --- |
| notifier source | `3f8be42e4ff81aa4f18274d01e5c7b28661fcc322bae21ffb7d225f111671ef7` |
| compiled notifier after canonical sandbox build | `0b4e898f9569cab6f58629be10c915daad48a7d38036b8ce52b612aae0ec05c4` |
| canonical coordinator repository | `d9390b909ed68383c147b8350eb78c1824312a16efcf42d3c584dbd5dbd8e64a` |
| frozen completion4 | `d0976edc12fea5d5b122e55d111e2f1d0fa7d03a3e26419ce2da5a447fb8cc4d` |
| frozen bridge3 | `7d14894f84be4bf05df92af8d8fe388cd1f4ecf7c3c35a3eb6ebda95052a9806` |
| frozen revocation10 | `a08c6f48a7a4d7d6d5de8a2225d1c19881617699df7d6b36f4e85de02c0451ed` |
| frozen original live | `f1051508d01ef711992ffffc0bdc73b6de60cbba006da8645b2fec7afafd8274` |
| frozen live5groups | `e9e43145e27f00f32ba1aeefe3a3c0cc54b34a609114226a0148ebe23c992f14` |
| private engine | `d60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072` |
| updated boundary test | `00ce7cb48756405ed0fb525fb68a6337214dfce262cd6143f9dc3078ff4f318e` |

Boundary baseline hash was `45d7bc7cbcf4f365efc46cd49b036432af7db9eb6819daa31671143cc19a3d58`.
Only assigned boundary callback/import and this note edited by this specialist;
tracked dirty `git diff --numstat` is identical to entry baseline (boundary file
was already untracked, so ordinary git diff does not show its delta). Patch adds
typed denial/ACK/snapshot assertions, preserves four cases and other bodies.
`git diff --check` exit0. Shipping/canonical HEADs unchanged. Frozen source/test
hashes match nearest revocation note exactly. Initial exploratory hash command
used nonexistent hermes_coordinator_notify.ts; corrected actual notifier path
hermes_notify_service.ts before any edits, whose hash matched the assigned freeze.

Down exit0 through same canonical env; `Sandbox removed` and sanitized evidence
retained at `/private/tmp/hermes-coordinator-notify-20261014-sandbox.evidence.MCjJgh`.
No separate destructive cleanup, engine restart, live-app action, commit or push.
Canonical build-generated outputs are permitted sandbox validation, not source edits.

## Handoff

**READY_COORDINDEPENDENTGATE / READY_FOR_VERIFICATION for this bounded test-only
contract resolution.** 43 source checks pass, original unit-run live skip is then
exercised in the 2 passing actual live tests. No frozen source hash changed.
Parent independently reruns these commands and source authorization/Recipe/ordinary
bridge-history checks at final worker freeze; no supplemental producer or broader
authority work requested. Full ship artifact remains STALE, not shipping-ready.
