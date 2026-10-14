# Offline staged receiver — not installed, native integration incomplete

## Current identity pointer (2026-10-13)

The historical checkpoints below are retained, not current qualification claims.
See [current identity reconciliation](../../../docs/ai/runs/2026-10-13-hermes-current-identity-reconciliation.md)
for the reviewed manifest `997524d5…`, patch `1f99fbf5…`, unchanged seven outputs,
host fixture results and parent-provided prior native/actual ACK qualification.
Installation remains NOTRUN; parent independent identity/host preflight is required.
This pointer does not supply any missing host metadata or native attestation.

## Continuation checkpoint (2026-10-13)

The approved strict SSH source transfer now succeeded. `source_snapshot/` contains
107 application files; `source_snapshot_manifest.json` records each SHA256 and the
archive hash. All nine original pins, including APPLICATION SOURCE `api/config.py`,
were checked before imports. No runtime configuration, credentials, live DB/chat,
environment or full Docker inspection was collected. The source snapshot is
unmodified, not a native patch. Later minimal metadata confirms the pinned image,
container ID and `/webui` read-only host bind mount in `source_guard.json`.

`test_native_http.py` launches the actual copied `server.py` main lifecycle on an
ephemeral private loopback port, under disposable HOME/settings/session state.
It creates only a disposable native Session and fixture registry. Its test-only
audit hook denies outbound socket connections and child/process launch. Actual
arrival contract is RED: POST receive returns 404 `not found`. Provider/DOM,
wake, busy, native journal correlation, restart/reopen/dedup remain UNIMPLEMENTED
or NOTRUN. Source access is no longer the blocker; do not request excerpts again.

Installer repair now pre-registers every attempted target before replacement,
restores all attempted targets even when another restoration fails, and verifies
bytes/mode/uid/gid. A rollback helper failure reports `source_restore_unqualified`
even if bytes happen to match; no failed fsync is called durable restoration.
Read-only container source mounts are retained: a HOST writer needs the exact
source mount at `/webui`, not container-side RW. Six new offline host tests pass,
including ten first/second-file failure windows and one-restart positive fixtures.
Docker inspection/readiness/restart are isolated test boundaries; no Docker install
was run. This does not qualify the host procedure against production.

Independent commands (cwd `tools/dev`; no artifact write access needed):

```sh
python3 -B -m unittest hermes_webui_receiver.test_host_failure_windows hermes_webui_receiver.test_host_job -v
python3 -B -m unittest hermes_webui_receiver.test_native_http -v
```

The second command must remain FAIL until real native integration makes the frozen
arrival check pass. No waiver; no source-presence check or fake sink replaces it.

### Parent-only independent host procedure — NOTRUN

1. Independently exercise all nine `host_job.GATES` through actual copied native
   HTTP/provider seam and actual frontend DOM, including same-operation crash
   recovery. Bind PASS evidence to exact source-manifest and patch-set hashes.
2. Obtain parent verified approval for this exact host job within AJ's ONE planned
   restart budget. Attest an actually available host facility and its survival
   across target stop. Protect the complete manifest and reviewed artifacts 0600.
   Do not use source_guard.json as a deployment manifest.
3. On the HOST, independently compute configDigest internally without printing
   inspect/env. Verify exact container/image/source mount and all original hashes.
   Preserve `/webui` read-only mount, cwd `/vault`, image/config/ports/env unchanged.
   Attest the absolute readiness argv is read-only and has no fixture-chat effect.
4. With the package parent on PYTHONPATH, validate without executing:
   `python3 -B -m hermes_webui_receiver.host_job --manifest <protected-manifest>`.
   Only after steps1–3, the PARENT's attested host facility may execute the exact
   same command with `--execute-parent-authorized`.
5. Inspect the truthful receipt. Installed means exactly one same-container restart
   plus readiness passed. `source_restored_runtime_unqualified` proves verified
   durable source restoration ONLY; `source_restore_unqualified` requires operator
   recovery even if bytes match. Neither authorizes another restart. Never resume
   against an existing backup directory or remove the restart-intent marker.

Historical text below describes the preceding source-missing milestone; its
missing-copy claims are superseded by this checkpoint, not by native acceptance.

`receiver.py` is real stdlib SQLite inbox/immutable run-link/intents/scoped receive
and status handler code. It opens no listener. It is **not** an integrated deployed
WebUI adapter: no full source copy exists here. Its `native` boundary cannot be
replaced by a fake sink and called native acceptance. `source_guard.json` is the
single machine-readable full-copy request and hash-pinned patch guard. Local Hermes
source is deliberately not imported. Source position numbers are evidence, not
blind insertion offsets. Reject different hashes; do not auto-force patches.

## Required smallest native patch after copy

1. In actual existing server routing, register exactly Capability.RECEIVE and
   STATUS as nonbrowser scoped relay endpoints (POST bounded JSON). Supply a current
   locally operator-authorized run/immutable owner/original-chat/historical-anchor/
   profile registry. No HTTP link API. Provision digest of **existing** Rhythm owner
   credential through a protected local reference, not a new password/login or
   assumption that WebUI's general auth accepts that bearer. Digest is a capability
   secret: protected owner-only reference, no logs. Never expose registry/digest to
   HTTP. Existing browser profile/CSRF/auth policy remains untouched. Validate
   registered current profile and immutable ownership inside native session lock.
2. Instantiate Capability only in running server startup; call startup/shutdown
   from its real lifecycle, not docker-exec imports. Stage subscriber validation
   dependency with module (or adjust local import in reviewed copied patch).
3. Implement native.current_binding from current operator registry plus actual
   current owner/profile/run/session membership. Unknown/old/transfer fail closed.
   native.start_once rechecks that binding under native session/profile lock, reads
   persisted correlated journal, atomically writes committed launch intent carrying
   eventId/full identityHash/turnIdentity, then calls routes.start_session_turn with
   bounded fixed event text. **Do not substitute an assistant transcript append.**
   Existing active409 returns `busy` ONLY if native proves no launch side effect.
   Keep persisted provider/workspace/model configuration unchanged. No steer.
4. Integrate event/turn correlation with actual _start_run and native JSON save and
   turn journal. Crash ordering must distinguish not-started from started/completed
   by durable native journal/transcript evidence. Our SQLite launch lease is NOT an
   atomic native JSON receipt; expired ambiguous leases never launch again. Complete
   native correlation/fencing implementation needs the complete copied files.
   Preserve JSON fullpayload/shrink/metadata guards, locks, counters and caches.
5. native.observe reads that journal and independently saved exact event-bound
   transcript. Existing server_turn_started fans out into actual renderer; reopened
   browser GET saved transcript must render same event/turn/message. Only completed
   native turn + same saved/render proof can become visible. Browser-supplied boolean,
   HTTP200, in-memory callbacks and diagnostic ACK are NOT proof. Closed browser can
   complete and save, but visible waits for actual qualified render observation.

## Separate-copy gate

Fixed deterministic provider is injected in TEST SETUP at copied real runner seam,
not production route/env flag/config change. Isolated HOME; omit .env/.git/config/
data/auth files. No LLM/network/provider/tool calls. Drive actual registered HTTP
entrypoint and actual frontend DOM: arrival correct chat/wake/render, busy queue
no steer, fullidentity duplicate/collision, restart/reopen, crash-before/after native
launch journal, oldsession/owner/profile revocation. No mocked native sink result.
These acceptance cases are currently **NOTRUN**, not waived or implemented by the
unit contract. Parent independent verifier owns this gate before installation.

## Host job (NOTRUN)

`python3 -B -m hermes_webui_receiver.host_job --manifest <protected-parent-manifest>`
only validates; `--execute-parent-authorized` is parent execution only AFTER gate.
Run with package parent on PYTHONPATH from host, never target container. Full source
copy and completed reviewed native patch must supply source/artifact hashes and
independent native/DOM evidence hashes, exact container ID, config fingerprint
(internally hashed inspect; never print environment), host-mounted source root,
approved replacement files and parent-attested readiness command. `source_guard.json`
intentionally fails this schema. No installable native patch is presently claimed.

Parent supplies actual available **host** systemd-run/at/nohup metadata and launch
invocation; none is assumed available here. Host facility survives target stop.
Back up all approved files, preserve ownership/mode, verify all hashes first, atomic
per-file replacement, restart SAME container exactly once, no recreate/image/env/
ports/config edits. Multi-file replace is not globally atomic: partial failure
restores approved originals. Existing container remains same image/config.
Readiness failure restores original source but may leave patched modules loaded:
runtime rollback/restart then requires **separate rollback-restart approval**.
Job records restart intent before command and will not resume using an existing
backup directory. No second restart assumed, no deletion of inbox/data/tombstones.

Unit command from tools/dev:
`python3 -B -m unittest test_hermes_webui_receiver hermes_webui_receiver.test_host_job -v`.
Unit state/transport validation is not native/DOM or tested installation acceptance.
Future Rhythm checks only canonical sandbox.sh with four existing fixture paths,
0400 inputs and ports4898/4897/4899; no hand api_server/live4001/4096/approval4198.
