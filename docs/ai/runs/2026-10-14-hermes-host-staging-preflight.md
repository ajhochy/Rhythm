---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: READYSTAGINGFORINDEPENDENTGATE
tags: [run, rhythm]
---

# Protected host staging — install/restart NOTRUN

## Scope / approval / Phase 0

Explicit parent specialist handoff: INSTALLPREPARATION ONLY, one owner. Loaded
acceptance-contract first, coding-agent second; read AGENTS, project-state,
current-plan, full host_job.py and INTEGRATION, current identity/native ACK receipts,
receiver/subscriber dependencies and source guard. No orchestrator/peer dispatch.
Retained worktree HEAD `bb4a5651addbffc73a9ad47279196c783ba0cc4a`.

WAIVED: new failing behavioral acceptance test — non-behavioral staging/docs only;
no source, native algorithm, host algorithm or test edits. Existing independent
behavioral gates are retained, not rerun or substituted by staging checks.

Fixed staging acceptance: exact reviewed seven output bytes and four installer
dependency files; remote new operator-owned0700 staging tree with0600 regular
single-link artifacts; original four REPLACE hashes/mode0644/uidgid1000; all three
CREATE targets absent with planned0644/1000:1000; original nine dependency pins;
same container/image/config digest and configured healthy Docker state; available
independent host facility; provenance-bound gate summary; candidate without fake
service-launch attestation; read-only preflight; backup absent; reviewed parent
command NOTRUN. Parent independently verifies these artifacts before execution.

AJ's prior exact conditional approval is retained: tested WebUI install, ONE
planned restart, same image/config, independent host job. Latest eight chmod
approval is not a new install/restart grant. Parent already applied only four
directories775→755 and four files664→644, uid/gid unchanged1000. Original/rollback
permission receipt: `/private/tmp/rhythm-pi-permissions-1791993978313648000`.
This agent did not repeat chmod or read that private receipt's contents.

Allowed writes: this run note; temporary local staging/procedure files; NEW remote
`/home/pi-nas/rhythm-notify-stage-bb4a5651` only. No mounted app writes, runtime
DB/secret/token/config/chat/provider copies, registry provisioning, receiver
activation requests, actual API chats, services/jobs, Docker restart/recreate,
ports/relay/Tailscale/config/image changes, live migration, real cards, desktop
signature, Drive/email/billing, dependencies, destructive cleanup, commit or push.

## Phase 1 — consolidated surface / risk

Read entire existing installer524 lines, its seven-output schema and nine GATES.
No shared indexed symbols are edited: GitNexus edit-impact is not applicable to
new run documentation and copying immutable artifacts outside the worktree.
Existing installer stays pinned `3437cdb1…`, including original canonical inspect
digest algorithm: SHA256 of receiver.encoded JSON selecting Id, Image, Config,
HostConfig, Mounts (sorted keys, compact separators, ensure_ascii). No prior
different algorithm fingerprint is reused. Docker inspect values/health command
and environment never printed or stored; only internally computed digest and
allowlisted status/identity metadata returned.

Concrete risk: a staging template falsely asserting it has survived a service
launch. Mitigation: candidate `launchedOnHost=false`; actual SSH host-process
proof supplies an in-memory validation-only copy with true, never writes an
executed manifest or calls run/install. Future execution additionally checks
actual user systemd service MainPID equals launcher PID, active state and matching
InvocationID, plus explicit parent-reviewed candidate and evidence hashes. Only
that branch writes a new0600 executed-manifest, then invokes unchanged host_job
CLI with `--execute-parent-authorized`. Parent must review this new launcher;
its own guards are preparation, not independent approval.

First bounded attempt failed before local/remote staging: host denied
`os.readlink('/proc/1/ns/mnt')` with PermissionError13. A read-only diagnostic
confirmed this exact denial. No escalation, permission change or policy bypass.
Second/final attempt uses readable PID1/systemd, self-cgroup/container-marker
checks. It does NOT claim mount-namespace equality. Future actual service
MainPID/InvocationID proof remains mandatory. This is an available-metadata
adjustment to the new staging wrapper, not modification of host_job's algorithm.

## Files

Remote staging root (all directories0700, owner1000:1000):
`/home/pi-nas/rhythm-notify-stage-bb4a5651`.
Only subdirectories: `artifacts`, `hermes_webui_receiver`.
Every following remote file is0600, uid/gid1000:1000, regular, single-link;
hashes read back after writing and reverified by the read-only launcher.

| Stage-relative path | SHA256 |
|---|---|
| launcher.py | `56645439623e6ad292e09f54815a351715b5aafb374bf9f7ccc705d085cacf33` |
| hermes_webui_receiver/host_job.py | `3437cdb14cb09a098cff4dc905a3b6ff251e42e658327dee30d8cae567976a01` |
| hermes_webui_receiver/receiver.py | `4d49279b04b5adf294103f9275c440cda6e8ec4fae01b5dd88da0d4846922d44` |
| hermes_webui_receiver/__init__.py | `793cf32b7e6c6f73162cbf40d1cf63e74c40ae63fc84af6301f98b25290c0750` |
| hermes_notify_subscriber.py | `270548dfe3c047babe7445db98ccf5d70226b9c37273cca5c6b8f7b49fa58656` |
| native_patch_manifest.json | `997524d5bf0b3b7ef2adbac73bad7ea62533eafb154b6ac1a774698b124844d0` |
| candidate-manifest.json | `345f06d30d645936a5a01442045e92814290a9a15bce8f8f56ee975c044f1822` |
| independent-gate-evidence.json | `f92b7221e403f350f98526965a72dbd863d68ea4e71bf76de908e438f6db7919` |
| inventory.json | `a6f4a4f023b6bf74e2287bad1088a6a2daf399d97c3952d9ff02b71271954d1d` |
| artifacts/0 — server.py | `2b39e3a15b69c58006d1450a1edf4dd2119ab6ce5c4ace8e70239ac82e0e16fa` |
| artifacts/1 — api/routes.py | `a6b0ceb93cd4cdfc09c5d79480713faeaf16d4939cb92680e3d930f0e3603d34` |
| artifacts/2 — api/models.py | `3c943e69fc18b33768a852c256c15825447bb3065cf3933946ec80116bafec43` |
| artifacts/3 — static/ui.js | `7e5ba50ec4c03c8797fafc49bb989de2a95967955f617e79ced23cf3ad4791ce` |
| artifacts/4 — api/rhythm_notify.py | `52a90a9e785c3bde30cd11f766a3c861eedbaed738dcedc695478e75548df780` |
| artifacts/5 — api/rhythm_inbox.py | `e89406af68a793e86eefd75d9bf4ada8371d438e7e5a19d80e189ac7688e6812` |
| artifacts/6 — api/rhythm_schema.py | `8b0002f10c6906443af059920bf93fd60810d7e16f58351b381324ebce85af38` |

Proposed backup: `/home/pi-nas/rhythm-notify-stage-bb4a5651/backup`, verified absent,
NOT created. `executed-manifest.json` also absent. New staging creation refused
ANY existing path, including symlink; no existing content overwritten or removed.
Candidate patchSetHash (sha of exact encoded files including absolute artifact
paths, before/after hashes, operation/absence/mode/uid/gid):
`fecdac8ded17094c37aaee91dae44d6e53feb5d04dbab2d35a03e95f1a63a778`.

Local protected0700 artifact tree:
`/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/hermes-notify-staging-bb4a5651`.
Contains identical16 files0600 plus local-only0600 `transfer-receipt.json`.
Local procedure files in the same approved temporary parent:
- `hermes-prepare-stage-bb4a5651.py` SHA `743fed4212bc449d64219f4f28668230ceda19450027cecab2507478d19b594f`.
- `hermes-stage-launcher-bb4a5651.py` SHA same as staged launcher above.
No source_snapshot modification/regeneration: seven outputs copied byte-identical;
local ignored copied-source fixture retained. Native patch remains
`1f99fbf5a68258aebcf9d760fbce129afe561734521aa9fc4bf20c6a7ec06a3c`.

## Gate evidence provenance — not this agent's test PASS

Protected summary binds current manifest/patch/host/receiver/native hashes, exact
source pins, nine named gate cases PASS and verifier IDs:
`4f0b4373-a18e-426e-8790-9d762774df33` +
`baa5df2a-2df0-4cec-bc9d-217631def247`, never implementation-owner.
Parent-confirmed receipts: actual native ACK1 PASS, native30, migration11,
unobscured screenshot/browser evidence, provider1, wrong-run ACK404, reopen/retry,
tombstone2, actual DB visible, foreign unchanged. Host38 + independent13 scenarios
+8 invalid denials PASS;107 original pins and seven current outputs verified.
Current bb4a5651 all3 CI green is explicitly parent gh-observed, not rerun here.
Ambiguous committed-before-launch crash quarantine qualifies safety/no replay,
NOT a liveness promise. Historical failed receipts are not rewritten.

Summary explicitly records `installation=NOTRUN`, `activation=NOTRUN`, independent
staging review PENDING. It hashes the retained completion-resume, current identity
and realACK readiness receipt documents; those link full commands, evidence and
screenshots. No raw diagnostic/credential/config or screenshot bytes transferred.

## Phase 2 — actual commands / checks

All SSH used existing key, BatchMode=yes, StrictHostKeyChecking=yes,
ConnectTimeout=10, exact `pi-nas@100.109.210.55`; no host-key override.
Initial read-only identity/facility/path probe: uid1000, gid1000, user systemd
manager `running`, proposed staging absent. `/usr/bin/systemd-run --version`
read-only: systemd257 (257.13-1~deb13u1).

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 pi-nas@100.109.210.55 '/usr/bin/id -u; /usr/bin/id -g; /usr/bin/test -x /usr/bin/systemd-run && /usr/bin/systemctl --user is-system-running; /usr/bin/test -d /home/pi-nas && /usr/bin/test ! -e /home/pi-nas/rhythm-notify-stage-bb4a5651 && /usr/bin/test ! -L /home/pi-nas/rhythm-notify-stage-bb4a5651'
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 pi-nas@100.109.210.55 '/usr/bin/systemd-run --version'
```
Permission diagnostic ran remote `/usr/bin/python3 -B -c` importing os/json/Path
and attempting JSON booleans for uid/gid, PID1systemd, mount-namespace equality,
container markers and staging existence. Equality expression
`os.readlink('/proc/self/ns/mnt') == os.readlink('/proc/1/ns/mnt')` raised
PermissionError13; no other read/write or escalation followed that diagnostic.

Bounded preparation command, run twice, retained worktree cwd:
```sh
python3 -B /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/hermes-prepare-stage-bb4a5651.py
```
Attempt1: `BLOCKED remote operation (no sensitive stderr disclosed)`; diagnostic
identified namespace-read PermissionError, no staging reached. Attempt2 after
documented adjustment: exit0, FRESH_HOST allowed metadata, STAGED `staged_only`,
16 files verified mode384(0600)/uidgid1000, staging448(0700), backup absent.
Procedure uses only read-only remote source/stat/inspect/facility checks then
exclusive new staging directory/artifact writes. It does not call installer run.

Actual staged read-only validation (safe for parent to repeat):
```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 pi-nas@100.109.210.55 '/usr/bin/python3 -B /home/pi-nas/rhythm-notify-stage-bb4a5651/launcher.py'
```
Observed exit0: `state=read_only_preflight_pass`, `execution=NOTRUN`,
`serviceLaunched=false`, `candidateLaunchedOnHost=false`, `backupAbsent=true`,
`executedManifestAbsent=true`. All16 actual staged hashes/protection and module
origins verified; all11 unique original-source pins (original9 plus server/ui),
four replacement metadata and three CREATE absences rechecked. Uses unchanged
host_job.inspect and validate_manifest, NEVER run/install or CLI execute.
Its in-memory validation-only true flag attests that actual host SSH Python
process, not a launched installation service. Candidate remains intentionally
invalid for direct host_job CLI until an actual parent service invocation.

Fresh host identity (rechecked after staging with unchanged host_job.inspect):
- Container `8b5fa0a02828be30446501025a4ffdfbb6a9462a32e8da9cc5b706e874395eec`.
- Image `sha256:4fbb112fb9f90efac654c43239cffc233122c2b7536aaad9de1e88455c20de0a`.
- configDigest `f32cd63ffaf5bb29ed3e3d32a634f49673e0a08cc8e141cad17964c049f3d99b`.
- Running true, configured Docker health present, status healthy; no CMD output.
- Exact source `/home/pi-nas/stacks/hermes-webui` mounted read-only at `/webui`.
- `/home/pi-nas`0700; stacks/source/api/static0755, all uidgid1000:1000.
- `/usr/bin/systemd-run` executable; user SystemdManager running. PID1 systemd,
  no container marker files or docker/kubepods/libpod/lxc self-cgroup markers.

All four source REPLACE before hashes were actual read/verified, mode0644 and
owner1000:1000; originals retained in protected candidate and gate summary:

| Source path | Before SHA256 |
|---|---|
| server.py | `975cfd680fee011d71d630cb5d68df6d2d8b09461e867584ba71ca54ea3efdd6` |
| api/routes.py | `7500a207fbba663f25407d04f47a6e618e8e16aa07634a8cd921d5081ee8b66c` |
| api/models.py | `2631a28024f9dc6018a5ceeebd5c7e09bfdae9496f496f7e7e233c951456fa82` |
| static/ui.js | `33c50f790a4a5c9787e5be99369232460d40e2e52042ed48c68be1e06fe4e655` |

Other original nine-pin files remain unchanged, observed0664/1000:1000 (no chmod
applied here). CREATE api/rhythm_notify.py, api/rhythm_inbox.py, api/rhythm_schema.py
actual absent, beforeHash null; future installed metadata0644/1000:1000 explicitly
chosen per staging handoff, not inferred from0600 protected artifact metadata.

Local runnable artifact check (no mocks; no product tests edited/run):
```sh
python3 -B - <<'PY'
import ast, hashlib, json, stat
from pathlib import Path
root=Path('/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012')
p=Path('/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/hermes-notify-staging-bb4a5651')
sha=lambda b:hashlib.sha256(b).hexdigest()
manifest=json.loads((p/'candidate-manifest.json').read_bytes())
evidence=json.loads((p/'independent-gate-evidence.json').read_bytes())
receipt=json.loads((p/'transfer-receipt.json').read_bytes())
inventory=json.loads((p/'inventory.json').read_bytes())
assert len(inventory)==15 and len(receipt['files'])==16
for name,h in inventory.items():
    assert sha((p/name).read_bytes())==h==receipt['files'][name]['sha256']
    assert receipt['files'][name]['mode']==0o600 and receipt['files'][name]['uid']==receipt['files'][name]['gid']==1000
    assert stat.S_IMODE((p/name).stat().st_mode)==0o600
assert manifest['hostFacility']['launchedOnHost'] is False
assert manifest['restartBudget']==1
assert manifest['nativeGate']['evidenceHash']==sha((p/'independent-gate-evidence.json').read_bytes())
assert evidence['verifierIDs']==['4f0b4373-a18e-426e-8790-9d762774df33','baa5df2a-2df0-4cec-bc9d-217631def247']
assert evidence['installation']==evidence['activation']=='NOTRUN'
assert evidence['independentStagingReview']=='PENDING'
for f in manifest['files']:
    local=p/Path(f['artifact']).relative_to('/home/pi-nas/rhythm-notify-stage-bb4a5651')
    assert sha(local.read_bytes())==f['afterHash']
    assert local.read_bytes()==(root/'tools/dev/hermes_webui_receiver/source_snapshot'/f['path']).read_bytes()
    assert (f['mode'],f['uid'],f['gid'])==(0o644,1000,1000)
for name in ['hermes_webui_receiver/host_job.py','hermes_webui_receiver/receiver.py','hermes_webui_receiver/__init__.py','hermes_notify_subscriber.py']:
    assert (p/name).read_bytes()==(root/'tools/dev'/name).read_bytes()
    ast.parse((p/name).read_bytes())
ast.parse((p/'launcher.py').read_bytes())
print('PASS: 16 remote file receipts; 15 inventory bindings; exact7 output bytes; unchanged4 dependency bytes; candidate host launch false; independent evidence provenance; syntax')
for name in ['hermes-prepare-stage-bb4a5651.py','hermes-stage-launcher-bb4a5651.py']:
    q=p.parent/name; print('PROCEDURE_SHA',name,sha(q.read_bytes()))
PY
```
Observed exit0, exact PASS line and the two procedure SHAs above.
No live-component/native/host-install test, fake Docker, test waiver of behavioral
gates, or external provider request was used to manufacture these staging checks.

Final command, retained worktree cwd:
```sh
git diff --check && git status --short && git rev-parse HEAD && ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 pi-nas@100.109.210.55 '/usr/bin/python3 -B /home/pi-nas/rhythm-notify-stage-bb4a5651/launcher.py'
```
Observed exit0, unchanged HEADbb4a5651, no tracked changes; this new run note plus
four pre-existing untracked screenshot artifact directories only. Repeated host
preflight PASS with identical candidate/config digest, original before metadata,
three CREATE absences, backup/executed-manifest absent, serviceLaunched false and
execution NOTRUN. `git diff --check` covers tracked-diff hygiene, not remote staging
or untracked documentation; actual staged byte checks above cover those artifacts.

## Planned parent command — NOT RUN

Only AFTER parent independent read-only artifact review, receipt-source identity
review and fresh preflight, under original still-current conditional approval.
Run ON HOST as pi-nas; independent user service survives target-container stop.
Do not use a container exec or launch the wrapper directly with execution flags.

```sh
/usr/bin/systemd-run --user --unit=rhythm-notify-install-bb4a5651 --service-type=exec --property=Restart=no --property=UMask=0077 --working-directory=/home/pi-nas/rhythm-notify-stage-bb4a5651 --setenv=PYTHONPATH=/home/pi-nas/rhythm-notify-stage-bb4a5651 /usr/bin/python3 -B /home/pi-nas/rhythm-notify-stage-bb4a5651/launcher.py --execute-parent-authorized --reviewed-candidate-sha 345f06d30d645936a5a01442045e92814290a9a15bce8f8f56ee975c044f1822 --independent-gate-reviewed f92b7221e403f350f98526965a72dbd863d68ea4e71bf76de908e438f6db7919
```

Launcher then invokes exact reviewed installer command (NOT RUN here):
```sh
/usr/bin/python3 -B -m hermes_webui_receiver.host_job --manifest /home/pi-nas/rhythm-notify-stage-bb4a5651/executed-manifest.json --execute-parent-authorized
```
All stdlib; PYTHONPATH fixed to protected package parent; actual module locations
checked. No arbitrary readiness argv. Existing Docker health state comparison
only. Candidate schema strictly supplied except deliberately false service-launch
flag, promoted solely after actual service identity validation. The two explicit
review-hash flags are operator review acknowledgments, NOT credentials or a new
authorization mechanism. Parent must not treat staging PASS as approval to run.

## Rollback / handoff

READYSTAGINGFORINDEPENDENTGATE (specialist READY_FOR_VERIFICATION). Parent owns
independent staging/launcher review and any later execution. Current gates can be
reviewed read-only against protected artifacts; no unchanged-scope reapproval
requested. Host namespace permission denial is distinct from workflow approval
and remains respected. No current blocker to read-only staging verification.

Rollback semantics remain unchanged: installer backups four originals and exact
metadata, exclusive CREATE publication, all-seven preflight before writes,
persistent one-restart intent. On failure it attempts approved source restoration,
does not delete foreign targets and reports verified/durable status truthfully.
Restored source is NOT proof of runtime rollback after restart. No automatic
second restart, no restarting/resuming a job with an existing backup, no deletion
of markers, backup/staging/inbox/chat data. Any additional rollback restart needs
separate explicit authorization. No rollback operation performed in this slice.

Native notification feature remains dormant for usable run delivery until a
separately authorized operator registry/link and synthetic smoke; installation
and notification deployment completion are NOT claimed. No credentials supplied.
