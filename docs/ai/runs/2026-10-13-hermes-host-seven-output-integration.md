---
date: 2026-10-13
repo: Rhythm
branch: hermes-event-notify-20261012
pr: 1616
issues: []
status: READYFORHOST7INDEPENDENTGATE
tags: [run, Rhythm]
---

# Host seven-output integration (independent disjoint owner)

## Scope / approvals

Explicit parent handoff authorizes ONLY `host_job.py`, `test_host*.py`, new
`test_host_native_manifest.py`, and this run note under the notify worktree.
Exact reviewed allowlist expands five to seven: REPLACE server.py, api/routes.py,
api/models.py, static/ui.js; CREATE api/rhythm_notify.py, api/rhythm_inbox.py,
api/rhythm_schema.py. No arbitrary expansion. Native source, manifest, receiver,
adapter, DOM, subscriber, native fixtures are frozen and untouched.
No host/SSH/Docker execution, ports, live config/data, credential access,
dependency installs, cleanup, commits or pushes. Parent owns actual ACK and
integration after the independent native gate. No renewed approval needed for
unchanged approved scope.

## Phase 0 — acceptance contract

Loaded acceptance-contract first, then coding-agent; read repo memory.
Frozen check: `tools/dev/hermes_webui_receiver/test_host_native_manifest.py`.
Command (worktree root):

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/dev python3 -m unittest hermes_webui_receiver.test_host_native_manifest -v
```

RED before implementation: Ran 5 tests; FAILED (failures=1, errors=8).
`test_actual_seven_plan_dry_validation_and_full_install`: exact OUTPUTS lacks
models/ui. Seven publication-fault subcases rejected with `approved files required`.
Template check: missing pending_manifest_template (requested functionality).
No-clobber and missing-health negative checks already pass because the old
five-file guard rejects the plan first; these are retained safety boundaries,
not proof of health enforcement until positive seven-file install passes.
Mandate: make these frozen named checks pass without editing them. Parent
independent host verifier can run this command without source write access;
only disposable temp files are written. Docker boundary alone is faked, real
installer/filesystem is not mocked. No actual Native PASS claim.

Input manifest SHA256: `e56afa198b585de76f3d416eda799fc5335a7d36d5471f7d9211a06c4d868c3a`.
Native patch SHA256: `a4c0ec35fe76226db0a484367282c437ed2507fabdbdfdc22ffaaccee6e15a01`.
Baseline HEAD: `ee914fce476de2190efdead7c3bc2ce8f59c19ce`, dirty package preserved.
Actual tests verify seven after-hashes and recover all 107 before pins via
reverse patch only in a disposable copy; worktree native bytes never altered.

## Phase 1 — bounded impact review

GitNexus upstream impact for host_job.validate_manifest and install:
Target not found, risk UNKNOWN, indexed repo Rhythm. This is unindexed surface,
not zero blast radius. Manual full surface: validate_manifest → run → install;
main validates before execution; all three existing host modules are callers.
Existing restoration, inode ownership, mode/uid/gid, no-clobber, no-follow chain,
artifact/source pins, replay backup and one-restart logic reviewed in full.
Consequential risk: seven-source rollback includes new frontend directory and
models source; health absent must stop before writing, not after restart.
Proportionate gate: all old host assertions preserved with seven-output fixture,
all seven publication faults, whole 107-object tree/content/metadata equality,
actual-manifest full fake install and structured Docker inspect boundary.

## Files / Checks / Handoff

Changed paths (only assigned paths): host_job.py, test_host_exact_patch.py,
test_host_failure_windows.py, test_host_job.py, new test_host_native_manifest.py,
and this note. No native files modified. GitNexus additionally queried ExactPatch,
FailureWindows, HostHardening: all target-not-found / UNKNOWN. Exact literal
caller search found test_repair_round1.py too: its historical host test still
uses lowercase operations, arbitrary curl readiness and missing metadata.
It is outside ownership, left frozen, NOTRUN; never broaden host validation
to admit that obsolete plan. Parent must account for it in full integration.

Implementation: seven exact typed operations, existing approved manifest digest
and per-file before/after binding retained; source metadata preserved; artifacts
remain protected single-link owner-only; CREATE remains atomic no-clobber.
Added fail-before-write requirement for existing configured Docker health and
structured health state. No health program executes, no new config/healthcheck
is installed, read-only /webui mount preserved. Existing inode-owned restoration
logic unchanged, no implicit second restart, runtime restoration never claimed.

Fresh gate command:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/dev python3 -m unittest hermes_webui_receiver.test_host_native_manifest hermes_webui_receiver.test_host_exact_patch hermes_webui_receiver.test_host_job hermes_webui_receiver.test_host_failure_windows -v
```

First implementation run: Ran 35 tests in 1.365s; FAILED (errors=8).
All old 30 passed. Actual fixture reverse patch leaves empty CREATE targets;
installer truthfully rejects `CREATE target must be absent`. Repair 1 was
fixture-only: verify empty then unlink ONLY disposable reverse-patch artifacts.
No named acceptance assertion edited/removed; production absence guard unchanged.
New stronger host boundaries added before final gate. No second repair needed.

Final run: **Ran 38 tests in 1.544s — OK**. Counts: original 30 retained,
5 actual-manifest checks, 3 additional boundary checks. Seven actual publication
faults and seven existing directory-fsync publication faults each restore exact
approved content/metadata and CREATE absence; actual fixture compares the entire
107 original source-file tree. Full actual seven-output fake install checks every
hash/metadata, unchanged neighbors, single SAME-container restart, then replay
refusal. Additional checks cover 35 missing-metadata cases, api/static symlink
parents, config/image/source-root readiness drift, foreign inode retention for
each of the three CREATE files on ambiguous restart. Old malformed plans,
shell/argv readiness, hash/permissions, source/artifact/backup races, durability
truthfulness, unattempted foreign changes and no-second-restart assertions remain.
Prior bb0 30+7+3 receipts remain historical, not reused as current qualification.

`git diff --check`: exit 0 (tracked diff only; host files currently untracked
inside the pre-existing dirty package). Final hashes via `shasum -a 256`:

| Artifact | SHA256 |
|---|---|
| host_job.py | `3437cdb14cb09a098cff4dc905a3b6ff251e42e658327dee30d8cae567976a01` |
| test_host_native_manifest.py | `9133274fc6163e93e83245e939d84692e71f22eab3e07e6369dd5052798c5c01` |
| test_host_exact_patch.py | `9bfe532bb6aa677daaee34cbb4177501b8717838ea434b062cd0ecd23b37d74c` |
| test_host_job.py | `6e601a1550d90186a30f063e5fbde716abe4da3ad7de6190807c772d0abc5821` |
| test_host_failure_windows.py | `64ae78a80e6feb5b30f50e42aa1d37632339573778c4b9042e547f8b06d3849d` |

Native manifest and patch hashes rechecked unchanged after gate. Actual Native
gate / Docker / host install / host readiness / actual Rhythm ACK: **NOTRUN**.

## Host manifest template

Template path: this note's `Host manifest template` section; canonical generator:
`tools/dev/hermes_webui_receiver/host_job.py:pending_manifest_template`.
Read-only generation command run successfully (prints only non-secret template):

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/dev python3 -c 'import json; from pathlib import Path; from hermes_webui_receiver.host_job import pending_manifest_template; print(json.dumps(pending_manifest_template(Path("tools/dev/hermes_webui_receiver")), indent=2))'
```

STRICT deployment-schema template below is deliberately **not executable**:
unknown inputs are null/false/NOTRUN, not invented PASS/true. Captured mount
destination `/webui`, writable `false`; host source root and immutable image and
container identity are the actual capture. Snapshot pins contain before hashes,
not deployed owner/mode attestations; local copy uid/gid is not host evidence.
`readiness.status=healthy` is the required post-restart comparison, NOT a claim
that the actual host is healthy. No config values are included.

```json
{
  "image": "sha256:4fbb112fb9f90efac654c43239cffc233122c2b7536aaad9de1e88455c20de0a",
  "restartBudget": 1,
  "containerId": "8b5fa0a02828be30446501025a4ffdfbb6a9462a32e8da9cc5b706e874395eec",
  "configDigest": null,
  "mountedSourceRoot": "/home/pi-nas/stacks/hermes-webui",
  "backupDirectory": null,
  "approvedPatchManifest": null,
  "files": [
    {"path":"server.py","operation":"REPLACE","expectedAbsent":false,"beforeHash":"975cfd680fee011d71d630cb5d68df6d2d8b09461e867584ba71ca54ea3efdd6","afterHash":"2b39e3a15b69c58006d1450a1edf4dd2119ab6ce5c4ace8e70239ac82e0e16fa","artifact":null,"mode":null,"uid":null,"gid":null},
    {"path":"api/routes.py","operation":"REPLACE","expectedAbsent":false,"beforeHash":"7500a207fbba663f25407d04f47a6e618e8e16aa07634a8cd921d5081ee8b66c","afterHash":"a6b0ceb93cd4cdfc09c5d79480713faeaf16d4939cb92680e3d930f0e3603d34","artifact":null,"mode":null,"uid":null,"gid":null},
    {"path":"api/models.py","operation":"REPLACE","expectedAbsent":false,"beforeHash":"2631a28024f9dc6018a5ceeebd5c7e09bfdae9496f496f7e7e233c951456fa82","afterHash":"3c943e69fc18b33768a852c256c15825447bb3065cf3933946ec80116bafec43","artifact":null,"mode":null,"uid":null,"gid":null},
    {"path":"static/ui.js","operation":"REPLACE","expectedAbsent":false,"beforeHash":"33c50f790a4a5c9787e5be99369232460d40e2e52042ed48c68be1e06fe4e655","afterHash":"7e5ba50ec4c03c8797fafc49bb989de2a95967955f617e79ced23cf3ad4791ce","artifact":null,"mode":null,"uid":null,"gid":null},
    {"path":"api/rhythm_notify.py","operation":"CREATE","expectedAbsent":true,"beforeHash":null,"afterHash":"52a90a9e785c3bde30cd11f766a3c861eedbaed738dcedc695478e75548df780","artifact":null,"mode":null,"uid":null,"gid":null},
    {"path":"api/rhythm_inbox.py","operation":"CREATE","expectedAbsent":true,"beforeHash":null,"afterHash":"395771e23f0ab44f3d6a69909070fdf2b13e97cdf1c71f22fd1cc9ee2807aede","artifact":null,"mode":null,"uid":null,"gid":null},
    {"path":"api/rhythm_schema.py","operation":"CREATE","expectedAbsent":true,"beforeHash":null,"afterHash":"8b0002f10c6906443af059920bf93fd60810d7e16f58351b381324ebce85af38","artifact":null,"mode":null,"uid":null,"gid":null}
  ],
  "readiness": {"kind":"docker-health","status":"healthy"},
  "hostFacility": {"kind":null,"attestedAvailable":false,"launchedOnHost":false},
  "nativeGate": {
    "result":"NOTRUN",
    "cases": {"actual_native_entrypoint":"NOTRUN","arrival_correct_chat_wake_visible":"NOTRUN","busy_durable_no_steer":"NOTRUN","crash_ambiguous_native_journal":"NOTRUN","duplicate_full_identity_collision":"NOTRUN","frontend_dom":"NOTRUN","old_session_owner_profile_revocation":"NOTRUN","restart_reopen":"NOTRUN","zero_network_provider_test_setup_only":"NOTRUN"},
    "verifier":null,
    "sourceManifestHash":"e56afa198b585de76f3d416eda799fc5335a7d36d5471f7d9211a06c4d868c3a",
    "evidenceHash":null,
    "patchSetHash":null
  }
}
```

## Parent handoff / STOP preflight

**READYFORHOST7INDEPENDENTGATE** (offline host artifact only).
Independent verifier reruns the 38-check command above against these pinned
artifacts. Pending inputs, all NOTRUN and STOP rather than inferred:

1. Actual independent nine-case native gate bound to this manifest digest,
   verifier and evidenceHash; parent recomputes patchSetHash only after exact
   protected staged artifact locations and file metadata are reviewed.
2. Parent-authorized read-only host inspection: current exact container/image,
   config fingerprint (Id/Image/Config/HostConfig/Mounts, never log Config),
   same captured /webui source mount and Running state. Existing configured
   Docker health Test and structured State.Health.Status must be present.
   Missing health is a STOP, not permission to configure one.
3. Host facility kind/resolution/availability plus launched-on-host attestation;
   no availability or scheduler resolution was established in this slice.
4. Actual protected staging artifact/approved manifest paths, new protected
   backup parent and absent backup path, deployed four REPLACE uid/gid/mode
   and approved three CREATE uid/gid/mode. Read-only absence/hash/chain checks,
   no live source permissions broadened. No operator data/new configs touched.

No install/restart authorization is granted by passing offline fixtures. Parent
owns actual ACK implementation and integrated runtime qualification next; this
slice has no actual ACK code. Source restoration receipts are deliberately
runtime-unqualified and an additional restart still requires separate approval.
