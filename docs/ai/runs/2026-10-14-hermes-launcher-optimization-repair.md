---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: READYFORLAUNCHERREGATE
tags: [run, rhythm]
---

# Launcher optimization repair — staging only

## Scope / retained approval

Explicit parent specialist handoff after independent `99b666` FAIL. Sole writer;
prior writer/guard finished. Worktree retained at bb4a5651. Skills loaded in order:
acceptance-contract, coding-agent. Read AGENTS, project-state, current-plan,
dedicated host-staging run, entire exact launcher and unchanged host_job.

Permitted writes: new reviewable launcher/test source artifacts under
tools/dev/hermes_webui_receiver, this run, local protected staging/procedure files;
remote ONLY atomic replacement of launcher.py and inventory.json under existing
/home/pi-nas/rhythm-notify-stage-bb4a5651 after old-hash/protection verification.
Old remote bytes retained locally only. No frozen host_job/receiver/subscriber,
seven output/native algorithm edits. No service environment/PYTHONOPTIMIZE reads,
secrets dumps, mounted source writes, Docker/service launch or restart, installer
execution, activation/chats, config/image/ports/network changes, real credentials,
data/card/Drive/email/billing, dependencies, cleanup, commit/push.

Original conditional AJ ONE restart is retained but still HOLD pending independent
new-launcher regate. No second rollback restart; no new execution authorization.

## Phase 0 — fixed executable contract / RED

Contract: test_denials_before_any_write_or_host_call (all named DENIALS at compile
optimization 0/1/2), test_valid_fixture_exactly_one_manifest_and_fake_host_call,
test_readonly_allowlisted_output_and_zero_side_effects, test_no_production_asserts.
Mandate: make these checks pass without weakening them. Parent independent
verifier can run the source test with a read-only staged launcher path; no artifact
write permission needed. This specialist is not independent qualification.

Command (retained worktree cwd):
`python3 -B tools/dev/hermes_webui_receiver/test_launcher_security.py /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/hermes-notify-staging-bb4a5651/launcher.py`

First harness run: 97 failures, including unrelated valid/readonly fixture failures
from bound methods patched onto Path. Repaired the fixture descriptor wiring
before implementation. Re-ran identical checks with unittest output captured in
memory to summarize failures: 4 tests, 95 failures, 0 errors; valid/readonly PASS.
WrongMainPID and wrong review at optimize=1 and 2 reached executed-manifest WRITE
intercept. Original exact bytes compiled/executed unmodified; os/subprocess/file
I/O intercepted, manifest only in-memory, fake host calls only. No actual service
or Docker call. Other existing guards/schema denials already passed where not
removed by optimization; no invented failure requirement for healthy behavior.

Retained ORIGINAL bytes additionally re-probed with system Python after local
backup preservation (no fixed-source mutation):
```sh
/usr/bin/python3 -B - <<'PY'
import runpy,sys
sys.argv=['contract','/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/hermes-notify-staging-bb4a5651/launcher.original-56645439.py']
n=runpy.run_path('tools/dev/hermes_webui_receiver/test_launcher_security.py',run_name='contract')
for case in ('wrong_pid','wrong_review'):
 h=n['Host'](case); status,output=h.execute(1)
 if len(h.opens)!=1 or len(h.writes)!=1 or len(h.calls)!=1 or status!=0: raise RuntimeError('RED not reproduced')
 print('RED ORIGINAL optimize=1',case,'manifest WRITE intercept=1 fake hostcall=1 real writes=0')
PY
```
Exit0 means original defect reproduced, NOT contract PASS:
`RED ORIGINAL optimize=1 wrong_pid manifest WRITE intercept=1 fake hostcall=1 real writes=0`
and identical wrong_review line. Both compile/execute exact original inline bytes.

## Phase 1 — whole surface / impact / risk

GitNexus upstream impact for main and protected_bytes scoped to new
tools/dev/hermes_webui_receiver/launcher.py in Rhythm: both target NOT FOUND,
risk UNKNOWN (not a no-dependency/LOW claim). Launcher existed only in staging,
not indexed source. Manual caller review: __main__ calls main; main calls
protected_bytes and digest, unchanged host_job protected/inspect/read_file/
validate_manifest/encoded/command/fsync_directory; planned parent service calls
launcher by absolute path. No shared indexed existing symbols changed.

Consolidated security risk is consequential: optimization removes authorization,
service provenance, host isolation, staging protection, byte/source/config,
evidence and replay guards before manifest creation. Replace every ast.Assert
with explicit require(condition); helper must use if/raise, constant sanitized
error. Predicates, UNIT, candidate/evidence flags, inventory semantics, default
read-only branch and unchanged installer CLI preserved. Test exact runtime bytes
at optimization0/1/2 plus process -O and PYTHONOPTIMIZE0/1/2. Read-only real host
preflight after static proof; no execution branch on host. Existing product/native
gates preserved by byte identity, not claimed rerun.

## Phase 2 — implementation / GREEN

Added reviewable source artifacts (not new product outputs):
- `tools/dev/hermes_webui_receiver/launcher.py` — exact staging launcher with all
  35 runtime security assertions converted to require(condition). Explicit helper
  if/raise, no assertions anywhere in production launcher, sanitized constant
  exception/failure JSON. No environment clearing/optimization refusal workaround.
- `tools/dev/hermes_webui_receiver/test_launcher_security.py` — actual exact-byte
  compile/exec contracts; fake host/filesystem/subprocess boundaries only. Launcher
  functions are NOT replaced. Existing host_job.validate_manifest and canonical
  inspect digest execute unchanged against synthetic data. No actual installer.
- This run note. No existing tracked file edits. Existing unrelated untracked
  staging run and four artifact directories preserved.

First implementation attempt GREEN; zero implementation repair retries.
Initial contract fixture descriptor repair occurred before implementation, not a
weakened acceptance test. Added a separate missing-import/unusable-OS-flag fail-
closed test without changing the four fixed contract assertions.

The 51 denial fixtures, each at compile optimize0/1/2 (153 denials):
`wrong_pid inactive wrong_invocation wrong_unit missing_invocation missing_property
wrong_review wrong_evidence_review uid gid docker_marker container_marker pid1
cgroup facility_file facility_access manager inventory_traversal inventory_absolute
staged_byte directory_mode directory_owner file_mode file_owner file_group
file_links file_type job_origin receiver_origin subscriber_origin facility
candidate_launched backup_path backup_replay manifest_replay evidence_binding
source_manifest_binding container_id image config not_running unhealthy
health_command mount source_pin source_metadata before_hash artifact_hash
create_collision patch_binding gate`.

Every denial asserts ZERO manifest-open/write attempts and ZERO host CLI calls,
status1, exact sanitized BLOCKED JSON. Fixed unit argv is checked by the fixture;
wrong-unit fixture models another service invocation owning the process rather
than making a configurable unit. Missing import and unusable O_NOFOLLOW are six
additional fail-closed boundary probes. Synthetic private buffer appears in
source bytes, inspect Config/Env/health command and import error; never in output.
Read-only output is restricted to original allowlisted status/digests/metadata.
Valid fixture at each optimize level: exactly ONE intercepted manifest open/write
and ONE fake fixed installer CLI call, exit0; candidate launch flag remains false.
Read-only fixtures: exit0 and zero writes/calls at each optimization level.

Actual GREEN commands, retained worktree cwd (every command exit0):
```sh
python3 -B tools/dev/hermes_webui_receiver/test_launcher_security.py
PYTHONOPTIMIZE=0 /usr/bin/python3 -B tools/dev/hermes_webui_receiver/test_launcher_security.py
PYTHONOPTIMIZE=1 /usr/bin/python3 -B tools/dev/hermes_webui_receiver/test_launcher_security.py
PYTHONOPTIMIZE=2 /usr/bin/python3 -B tools/dev/hermes_webui_receiver/test_launcher_security.py
/usr/bin/python3 -B -O tools/dev/hermes_webui_receiver/test_launcher_security.py
```
First set before the supplemental boundary test: `Ran 4 tests ... OK` for each.
After the additive boundary test: `/usr/bin/python3 -B ...` returned
`Ran 5 tests in 0.341s ... OK`. Full current staged-byte set also executed:
```sh
PYTHONOPTIMIZE=0 /usr/bin/python3 -B tools/dev/hermes_webui_receiver/test_launcher_security.py /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/hermes-notify-staging-bb4a5651/launcher.py
PYTHONOPTIMIZE=1 /usr/bin/python3 -B tools/dev/hermes_webui_receiver/test_launcher_security.py /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/hermes-notify-staging-bb4a5651/launcher.py
PYTHONOPTIMIZE=2 /usr/bin/python3 -B tools/dev/hermes_webui_receiver/test_launcher_security.py /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/hermes-notify-staging-bb4a5651/launcher.py
/usr/bin/python3 -B -O tools/dev/hermes_webui_receiver/test_launcher_security.py /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/hermes-notify-staging-bb4a5651/launcher.py
```
Observed `Ran 5 tests` / `OK` each, 0.361/0.364/0.364/0.367s respectively.
unittest assertions are explicit methods and remain active under process -O/-OO.
No full native/host-install rerun: existing frozen algorithms/107-pin manifest,
seven native output bytes and dependencies verified byte-identical, no edits.

## Atomic restage / all16 readback

Procedure: approved temporary parent
`hermes-restage-launcher-bb4a5651.py`, SHA256
`062301b803d72ad1e477b490cd0083550dc01d2d5a1d0414ac25b28d3de61950`.
Static syntax compiled for local and embedded remote code; no remote assertions.
AST proof compared ALL old assertion predicates to ALL new require call arguments:
`PASS: identical original/new guard predicates: 35`.

Actual command (once, successful; do NOT rerun blindly over changed hashes):
```sh
/usr/bin/python3 -B /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/hermes-restage-launcher-bb4a5651.py
```
Uses SSH BatchMode=yes, StrictHostKeyChecking=yes, ConnectTimeout=10, existing
`pi-nas@100.109.210.55` identity. Remote inline Python only reads staging and
atomically replaces launcher.py then inventory.json. Before ANY remote write:
exact OLD launcher `56645439623e6ad292e09f54815a351715b5aafb374bf9f7ccc705d085cacf33`
and inventory `a6f4a4f023b6bf74e2287bad1088a6a2daf399d97c3952d9ff02b71271954d1d`
required; all15 inventory bindings and all16 protected regular single-link0600
1000:1000 files checked; exact staging directory contents and no backup/executed
manifest. Pinned no-follow directory chain, operator-owned0700 staging/subdirs;
no drift observed. Rechecks each old target hash immediately before atomic rename,
fsyncs file and directory. No unrelated remote write or remote backup added.
Between two atomic publications old inventory fails closed against new launcher.

Only launcher binding changed in inventory; inventory retains 15 bindings and
does not recursively self-hash. Inventory itself externally SHA-bound below.
Candidate input authorization hash and evidence unchanged; neither regenerated.
Local protected0600 original backups inside local stage:
`launcher.original-56645439.py`, `inventory.original-a6f4a4f0.json`.
Local stage launcher/inventory synchronized to source/remote after successful
readback. Local receipt `optimization-repair-receipt.json`, SHA256
`a8b532c9100d0a013e9db6264caeca8b7b521ee7294ed0e0baf646e160fe5d7b`.
Old transfer-receipt and original procedure preserved, not overwritten as current.

Readback: `state=restaged_only`, execution NOTRUN, 16 files all mode0600,
uid/gid1000:1000, regular single-link. Staging/root subdirs0700. Hashes:

| Stage-relative path | Current SHA256 |
|---|---|
| launcher.py | `76962c3c72615ca5be5cefc6f5a023d2c71f598129ce12f5c8437435ceb2f0a2` |
| inventory.json | `59d40e9a1e1757df47630c86762fec94bcb5de8b56187ee550c6622228aaf3bc` |
| candidate-manifest.json | `345f06d30d645936a5a01442045e92814290a9a15bce8f8f56ee975c044f1822` |
| independent-gate-evidence.json | `f92b7221e403f350f98526965a72dbd863d68ea4e71bf76de908e438f6db7919` |
| native_patch_manifest.json | `997524d5bf0b3b7ef2adbac73bad7ea62533eafb154b6ac1a774698b124844d0` |
| hermes_webui_receiver/host_job.py | `3437cdb14cb09a098cff4dc905a3b6ff251e42e658327dee30d8cae567976a01` |
| hermes_webui_receiver/receiver.py | `4d49279b04b5adf294103f9275c440cda6e8ec4fae01b5dd88da0d4846922d44` |
| hermes_webui_receiver/__init__.py | `793cf32b7e6c6f73162cbf40d1cf63e74c40ae63fc84af6301f98b25290c0750` |
| hermes_notify_subscriber.py | `270548dfe3c047babe7445db98ccf5d70226b9c37273cca5c6b8f7b49fa58656` |
| artifacts/0 | `2b39e3a15b69c58006d1450a1edf4dd2119ab6ce5c4ace8e70239ac82e0e16fa` |
| artifacts/1 | `a6b0ceb93cd4cdfc09c5d79480713faeaf16d4939cb92680e3d930f0e3603d34` |
| artifacts/2 | `3c943e69fc18b33768a852c256c15825447bb3065cf3933946ec80116bafec43` |
| artifacts/3 | `7e5ba50ec4c03c8797fafc49bb989de2a95967955f617e79ced23cf3ad4791ce` |
| artifacts/4 | `52a90a9e785c3bde30cd11f766a3c861eedbaed738dcedc695478e75548df780` |
| artifacts/5 | `e89406af68a793e86eefd75d9bf4ada8371d438e7e5a19d80e189ac7688e6812` |
| artifacts/6 | `8b0002f10c6906443af059920bf93fd60810d7e16f58351b381324ebce85af38` |

Source test SHA `78055b29e5d1c57198662c8c0a328122e53543448ae73eb7dda9699e3bf131e8`.
Unchanged source_snapshot_manifest SHA
`cfe5f82898f38923a90ec5081a71608f8e9b416fcd7b77ca16974a951f72a093` (107 pins).
Unchanged native.patch SHA
`1f99fbf5a68258aebcf9d760fbce129afe561734521aa9fc4bf20c6a7ec06a3c`.

## Actual read-only host verification

Only after static/optimized contract and restage verification:
```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 pi-nas@100.109.210.55 '/usr/bin/python3 -B /home/pi-nas/rhythm-notify-stage-bb4a5651/launcher.py'
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 pi-nas@100.109.210.55 '/usr/bin/python3 -B -O /home/pi-nas/rhythm-notify-stage-bb4a5651/launcher.py'
```
Both exit0 `read_only_preflight_pass`, execution NOTRUN, serviceLaunched false,
candidateLaunchedOnHost false, backupAbsent/executedManifestAbsent true; same
candidate SHA above and configDigest
`f32cd63ffaf5bb29ed3e3d32a634f49673e0a08cc8e141cad17964c049f3d99b`.
All staged hashes/protection/origins, original11 host source pins, four replacement
hashes/0644/1000:1000 and three CREATE absences pass. Configured healthy container,
image and read-only /webui mount unchanged; PID1/systemd and self/container markers
pass. No raw inspect/secret/health command contents printed or persisted.

Final local command: `git diff --check && git status --short && git rev-parse HEAD`
plus inline read-only AST/hash verification: exit0, unchanged HEADbb4a5651,
no tracked changes; new launcher/test/run artifacts plus pre-existing untracked
files only. Local/remote receipt15 bindings and all16 readback identities verified;
35 predicate-equivalence proof, source107 pins and seven output identity PASS.
No commit/push; parent owns review and commit.

## Planned command — NOT RUN / qualification pending

The previous staging run's launcher/inventory SHA references are superseded by
the current table ONLY; historical receipt preserved. Original independent
staging qualification is FAILED (`99b666`); new launcher independently qualified
PENDING. Current candidate/evidence/native hashes do not need regeneration.
This run's GREEN is implementation evidence, not independent approval.

Exact fixed-unit planned command is unchanged and **NOT RUN**:
```sh
/usr/bin/systemd-run --user --unit=rhythm-notify-install-bb4a5651 --service-type=exec --property=Restart=no --property=UMask=0077 --working-directory=/home/pi-nas/rhythm-notify-stage-bb4a5651 --setenv=PYTHONPATH=/home/pi-nas/rhythm-notify-stage-bb4a5651 /usr/bin/python3 -B /home/pi-nas/rhythm-notify-stage-bb4a5651/launcher.py --execute-parent-authorized --reviewed-candidate-sha 345f06d30d645936a5a01442045e92814290a9a15bce8f8f56ee975c044f1822 --independent-gate-reviewed f92b7221e403f350f98526965a72dbd863d68ea4e71bf76de908e438f6db7919
```
Unchanged host CLI behind actual service provenance, also **NOT RUN**:
```sh
/usr/bin/python3 -B -m hermes_webui_receiver.host_job --manifest /home/pi-nas/rhythm-notify-stage-bb4a5651/executed-manifest.json --execute-parent-authorized
```
Restart budget remains1, no automatic second rollback restart. Parent must keep
execution HOLD until independent review of current launcher bytes/test results,
current receipt identity and fresh preflight under existing conditional approval.

## Teardown / handoff

All fixture patches/environment restored by context managers; virtual streams
closed, no actual manifests written by tests. SSH commands completed; no service,
Docker operation, sandbox/backend or installer started, so no process teardown
needed or attempted. Protected staging and local original backups intentionally
retained; no existing files deleted. Backup/executed-manifest remain absent.

READYFORLAUNCHERREGATE (specialist READY_FOR_VERIFICATION only). Parent independent
verifier owns regate; can run test against read-only current launcher with optional
path. No unchanged-scope reapproval requested. Activation, runtime notification
delivery, production install/restart and native end-to-end completion NOT claimed.
