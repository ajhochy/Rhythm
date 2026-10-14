---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: BLOCKED_NATIVE_INTEGRATION
tags: [run, rhythm]
---

# Coordinated receiver source artifact

## Scope and approvals

Explicit parent specialist handoff; acceptance-contract loaded first then coding-agent.
Assigned clean worktree HEAD ee914fce476de2190efdead7c3bc2ce8f59c19ce verified.
Read AGENTS first, project-state/current-plan, deployed activation contract/run,
V2/subscriber, native boundary and prior atomic artifact. Historical 109+6 proof
remains Rhythm architecture only. Parent independently verifies read-only artifacts.

AJ approves source implementation, exact private-relay HTTP4001 opt-in and parent
coordinated installation with ONE planned same-container restart AFTER separate-copy
native/DOM gate. This agent does not activate/install/restart, SSH, read credentials,
change hosts/relay/ports/config, touch installed Hermes/global repositories, commit,
push or dispatch peers. No live provider, current chat, cards, approvals, production
DB/migration, shared dependency install or destructive cleanup. Parent owns trusted
source transfer and host execution. No second/rollback restart authorization inferred.

Permitted writes: tools/dev/hermes_webui_receiver/, new focused contract file,
subscriber and its two existing 4898 fixture callers (explicit fixture opt-in only),
this run. No other application or prior proof changes.

## Phase 0

Frozen command (cwd tools/dev): `python3 -B -m unittest test_hermes_webui_receiver -v`.
Initial run: 8 tests, 7 FAIL, 1 PASS. Capability-existence failures are structural
coverage only, NOT behavioral RED or native proof. Existing redirect/proxy invariant
already passed, intentionally retained as regression coverage.
Added actual behavioral RED before implementation:
`python3 -B -m unittest test_hermes_webui_receiver.TransportContract.test_constructor_denies_unopted_http_before_any_request -v`.
Observed 1 test FAIL: `AssertionError: ValueError not raised`; actual constructor
admitted unopted http://127.0.0.1:4001. No request occurred. Acceptance checks now
frozen: implement their stated durable state and transport outcomes without weakening.
No waiver for missing native/DOM acceptance; that gate remains NOTRUN without source.

## Phase 1

GitNexus upstream main/Subscriber/request at subscriber and main at consumer-live
returned Target not found, risk UNKNOWN. Counts0 are NOT evidence of no dependents.
Literal caller inspection found CLI, test_hermes_notify_repair and consumer_live;
read both entire callers. New receiver paths unindexed/additive. No existing backend
handler changed. Intended integration surface reviewed using pinned deployed evidence:
routes/auth/profile/start turn/start run, JSON payload/shrink guard, journal,
background lifetime and existing renderer/reopen. Full application copy absent.

Risks: remote IDs never create local links; owner/profile transfer revokes retries;
scoped bearer must not expand WebUI general auth; receipt commit is separate from
native JSON/journal commit. Durable intent alone is not exactly-once turn execution.
Native correlation/fenced journal recovery must be installed and tested before drain
can safely launch. Expired ambiguous launches stay launching, no blind duplicates.
Saved/render evidence must be exact event/turn/hash and native completed, not HTTP200.
Provider injection belongs only to offline test setup; production persisted provider
and all native profile/auth/CSRF checks unchanged. Installer fail-closed until source,
host facility and independent gate metadata supplied. Approval unchanged, no renewed
scope question needed. These are evidence/integration blockers, not host denials.

## Phase 2 — actual artifacts and limits

Implemented standalone stdlib receiver SQLite links/inbox/fullidentity hash,
scoped existing-credential SHA256 authorization, durable committed turn intent,
pending/launch lease/busy state, duplicate409 exception, immutable/revoked links,
receive/status handler target and owned lifecycle background drain. Ambiguous
launch stays quarantined; no expiry-based duplicate. No public listener. Event
text uses existing bounded fixed-label validator; reference is never action authority.
All client event states ingest as accepted, not visible. No public mark-visible API.

The in-process `native` wiring is intentionally UNIMPLEMENTED until full deployed
copy: current membership registry, native journal start_once fencing, actual
routes.start_session_turn invocation/correlation and independently saved/DOM
observation. Module is not a working native adapter and cannot presently qualify
exactly-once native launch or visible receipts. No fake native implementation was
made or tested. Registered production route changes are only hash-pinned integration
instructions, not actual application edits. Production provider unchanged.

Implemented subscriber exact byte-pinned private relay opt-in for HTTP127.0.0.1:4001
(--allow-private-relay), existing isolated4898 opt-in also exact, with constructor
enforcement; other HTTP denied. NoRedirect/empty ProxyHandler unchanged. Existing
two4898 fixture callers gain explicit loopback_test=True; assertions unchanged.

Added source_guard.json with nine parent-provided source hashes, exact image,
unknown mounted revision, one complete sanitized tracked-source-copy request,
minimal native patch positions/guard obligations and required native gate cases.
This is the single technical source request, not an additional permission request.

Added host_job.py: incomplete manifests fail closed; independent gate/patch set
binding, exact container/image/config preflight (inspect values never printed),
host mount/source/artifact hash checks, protected artifact references, backup,
preserved mode/owner, per-file atomic replace+fsync, persistent restart intent,
ONE same-container restart, bounded parent-attested readiness, source restoration
on failure without automatic second restart. Host facility must be explicitly
attested available/launched on HOST by parent. No facility availability is invented.
Job is **NOTRUN** and **not qualified for installation**: only its negative manifest
validation is tested. No complete manifest/native patch exists; source_guard.json
cannot enable installation. Rollback runtime may require a separately approved
restart. Multi-file atomicity/process crash/real readiness and actual host execution
are not tested or claimed. Parent must review/prove these before using the job.

One code-review repair round (within max2): explicit missing/nonstring auth denial
before optional internal authorization path; fsync backup directories/restart marker.
No failing assertion altered. No further repair loop undertaken.

### Files

Modified:
- tools/dev/hermes_notify_subscriber.py
- tools/dev/test_hermes_notify_repair.py (fixture constructor opt-in only)
- tools/dev/hermes_notify_consumer_live.py (fixture constructor opt-in only)

Added:
- tools/dev/test_hermes_webui_receiver.py
- tools/dev/hermes_webui_receiver/__init__.py
- tools/dev/hermes_webui_receiver/receiver.py
- tools/dev/hermes_webui_receiver/host_job.py
- tools/dev/hermes_webui_receiver/test_host_job.py
- tools/dev/hermes_webui_receiver/source_guard.json
- tools/dev/hermes_webui_receiver/INTEGRATION.md
- this run

### Commands and observed output

All test commands cwd assigned tools/dev; -B avoids pycache. Unit tests use disposable
SQLite directories, no installed data/config/auth, no network, server, provider or
Rhythm API/engine launch. Existing legacy tests include pre-existing injected
transport/fake transcript fixtures, NOT native evidence; no new native fake sink.

1. Initial acceptance command: 8 tests in0.010s, FAILED(failures=7); structural
   existence failures recorded above, not native behavioral RED.
2. Constructor behavioral RED named above: 1 test in0.007s, FAILED(failures=1),
   actual unopted HTTP admitted. Establishes transport behavioral defect.
3. After initial implementation:
   `python3 -B -m unittest test_hermes_webui_receiver test_hermes_notify_subscriber test_hermes_notify_repair test_hermes_notify_workflows test_hermes_notify_run_origin -v`
   observed `Ran 47 tests in 0.190s / OK`.
4. Before host implementation:
   `python3 -B -m unittest hermes_webui_receiver.test_host_job -v`
   observed 1 test FAIL missing guarded host module. Structural RED only.
5. Final fixed contract plus focused regression:
   `python3 -B -m unittest test_hermes_webui_receiver hermes_webui_receiver.test_host_job test_hermes_notify_subscriber test_hermes_notify_repair test_hermes_notify_workflows test_hermes_notify_run_origin -v`
   observed `Ran 48 tests in 0.195s / OK`. These are test executions, include repeated
   inherited legacy checks; NOT48 unique cases or original109+6 gate rerun. New
   receiver/transport9 + host negative schema1 pass. No native launch/DOM tests run.
6. Cwd worktree root:
   `git diff --check && git diff --stat && git status --short && shasum -a 256 tools/dev/hermes_notify_subscriber.py tools/dev/test_hermes_webui_receiver.py tools/dev/hermes_webui_receiver/receiver.py tools/dev/hermes_webui_receiver/host_job.py tools/dev/hermes_webui_receiver/source_guard.json tools/dev/hermes_webui_receiver/INTEGRATION.md tools/dev/hermes_webui_receiver/test_host_job.py docs/ai/contracts/hermes-event-notify-v2.md && git diff --quiet HEAD -- apps docs/ai/contracts && git rev-parse HEAD`
   exited0; tracked whitespace clean (does not cover added files); only listed scope
   modified/untracked. All apps/canonical contracts preserved; HEAD unchanged.

| Artifact | SHA256 |
|---|---|
| subscriber | 994caf51e51d7467c54684cd0b556cdde2b3245f4523ea6cbe5ea28e68fc71cc |
| receiver contract | 4b4854381a4e102fa1cce86e7af9d49eac049b3b4e25c11ce58361205310070c |
| receiver.py | c1f6230a8bd861b87b2eea0da6cce438cbf9a167e19cccf65c85c7f8ad1f013f |
| host_job.py | a71ab54ef4eff15af3e55bd0b785ca58868ad703f636054da1678e9a28943556 |
| source_guard.json | 2496127bafcc7c83b7d9084581fd227e264b9c458b155a176d10458e541e4d1e |
| INTEGRATION.md | 2f1fc10a327de1d0085029e2a926b03735e18525f2935a35444bbac078ca5ef8 |
| host negative contract | 5e8d3ef73a417f3c6d57919f7c75d49676bf26012d35437350383351740fc745 |
| preserved canonical V2 | 61d623be80c3228439a436738da534820d4d1c3b08dfdc93a2df10ab3a7ed5fe |

### Handoff / unrun gates

Offline source/state milestone available for parent independent verification with
read-only source access and disposable unit DBs. Full feature **BLOCKED**, not
READY_FOR_VERIFICATION: complete sanitized deployed copy, native correlation patch,
actual native HTTP+frontend DOM separate-copy provider-seam gate and host job safety
validation still required. Parent gets copy using its trusted connection and owns
transfer/host execution. No endless excerpt requests; exact need in source_guard.json.
No live current chat until separate fixture passes. Native ingest/wake/render/busy/
reopen/crash/ownership all NOTRUN; host install/restart/rollback NOTRUN. Test provider
only injected in copied TEST SETUP, no production flag/route. Existing operator
configuration remains untouched. No creds read, SSH, env/config/network/ports/relay
changes, live writes, commits or pushes. Unchanged approvals/exclusions carry forward.

Any future Rhythm checks retain canonical sandbox.sh up/status/down,0400 sanitized
fixtures and four existing fixed paths:
RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-event-notify-20261012-fixture;
RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-event-notify-20261012-fixture/rhythm.db;
RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-event-notify-20261012-fixture/notifier-opencode.json;
RHYTHM_SANDBOX_DIR=/private/tmp/hermes-event-notify-20261012-sandbox;
owned ports4898/4897/4899. This run starts none, no hand api_server/live4001/4096/4198.
