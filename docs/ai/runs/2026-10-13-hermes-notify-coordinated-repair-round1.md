---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: BOUNDED_FAIL_NATIVE_INSTALL_NOT_QUALIFIED
tags: [run, rhythm]
---

# Coordinated native + installer repair round1

## Scope and retained authorization

Explicit parent specialist handoff after independent FAIL `5cf65199`. Sole writer
retained `/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012`,
HEAD `ee914fce476de2190efdead7c3bc2ce8f59c19ce`; existing dirty package preserved.
Loaded acceptance-contract FIRST, then coding-agent. Read AGENTS, project-state,
current-plan, native browser/source-installer runs, patch builder and manifest,
native receiver, subscriber, host job and native fixture contracts.

Approved scope is notification-specific native authority/save fencing, exact
native event/saved/render receipt + concrete relay adapter, supported offline
fixture initialization, and exact host patch/install hardening. AJ's ONE planned
same-container restart remains parent-owned AFTER tests and independent gate.
No renewed approval requested for unchanged scope. No install by this writer.
Excluded: live source/chat/config/DB/credential writes, provider internet or tools,
remote writes/SSH refetch, host execution/restart, relay/Tailscale/production port
changes, migration, billing/email/drive/cards, desktop/signature work, shared
dependency installation, destructive cleanup, commits/push/merge/deployment.
Future Rhythm-dependent validation must use canonical sandbox lifecycle and all
four approved fixture paths,0400 fixture inputs, ports4898/4897/4899; no live4001
request and no manually launched API. No additional authorization inferred.

## Phase 0: four new actual RED probes before implementation

Command, cwd retained worktree `tools/dev`:

```sh
python3 -B -m unittest hermes_webui_receiver.test_repair_round1 -v
```

Observed `Ran 4 tests in 12.544s / FAILED (failures=4)`:

1. `test_queued_profile_mutation_cannot_be_erased_to_authorize_launch`: real
   copied HTTP first turn held at only the upstream Agent seam; second event
   accepted durably; actual session JSON profile mutated while turn active;
   release and native save produced `profile=default`, `providerCalls=2`, second
   status200/started. Expected calls1 and preserved foreign-profile. Assertion
   `2 != 1`. This is direct-file fault reproduction; supported operator/profile
   update acceptance remains separate/unrun, not represented as covered.
2. `test_actual_browser_reply_is_unobscured`: real Chromium/copied renderer reply
   exists but hit-test returns `<div class="onboarding-check muted">...Provider
   config...Needs verification...`; unobscured=false. Actual screenshot at
   `artifacts/hermes-notify-repair-round1/red-live.png` (sanitized fixture only).
   Expected actual reply element hit, not merely DOM text. Fixture startup/HTTP
   and provider worked; not missing-import or timeout RED.
3. `test_saved_completion_is_not_forever_started`: actual reply saved, closed
   browser, status200 remains started after polling. Expected completed distinct
   from visible. Assertion `'started' != 'completed'`. This probe does not cover
   full authenticated renderer receipt or subscriber→Rhythm ACK acceptance.
4. `test_exact_five_file_patch_installs_new_files_with_one_fake_restart`: exact
   existing patch outputs, reverse patch only in disposable source copy; empty
   additive files removed only there. Typed create/replace five-file manifest
   rejects server.py with `unapproved file path`. Actual disposable file writes;
   only Docker boundary isolated. No deployment gate values fabricated for host
   use. This probe is not comprehensive host failure-window coverage.

Mandate remains make named checks pass without changing assertions. Parent's
independent verifier must rerun artifact read-only; no independent PASS claimed.
Contract is four minimum root reproductions, NOT all requested acceptance proofs.

## Phase 1: bounded review

Read entire native.py, receiver.py, host_job.py, subscriber.py, patch builder,
native HTTP/wakeup/browser drivers and host failure-window suite. Inspected
Session.save metadata assembly and authority fields, _retag_empty_session_profile,
and onboarding route/helper. Save serializes stale object's `profile` without
authority revision merge/fence. Native.current_binding checks saved profile but
the async stale save can erase evidence before queue recheck. Retag helper rejects
nonempty/pending sessions; no supported active profile update path qualified.
Receiver schema has only accepted/launching/started/visible and maps completed
observation back to started. Native.observe has no saved/render proof.
Subscriber ships no concrete NativeAdapter. Host manifest excludes server.py,
requires existing target.stat + nonnull beforeHash, accepts arbitrary absolute
readiness argv by attestation, and backup parent symlinks are not checked.
Consequential authority/installation risks remain open; no graph bypass.

GitNexus upstream impact calls (repo Rhythm, includeTests=true): `start` in
test_native_wakeup.py, `save` in copied api/models.py, `run` in host_job.py each
returned Target not found/risk UNKNOWN. Not proof of no callers/processes.
Only intended implementation edit this attempt is Fixture.start's supported
onboarding setup. All literal fixture callers reviewed: native wakeup, browser,
new repair probes. They use isolated HOME, audit-hook outbound/process denial,
ephemeral loopback native listener and deterministic upstream Agent only. No
production symbol changed. Existing helper complete_onboarding persists the
normal setting through save_settings; no env bypass or DOM/CSS deletion needed.

## Files / checks / handoff

New acceptance files: test_repair_round1.py, test_repair_visible.mjs. Changed only
test_native_wakeup.py fixture bootstrap to call existing complete_onboarding()
before server startup (normal save_settings persistence in isolated HOME).
No assertions, provider expectations, source patch or production file edited.

## Phase 2 attempt1: fixture initialization fixed, full feature FAILED

One fixture repair attempt; no second attempt and no native/host production repair
performed. The fixture setup now completes supported first-run before rendering.
Frozen browser hit-test was rerun with a DIFFERENT artifact output directory to
preserve original RED evidence. Exact executed command (cwd tools/dev):

```sh
python3 -B -c 'import os, subprocess, tempfile; from pathlib import Path; from hermes_webui_receiver.test_native_wakeup import fixture, ROOT
with tempfile.TemporaryDirectory() as d:
 home=Path(d).resolve()
 evidence=ROOT.parents[2]/"docs/ai/runs/artifacts/hermes-notify-repair-round1/attempt1"
 evidence.mkdir(exist_ok=False)
 with fixture(home) as server:
  result=subprocess.run(["node",str(ROOT/"test_repair_visible.mjs"),server.base,"/Users/ajhochhalter/Documents/Rhythm/apps/web/node_modules/playwright/index.js","/Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell",str(evidence)],cwd=home,env=dict(PATH="/opt/homebrew/bin:"+os.defpath,HOME=str(home),TMPDIR=str(home)),capture_output=True,text=True,timeout=45)
  print(result.stdout,result.stderr)
  assert result.returncode==0
  assert len(server.calls())==1'
```

Exit0: proof width732/height24.5, hit `<p>Fixture native reply.</p>`,
unobscured=true, providerCalls1. Screenshot in attempt1/red-live.png (frozen
driver filename, despite PASS) visually inspected: actual unobscured correct-chat
reply and native normal UI. Original RED screenshot visually inspected: first-run
wizard covers the chat. No image/HTML content injected, seeded or CSS hidden.
This is live-pane visibility only, NOT reopen/closed-tab hit-test proof or ACK.

Diagnostics inspected:400s are `/api/git-info?session_id=fixture-chat`; sandboxed
serviceWorker access errors also remain. No related cause/clearance proven and
no console-clean claim. No security fence relaxed. Investigation/clearance is
still required if related to the requested behavior.

```sh
python3 -B -m unittest hermes_webui_receiver.test_native_http hermes_webui_receiver.test_native_wakeup hermes_webui_receiver.test_native_browser -v
```

`Ran 8 tests in 37.377s / OK`: existing7 native + existing1 browser. Original
browser reports liveDOM/reopenDOM/foreignChat PASS, blocked external requests14,
sandboxed serviceWorker and400 diagnostic errors. These are DOM checks, not new
reopen/foreign screenshot/hit-test qualification. Revocation/owner/profile/old
session regression preserved. No actual subscriber end-to-end proof implied.

```sh
python3 -B -m unittest hermes_webui_receiver.test_host_failure_windows hermes_webui_receiver.test_host_job test_hermes_webui_receiver test_hermes_notify_subscriber test_hermes_notify_repair test_hermes_notify_workflows test_hermes_notify_run_origin -v
python3 -B -m hermes_webui_receiver.verify_native_artifact
```

`Ran 54 tests in 0.261s / OK` (includes inherited repetitions, not54 distinct
behaviors). Verifier reports five patched outputs,107 original pins recovered,
Python compiles. It checks hashes, NOT exact original path set after removal of
additive empty files. No exact-tree restoration claim. Patch builder NOTRUN;
source package and original pins not changed, no forced patch/hash update.

```sh
python3 -B -m unittest hermes_webui_receiver.test_repair_round1.RepairRound1.test_queued_profile_mutation_cannot_be_erased_to_authorize_launch hermes_webui_receiver.test_repair_round1.RepairRound1.test_saved_completion_is_not_forever_started hermes_webui_receiver.test_repair_round1.RepairRound1.test_exact_five_file_patch_installs_new_files_with_one_fake_restart -v
```

`Ran 3 tests in 10.265s / FAILED (failures=3)`: same authority overwrite/calls2,
started-not-completed, and exact patch rejected. Full feature implementation was
NOT completed. This is a failed implementation stage, not a host permission
denial, missing acceptance criteria, or request for unchanged-scope approval.
Phase2 remains incomplete; no READY_FOR_NATIVEINSTALL_INDEPENDENTGATE.

## Final boundary status / specific remaining work

| Boundary | Current result | Remaining |
|---|---|---|
| Queued authority | FAIL actual HTTP/native save, calls2 | Notification-specific revision/profile mutation fencing through active async save and launch lock; preserve mutation or quarantine queue. Supported operator/profile update test still missing. |
| Actual visible browser | PARTIAL live hit-test + screenshot PASS | Reopen and completed closed-tab wake hit-test/screenshots, foreign no-effect screenshot, related400 clearance. Existing DOM-only assertions remain insufficient for these. |
| Completed→visible→ACK | FAIL stays started | Persist completed exact event/run/chat/turn + saved message proof; authenticated profile/owner exact renderer attestation with stale/replay/foreign/reset protection; concrete protected NativeAdapter; whole actual subscriber→native→DOM→visible→ownerACK fixture. Do not call HTTP200/saved visible. |
| Exact host patch | FAIL rejects server.py | Typed create-vs-replace exact set/hash verification, no clobber, backup and all parent symlink rejection, safe structured readiness with no shell/untrusted executables, actual-file create rollback/failure windows and replay restart cap; exact original tree proof. Runtime rollback second restart requires separate approval. |

No native authority or receipt fix attempted in this turn; source remains known
unsafe/incomplete. No host hardening fix attempted. New probes are root
reproductions, not a full acceptance suite. Read-only artifact verification can
use disposable copies and the frozen JS driver with a fresh writable evidence
directory; the new Python browser wrapper currently writes evidence under docs,
so run that wrapper only in a verifier-owned copy, never against a read-only
artifact or the preserved RED directory. Production authorization unchanged.

## Hashes / teardown / host command NOTRUN

Root `git diff --check`, `git rev-parse HEAD`, `git status --short`, and
`shasum -a 256` for paths below ran successfully. HEAD unchanged; initial dirty
subscriber/consumer/repair tests untouched by this run. No commit/push.

| Artifact | SHA256 |
|---|---|
| test_repair_round1.py | 2ea41ec99bf05704d4116ee2877fa18fa85b227a46091d3b3b0e1c2503b16500 |
| test_repair_visible.mjs | d66a3880195397f9db8adc50e2d253a66101b21ed48c27739256609d66d14eb9 |
| test_native_wakeup.py after fixture change | becffc51e2c165a4f96d104142de9b83ae26cb9b7b45b849491fc36c0c1b8486 |
| native.patch unchanged | 6f975d3c4e8cf0acb15dbde6e65ba3140a821c7f7afb4e6dc0f5acea7926957f |
| native_patch_manifest.json unchanged | 284eced5b19461e1ae6d6df7d8a94527ea8ce8a74753bb33de2e9bbcd912a43c |
| receiver.py unchanged | c1f6230a8bd861b87b2eea0da6cce438cbf9a167e19cccf65c85c7f8ad1f013f |
| native.py unchanged | 65c1ef6551e2ac8abc0682e24233d7e9d71d0bc3d9161a421ba4ec7b2457a932 |
| host_job.py unchanged | 115f95c47c1274446e36bdcb499c2e1ee6b504cb74ddc42a3a94af2f881f1e97 |
| original source_snapshot_manifest.json unchanged | cfe5f82898f38923a90ec5081a71608f8e9b416fcd7b77ca16974a951f72a093 |
| original RED screenshot | 28ca6765acca1135944f9fd20b8ed64a874079472cce8393eed61fa45361dde9 |
| attempt1 unobscured live screenshot | 8a96956e01bd995235c7c3b71859ad1aa54a4bb09fc4dcb873d0398dbea1c108 |

All native fixture children terminate/wait in fixture finally; browser closes in
finally; subprocesses completed, private TemporaryDirectories disposed. No
Rhythm-dependent test run; sandbox up/status/down NOTRUN, no owned Rhythm sandbox
launched. No live ports touched. No host Docker command executed; only fixture
Docker boundary isolation. Host install/ONE planned restart/rollback restart
NOTRUN, parent only after repaired artifact and independent qualification.

**BOUNDED_FAIL**. Current counts: existing7 native +1 browser +54 regression
invocations PASS; four new root probes initially4 FAIL; after fixture-only repair
live visibility probe PASS separately, remaining3 FAIL. No whole-feature PASS.
