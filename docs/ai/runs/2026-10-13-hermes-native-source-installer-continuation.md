---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: BLOCKED_NATIVE_IMPLEMENTATION_INCOMPLETE
tags: [run, rhythm]
---

# Retained-worktree source retrieval and installer repair

## Scope / approvals carried forward

Explicit coordinated continuation; acceptance-contract loaded FIRST, then coding-agent.
Read AGENTS.md, project-state/current-plan, prior receiver run, INTEGRATION.md,
source_guard.json and canonical V2. HEAD verified and retained:
`ee914fce476de2190efdead7c3bc2ce8f59c19ce`. All prior dirty milestone files preserved.
No orchestrator, peer dispatch, commits, push, merge or destructive cleanup.

Approval includes receiver/native copied-source testing and minimal host-job repair.
NEW read-only strict SSH authorization is used only for exact pi-nas@100.109.210.55
hostname/source/limited container source identity. No known_hosts or keys read/edited,
no bypass. Parent owns independent verifier and actual host execution AFTER actual
native+DOM gate and verified exact-job approval within AJ's ONE planned restart.
Rollback restart retains separate approval. No live current chat, production DB,
provider, credentials, real cards, desktop signatures, relay/Tailscale/ports/env
changes, shared dependency installation, remote writes/install/restart or fixture
chat requests. No new permissions inferred from access success.

Writes this continuation: `tools/dev/hermes_webui_receiver/` and this new run only.
Existing subscriber/consumer/tests and earlier run are not edited by this continuation.

## Phase 0 — actual RED, not source presence

Frozen host command (cwd assigned worktree `tools/dev`):

```sh
python3 -B -m unittest hermes_webui_receiver.test_host_failure_windows -v
```

First setup run returned 13 errors: macOS temp-path symlink was correctly denied.
Resolved the disposable root before any product edit; no security guard/assertion
weakened. Rerun BEFORE implementation: `Ran 4 tests in 0.047s`,
`FAILED (failures=10)`. Actual source bytes differ from original after real
os.replace commits and injected directory fsync/open/close or post-replace error.
Both first-file and partial second-file windows reproduced. Positive fixture
already passed and is retained regression coverage, not a claimed RED.

New actual native entrypoint command:

```sh
python3 -B -m unittest hermes_webui_receiver.test_native_http -v
```

Fixture setup initially failed creating native Session before its directory existed;
then its all-process fence raised RuntimeError during version probing. Corrected
setup mkdir and used OSError for denied effects (native best-effort probe catches
it); copied source to disposable HOME outside repository ancestry. No SUT changed.
Final meaningful RED: `Ran 1 test in 1.867s`, `FAILED (failures=1)`:
`AssertionError: 404 != 200 : { "error": "not found" }`.
Actual copied server.py main lifecycle served HTTP and actual native Session was
persisted. The route, NOT imports/dependencies/SSH, is absent. No native waiver.
The named acceptance assertion remains frozen; make it pass through real native
wiring, not fake receipts. Parent independently reruns it without artifact write
access. This arrival test is NOT the full requested native/DOM acceptance suite.

## Phase 1 — bounded review and source acquisition

GitNexus upstream `run` and `atomic_replace` at
`tools/dev/hermes_webui_receiver/host_job.py`, repo Rhythm: both Target not found,
risk UNKNOWN. Zero graph results do NOT prove no dependents. Literal caller review
found replacement and rollback owned by run(), CLI main(), old negative-schema
test and new disposable-file regression. Read all of host_job.py before editing.
Actual installer file accounting can lose source bytes: consequential safety risk,
tested by real filesystem fault injection, no Docker execution.

Strict connection command (cwd retained worktree root):

```sh
ssh -oBatchMode=yes -oStrictHostKeyChecking=yes -oConnectTimeout=8 pi-nas@100.109.210.55 hostname
```

Observed `pi-nas`. Read root application names only using docker exec Python
Path('/webui').iterdir(); no runtime file contents. One source snapshot command
(cwd tools/dev): `python3 -B -m hermes_webui_receiver.capture_source`.
Exact remote argv/allowlist are durable in capture_source.py; it streams tar over
the same strict SSH, reads source bytes without imports/writes, checks every
original source pin BEFORE publishing snapshot locally. Observed:

```json
{"state":"HASH_PINNED_SOURCE_COPY","files":107,"archiveHash":"8f1110712645ebcb802ce27bdf6ac95c3077af65807fc06c97a39b2f2ee00945"}
```

Includes actual server/lifecycle, api/provider/runner helpers, real static
.js/.css/.html and reviewed package/requirements/pyproject manifests. Excludes
.env/.git/runtime config/data/auth/credentials/live DB/chats/logs/cache and
node_modules. APPLICATION SOURCE api/config.py pin matches; no runtime config
content read. Every copied path/hash is in source_snapshot_manifest.json.
Mounted git revision unavailable; no revision fabricated. External Hermes Agent
source is not included; WebUI runner construction helpers ARE included.

Minimal metadata command, no full inspect or env:

```sh
ssh -oBatchMode=yes -oStrictHostKeyChecking=yes -oConnectTimeout=8 pi-nas@100.109.210.55 'docker inspect --format "{{.Id}} {{.Image}} {{.Config.WorkingDir}}{{range .Mounts}}{{if eq .Destination \"/webui\"}} source={{.Source}} destination={{.Destination}} writable={{.RW}}{{end}}{{end}}" hermes-webui-trial'
```

Observed container
`8b5fa0a02828be30446501025a4ffdfbb6a9462a32e8da9cc5b706e874395eec`,
image `sha256:4fbb112fb9f90efac654c43239cffc233122c2b7536aaad9de1e88455c20de0a`,
cwd `/vault`, source `/home/pi-nas/stacks/hermes-webui`, destination `/webui`,
`writable=false`. This is source identity evidence, not runtime qualification.

Native integration review identified actual server Handler._handle_write auth
boundary and main startup/shutdown; routes._check_csrf/same-origin/profile guards;
start_session_turn → _start_run → _start_chat_stream_for_session; real per-session
lock, pending JSON save, submitted native journal, thread launch, compensation and
server_turn_started fan-out. Read native turn_journal append/fsync/read shards and
real messages.js server_turn_started handler attaching existing renderer. Read
provider construction seam in streaming.py. Native submitted-journal failures are
currently swallowed before launching worker: a notification extension must make
correlated native commit fencing fail closed, not assume journal atomicity with
the independent inbox DB. Startup recovery and caches must also be qualified.
No native symbols were edited; full native integration review/implementation and
provider/DOM test setup remain incomplete, NOT blocked by source-access denial.

## Phase 2 — implemented installer slice / two repair attempts

Attempt1: pre-register target backup accounting BEFORE atomic_replace. Restore all
attempted files in reverse order, continuing after a failed restoration. Verify
original bytes, mode, uid and gid independently. Report per-file verified/durable
flags (indices, not private contents); any helper or verification failure produces
`source_restore_unqualified`. A directory-fsync failure after restored bytes does
NOT claim durable restoration. No implicit second restart. Focused host run after
repair: `Ran 5 tests in 0.039s / OK`.

Attempt2: actual source mount metadata revealed incorrect container-RW preflight
requirement in this HOST writer. Added RED read-only-mount positive fixture:
`python3 -B -m unittest hermes_webui_receiver.test_host_failure_windows.FailureWindows.test_host_write_preflight_accepts_container_readonly_source_mount -v`
returned `FAILED (errors=1)`, `ValueError: approved writable mount absent`.
Repair requires exact source at destination `/webui`, not container RW. Retains
actual read-only mount and does NOT authorize/remount it writable. Host write
permissions are still enforced by actual filesystem operations. No further repair
attempts performed. Native code remains unimplemented; not marked Phase2 complete.

### Final focused command / real output

```sh
# cwd retained worktree/tools/dev
python3 -B -m unittest hermes_webui_receiver.test_host_failure_windows hermes_webui_receiver.test_host_job test_hermes_webui_receiver test_hermes_notify_subscriber test_hermes_notify_repair test_hermes_notify_workflows test_hermes_notify_run_origin -v
```

Observed `Ran 54 tests in 0.275s / OK`. Includes inherited repeated legacy cases;
not54 unique product cases and not a rerun of verifier564b. New six host tests
include ten first/second-file post/precommit windows, rollback-fsync truthful
receipt, helper precommit fsync original-byte/temp cleanup and positive one-restart
fixtures for writable/read-only mounts. Actual disposable filesystem mutations;
ONLY Docker inspect/command boundaries isolated. No mock receiver/native sink or
transcript added. Synthetic independent gate values only enable disposable host
fixtures, never a deployment manifest. Actual Docker installer NOTRUN.

Integrity validation from worktree root: independently rehashed all107 source
files against manifest, compiled four new/changed Python modules in memory (no
bytecode writes), `git diff --check`, hashes below, `git diff --quiet HEAD -- apps
docs/ai/contracts`, `git rev-parse HEAD`, `git status --short`. Exit0. Output:
`107 source hashes verified; snapshot unchanged`; `4 changed/new Python modules
compile without bytecode writes`. HEAD unchanged. No application/canonical
contract edits. Tracked diff whitespace check is not a check of added vendor files.

| Artifact | SHA256 |
|---|---|
| host_job.py | 115f95c47c1274446e36bdcb499c2e1ee6b504cb74ddc42a3a94af2f881f1e97 |
| test_host_failure_windows.py | fec499d5a7671bd10e6343af5d5355a36f675e208124869f55032b50ef4ecddd |
| test_native_http.py | 86731b89059107ffd05234c3411c69bc8ab288388b55b48f90578546fa4a9bd4 |
| capture_source.py | ccb031cff66581bbec6790072b9309bbe78188e596189b84436507f23d189b94 |
| source_snapshot_manifest.json | cfe5f82898f38923a90ec5081a71608f8e9b416fcd7b77ca16974a951f72a093 |
| source_guard.json | 7679b57a1612e9e4229058a4bbe8a0093fa68c820acb403829de81d78b1fca84 |
| preserved canonical V2 | 61d623be80c3228439a436738da534820d4d1c3b08dfdc93a2df10ab3a7ed5fe |

## Files / independent handoff

Changed this continuation: host_job.py, source_guard.json, INTEGRATION.md.
Added: test_host_failure_windows.py, test_native_http.py, capture_source.py,
source_snapshot_manifest.json, source_snapshot/ (all107 paths listed in manifest),
this run. Preserve prior dirty69568 source and all earlier evidence unchanged.

Parent's exact independent host procedure is recorded at INTEGRATION.md
"Parent-only independent host procedure — NOTRUN". Its validation-only and
execution commands are distinct. Manifest still cannot be completed honestly:
nativeIntegrationPatch/nativeGate/hostFacility remain null; no independent actual
native+DOM PASS/evidence hash/patch set or configDigest/readiness attestation.
No installable native file patch or provider/DOM acceptance test is delivered by
this partial continuation. Do not treat source-copy or installer tests as native
verification. No more excerpt requests or unchanged-scope approval questions.

| Criterion | Offline actual copied WebUI | Actual deployed |
|---|---|---|
| Arrival in correct original chat | FAIL: receive404; no ingestion | NOTRUN |
| Native wake | NOTRUN / implementation incomplete | NOTRUN |
| Existing frontend DOM visible | NOTRUN / gate absent | NOTRUN |
| Busy409 durable/no steer | NOTRUN native (standalone inbox units pass only) | NOTRUN |
| Duplicate/collision | NOTRUN native | NOTRUN |
| Restart/reopen/dedup | NOTRUN native | NOTRUN |
| Crash between native commit/wake | NOTRUN / native fencing incomplete | NOTRUN |
| Owner/profile/old-session revocation | NOTRUN native | NOTRUN |
| Zero-network test-provider execution | NOTRUN; server test fence active, no provider run | NOTRUN |
| Host restoration failure windows | PASS disposable actual files | NOTRUN |
| Host positive preflight / one restart | PASS disposable files with isolated Docker boundary | NOTRUN |

Full feature remains BLOCKED_NATIVE_IMPLEMENTATION_INCOMPLETE, not
READY_FOR_VERIFICATION or product ready. Installer slice is independently runnable.
Concrete remaining work is actual scoped routing/lifecycle registry and native
event/turn commit correlation, safe same-operation crash recovery/quarantine,
real test-only provider seam and existing-renderer DOM gate. HTTP404 proves the
route is absent; it is not an external permission or missing-dependency excuse.

No Rhythm server/engine/tests started. Future Rhythm commands retain canonical
tools/dev/sandbox.sh only; all four fixed paths,0400 fixtures and ports4898/4897/4899
from prior run remain required. No live4001/4096/approval4198 attachment. Owned
copied WebUI subprocess was terminated/waited; ephemeral private listener gone.
Native production activation, host deployment/restart and rollback are NOTRUN.
