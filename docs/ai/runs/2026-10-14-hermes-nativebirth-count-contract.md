---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: null
issues: [NOTIFY-HERMES]
status: PASS_NATIVEBIRTH_FIXTURE
tags: [run, rhythm]
---

## Files / scope

Explicit PARENT contract correction, NOT a waiver of duplicate protection.
Only tools/dev/test_provision_native_birth.py and this new run are writable.
HEAD c74f4392a6df61979fbe33e620a0077ebb6e0b4b; existing dirty work preserved.
Loaded acceptance-contract first, then coding-agent; read AGENTS, project-state,
current-plan, regression registry and nativebirth-current-ack run.
No app source/DTO/CLI core/native schema edits, server builds, sourceguard300
interference, 4998/4898 activity, installed app/Pi/live configuration/DB access,
providers, external services, dependency installs, commits/push or activation.
Restart approval remains absent. Retained temp evidence is not cleaned up.

## Phase 0 / fixed acceptance contract

Command: `RHYTHM_LIVE_E2E=1 python3 -B tools/dev/test_provision_native_birth.py`.
Before implementation: 1 test in 1.436s, FAILED at original line86,
`AssertionError: 2 != 1`. All preceding birth/receipt/byte assertions passed;
partial refusal was not reached. Prior run first failed at line73 for missing
durable birth, then at line86 for counting metadata. Neither RED is erased.
The count RED represents one actual chat plus metadata, not a second chat:
zero duplicate conversations observed in the prior retained evidence.

Fixed observable contract: exact regular non-symlink Session JSON identity set
{new receipt SID}, filename SID+'.json', after reuse and partial-receipt denial;
original messages/profile/title and saved bytes remain unchanged at both points.
Only known _index.json metadata is permitted: pinned models.py lines432–533
writes a top-level list of compact rows, not a versioned wrapper or top-level
Session object. Validate list/row identity, zero message count, profile/title.
Unknown JSON metadata, disguised chats, malformed identities and symlinks fail
closed. Independent file-only helper check must demonstrate that a legitimate
second SID is counted and singleton assertion fails, without server action.
Parent independently reruns the command with read-only source and writable
disposable temp state; no independent verification claim is made here.

## Phase 1 / bounded impact review

GitNexus upstream impact for test_new_chat_is_saved_empty_once_and_receipt_is_immutable
with file hint and tests enabled: Target not found, risk UNKNOWN, not LOW.
Complete 94-line test, native HTTP fixture, CLI core and contract helper read.
No production symbol is edited; unittest is the test entry point. Only two
incorrect raw counts will be replaced, with additive preservation assertions
and file-only adversarial checks. Existing copy pins, startup timeout, audit
fence, native routes, profile and native source stay unchanged.
Consequence reviewed: broadly ignoring underscore files could conceal another
chat; therefore only source-recognized index structure is exempted.

## Checks / handoff

Baseline SHA256 test:
`962b4b263ddc0db268cfc7033409a0a7efced83329d898de72b7ea6d406ab525`.
Baseline CLI core:
`7102284df56b8a0b4a62d45b6d1018f94761da2f8958d93b2e006dc2c9e11ebf`.
Source engineRequestID/schema mismatch remains separate and unchanged;
no source ACK, SSE/DOM qualification or whole-CLI readiness is claimed.

## Phase 2 / implementation and GREEN

One criterion correction, no runtime repair attempts. Original assertions are
preserved except the two incorrect glob counts; both now compare all parsed
Session bodies to `{sid: saved}`, stronger than count or SID set alone.
Added saved-byte equality after partial refusal. Added one independent file-only
test: two legitimate different SIDs are counted and singleton guard raises;
isolated subcases reject unknown metadata, Session masquerading as _index.json,
wrong filename and symlink. No mock server, seeded native response, index removal,
production algorithm/profile/schema or timeout change.

Exact focused validation command (all exit0):

```bash
RHYTHM_LIVE_E2E=1 python3 -B tools/dev/test_provision_native_birth.py && python3 -B tools/dev/test_provision_contract.py && python3 -B tools/dev/test_provision_bridge_contract.py && python3 -B tools/dev/test_provision_transport_boundaries.py && git diff --check
```

- Birth: `Ran 2 tests in 1.430s`, `OK` (1 real HTTP + 1 file-only guard).
- Helper: `Ran 16 tests in 0.112s`, `OK`.
- Bridge: `Ran 1 test in 0.523s`, `OK`.
- Transport boundaries: `Ran 3 tests in 0.060s`, `OK`.
- Whitespace check PASS. Total 22 checks/tests passed, none skipped.

Actual output:
```json
{"durableBirth":"PASS","sameSID":"f82529dcd17f","messagesCount":0,"providerEffects":0,"fixture":"/private/tmp/hermes-native-birth-1n9airff","nativeCorePins":107,"nativeOutputs":7}
```

Retained native.log: owned copied PID90008, loopback61174; GET /health200,
exactly one POST /api/session/new200, one POST /api/session/rename200, one
reuse GET /api/session?session_id=f82529dcd17f&messages=0&resolve_model=0200.
Partial receipt denial generates no new HTTP request. Actual index is a list
with one compact row: same SID, message_count0, default, fixed fixture title.
Receipt intentionally ends status=persisting for refusal check. Saved body and
bytes unchanged after both reuse and refusal, messages[]. All 107 core pins and
7 output pins verified before copying. Native bootstrap fence denies outbound,
provider/child-process effects before imports; no agent installed in fixture.
No Rhythm API/engine launched or sourceguard touched. Owned native process exited;
fixture evidence retained. This is empty native birth before SSE, not provider
execution or native/current-source ACK integration. Actual Native.current_binding
was qualified in the prior run; it was NOT rerun by this count-only fixture.

## Hashes / preservation / independent handoff

`shasum -a 256` before and after confirmed the following unchanged identities:
```
7102284df56b8a0b4a62d45b6d1018f94761da2f8958d93b2e006dc2c9e11ebf tools/dev/hermes_fixture_provision.py
9ff91d1bd5e4b4bcdc48336660361511e0e080795c44f082dd878d91967c380c tools/dev/hermes_cli_fixture_test.py
3f8be42e4ff81aa4f18274d01e5c7b28661fcc322bae21ffb7d225f111671ef7 apps/api_server/src/services/hermes_notify_service.ts
871070c91dd646063e46600286ee3b33deb4b55d522ab9875f384b5214a047b7 apps/api_server/src/shared_agents/delegation_coordinator.ts
3c943e69fc18b33768a852c256c15825447bb3065cf3933946ec80116bafec43 native source_snapshot/api/models.py
8b0002f10c6906443af059920bf93fd60810d7e16f58351b381324ebce85af38 native source_snapshot/api/rhythm_schema.py
cfe5f82898f38923a90ec5081a71608f8e9b416fcd7b77ca16974a951f72a093 native source_snapshot_manifest.json
997524d5bf0b3b7ef2adbac73bad7ea62533eafb154b6ac1a774698b124844d0 native native_patch_manifest.json
```
Native root is the unchanged test import's
`/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012/tools/dev/hermes_webui_receiver`.
Test after SHA256:
`9de9d14574be5843a4c27fe39c6b1a4ee6a1a8bebb2326c175538f7c676ba0af`.
Only the two assigned files were authored in this continuation; unrelated dirty
work was not staged, reverted or cleaned. This is qualified
PASS_NATIVEBIRTH_FIXTURE, ready for parent verification of this bounded test
correction only. Parent must still fix source engineRequestID compatibility
after frozen guard completes and independently qualify current-source ACK.
No READY whole CLI/ACK, restart request or activation permission is implied.
