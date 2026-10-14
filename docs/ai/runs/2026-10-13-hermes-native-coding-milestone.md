---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: FAIL_NATIVE_DOM_GATE
tags: [run, rhythm]
---

# Native coding milestone — retained single-writer continuation

## Scope / approvals

Retained worktree `/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012`,
HEAD `ee914fce476de2190efdead7c3bc2ce8f59c19ce`. Explicit parent continuation satisfies
entry gate; acceptance-contract loaded first, then coding-agent. Read AGENTS.md,
project-state.md/current-plan.md and the source/installer continuation run.
No orchestrator or peer dispatch. Existing dirty package, installer repairs and
frozen test preserved. Assigned native route/lifecycle/correlation/provider-boundary
fixture scope only; writes confined to `tools/dev/hermes_webui_receiver/` and this run.
No renewed unchanged-scope approval requested.

All live SSH/refetch/network provider/commands/tools/current chats/cards, credentials,
production DB/config, desktop approval, drive/mail/billing, relay/Tailscale, shared
dependency changes, remote writes/install/restart/deploy, commits/push and destructive
cleanup remain excluded. Parent owns independent gate and any later ONE planned
existing-image restart; this artifact does NOT authorize that restart. No host job
execution or production activation. No existing operator configuration changed.

## Phase 0 — frozen actual native RED

Cwd `worktree/tools/dev`, exact command:

```sh
python3 -B -m unittest hermes_webui_receiver.test_native_http -v
```

Before any implementation: `Ran 1 test in 1.477s / FAILED (failures=1)`.
Stack: `test_native_http.py:93`, `AssertionError: 404 != 200 : { "error": "not found" }`.
Frozen SHA256 remains `86731b89059107ffd05234c3411c69bc8ab288388b55b48f90578546fa4a9bd4`.
Mandate: make that check pass through copied server main/Handler/native Session,
without editing the test or introducing a fake native sink. Additional native and
browser checks were added after this frozen RED, not falsely claimed pre-code REDs.
Independent parent verifier can run the same artifact tests without source write access.

## Phase 1 — bounded impact / risk review

GitNexus upstream impact in indexed Rhythm, exact copied-source file hints:
`_handle_write`, `main` (server.py), `_start_chat_stream_for_session`, `_start_run`,
`start_session_turn` (api/routes.py): each returned Target not found, risk UNKNOWN.
No claim of zero dependencies. Literal caller review found do_POST/PUT/PATCH/DELETE
sharing the write dispatcher; routes browser chat/regeneration and server wakeup
sharing `_start_run`; its adapter and direct delegates share the low-level starter.
Reviewed native lock/pending preparation/submitted journal/thread launch/compensation,
main startup/shutdown, provider construction/result seam, native journal shards,
existing frontend session-stream/server_turn_started and actual session-load routes.

Consequential risks: global auth/CSRF regression, cached stale binding, journal error
swallowed before launch, SQLite/native ordering and launch ambiguity. Scoped dispatch
returns only for the two exact POST paths. Browser Origin/Cookie is rejected by the
existing capability; other routes retain native auth/profile/CSRF. Protected local
registry version/owner/mode/no-symlink validation, immutable linked owner/profile/chat
and digest, durable session metadata + cache checks, and launch-time authority recheck
under the actual per-session lock are implemented. No HTTP linking/provision endpoint.
External runner/gateway backends fail closed rather than bypass their configuration.
models.py, webui_session_db.py, config.py, auth.py, turn_journal.py, background_process.py,
messages.js and sessions.js are byte-identical to original pins. Shrink/cache/save and
existing renderer protections were not weakened.

## Phase 2 — actual native implementation

`build_native_patch.py` validates original server/routes hashes and exact replacement
anchors, compiles the whole intended output before publishing, emits native.patch +
native_patch_manifest.json, and applies to actual copied source. The original snapshot
manifest remains unchanged; it describes ORIGINAL source, not patched bytes. Do not
run the builder on patched input: it correctly refuses mismatched hashes. Verify the
finished artifact with `verify_native_artifact.py` instead. The first input-only reverse
command from inside the repo skipped its filters; builder correctly refused source hash
mismatch without writes. Correct root-relative exact reverse restored only our owned
server/routes hunks, then builder independently revalidated original hashes. No force.

Actual source surface:

| Copied file | Change | Result SHA256 |
|---|---|---|
| server.py | scoped Handler dispatch, owned main worker startup/shutdown | efda3657b2f596a90e4050cc34ca2691d03dde5b789e058863ae470ef9bb1083 |
| api/routes.py | optional notification through start_session_turn → _start_run → low-level native starter; locked recheck, correlated submitted commit, scoped fail-closed persistence | d033cc672fa08db2f3f6cf356d45813ccfda63445e0a1a6cea7462989fee403b |
| api/rhythm_notify.py | native registry/operation integration, real journal observation, bounded HTTP framing | 65c1ef6551e2ac8abc0682e24233d7e9d71d0bc3d9161a421ba4ec7b2457a932 |
| api/rhythm_inbox.py | existing Receiver/Capability bundled with native-local schema import | d2d0e56ba5397b69aefb7b532e1764ff9a1656303032889d01c9eac2546ffc4b |
| api/rhythm_schema.py | existing notification schema/label validator bundled, no subscriber process | 8b0002f10c6906443af059920bf93fd60810d7e16f58351b381324ebce85af38 |

Durable SQLite leased intent precedes native pending save. Submitted journal contains
eventId + full canonical hash + deterministic turn ID in the SAME fsynced native event.
Only notifications demand the journal receipt + explicit directory-fsync success before
thread launch; ordinary chat keeps its existing error policy. Worker_started is native
proof of admission, not HTTP200. Leases without that proof remain quarantined, including
pre-journal/pending-save and post-journal/prelaunch crashes. No expiry-based blind retry.
Native 409 returns accepted durable intent for later recheck, never steer. No provider
test route/config/env flag was added to production source.

One native repair: initial real wake check timed out in `urllib.request` at first POST
(12.122s). Root cause was registry link WRITES inside current_binding when drain already
owned a SQLite write transaction. Provisioning moved to owned startup; current_binding
is read-only immutable comparison. Rebuilt guarded patch; exact wake test passed in
4.642s. No native.start_once/observe mocks. Real streaming `_get_ai_agent` constructor
uses TEST SETUP class only at external upstream AIAgent boundary; absent upstream runtime
provider module is supplied there. Normal native WebUI routing/worker/journal/save is
real. Subprocess audit denies ALL outbound connects/process/system effects. Fixture
Agent produces deterministic text, no tools/provider calls, and records fsynced invocation
counts. HOME/source/state/config paths are sanitized disposable copies outside repo
ancestry; no .env/.git/live data inherited or imported.

### Final focused commands and observed results

All cwd `worktree/tools/dev`:

```sh
python3 -B -m hermes_webui_receiver.verify_native_artifact
python3 -B -m unittest hermes_webui_receiver.test_native_http hermes_webui_receiver.test_native_wakeup -v
python3 -B -m unittest hermes_webui_receiver.test_host_failure_windows hermes_webui_receiver.test_host_job test_hermes_webui_receiver test_hermes_notify_subscriber test_hermes_notify_repair test_hermes_notify_workflows test_hermes_notify_run_origin -v
```

Verifier: `PASS: five patched outputs; all 107 original pins recovered exactly; native Python compiles`.
Actual native suite: `Ran 7 tests in 34.750s / OK`.
Preserved affected regressions: `Ran 54 tests in 0.242s / OK` (inherited repeated cases,
not54 unique behaviors). Source-only integrity commands from root `git diff --check`,
`git status --short`, `git rev-parse HEAD` passed; HEAD unchanged.

Native tests assert deterministic reply saved in correct chat, foreign chat empty,
single canonical submitted operation/event/hash/turn, matching worker_started, exactly
one provider invocation after duplicate/restart, actual normal HTTP GET reopen; durable
busy second event stays accepted while first provider is held and then runs once;
collision/foreign-chat/bad-token/browser-origin/revocation denial; changed local
owner/profile/old-session binding denial; notification journal-error zero launch; actual
owned subprocess crashes before journal, after journal, and after provider admission.
Crash counts remain respectively0/0/1 after restarting and reposting the event. Those
first two ambiguous cases deliberately do NOT promise eventual completion.

## Exact remaining FAIL — actual frontend DOM gate

Installed dependency was absent in assigned worktree but reused read-only from
`/Users/ajhochhalter/Documents/Rhythm/apps/web/node_modules/playwright/index.js`.
Default Playwright Chromium1234 binary absent. Reused installed
`/Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`.
No installation/download. Browser ephemeral context with sanitized HOME/TMPDIR,
service workers blocked, external requests aborted, background-networking/sync/update
disabled and resolver restricted; no mocked API responses or inserted transcript/DOM.
Existing copied HTML/messages.js/sessions.js and actual server responses were loaded.

Command: `python3 -B -m unittest hermes_webui_receiver.test_native_browser -v`.
Initial actual result: FAIL at DOM reply wait, timeout30000ms, 32.677s total.
Repair1 (setup only): use supported root `?session=fixture-chat` URL to avoid duplicate
deep-link asset loads, await actual native EventSource OPEN, bounded15s reply wait +
diagnostics. Result FAIL,16.794s. Repair2 (setup only): await actual loaded S.session
and completed loader before notification, collect browser errors. Final result:
`Ran 1 test in 16.751s / FAILED (failures=1)`.

Final stack: `test_native_browser.py:22` assertion returncode1; Node
`test_native_dom.mjs:44:16`, `page.waitForFunction: Timeout 15000ms exceeded`.
Actual relay receive POST returned200. No actual /api/chat/stream request appeared.
DOM remained welcome text + `Loading conversation...`; diagnostic state at timeout
`{"busy":false,"stream":null}` (sid undefined). Browser errors included blocked
external CDN requests and `Failed to read the 'serviceWorker' property from 'Navigator':
Service worker is disabled because the context is sandboxed and lacks the
'allow-same-origin' flag.` This is observed evidence, NOT an established root cause.
No CSP/security bypass performed. Two bounded repairs exhausted; no further retries.
Browser reopen/foreign-DOM assertions were NOT REACHED. Native HTTP reopen is PASS;
it does not substitute for DOM proof. The browser package is NOT absent; access/SSH
is NOT the blocker. Exact next failure is native frontend mounting/live-view evidence.

`Native.observe` intentionally supplies no rendered/saved-equals-rendered proof:
persisted completion is NOT actual DOM visibility. Production visible ACK remains
unimplemented/fail-closed; notification status never falsely claims visible. Parent
must complete independent actual DOM and qualified event-bound visible receipt before
any activation manifest. This is NOT READY_FOR_NATIVE_INDEPENDENT_GATE.

## Files / hashes / independent handoff

Added authored files under receiver: native.py, build_native_patch.py,
test_native_wakeup.py, test_native_browser.py, test_native_dom.mjs,
verify_native_artifact.py. Generated: native.patch, native_patch_manifest.json,
the five copied source files above. Updated source_guard.json to point at unqualified
patch and retain nativeGate/hostFacility null. This run added; no earlier run rewritten.
All earlier dirty subscriber/consumer/test and installer work preserved.

| Artifact | SHA256 |
|---|---|
| native.patch | 6f975d3c4e8cf0acb15dbde6e65ba3140a821c7f7afb4e6dc0f5acea7926957f |
| native_patch_manifest.json | 284eced5b19461e1ae6d6df7d8a94527ea8ce8a74753bb33de2e9bbcd912a43c |
| build_native_patch.py | b36dda7ae921044cf833fb77ef1095b785d1e16adc9daf942b24238c72377033 |
| test_native_wakeup.py | 46e7d62bd09b6f427e3b24d74a33546e35f8b50e31e6349c68ecc641e398ef89 |
| test_native_browser.py | 922308ca79d0aa56c860cf621cfceb5e7e1e3ef2bcca1f48e5572a2409c0193b |
| test_native_dom.mjs | 4cc1c12fe6d152220dad6009874746455f88e85b9deea31a37c906f851ec89da |
| verify_native_artifact.py | 06a9e2b02e7b28816c4f5df85086e3e750d3ad1d31ceb2f7d0f0e4ef2ab63c83 |

Independent verifier: run integrity +7 native checks above, then exact failing DOM
command; no source edits needed. No fake deployment manifest or independent PASS
fabricated. Existing installer does not yet qualify these added native files; parent
must review installation surface AFTER native DOM gate rather than use source_guard
as permission. Host installer, production activation and planned restart are NOTRUN.

All owned WebUI subprocesses terminated/waited (intentional crash children already
exited); browser contexts/browser closed in finally; disposable fixture directories
removed by their scoped TemporaryDirectory owners. No shared process/port was stopped.
No Rhythm API/fork process or test started, so canonical Rhythm sandbox up/status/down
was NOTRUN, not required for these offline Python/copied-WebUI checks. Future Rhythm
commands retain all four canonical paths,0400 fixture inputs, sandbox private/tmp
and4898/4897/4899 only; no hand-started API or attachment to live4001/4096/4198.
