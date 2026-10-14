---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: null
issues: [hermes-event-notify]
status: READY_FOR_VERIFICATION
tags: [run, Rhythm]
---

## Files / scope

Parent specialist handoff authorizes ONLY host_job.py, test_host_job.py,
test_host_failure_windows.py, new test_host_exact_patch.py in
tools/dev/hermes_webui_receiver/ and this run note. Retained HEAD
ee914fce476de2190efdead7c3bc2ce8f59c19ce; unrelated dirty files preserved.
Native writer 2a3b26e2 owns native/receiver/manifests/DOM/subscriber fixtures.
No commits/push/install/SSH/real Docker/restart/network/live data/secrets.
Parent controls final hash integration and separately approved ONE live restart.

## Phase 0 / frozen acceptance contract

Loaded acceptance-contract first, then coding-agent. Read AGENTS.md and both
memory files. Private exact-shape five-output fixture; no unstable native hashes
are embedded. New acceptance file is frozen before implementation; mandate is
to make its checks pass unchanged. Parent/independent verifier can rerun against
the source without write access (all writes are disposable fixture files).

Command from worktree tools/dev:
`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest hermes_webui_receiver.test_host_exact_patch -v`

RED: Ran 10 tests in 0.040s; FAILED (errors=7). Positive exact-five install,
readiness rollback, and all five partial-publication subcases fail at actual
root cause: `ValueError: unapproved file path` for server.py. Seven negative
test methods already pass (existing deny-first behavior), retained as safeguards,
not evidence that their specific downstream guards yet exist.

Named checks cover exact five outputs/readonly mount/backups/ONE fake restart;
structured readiness denying shell; existing CREATE target; backup-parent
symlink; traversal/state path/deletion/unsupported type/missing metadata;
approved-manifest digest; source/artifact symlinks; every partial-file directory
fsync rollback with original bytes/mode/uid/gid and new absence; readiness
failure source-only restoration; existing backup blocking restart replay.

## Phase 1 / bounded impact review

GitNexus Rhythm upstream impacts for run, validate_manifest, protected,
atomic_replace and fsync_directory with exact host_job.py hint, plus exercise
with the test_host_failure_windows.py hint, each return Target not found,
UNKNOWN risk. Untracked retained module is not indexed; no inferred zero risk.
Exact-text caller search and full reads cover host_job main, host tests and
test_repair_round1. High-consequence risks: arbitrary readiness execution,
clobbering additive modules, backup parent escape, partial commit durability,
configuration drift and duplicate restart. Proportionate offline failure tests
and fail-closed typed manifest are within existing approved scope.

Integration note: unowned test_repair_round1's old host probe supplies lowercase
operations, no approved manifest/metadata, arbitrary readinessArgv and invented
source hash. It must NOT be accepted via a compatibility bypass. Parent must
adapt that integration input after both independent slices finish; not edited
here. No renewed scope approval needed for unchanged specialist scope.

## Phase 2 / checks and handoff

Implemented only the four owned Python paths plus this note. The new acceptance
file stayed unchanged after RED. test_host_failure_windows retains every prior
test method/assertion; its input fixture now uses the strict approved five-file
plan instead of two arbitrary API files. Other retained regression files were
not edited. No runtime/native source, manifest, subscriber or DOM file edited.

Strict schema rejects unknown/incomplete fields, unsupported operations,
arbitrary readiness argv, duplicate/extra/missing outputs, traversal and state
deletion. Exactly two REPLACE paths (`server.py`, `api/routes.py`) require
reviewed deployed hashes; exactly three CREATE paths (`api/rhythm_notify.py`,
`api/rhythm_inbox.py`, `api/rhythm_schema.py`) require beforeHash=null and
expectedAbsent=true. Every file explicitly binds afterHash, artifact, mode,
uid and gid via nativeGate.patchSetHash. Protected approvedPatchManifest bytes
bind to sourceManifestHash and the exact five before/after records. Protected
artifacts are single-link regular operator-owned files, mode 0400 or 0600.
REPLACE output metadata must equal deployed metadata; safe output modes are
0600/0640/0644. No existing CREATE inode or symlink is overwritten.

Every absolute directory chain is walked with O_DIRECTORY/O_NOFOLLOW and
directory-relative FDs. Ancestors must be root/operator-owned and not
group/world-writable, except root-owned sticky temporary ancestors. Backup
parent must already exist, be operator-owned and owner-only (0700); unsafe,
symlinked, missing, noncanonical or traversing parents fail closed. Only the
final exclusive 0700 backup directory is created; no recursive mkdir or
automatic cleanup/resume. Canonical macOS temporary paths are obtained in the
fixture with Path.resolve(), not by allowing /tmp or /var symlink aliases.

Full plan and pinned references are verified before backups/application writes.
Original bytes and approved original metadata are durably backed up before
publication; attempted accounting precedes publication. CREATE uses atomic
hard-link no-clobber publication; rollback deletes only its recorded inode,
never a racing foreign inode. Rollback verifies bytes/mode/uid/gid/absence and
directory durability. Unattempted foreign changes are preserved and never
reported restored. Descriptor-pinned operations plus rechecks reject tested
source/artifact/backup chain races; this is best-effort race protection, not a
kernel compare-and-swap or protection against a hostile same-UID/root actor.

Readiness accepts ONLY `{"kind":"docker-health","status":"healthy"}`.
It compares the existing inspected State.Health.Status; it never invokes a
readiness program, HTTP endpoint, shell, Python script or container health
command. Existing internal Docker inspect/restart calls remain the sole command
surface. Id/image/configuration fingerprint must remain identical, and final
source hashes/inodes/metadata must match. Config/environment content is hashed
internally, never logged or included in receipts. No recreate or data migration.
Persistent exclusive backup and restart-intent prevent replay of the same job;
failed readiness restores source only, requests explicit rollback-restart
approval, and never consumes an automatic second restart.

### Actual commands/results

All Python commands ran from the worktree's tools/dev; no native browser/server
suite, socket, actual Docker, host install or SSH command was run.

1. Phase 0 command above: 10 methods, seven root-cause error occurrences,
   exactly `ValueError: unapproved file path` (RED).
2. `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest hermes_webui_receiver.test_host_job hermes_webui_receiver.test_host_failure_windows hermes_webui_receiver.test_host_exact_patch -v`
   — first implementation validation: `Ran 17 tests in 0.234s / OK`.
3. Added in-scope hardening checks for malformed readiness, incomplete metadata,
   unknown/deletion fields, full-plan verification, no-clobber races, committed
   link errors, restoration durability, chain races and config drift. Disposable
   HOME runner below initially yielded `Ran 76 tests in 0.529s / OK`; first
   wrapper used exit=False without propagating failure status, so reran with
   explicit success-based exit: `Ran 76 tests in 0.589s / OK`.
4. Final review added an unattempted-source-race truthfulness regression and
   final-readiness inode/metadata verification. Final exact command:

```sh
python3 -B -c 'import os, pathlib, sys, tempfile, unittest
with tempfile.TemporaryDirectory(prefix="hermes-host-offline-") as home:
    os.environ["HOME"] = str(pathlib.Path(home).resolve())
    tempfile.tempdir = os.environ["HOME"]
    result = unittest.main(module=None, argv=["unittest", "hermes_webui_receiver.test_host_failure_windows", "hermes_webui_receiver.test_host_job", "hermes_webui_receiver.test_host_exact_patch", "test_hermes_webui_receiver", "test_hermes_notify_subscriber", "test_hermes_notify_repair", "test_hermes_notify_workflows", "test_hermes_notify_run_origin", "-v"], exit=False)
    sys.exit(not result.result.wasSuccessful())'
```

Observed **`Ran 77 tests in 0.528s / OK`**, successful exit. Actual count is
30 host test methods (10 frozen exact-patch, 13 additional hardening, 1 prior
manifest denial, 6 prior failure-window methods) plus 47 retained offline
receiver/subscriber/run-origin executions. Prior 54 executions remain, with
23 additive methods; inherited legacy cases are repeated, not 77 unique
product cases. Directory failure-window method contains 10 first/second-file
subcases plus separate fsync, rollback-durability and positive tests. Exact
contract additionally exercises directory fsync failure at all five outputs.
No post-implementation failing repair round; no assertion was weakened to
obtain GREEN. Frozen acceptance checks remain the implementation mandate.

Positive fake fixture evidence: all five actual disposable files have approved
bytes/mode/uid/gid; only the four expected API modules exist in api/; backups 0
and 1 contain original server/routes bytes; read-only `/webui` container mount
is accepted for host-side writes; fake command count is exactly 1, equal to
`['docker', 'restart', exactContainerId]`. No real restart occurred. Unhealthy
fake readiness consumes one fake restart, restores all original source and
removes all three created modules, with runtime UNQUALIFIED.

From worktree root:
`shasum -a 256 tools/dev/hermes_webui_receiver/host_job.py tools/dev/hermes_webui_receiver/test_host_job.py tools/dev/hermes_webui_receiver/test_host_failure_windows.py tools/dev/hermes_webui_receiver/test_host_exact_patch.py && git diff --check`
— successful exit; no whitespace errors in tracked diff. These host files are
retained untracked paths, so git diff is not proof of their contents; hashes and
actual unit execution qualify the exact owned artifact. `git status --short`
retains prior unrelated dirty paths and native writer's concurrent additions.

| Owned Python artifact | Final SHA-256 |
| --- | --- |
| host_job.py | 2f1ccb41c744175fa2eef454e4823e11d6cc1ddb03954f9f16146b9287eb73f7 |
| test_host_job.py | 8c9ebd76c4ec337b2712a3bf4bc3d9f116b4b1fbf56cddac541cfee8af6ab531 |
| test_host_failure_windows.py | 2bdd56e99758e38545f994277961dfd7b56f862622d3dc93f24c6362437d4f6d |
| frozen test_host_exact_patch.py | a1aea8473045f3a54f280713c3a02900943039ae2103e43558a848786446d9aa |

## Independent verification / remaining activation requirements

READY_FOR_VERIFICATION for this offline implementation slice only. Parent must
rerun the frozen command against these hashes without editing its checks, then
perform the SINGLE final integration boundary after native writer finishes.
No live readiness, actual host availability, native DOM gate or production
qualification is claimed. Native/DOM suites intentionally not run here.

Before any separately authorized activation, parent must:

1. Obtain independent full native+DOM PASS evidence for the final native artifact,
   not fixture attestations. Freeze final source/native patch manifest hashes
   after both owners finish; supply a protected approvedPatchManifest copy and
   real current deployed before hashes, exactly three absent CREATE paths, all
   approved artifact digests and numeric output mode/uid/gid. Bind exact files
   via patchSetHash and approved-manifest bytes via sourceManifestHash.
2. Adapt the old unowned integration probe's inputs to this strict schema
   (uppercase CREATE/REPLACE, expectedAbsent, metadata, approved manifest,
   structured readiness). Its arbitrary readinessArgv and placeholder hash are
   intentionally incompatible; no unsafe compatibility bypass added here.
3. Independently establish an available host facility outside the same target
   container, exact container/image/config fingerprint and `/webui` source
   mount, existing safe Docker health state/probe configuration, filesystem
   permissions, protected existing backup parent and unused backup directory.
   This slice does not add a healthcheck or recreate/change container config.
4. Preserve current runtime/data/configuration and obtain AJ's explicit live
   ONE-restart approval before execution. Keep backup/restart-intent state;
   don't delete it to resume. Readiness failure or ambiguous restart leaves
   runtime unqualified; another restart needs separate explicit AJ approval.

This agent performed no production, Docker, SSH, install, restart, liveconfig,
credential, network/relay/Tailscale, migration, destructive cleanup, dependency
installation, commit or push operation. Temporary fixture cleanup only.
