---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: FAIL_NATIVE_VISIBLE_ACK_PARTIAL_PROFILE_COMPLETION_IMPLEMENTED
tags: [run, rhythm]
---

# Focused native implementation — NOT ready

## Scope / durable authorization

Explicit parent specialist handoff; acceptance-contract loaded FIRST, coding-agent
second. No orchestrator/peer dispatched. Retained worktree
`/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012`,
HEAD `ee914fce`; initial dirty package preserved. Read supplied AGENTS instructions,
project-state/current-plan, round1 run and frozen roots. Parent independently
verifies against read-only artifact; no independent PASS claimed.

Approved scope: native notification profile authority/save fencing,
completed/saved/visible pipeline, concrete NativeAdapter and associated native
fixtures/integration tests; dedicated native run only. Necessary patch builder
and generated native outputs are included. Parent owns integration of new output
identities into host manifest. No unchanged-scope approval re-requested.

Exclusions retained: host_job.py and test_host* are another writer's exclusive
paths; no edits, execution or reads of their implementation this run. No shared
host tests/docs edits. No live SSH/install/restart/remote chat writes, live config,
credentials/DB, provider internet, production/relay/Tailscale ports, drive/email/
billing/cards/desktop approval, shared dependency install, destructive cleanup,
commits/push/merge/deploy. ONE planned restart stays parent-owned AFTER the
independent gate; NOT executed. No permission denial caused this FAIL.

## Phase 0 — actual RED before implementation

Cwd for all Python commands below: retained worktree `tools/dev`.

```sh
python3 -B -m unittest hermes_webui_receiver.test_repair_round1.RepairRound1.test_queued_profile_mutation_cannot_be_erased_to_authorize_launch hermes_webui_receiver.test_repair_round1.RepairRound1.test_saved_completion_is_not_forever_started -v
```

`Ran 2 tests in 10.263s / FAILED (failures=2)`:

- Frozen profile root line42: `2 != 1`; saved profile `default`, providerCalls2,
  queued HTTP status200/started after actual JSON foreign-profile mutation.
- Frozen completion root line58: `'started' != 'completed'` after real saved reply.

Mandate: make these unchanged checks pass. Neither frozen Python assertions nor
the frozen reply/hit-test JS assertions were edited. These are two root checks,
not coverage of all requested acceptance criteria.

## Phase 1 — bounded impact review

Reviewed native.py, receiver.py, patch builder, source_guard, verifier, native HTTP
and wakeup fixture, frozen browser driver; inspected Session.save metadata,
shrink/backup and atomic replacement/index boundary, notification start lock/
commit/start failure paths and native completed-journal/save boundary. Read literal
streaming save callsites and profile retag/profile helper references. The supported
empty-session retag rejects active/nonempty sessions; no active supported transfer
path has been qualified by this run.

GitNexus `impact(direction=upstream, repo=Rhythm)` for `save` in copied models.py,
`drain` in receiver.py, `Native` in native.py, and `build` in patch builder returned
**Target not found / UNKNOWN**. Caller/process blast radius is unknown, NOT zero.
Scope risk review: stale cache/save can erase authoritative transfer; saved reply
cannot authorize visible or ACK; original owner must not be reassigned by a late
worker callback. Proportionate actual copied-server root tests and seven native
regressions were run. This is not a complete concurrency/security qualification.

## Implementation / two repair attempts

Changes:

- `native.py`: arm notification operation only after busy admission check, before
  pending save; snapshot durable session_id/profile/clear/shrink generations and
  original protected registry record. Preserve worker's original binding/cache;
  serialize current durable profile rather than overwriting it with stale cache.
  Changed registry/reset generations fail closed; recheck immediately before
  atomic replace. No ordinary Session.save behavior change without an operation.
- `receiver.py`: represent completed separately from started and visible; continue
  observing completed entries. Native observe rejects malformed journals, requires
  exactly one correlated completed event plus saved nonempty assistant at native
  completed index, and persists saved message hash/turn/identity proof.
- `build_native_patch.py`: recover originals in disposable copy by reversing prior
  hash-verified patch; require source pins before rebuilding. Add models.py save
  boundary and routes.py operation arm. Existing metadata/shrink/backup/index
  machinery retained, not replaced or disabled.
- Regenerated `native.patch`, `native_patch_manifest.json`, and six corresponding
  source_snapshot outputs; source_guard names new hash and remains unqualified.

Attempt1 command: `python3 -B -m hermes_webui_receiver.build_native_patch` followed
by the Phase0 command. `Ran 2 tests in 15.782s / failures=1`: completion GREEN,
profile root failed at `server.wait_reply()` because first implementation refused
all saves after transfer. Stack: streaming.py14796 → models.py1657 →
Operation.check_save → Native.current_binding → Denied. This fail-closed variant
preserved JSON but did not satisfy frozen saved-reply acceptance.

Attempt2 preserves authoritative serialized metadata without mutating original
worker profile; registry/generation changes still refuse save. Exact command:

```sh
python3 -B -m hermes_webui_receiver.build_native_patch && python3 -B -m unittest hermes_webui_receiver.test_repair_round1.RepairRound1.test_queued_profile_mutation_cannot_be_erased_to_authorize_launch hermes_webui_receiver.test_repair_round1.RepairRound1.test_saved_completion_is_not_forever_started hermes_webui_receiver.test_native_http hermes_webui_receiver.test_native_wakeup hermes_webui_receiver.test_native_browser -v && python3 -B -m hermes_webui_receiver.verify_native_artifact
```

`Ran 10 tests in 45.117s / OK`: two frozen roots + seven existing native + one
existing browser. Profile output: `foreign-profile`, providerCalls1, queued404
`unavailable`. Closed-tab output: exact event/run/chat state `completed`. Existing
browser liveDOM/reopenDOM/foreignChat PASS; external requests14 aborted.
Sandboxed serviceWorker and `/api/git-info`400 diagnostics remain; no clean-console
or related-diagnostic clearance claim.

Verifier recovered all107 original SHA256 pins and compiled generated Python.
Its final text still says **five** outputs: that fixed text is stale; actual
manifest has **six** (new replacement `api/models.py`). Parent host integration
MUST use actual updated manifest, not the obsolete five-file assumption.

Additional command:

```sh
python3 -B -m unittest test_hermes_webui_receiver test_hermes_notify_subscriber -v && git diff --check
```

`Ran 15 tests in 0.043s / OK`, diff check clean. These existing unit contracts do
not substitute for native browser receipts or actual Rhythm ACK.

## Actual remaining root: renderer → native visible FAIL

New `test_native_visible_contract.py` runs the unchanged actual copied renderer
driver, then asserts exact five-field native visible receipt. No DOM injection,
seeded transcript, synthetic renderer receipt or unit-callback ACK. This check
is RED; no visibility implementation was attempted after the two root repairs.

```sh
RHYTHM_NATIVE_EVIDENCE_DIR=/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012/docs/ai/runs/artifacts/hermes-native-focused-20261013 python3 -B -m unittest hermes_webui_receiver.test_native_visible_contract -v
```

`Ran 1 test in 5.679s / FAILED (failures=1)` at new test line38:

```text
expected state visible; actual state completed
actual = {version:2,eventId:fixture-event,runId:fixture-run,
          hermesSessionId:fixture-chat,state:completed}
```

Actual renderer proof width732/height24.5, hit `<p>Fixture native reply.</p>`,
unobscured=true. Screenshot `artifacts/hermes-native-focused-20261013/red-live.png`
visually inspected: normal native UI and unobscured fixture reply. File name is
frozen driver naming, not an assertion of visual failure. The missing hook is
real: native.observe supplies saved but never rendered; no authenticated renderer
receipt route or callback exists, so native visible and Rhythm ACK remain absent.
Browser attestation would prove rendering, NOT cryptographically prove user reading.

## Open risks / unfinished acceptance — do not install

1. Authenticated full-identity renderer receipt, foreign/forged/stale/duplicate
   rejection, actual reopening hit-test and closed-tab→reopen receipt NOT implemented.
2. Concrete protected NativeAdapter NOT implemented; subscriber→nativeHTTP→browser
   →nativevisible→actual Rhythm ACK NOT run. No fake ACK or success claimed.
3. Profile root PASS is the frozen direct JSON mutation probe, not a supported
   active operator-profile update integration. Cross-writer locking, durable
   authority revision at intent/queue acceptance, callback race/reset/shrink
   coverage, cold/restart fence persistence remain unqualified. Current fence
   is an in-memory notification operation with durable metadata checks; it is
   NOT a fully durable origin revision protocol.
4. Sidebar index still uses cached Session.profile in its persisted shallow copy;
   serialized JSON transfer does not qualify index transfer consistency.
5. Existing inbox schema has an old CHECK without completed. Current new CREATE
   does not migrate existing inboxes; upgrade completion is unqualified and can
   hit CHECK constraint failure. Do not deploy this candidate to existing state.
6. Saved message hash is computed at observation from completed journal index;
   full immutable saved-message/event tag and later reset/rewrite defenses are
   not qualified. No whole saved-proof security claim.

These are implementation gaps, not permission blocks. Phase2 full feature remains
incomplete. Two root repair attempts used; no third root repair in this run.
Parent/verifier can run all named tests in verifier-owned writable disposable
copies; new browser wrapper uses temp evidence by default and can verify artifact
read-only with a separate writable evidence directory. Existing seven native
fixtures never open production data or credentials.

## Output identity / hashes / teardown

Six patch outputs: server.py, api/routes.py, api/models.py,
api/rhythm_notify.py, api/rhythm_inbox.py, api/rhythm_schema.py. Original107 pins
unchanged. Parent host manifest boundary changed by necessary native save output;
host writer was not touched. Initial subscriber/consumer/repair tests untouched.

| Artifact | SHA256 |
|---|---|
| native.py | 682b75206ee2133b0ea9a59cad2350409df39fc727640072db01a7061745b284 |
| receiver.py | de48bee81adf6d4d64f79bbd4f064bbdd46b745b6afd4f9d4c88b9146094c7a1 |
| build_native_patch.py | 7c9d0ad6727c32886b2c0c8ca202255ffaec7da2d88e8c6c299f4bc824c58a2d |
| native.patch | 68ac1f10acacc2c4115c2004c8571560c52acbfe0f95640cf0609e49f369a2c6 |
| native_patch_manifest.json | 3c2945f21590a2570ce9df44c2d195799430b926e57179299120b6768bdd7fec |
| source_guard.json | 8341d41fbb4ebc0b2e2a9b433d01f7c1d9d369e4d38ce61953e2ee1db3ada934 |
| test_native_visible_contract.py | 684cb7568879f8f98b6728da99237a111a75a42b31f21d3491fa84d2dc8a2d41 |
| actual unobscured screenshot | e497d897ed8d7d947b6e2449badc7449481782d59f35307be05afba595c6f368 |

Root `git diff --check`, `git status --short` and listed `shasum -a 256` ran;
HEAD unchanged. No commits/push. All fixture children terminate/wait in finally,
browser closes in finally, isolated HOME/state/source temp trees disposed by
TemporaryDirectory. No copied listener remains owned by this run. No live ports
touched. No Rhythm sandbox launched: canonical four fixture variables and
ports4898/4897/4899 up/status/down NOTRUN because no Rhythm-dependent execution
occurred. Never manually launched API/engine. No restart/install/artifact host work.

**FAIL** — two roots implemented GREEN, actual visible receipt still RED, no ACK,
NOT READY_FOR_VERIFICATION or native installation.
