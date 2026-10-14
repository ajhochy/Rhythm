---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: READYFORIDENTITYGATE
tags: [run, rhythm]
---

# Current identity reconciliation — no product behavior change

## Scope / approvals

Explicit parent specialist handoff; sole writer at
`/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012`,
HEAD `ee914fce476de2190efdead7c3bc2ce8f59c19ce`. Acceptance-contract loaded first,
coding-agent second; AGENTS and existing project-state/current-plan read.
Approved writes ONLY: `tools/dev/hermes_webui_receiver/test_host_native_manifest.py`
static reviewed identity, `tools/dev/hermes_webui_receiver/source_guard.json`
static patch identity, this dedicated run and an optional INTEGRATION pointer.
One identity update attempt; no generic repair loop or peer dispatch.
All existing behavior/assertions, historical receipts, nine deployed hashes,
107 original pins, seven outputs, product/native/receiver/host_job bytes retained.
No Docker, host_job CLI, SSH, staging, real install/restart, servers, live config,
secrets, provider/network/relay/Tailscale, chat/card/Drive/email/billing/desktop
actions, approval writes, shared dependency installs, destructive cleanup, commits
or push. Disposable HOME/files only; fake Docker boundary is NOT a host attestation.
Parent owns independent identity gate and actual host metadata/preflight/staging
for SAME container/ONE planned restart under existing conditional AJ approval.
No new broad approval requested or inferred; all STOP template inputs stay null.

## Phase 0 — fixed acceptance contract / observed RED

WAIVED: new live behavioral test — non-behavioral static test/guard identity
reconciliation only. No product behavior implemented or live gate rerun claimed.
The following **new fixed identity checks** were run BEFORE implementation:
2 tests / 0.003s / FAILED (failures=2), manifest old `e56afa198…` versus reviewed
current `997524d5…`; patch old `a4c0ec35…` versus reviewed current `1f99fbf5…`.
Implementer's mandate: make these exact checks pass without editing their fixed
expectations; retain all existing host assertions. Parent independent verifier
can run these commands with read-only artifact access and verifier-owned temp state.

Cwd for every Python command below: this worktree's `tools/dev`.
```sh
python3 -B - <<'PY'
import ast, hashlib, json, unittest
from pathlib import Path
r=Path('hermes_webui_receiver')
M='997524d5bf0b3b7ef2adbac73bad7ea62533eafb154b6ac1a774698b124844d0'
P='1f99fbf5a68258aebcf9d760fbce129afe561734521aa9fc4bf20c6a7ec06a3c'
class IdentityContract(unittest.TestCase):
    def test_reviewed_manifest_static_identity(self):
        tree=ast.parse((r/'test_host_native_manifest.py').read_text())
        node=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='MANIFEST_HASH' for t in n.targets))
        self.assertIsInstance(node.value,ast.Constant)
        self.assertEqual(node.value.value,M)
        self.assertEqual(hashlib.sha256((r/'native_patch_manifest.json').read_bytes()).hexdigest(),M)
    def test_reviewed_patch_static_identity(self):
        guard=json.loads((r/'source_guard.json').read_text())
        self.assertEqual(guard['nativeIntegrationPatch']['sha256'],P)
        self.assertEqual(hashlib.sha256((r/'native.patch').read_bytes()).hexdigest(),P)
result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(IdentityContract))
raise SystemExit(not result.wasSuccessful())
PY
```

Full host baseline command (run unchanged after identity update):
```sh
python3 -B -c 'import os,tempfile,unittest; from pathlib import Path; t=tempfile.TemporaryDirectory(dir="/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode"); os.environ["HOME"]=t.name; os.environ["TMPDIR"]=t.name; tempfile.tempdir=t.name; suite=unittest.defaultTestLoader.loadTestsFromNames(["hermes_webui_receiver.test_host_job","hermes_webui_receiver.test_host_failure_windows","hermes_webui_receiver.test_host_exact_patch","hermes_webui_receiver.test_host_native_manifest"]); result=unittest.TextTestRunner(verbosity=2).run(suite); t.cleanup(); raise SystemExit(not result.wasSuccessful())'
```
Observed baseline: **38 tests / 1.250s / 33 pass, 5 FAIL**. All five failures are
NativeManifest.setUp line38 static manifest digest equality, actual current
`997524d5bf0b3b7ef2adbac73bad7ea62533eafb154b6ac1a774698b124844d0` versus historical
`e56afa198b585de76f3d416eda799fc5335a7d36d5471f7d9211a06c4d868c3a`.
No host algorithm failure was observed. Historical patch identity retained here:
`a4c0ec35fe76226db0a484367282c437ed2507fabdbdfdc22ffaaccee6e15a01`.

## Phase 1 — consolidated impact / risk

GitNexus upstream impact attempted on MANIFEST_HASH (test path) and source_guard.json
in indexed Rhythm: both Target not found, risk UNKNOWN. Not evidence of no callers
or affected processes. These untracked package paths are not covered by the index.
Read whole intended edit surface and host_job.py, all four host test modules,
native manifest, verifier, INTEGRATION and historical lockrepair receipts.
MANIFEST_HASH is used by setUp equality, fixture sourceManifestHash and template
comparison. Guard is read by pending_manifest_template; image/container/source and
all nine original sourceHashes remain unchanged. No function/class edit needed.
Concrete risk: accidental identity bypass or falsely treating fake install as live
qualification. Mitigation: explicit fixed literals, preserved test AST except the
single literal, guard semantic equality except patch digest, unchanged full package
bytes/metadata fingerprint, all38 unchanged host cases, independent inline disposable
current-seven positive install/replay/restore/source guards, and 7/107 verifier.

Pre-edit preservation fingerprint (143 package files excluding the two permitted
identity files and INTEGRATION):
`479aef02a33b9c449d123e754f5f76a72f92b5269bd344d70f8a81772d1cf878`.
It hashes sorted JSON mapping relative path to SHA256, mode, uid, gid, size,
mtime_ns, inode. Assertion AST with ONLY MANIFEST_HASH value normalized:
`1dfcc7938fb1027e6404d8389e5d7c61c6927ad15e2933101b4543ac86388e58`.
Guard JSON with ONLY nativeIntegrationPatch.sha256 normalized:
`99e145d80544cf21f7ed19fbce9a3c701bf92d0ded0fe6651289127043f13b7d`.

## Phase 2 — single identity update / GREEN pending independent preflight

Only two implementation literals changed: test MANIFEST_HASH to reviewed current
`997524d5…`, source_guard.nativeIntegrationPatch.sha256 to reviewed current
`1f99fbf5…`. No dynamic expected-hash derivation, assertion removal, force or bypass.
INTEGRATION gained a pointer; all historical checkpoint text/receipts retained.
The new fixed contract above was NOT edited after its RED run. Native/ACK qualification is the parent-provided prior
independent4f0 receipt, not this agent's rerun: actual real ACK 1 PASS / 8.284s,
native30 PASS / approximately66s, migration11 PASS / approximately10s, unobscured
reply/provider1, wrong-run404, consumer retry/tombstone2, actual DB-visible and
foreign unchanged. Prior same-identity qualification is retained, historical
failed lockrepair receipts are not rewritten. Host current fixture GREEN requires
this run's checks plus parent independent preflight; real installation is NOTRUN.

### Actual validation command / observed result

Executed once after the two-literal update, cwd tools/dev:
```sh
python3 -B - <<'PY'
import re, subprocess
from pathlib import Path
note=Path('../../docs/ai/runs/2026-10-13-hermes-current-identity-reconciliation.md').read_text()
# First two shell blocks are the frozen identity and unchanged host38 commands.
for command in re.findall(r'```sh\n(.*?)\n```',note,re.S)[:2]:
    subprocess.run(['sh','-c',command],check=True)
subprocess.run(['python3','-B','-c','import os,tempfile; from hermes_webui_receiver.verify_native_artifact import verify; t=tempfile.TemporaryDirectory(dir="/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode"); os.environ["HOME"]=t.name; os.environ["TMPDIR"]=t.name; tempfile.tempdir=t.name; verify(); t.cleanup()'],check=True)
script=re.findall(r'```python\n(.*?)\n```',note,re.S)[0]
exec(compile(script,'current-identity-inline-fixture','exec'))
PY
```
At execution the note contained only the first two shell blocks; the launcher
used all shell blocks then present (no `[:2]`), with no comment. The bounded slice
above preserves that exact selection now that the command itself is recorded.

Observed: **identity2 OK / 0.002s; HOST38 OK / 1.824s; verifier PASS7/107 plus
Python/JS syntax; inline positive/replay, all7 publication restores, source drift,
artifact drift, foreign CREATE, all9 deployed pins and null STOP/sourceguard denial
PASS.** No host CLI or actual Docker invocation. Temporary state owned by this test
was disposed; no cleanup of existing files/worktrees. These results are fixture
qualification only; the parent independent identity/actual host preflight is pending.

Full38 observed outputs (all `ok`, unchanged methods):
```text
HostHardening.test_all_source_metadata_and_content_verified_before_backups ... ok
HostHardening.test_backup_traversal_unsafe_parent_and_existing_symlink ... ok
HostHardening.test_configuration_drift_restores_without_restart ... ok
HostHardening.test_create_race_preserves_foreign_inode_and_marks_restore_unqualified ... ok
HostHardening.test_create_removal_durability_failure_is_truthful ... ok
HostHardening.test_create_symlink_and_hardlinked_artifact_never_written ... ok
HostHardening.test_every_missing_metadata_and_injected_delete_field ... ok
HostHardening.test_exact_plan_rejects_missing_extra_duplicate_and_unlisted_outputs ... ok
HostHardening.test_foreign_created_targets_never_removed_during_rollback ... ok
HostHardening.test_last_artifact_hash_or_mode_mismatch_prevents_any_write ... ok
HostHardening.test_link_committed_then_error_removes_only_our_created_file ... ok
HostHardening.test_readiness_config_image_and_root_drift_restores_all_seven ... ok
HostHardening.test_seven_metadata_boundaries_and_both_source_parent_symlinks ... ok
HostHardening.test_source_artifact_and_backup_chain_races_prevent_restart ... ok
HostHardening.test_unattempted_source_race_is_preserved_not_claimed_restored ... ok
HostHardening.test_unsupported_readiness_programs_and_health_fields ... ok
HostJobContract.test_missing_native_gate_and_host_metadata_deny_install_plan ... ok
FailureWindows.test_all_pre_restart_failure_windows_restore_without_restart ... ok
FailureWindows.test_atomic_helper_precommit_failure_leaves_original_bytes ... ok
FailureWindows.test_committed_file_restored_after_directory_fsync_failure ... ok
FailureWindows.test_host_write_preflight_accepts_container_readonly_source_mount ... ok
FailureWindows.test_positive_preflight_fixture_consumes_only_one_restart ... ok
FailureWindows.test_restore_fsync_failure_never_claims_durable_restoration ... ok
ExactPatch.test_approved_manifest_digest_and_exact_path_binding ... ok
ExactPatch.test_backup_parent_symlink_refused_before_writes ... ok
ExactPatch.test_each_partial_file_directory_fsync_restores_bytes_identity_and_absence ... ok
ExactPatch.test_exact_seven_outputs_readonly_mount_backups_and_one_restart ... ok
ExactPatch.test_existing_backup_blocks_duplicate_restart ... ok
ExactPatch.test_existing_new_target_is_never_clobbered ... ok
ExactPatch.test_injected_source_symlink_and_artifact_symlink_refused ... ok
ExactPatch.test_readiness_failure_restores_source_not_runtime_no_second_restart ... ok
ExactPatch.test_shell_readiness_is_rejected_before_writes ... ok
ExactPatch.test_unapproved_traversal_state_deletion_and_missing_metadata_refused ... ok
NativeManifest.test_actual_seven_plan_dry_validation_and_full_install ... ok
NativeManifest.test_actual_template_never_fabricates_host_or_native_attestation ... ok
NativeManifest.test_all_create_targets_no_clobber ... ok
NativeManifest.test_all_seven_publication_faults_restore_exact_tree ... ok
NativeManifest.test_missing_or_disabled_docker_health_stops_before_writes ... ok
Ran 38 tests in 1.824s
OK
```

### Current seven before/after identities and local metadata

Before values are retained original deployed pins (CREATE absent), not preceding
patched outputs. The atomic-migration artifact provenance is recorded in the
unchanged [lockrepair receipt](2026-10-13-hermes-lockrepair-realack.md): only inbox
output changed from the historical artifact; six other outputs retained.

| Output | Original before | Current after |
|---|---|---|
| server.py | `975cfd680fee011d71d630cb5d68df6d2d8b09461e867584ba71ca54ea3efdd6` | `2b39e3a15b69c58006d1450a1edf4dd2119ab6ce5c4ace8e70239ac82e0e16fa` |
| api/routes.py | `7500a207fbba663f25407d04f47a6e618e8e16aa07634a8cd921d5081ee8b66c` | `a6b0ceb93cd4cdfc09c5d79480713faeaf16d4939cb92680e3d930f0e3603d34` |
| api/models.py | `2631a28024f9dc6018a5ceeebd5c7e09bfdae9496f496f7e7e233c951456fa82` | `3c943e69fc18b33768a852c256c15825447bb3065cf3933946ec80116bafec43` |
| static/ui.js | `33c50f790a4a5c9787e5be99369232460d40e2e52042ed48c68be1e06fe4e655` | `7e5ba50ec4c03c8797fafc49bb989de2a95967955f617e79ced23cf3ad4791ce` |
| api/rhythm_notify.py | null (CREATE) | `52a90a9e785c3bde30cd11f766a3c861eedbaed738dcedc695478e75548df780` |
| api/rhythm_inbox.py | null (CREATE) | `e89406af68a793e86eefd75d9bf4ada8371d438e7e5a19d80e189ac7688e6812` |
| api/rhythm_schema.py | null (CREATE) | `8b0002f10c6906443af059920bf93fd60810d7e16f58351b381324ebce85af38` |

Inline installation verified mode/uid/gid `[420,501,20]` (0644) for all4 REPLACE
and `[384,501,20]` (0600 protected disposable artifact) for all3 CREATE. All7
fault restores verified exact original full-tree hashes/mode/uid/gid/CREATE absence;
non-output files unchanged. These are fake local fixture values, NOT host metadata.
Worktree output metadata was independently unchanged before/after this task:

| Snapshot output | Mode | uid/gid | bytes | mtime_ns | inode |
|---|---|---|---|---|---|
| server.py | 0644 | 501/20 | 31396 | 1791935057506737249 | 488594657 |
| api/routes.py | 0644 | 501/20 | 1399990 | 1791935057507010418 | 488594656 |
| api/models.py | 0600 | 501/20 | 700051 | 1791935057507554965 | 488589117 |
| static/ui.js | 0600 | 501/20 | 1157740 | 1791935057508865644 | 488589191 |
| api/rhythm_notify.py | 0644 | 501/20 | 18079 | 1791935057509140855 | 488594016 |
| api/rhythm_inbox.py | 0644 | 501/20 | 17191 | 1791935057509213939 | 488594017 |
| api/rhythm_schema.py | 0644 | 501/20 | 3195 | 1791935057509292857 | 488594018 |

### Preservation command / exact fingerprints

The following was executed after validation; all asserts passed. Pre-edit command
used the same computations without asserts and printed the Phase1 fingerprints.
```sh
python3 -B - <<'PY'
import ast, hashlib, json, stat
from pathlib import Path
r=Path('hermes_webui_receiver')
sha=lambda b: hashlib.sha256(b).hexdigest()
files={}
for p in sorted(r.rglob('*')):
    if p.is_file() and p.relative_to(r).as_posix() not in {'test_host_native_manifest.py','source_guard.json','INTEGRATION.md'}:
        s=p.stat(); files[p.relative_to(r).as_posix()]=[sha(p.read_bytes()),stat.S_IMODE(s.st_mode),s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ino]
digest=sha(json.dumps(files,sort_keys=True).encode())
assert len(files)==143 and digest=='479aef02a33b9c449d123e754f5f76a72f92b5269bd344d70f8a81772d1cf878'
print('PRESERVED_PACKAGE',len(files),digest)
a=ast.parse((r/'test_host_native_manifest.py').read_text())
for n in a.body:
    if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='MANIFEST_HASH' for t in n.targets): n.value=ast.Constant(value='IDENTITY')
digest=sha(ast.dump(a).encode()); assert digest=='1dfcc7938fb1027e6404d8389e5d7c61c6927ad15e2933101b4543ac86388e58'
print('TEST_AST_EXCEPT_IDENTITY',digest)
g=json.loads((r/'source_guard.json').read_text()); g['nativeIntegrationPatch']['sha256']='IDENTITY'
digest=sha(json.dumps(g,sort_keys=True).encode()); assert digest=='99e145d80544cf21f7ed19fbce9a3c701bf92d0ded0fe6651289127043f13b7d'
print('GUARD_EXCEPT_IDENTITY',digest)
for n in ['host_job.py','receiver.py','native.py','native.patch','native_patch_manifest.json','source_snapshot_manifest.json','source_guard.json','test_host_native_manifest.py','INTEGRATION.md']:
    print(sha((r/n).read_bytes()),n)
for n in json.loads((r/'native_patch_manifest.json').read_text()):
    print('UNCHANGED_OUTPUT_METADATA',n,files['source_snapshot/'+n])
print('PASS original product bytes/metadata and all test assertions preserved; only two static identity values changed')
PY
```
The inode/mtime aggregate is a same-worktree before/after invariant, not a portable
cross-machine pin. Exact current file SHA256s (package relative):
- `test_host_native_manifest.py`: `c5c9a78c2a5b3544fa2bd73ca808a2979b53fd3b850343af197c44f87d870b9d`
- `source_guard.json`: `1e42acac739d96f2dfba63c5c44380561df78476b83e7b3cd94d250a19c35159`
- `INTEGRATION.md`: `bb702485ce0404350baf8ee5c568e4cb4293ed0473bc0b8eacbddaa5e75da59c`
- unchanged `host_job.py`: `3437cdb14cb09a098cff4dc905a3b6ff251e42e658327dee30d8cae567976a01`
- unchanged `receiver.py`: `4d49279b04b5adf294103f9275c440cda6e8ec4fae01b5dd88da0d4846922d44`
- unchanged `native.py`: `52a90a9e785c3bde30cd11f766a3c861eedbaed738dcedc695478e75548df780`
- unchanged `source_snapshot_manifest.json`: `cfe5f82898f38923a90ec5081a71608f8e9b416fcd7b77ca16974a951f72a093`
- unchanged builder: `e16291f05ad4d1bc3f6b7530e4601bb2ccb4c7ab715f9f5234ba897349319224`
- unchanged verifier: `16605eb66ebaa7a170d67674e193bb2909bd7ef5d2cc954d33ce69177663ed77`

## Handoff

**READYFORIDENTITYGATE** (specialist implementation READY_FOR_VERIFICATION).
Native/ACK qualified per prior parent independent4f0 SAME-identity receipt;
host current fixture GREEN38, current7/107 proof GREEN; independent identity
and actual host metadata/preflight/staging pending. No live native/ACK rerun here.
All STOP template fields remain null/unattested. source_guard's older milestone
status is historical, intentionally not converted to an installation attestation.
Next: parent independently reruns fixed checks/read-only artifact, confirms actual
host metadata and protected staging for SAME pinned container/ONE restart only
under existing AJ conditional approval. This run authorizes no host execution.
No consequential new risk or material expansion discovered; no new approval request.

Final root command `git diff --check && git rev-parse HEAD && git status --short &&
git diff --stat` exited0; HEAD unchanged `ee914fce476de2190efdead7c3bc2ce8f59c19ce`.
Existing three tracked dirty subscriber/consumer/repair files remain untouched.
Package is still untracked, so git diff --check is only a tracked-diff hygiene
check, NOT proof of package scope. The before/after143-file metadata digest and
normalized test/guard fingerprints above establish this run's package scope.
Actual changed paths: two identity files, INTEGRATION pointer, this dedicated run.

### Independent inline fixture (no edited test helpers)

This supplementary check exercises real host_job file operations on a separate
copy with fake Docker only, fixed reviewed hashes, all seven fault restores,
replay/no-clobber and source/artifact guards. It is an independently constructed
fixture, NOT independent-person verification or actual host installation.
Run the Python block from tools/dev; exact launcher recorded below after execution.

```python
import ast, copy, hashlib, json, os, shutil, stat, subprocess, tempfile
from pathlib import Path
from unittest.mock import patch
from hermes_webui_receiver import host_job as job
r=Path('hermes_webui_receiver').resolve()
sha=lambda b: hashlib.sha256(b).hexdigest()
expected={'server.py':'REPLACE','api/routes.py':'REPLACE','api/models.py':'REPLACE',
          'static/ui.js':'REPLACE','api/rhythm_notify.py':'CREATE',
          'api/rhythm_inbox.py':'CREATE','api/rhythm_schema.py':'CREATE'}
assert sha((r/'native_patch_manifest.json').read_bytes())=='997524d5bf0b3b7ef2adbac73bad7ea62533eafb154b6ac1a774698b124844d0'
assert sha((r/'native.patch').read_bytes())=='1f99fbf5a68258aebcf9d760fbce129afe561734521aa9fc4bf20c6a7ec06a3c'
assert sha((r/'source_snapshot/api/rhythm_inbox.py').read_bytes())=='e89406af68a793e86eefd75d9bf4ada8371d438e7e5a19d80e189ac7688e6812'
native=json.loads((r/'native_patch_manifest.json').read_text())
pins=json.loads((r/'source_snapshot_manifest.json').read_text())['hashes']
guard=json.loads((r/'source_guard.json').read_text())
assert job.OUTPUTS==expected and set(native)==set(expected) and len(pins)==107
assert len(guard['sourceHashes'])==9
assert all(pins[n]==h for n,h in guard['sourceHashes'].items())
def tree(root):
    return {p.relative_to(root).as_posix():[sha(p.read_bytes()),stat.S_IMODE(p.stat().st_mode),p.stat().st_uid,p.stat().st_gid]
            for p in root.rglob('*') if p.is_file()}
with tempfile.TemporaryDirectory(dir='/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode') as home:
    os.environ['HOME']=home; os.environ['TMPDIR']=home; tempfile.tempdir=home
    for scenario in ['positive']+list(expected)+['source-drift','artifact-drift','foreign-create']:
        root=Path(tempfile.mkdtemp()).resolve(); source=root/'source'
        shutil.copytree(r/'source_snapshot',source)
        subprocess.run(['git','apply','--reverse',str(r/'native.patch')],cwd=source,check=True,capture_output=True)
        assert all(sha((source/n).read_bytes())==h for n,h in pins.items())
        for n,op in expected.items():
            if op=='CREATE' and (source/n).exists():
                assert (source/n).read_bytes()==b''; (source/n).unlink()
        originals=tree(source); artifacts=root/'artifacts'; artifacts.mkdir(mode=0o700)
        approved=artifacts/'approved.json'; approved.write_bytes((r/'native_patch_manifest.json').read_bytes()); approved.chmod(0o600)
        files=[]
        for index,(n,op) in enumerate(expected.items()):
            artifact=artifacts/str(index); artifact.write_bytes((r/'source_snapshot'/n).read_bytes()); artifact.chmod(0o600)
            info=(source/n).stat() if op=='REPLACE' else artifact.stat()
            assert native[n]['before']==pins.get(n) and sha(artifact.read_bytes())==native[n]['after']
            files.append(dict(path=n,operation=op,expectedAbsent=op=='CREATE',beforeHash=native[n]['before'],
                              afterHash=native[n]['after'],artifact=str(artifact),mode=stat.S_IMODE(info.st_mode),uid=info.st_uid,gid=info.st_gid))
        container=dict(Id='a'*64,Image=job.IMAGE,Config={'Healthcheck':{'Test':['CMD','fixture-health']}},
                       HostConfig={},State=dict(Running=True,Health=dict(Status='healthy')),
                       Mounts=[dict(Source=str(source),Destination='/webui',RW=False)])
        digest=sha(job.encoded({k:container[k] for k in ('Id','Image','Config','HostConfig','Mounts')}).encode())
        m=dict(image=job.IMAGE,restartBudget=1,containerId=container['Id'],configDigest=digest,mountedSourceRoot=str(source),
               approvedPatchManifest=str(approved),backupDirectory=str(root/'backup'),files=files,
               readiness=dict(kind='docker-health',status='healthy'),hostFacility=dict(kind='nohup',attestedAvailable=True,launchedOnHost=True),
               nativeGate=dict(result='PASS',verifier='INLINE-OFFLINE-FAKE-NOT-HOST-ATTESTATION',cases={k:'PASS' for k in job.GATES},
                               sourceManifestHash='997524d5bf0b3b7ef2adbac73bad7ea62533eafb154b6ac1a774698b124844d0',evidenceHash='d'*64,
                               patchSetHash=sha(job.encoded(files).encode())))
        calls=[]
        def docker(argv,timeout=30):
            calls.append(argv)
            if argv==['docker','inspect',container['Id']]: return json.dumps([container]).encode()
            assert argv==['docker','restart',container['Id']]; return b''
        if scenario=='source-drift': (source/'static/ui.js').write_bytes(b'foreign-source')
        if scenario=='artifact-drift': Path(files[-1]['artifact']).write_bytes(b'foreign-artifact')
        if scenario=='foreign-create': (source/'api/rhythm_inbox.py').write_bytes(b'foreign-created')
        before=tree(source); real=job.atomic_replace; injected=[False]
        def atomic(target,*args,**kwargs):
            result=real(target,*args,**kwargs)
            if scenario in expected and target==source/scenario and not injected[0]:
                injected[0]=True; raise OSError('committed publication fault')
            return result
        with patch.object(job,'command',side_effect=docker),patch.object(job.time,'sleep'),patch.object(job,'atomic_replace',side_effect=atomic):
            if scenario in ['source-drift','artifact-drift','foreign-create']:
                try: job.run(m)
                except ValueError: pass
                else: raise AssertionError('source/artifact guard did not reject')
                assert tree(source)==before and not (root/'backup').exists()
                assert all(c[1]=='inspect' for c in calls)
            elif scenario in expected:
                result=job.run(m)
                assert injected[0] and result['state']=='source_restored_runtime_unqualified' and not result['restartAttempted']
                assert tree(source)==originals and all(c[1]=='inspect' for c in calls)
            else:
                assert job.validate_manifest(m) is m and tree(source)==originals and not calls
                assert job.run(m)['state']=='installed'
                after=tree(source); assert set(after)==set(originals)|set(expected)
                for n,old in originals.items():
                    assert after[n][1:]==old[1:]
                    if n not in expected: assert after[n]==old
                for f in files:
                    assert after[f['path']]==[f['afterHash'],f['mode'],f['uid'],f['gid']]
                    print('OUTPUT',f['path'],'before='+str(f['beforeHash']),'after='+f['afterHash'],'metadata='+str(after[f['path']][1:]))
                try: job.run(m)
                except ValueError: pass
                else: raise AssertionError('replay was not rejected')
                assert tree(source)==after and calls.count(['docker','restart',container['Id']])==1
        print('PASS',scenario)
    template=job.pending_manifest_template(r)
    assert all(template[k] is None for k in ('configDigest','backupDirectory','approvedPatchManifest'))
    assert all(f[k] is None for f in template['files'] for k in ('artifact','mode','uid','gid'))
    assert template['hostFacility']==dict(kind=None,attestedAvailable=False,launchedOnHost=False)
    assert template['nativeGate']['result']=='NOTRUN' and all(v=='NOTRUN' for v in template['nativeGate']['cases'].values())
    assert all(template['nativeGate'][k] is None for k in ('verifier','evidenceHash','patchSetHash'))
    with patch.object(job,'command') as commands:
        for invalid in (guard,template):
            try: job.run(invalid)
            except ValueError: pass
            else: raise AssertionError('unattested source guard/template was accepted')
        commands.assert_not_called()
    print('PASS nine original deployed source guards; null STOP template; source_guard is not installable')
```
