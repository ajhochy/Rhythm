---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: BLOCKED
tags: [run, rhythm]
---

# Deployed evidence mapping / non-restarting activation blocker

## Phase 0 — fixed scope and acceptance disposition

Loaded acceptance-contract first, then coding-agent. Explicit parent handoff is
the workflow entry gate; no orchestrator or peer dispatch. Initial status was
clean; HEAD `5165796982ee281da72726fcda6a957671bf259d`, branch above. Parent reports
PR1616's three CI checks green; not queried or independently reverified here.
Read AGENTS.md first, project-state/current-plan, canonical V2, subscriber, native
boundary, full coordinator/native and durable-run receipts, and native atomic
prototype/contract. Historical 109 + 6 independent architecture proof is preserved.

WAIVED: failing behavioral acceptance test for non-behavioral documentation-only
mapping and exact blocker report. No code, adapter, assertions or protocol runtime
is implemented. This does not waive native ingest/wake/render/busy/reopen/dedup
acceptance; all remain BLOCKED/NOTRUN. No RED/GREEN test result is claimed.

Fixed deliverable: map every primary V2/subscriber requirement to parent-supplied
deployed evidence, distinguish source identification from behavioral proof, and
return the exact blocked activation step with smallest separately approvable
change instead of inventing an activation command. Independent parent verifier
can inspect both added Markdown artifacts read-only, validate hashes and mapping,
and obtain the missing source/approval without changing the candidate.

Permitted writes narrowed to this run and
`docs/ai/contracts/hermes-event-notify-deployed-activation.md`. All application,
tools/dev, canonical V2/subscriber and existing proof files remain untouched.
Read-only local operations only: no SSH (parent inspection reused), network,
chat/API/relay request, DB read/write, credentials, runtime imports, live/history
writes, activation, environment/config change, ports/listeners, restart/recreate,
deploy, migration, real cards, extra login, Tailscale, shared install, destructive
cleanup, commit or push. No approval inferred from host bypass. Parent retains
ownership of integration/commit and any later activation authorization.

## Phase 1 — bounded impact review

GitNexus `gitnexus_impact({target:'Subscriber',direction:'upstream',
file_path:'tools/dev/hermes_notify_subscriber.py',repo:'Rhythm',summaryOnly:true})`
returned `Target 'Subscriber' not found`, risk UNKNOWN. No indexed direct callers
or affected processes established; not zero blast radius. No HIGH/CRITICAL rating.
No existing symbol or API handler is edited, so no handler impact gate is needed.
Whole intended write surface is the two additive Markdown files above.

Consolidated consequential risks: wrong-owner remote-ID adoption; confusing
loopback reachability with upstream ownership/owner-endpoint availability;
in-memory wake dictionaries with durable receipts; storage with actual render;
cross-process import with running-server wake; real-provider execution through an
unproved offline injection; and source patch with hot-loading. The contract maps
each to a fail-closed gate. No deployable adapter is justified by the available
snippets. An excerpt fixture could check text, not integrate deployed Hermes.

## Phase 2 — artifacts / checks / handoff

Completed the additive activation contract: 18 canonical V2/subscriber obligation
rows, 8 native/user obligation rows, deployed source hashes, exact Steps A/B,
bounded source requests and separately approvable source-change proposals,
protected file-reference placeholders, future observable fixture cases and
non-destructive rollback. These are documentation/specification, not executable
preflight or protocol fixtures. No adapter/placeholder sink is shipped or claimed.

Exact blocked step: no supplied supported running-WebUI durable V2 event receive
capability or proved offline runner injection. POST/chat/start is a real turn
entrypoint, not eventId-atomic ingress. No existing live extension/reload hook
proved; patching source or docker-exec import cannot wake the running server.
The existing HTTP4001 origin independently fails current subscriber transport
policy. Parent must obtain the bounded source/ownership attestations specified
in the contract; absent ingress, separately approve native receive/status source
work; absent hook, separately resolve non-restart installation constraint. The
exact pinned protected-registry HTTP4001 opt-in is a separate **proposal only**,
not approved, implemented or tested. Do not relax global HTTP or change relay.

### Commands / actual output

All commands below used assigned worktree cwd. Local git/hashing/static checks
only, no Rhythm runtime/tests or network. Initial:

```sh
git status --short && git rev-parse HEAD && git branch --show-current
```

Output: empty short status; `5165796982ee281da72726fcda6a957671bf259d`;
`feat/hermes-event-notify-20261012`.

First static attempt was the following chain:

```sh
git diff --check && git diff --no-index --check /dev/null docs/ai/contracts/hermes-event-notify-deployed-activation.md && git diff --no-index --check /dev/null docs/ai/runs/2026-10-13-hermes-deployed-activation-blocker.md && git diff --quiet HEAD -- apps tools/dev docs/ai/contracts/hermes-event-notify-v2.md docs/ai/runs/2026-10-13-hermes-durable-run-origin.md && shasum -a 256 docs/ai/contracts/hermes-event-notify-v2.md tools/dev/hermes_notify_subscriber.py apps/api_server/src/services/hermes_notify_service.ts apps/api_server/src/routes/hermes_notify_routes.ts docs/ai/contracts/hermes-event-notify-deployed-activation.md && git status --short && git rev-parse HEAD
```

No output: stopped at no-index exit1 (added-file differences); not an aggregate
PASS. No artifact repair was made. Individual exit capture rerun:

```sh
git diff --check; printf 'TRACKED_WHITESPACE=%s\n' "$?"
git diff --no-index --check /dev/null docs/ai/contracts/hermes-event-notify-deployed-activation.md; printf 'NEW_CONTRACT_DIFFCHECK=%s\n' "$?"
git diff --no-index --check /dev/null docs/ai/runs/2026-10-13-hermes-deployed-activation-blocker.md; printf 'NEW_RUN_DIFFCHECK=%s\n' "$?"
git diff --quiet HEAD -- apps tools/dev docs/ai/contracts/hermes-event-notify-v2.md docs/ai/runs/2026-10-13-hermes-durable-run-origin.md; printf 'PRESERVED_SOURCE=%s\n' "$?"
shasum -a 256 docs/ai/contracts/hermes-event-notify-v2.md tools/dev/hermes_notify_subscriber.py apps/api_server/src/services/hermes_notify_service.ts apps/api_server/src/routes/hermes_notify_routes.ts docs/ai/contracts/hermes-event-notify-deployed-activation.md
git status --short; git rev-parse HEAD
```

Observed `TRACKED_WHITESPACE=0`, `NEW_CONTRACT_DIFFCHECK=1`,
`NEW_RUN_DIFFCHECK=1`, `PRESERVED_SOURCE=0`. Neither no-index check printed a
whitespace diagnostic; exit1 denotes added-file differences, not a behavioral
test. Final status lists only the two added Markdown paths. HEAD unchanged.

| File | Observed SHA256 |
|---|---|
| docs/ai/contracts/hermes-event-notify-v2.md | `61d623be80c3228439a436738da534820d4d1c3b08dfdc93a2df10ab3a7ed5fe` |
| tools/dev/hermes_notify_subscriber.py | `273d8398312391ecb3189cb11d951bdac512bf00624286cf46df9811ba134cca` |
| apps/api_server/src/services/hermes_notify_service.ts | `6b49cc995e8267b143a742d4081f50e624923a70a08e63089de562d8c1735b77` |
| apps/api_server/src/routes/hermes_notify_routes.ts | `cba73dd09efa92b8af329f0fbf77bad605250c9469881c1ec71ccf95f028cf27` |
| docs/ai/contracts/hermes-event-notify-deployed-activation.md | `326b74b07691b264b8fe486e2944f82b7f90aeb0d328c735d44563ff46ca06bb` |

The dedicated run is hashed after its final edit and returned in handoff (no
self-referential hash embedded). Parent independently verifies the contract's
mapping and blockers read-only. Canonical 109+6 proof/test sources are unchanged.

### Current acceptance / stop

| Gate | Result this run |
|---|---|
| Deployed native turn / renderer / saved-read source | Parent SOURCE-IDENTIFIED, no independent runtime proof |
| Executable preflight/protocol fixture or native adapter | NOT DEVELOPED/NOT TESTED; explicit missing-ingress/offline-source blocked branch |
| Exact non-restarting activation command | BLOCKED Steps A/B; none invented or executed |
| Durable native ingestion / accepted ACK | BLOCKED / NOTRUN |
| Original chat wake | BLOCKED / NOTRUN |
| Actual visible WebUI / visible ACK | BLOCKED / NOTRUN |
| Native busy retention / eventId dedup | BLOCKED / NOTRUN |
| Browser-closed / reopen duplicate recovery | BLOCKED / NOTRUN |
| Historical independent 109+6 Rhythm architecture | Preserved, not rerun and not deployed acceptance |
| New behavioral tests / live checks | NOTRUN; no test outputs claimed |

Activation is BLOCKED, not READY_FOR_VERIFICATION of the feature. The mapping is
available for independent documentation review. Implementation/repair attempts0;
two static-check command attempts, no source repair. No sandbox/runtime/process,
env/config/ports or DB/history was created or modified. No SSH, network/relay
request, credential access, extra login, activation, restart/recreate, deploy,
cards, commit, push or destructive cleanup. This is compatibility/evidence scope,
not a host permission denial. Approved unchanged read-only mapping scope and all
exclusions above carry into handoff; no repeated approval needed for that scope.
