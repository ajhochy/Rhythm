---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: null
issues: [NOTIFY-HERMES]
status: READY_FOR_COORDREGATE_WITH_BOUNDARY_CONTRACT_CONFLICT
tags: [run, rhythm]
---

## Scope / approvals

Explicit ScopedCOORDINATORAUTHORITYrepair specialist handoff; acceptance-contract
loaded first, coding-agent second. Same exclusive shipping worktree at
`c74f4392a6df61979fbe33e620a0077ebb6e0b4b`. Write only notifier, NEW tests and
this dedicated note. Frozen four completion checks, bridge three checks, prior
boundary/live tests and canonical coordinator repository remain unchanged.
Common current bridge authority: structural UNKNOWN denies retained history,
ACK and all new publication/ingest, including SSE per-flush through listRun.
Pending/dispatched/unverified/manual-verification are not structural revocations.
Persisted event rows/IDs/source keys/inbox bytes must remain unchanged on denial.
No new action/question-reply/approval authority, producer/lifecycle table, router
change, peers, shared deps, production/live ports, credentials, providers, installs,
restart, commit/push or destructive cleanup. Own canonical sandbox4998/4997/4999
up/status/down only; peer4898 family untouched. Existing approved fixture four
variables and private runtime/engine retained. Staging/signing artifacts STALE.
Parent independently reruns read-only tests/artifact probes after source freeze.

## Phase 0 — RED complete, frozen contract

NEW `hermes_coordinator_notify_revocation.test.ts` uses actual SQLite/migrations,
canonical root designation/add/reserve/settle and async repositories, existing
card plus opaque child question. Five parameterized checks first assert canonical
outcome UNKNOWN after child owner/project/parent, delegation target and root SDK
revocation. Soft assertions separately prove list denial, accepted/visible ACK
denial (V2 and V1), no new ingest/append/card publication metadata, byte-identical
event/origin snapshots, and denial/identity preservation after SQLite reopen.
Four root/foreign-runtime adversarial cases and authorized unverified positive.
Mandate: make these checks pass without editing them. Parent is independent verifier.

From apps/api_server, command prefix used for RED and GREEN:
```sh
env -i PATH="/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014/tools/dev/.hermes-shipping-runtime/node/bin:/usr/bin:/bin:/opt/homebrew/bin" HOME=/private/tmp TMPDIR=/private/tmp DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=4997 RHYTHM_MOBILE_GATEWAY_PORT=4999 RHYTHM_OPTIMIZER_MODE=shadow ./node_modules/.bin/vitest run src/__tests__/hermes_coordinator_notify_revocation.test.ts --no-file-parallelism
```
Before any source edits: exit1, **8 failed / 2 passed**, duration3.92s.
All five required revocations fail expected list/ACK-denial assertions, canonical
UNKNOWN controls pass. Root project/parent/runtime fail too; root-owner denial
and valid-unverified positive already pass. Output retained by tool at
`/Users/ajhochhalter/.local/share/opencode/tool-output/tool_13bd99062001rpLdGx55OIuhSA`.
Observed old ACK transitions pending→visible and extra progress/error rows.

## Phase 1 — consolidated bounded review

GitNexus impact HermesNotifyService upstream CALLS/IMPORTS/HAS_METHOD/HAS_PROPERTY:
Target not found, risk UNKNOWN (not zero impact). Manual entire notifier review:
bridgeSource/grant validation → bridgeOrigin → listRun/ackRun; originAuthority →
append/ingest/card publication; syncBridges; legacy authority/fallback/ACK;
Recipe recovery/runAuthority unchanged. Canonical repository exact join reviewed
(listGoalDelegationOutcomes1050–1103), no edits. Durable control's stored owner /
project / root tuple is the scope, not moved root's current-project empty fallback.
Known dispatched UNKNOWN denies whole run; valid pending goals have no unknown
dispatched membership. HTTP/SSE router reviewed, every flush calls listRun already.
External callers: server initialize/start/stop; delegation coordinator trusted
pre-first-engine bindBridge; authenticated origin/read/ACK/stream routes; approval
pending event listener. No API handler edit required. Risk is trust-boundary
disclosure and silent V1/Recipe fallback after bridge revocation; common guard
plus unchanged-source frozen contracts and live sandbox exercise mitigate it.

## Files / Checks / Notes

Changed only:
- `apps/api_server/src/services/hermes_notify_service.ts`
- NEW `apps/api_server/src/__tests__/hermes_coordinator_notify_revocation.test.ts`
- NEW `apps/api_server/src/__tests__/hermes_coordinator_revocation_live.test.ts`
- This note.

## Phase 2 — common guard / actual results

One source implementation attempt; no second repair needed for the new contract.
`bridgeOrigin` now requires authorized current coordinator state, so existing
read/ACK/ingest/card/sync callers all share the same revocation check. New
`currentRunAuthority` chooses bridge versus Recipe by declared identity, never
nullish-falls back after failed bridge authority. `authority` rejects bridge
identities; V1 ACK rejects them even when grant validation fails. `store` also
revalidates bridge origins BEFORE source-key dedup/insert, while Recipe store
behavior remains unchanged (no new attempt/session requirement on Recipe
history recovery). No origin/event schema, lifecycle or provenance table added.

The canonical root control JSON's existing stored session/owner/project tuple
is used before the repository exact scope join. A moved project is rejected,
not re-queried under its new project/default empty scope. Canonical dispatched
outcome UNKNOWN or missing coverage denies the whole run; all declared commands
must still match the current root SDK and workflow-orchestrator target. Captured
goals with no delegated child remain authorized. Declared descendant edges with
unprovable parent/owner/project or bounded incomplete coverage also deny, rather
than being silently ignored. No execution classifier rewrite. Valid dispatched /
returned_result_unverified still returns authorized sanitized history and ACK.

### Source checks

Using the exact Phase0 env prefix, attempt1:
```sh
./node_modules/.bin/vitest run src/__tests__/hermes_coordinator_notify_revocation.test.ts src/__tests__/hermes_coordinator_notify_contract.test.ts src/__tests__/hermes_source_contract.test.ts --no-file-parallelism
```
Exit0 **17 passed**, duration4.86s: NEW10 (five required revocations + four
adversarial roots/runtime + authorized unverified positive), frozen4 and bridge3.
Frozen acceptance file was not changed after RED. Each of the five has UNKNOWN
control, child card + opaque question pre-revocation positive, V2/V1 denial and
byte-identical retained event/origin history after ingest/replay/reopen.

Issue-level command, same exact Phase0 env prefix:
```sh
./node_modules/.bin/vitest run src/__tests__/hermes_coordinator_notify_contract.test.ts src/__tests__/hermes_coordinator_notify_boundaries.test.ts src/__tests__/hermes_coordinator_notify_live.test.ts src/__tests__/hermes_source_contract.test.ts src/__tests__/hermes_approvals.test.ts src/__tests__/coordinator_conversation_repository.test.ts src/__tests__/coordinator_workflow_runs.test.ts src/__tests__/hermes_coordinator_notify_revocation.test.ts --no-file-parallelism
```
Exit1 **40 passed / 3 failed / 1 skipped**, duration10.62s. Original33 are
**30 passed / 3 failed**, not a claimed33/33. The unchanged prior boundary file's
`rejects foreign card lineage: owner`, `: project`, `: delegation` now fail with:
```
AppError: Workflow not found
  Function.notFound src/errors/app_error.ts:12:12
  HermesNotifyService.listRun src/services/hermes_notify_service.ts:220:36
  events src/__tests__/hermes_coordinator_notify_boundaries.test.ts:57:63
  src/__tests__/hermes_coordinator_notify_boundaries.test.ts:75:12
```
Those older checks require a progress array after structural UNKNOWN; current
dispatch explicitly allows whole-run404. They were NOT edited, weakened or
hidden. Parent must reconcile the independently frozen older expectations with
the approved whole-run-denial contract. Other boundaries5 pass, including
ordinary execution-only completion and known-question withholding, legitimate
descendants/spoof exclusion, reopen and question-ID dedup. Approval5,
conversation6, workflow7 pass. Original live1 skipped in this unit run only.

Strict check run twice, exit0/no output, including after NEW live test additions:
```sh
env -i PATH="/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014/tools/dev/.hermes-shipping-runtime/node/bin:/usr/bin:/bin:/opt/homebrew/bin" HOME=/private/tmp TMPDIR=/private/tmp DB_CLIENT=sqlite ./node_modules/.bin/tsc -p tsconfig.json --noEmit
```

### Canonical build/live commands

From shipping root, exact identical env for `up`, `status`, `down`:
```sh
env RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-coordinator-notify-20261014-fixture RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-coordinator-notify-20261014-fixture/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-coordinator-notify-20261014-fixture/coordinator-opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/hermes-coordinator-notify-20261014-sandbox RHYTHM_SANDBOX_API_PORT=4998 RHYTHM_SANDBOX_ENGINE_PORT=4997 RHYTHM_SANDBOX_GATEWAY_PORT=4999 DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow RHYTHM_SANDBOX_NODE_BIN="$PWD/tools/dev/.hermes-shipping-runtime/node/bin/node" RHYTHM_SANDBOX_ENGINE_DIR="$PWD/tools/dev/.hermes-shipping-runtime" RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1 bash tools/dev/sandbox.sh up
```
Exit0. Strict API build/postbuild and existing MCP noCheck build pass; initial
health connection refusal then Sandbox ready. Existing sanitized read-only0400
fixture inputs reused, private unchanged engine used with skip-engine-build1
as explicitly assigned. No manual API launch/restart or peer sandbox operation.

From apps/api_server:
```sh
env -i PATH="/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014/tools/dev/.hermes-shipping-runtime/node/bin:/usr/bin:/bin:/opt/homebrew/bin" HOME=/private/tmp/hermes-coordinator-notify-20261014-sandbox/home TMPDIR=/private/tmp/hermes-coordinator-notify-20261014-sandbox/tmp DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=4997 RHYTHM_MOBILE_GATEWAY_PORT=4999 RHYTHM_OPTIMIZER_MODE=shadow RHYTHM_LIVE_E2E=1 RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-coordinator-notify-20261014-fixture RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-coordinator-notify-20261014-fixture/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-coordinator-notify-20261014-fixture/coordinator-opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/hermes-coordinator-notify-20261014-sandbox ./node_modules/.bin/vitest run src/__tests__/hermes_coordinator_notify_live.test.ts src/__tests__/hermes_coordinator_revocation_live.test.ts --no-file-parallelism
```
First exit0 **2 passed**, duration961ms. Final with additional ordinary-noGoals,
captured-pending and expired-card positive controls: exit0 **2 passed**, duration943ms.
Unchanged original live1 passed93ms. NEW live1 passed364ms, exercises all FIVE
revocations through real built HTTP API after actual engine root/child metadata
creation, canonical designation/add/reserve/settle, existing child card and a
synthetic retained opaque question journal fixture. No notifier import/mock.
For each group, output:
```
revocation <child-owner|child-project|child-parent|delegation-target|root-sdk>: canonical UNKNOWN, HTTP list/SSE/ACK404, journal unchanged
```
Initial list200 returns exact card ID + opaque question. Revoked list404 leaks
neither reference; V2 accepted/visible ACK and V1 visible ACK404 for both events;
SSE admission404; V1 list hides bridge history; exact journal rows remain unchanged.
Not a provider execution/verification or real question-production test. Existing
live test supplies real engine abort/idle lifecycle. Active pre-existing SSE
connection per-flush is reviewed through unchanged listRun caller, not claimed as
a live timed stream test. SQLite reopen proof is in NEW unmocked unit contract,
not an unauthorized full API restart. No new approval/question action grant.

### Artifact identity and teardown

At `status`: API/gateway PID51485 on4998/4999; enginePID51610 on4997. Captured
`shasum -a 256` before teardown:
| File | SHA256 |
| --- | --- |
| notifier source | `3f8be42e4ff81aa4f18274d01e5c7b28661fcc322bae21ffb7d225f111671ef7` |
| compiled notifier | `0b4e898f9569cab6f58629be10c915daad48a7d38036b8ce52b612aae0ec05c4` |
| canonical coordinator repository, unchanged | `d9390b909ed68383c147b8350eb78c1824312a16efcf42d3c584dbd5dbd8e64a` |
| frozen completion4, unchanged | `d0976edc12fea5d5b122e55d111e2f1d0fa7d03a3e26419ce2da5a447fb8cc4d` |
| frozen bridge3, unchanged | `7d14894f84be4bf05df92af8d8fe388cd1f4ecf7c3c35a3eb6ebda95052a9806` |
| prior boundaries8, unchanged | `45d7bc7cbcf4f365efc46cd49b036432af7db9eb6819daa31671143cc19a3d58` |
| original live1, unchanged | `f1051508d01ef711992ffffc0bdc73b6de60cbba006da8645b2fec7afafd8274` |
| NEW revocation10 frozen after RED | `a08c6f48a7a4d7d6d5de8a2225d1c19881617699df7d6b36f4e85de02c0451ed` |
| NEW live5-groups check | `e9e43145e27f00f32ba1aeefe3a3c0cc54b34a609114226a0148ebe23c992f14` |
| unchanged private engine | `d60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072` |

Same sandbox env, `status` then hashes then `down` then `git diff --check`: exit0.
Canonical owned teardown completed; sanitized diagnostics retained at
`/private/tmp/hermes-coordinator-notify-20261014-sandbox.evidence.ss7k0N`.
No separate destructive cleanup. Shared compiled output was rebuilt via canonical
sandbox only; no final cross-peer freeze claimed. Parent must rebuild/rerun both
source/tools after all specialist work ends.

## Handoff

**READY_FOR_COORDREGATE / READY_FOR_VERIFICATION for common read/ACK five-group
revocation only, with the three exact older boundary-contract conflicts above.**
Not all issue checks green and not shipping-ready. Parent independent e9cf probe
must rerun against final compiled artifact; NEW frozen contract is runnable
without changing source. Existing Recipe implementation/gates were left unchanged;
no newly added dedicated Recipe-reset/no-currentAttempt positive was executed
in this specialist stage (parent's existing Recipe recovery contracts retained).
No new lifecycle/provenance producer, no success claim for coding verification.
No commits/push; no staged app validity, signing/notarization/restart permission.
