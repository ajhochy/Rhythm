---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: READY_FOR_NATIVE_INDEPENDENT_GATE
tags: [run, rhythm]
---

# Focused native browser fixture repair

## Scope / approvals / Files

Explicit parent handoff; retained SINGLE writer at
`/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012`,
HEAD `ee914fce476de2190efdead7c3bc2ce8f59c19ce`. Loaded acceptance-contract first,
then coding-agent; read AGENTS.md, project-state.md, current-plan.md, native coding
run, browser driver/wrapper, native wake fixture, integrity verifier and actual
boot/load/session-stream code. No orchestrator or peers dispatched.

Approved scope: only initialization/reopen in `tools/dev/hermes_webui_receiver/test_native_dom.mjs`
(test helpers allowed if necessary; none changed), plus this durable run note.
Preserved all existing dirty parent work, frozen reply/assertion/provider-count
checks, 7 native checks, 54 regression invocations and source-copy pins. No seed
message/draft, fake HTTP/DOM response, new renderer, production rule change or
timeout increase. Only these two paths were written in this run.

Exclusions remain: production/source frontend edits, SSH/refetch, provider network,
live credentials/config/DB/current chats, install/restart/host-job execution,
relay/ports/Tailscale changes, drive/email/billing/cards, desktop/signature changes,
shared dependency install, destructive cleanup, commit/push/merge/deployment.
No renewed unchanged-scope approval needed. AJ's ONE planned restart remains
parent-owned AFTER independent native + host-job readiness; NOT EXECUTED here.

## Phase 0 — acceptance contract RED (before edits)

Adopted the existing executable contract explicitly assigned by the parent:
`NativeBrowser.test_existing_frontend_live_reopen_and_foreign_chat_dom` drives real
copied server/main/HTTP, selected registered chat, actual Chromium/native renderer,
one exact reply, saved reopen, foreign chat exclusion, and one provider invocation.
Mandate: make that check pass by fixing setup only, not changing expected replies,
counts or assertions. Parent independent verifier runs the same artifact read-only.

All Python commands below ran from `worktree/tools/dev`.

```sh
python3 -B -m unittest hermes_webui_receiver.test_native_browser -v
```

Observed before implementation:
`Ran 1 test in 12.257s / FAILED (failures=1)`.
Exact failed stack:

```text
test_native_browser.py:22: self.assertEqual(result.returncode, 0, result.stdout + result.stderr + server.logs())
AssertionError: 1 != 0
page.waitForFunction: Timeout 10000ms exceeded.
at test_native_dom.mjs:28:16
Node.js v26.5.0
```

The diagnostic normal session GET returned200, message_count0, messages[], no
pending user message, no stream and empty composer draft; DOM showed welcome text.
Profile/models/session GET and session SSE returned200. Timeout was BEFORE notify
POST; not evidence of an introduced receiver bug.

## Phase 1 — bounded impact / executed BASE cause

GitNexus `impact(target:"test_native_dom.mjs", direction:"upstream", repo:"Rhythm",
file_path:"tools/dev/hermes_webui_receiver/test_native_dom.mjs", includeTests:true)`
returned `Target not found`, risk UNKNOWN. This is an unindexed additive fixture,
not proof of zero dependencies. Direct launcher reviewed: test_native_browser.py
subprocess. No shared production symbol was edited. Main consequential risk was
turning a transient restored session into false readiness / hiding a renderer gap;
retained real DOM checks and added native current-pane/SSE readiness mitigate it.

Parent supplied executed BASE evidence in triage `6c9d5155`: reverse native.patch
ONLY in disposable source copy, verify all107 pins, breakpoint boot.js4387:
sid fixture-chat, count0, no pending/draft, loading null; then boot true, sid null.
This run independently executed the disposable reverse-patch integrity verifier
before and after repair (all107 pins exact), and reproduced the candidate timeout.
It did NOT rerun the parent's interactive BASE breakpoint. `git show --stat
--oneline 6c9d5155` failed unknown revision: triage identifier is not an available
commit in this retained worktree; no Git history/source change was attempted.

Actual unchanged boot.js4386–4399 deliberately clears empty restored chats after
loadSession; the old fixture's function-exists wait selected during boot, so boot
could clear the selection. messages.js server_turn_started requires current pane;
sid null cannot attach. This explains why successful GET/SSE did not prove ready.
No receiver regression proven by this failure.

## Phase 2 — smallest repair and executed checks

Repair attempt1 of maximum2 PASSED; no second repair attempted. Both first page
and reopened page await `S._bootReady`, no load, and OPEN native gateway SSE.
For this exact fixture boot path, gateway subscription starts after terminal
restore/list/composer-prefill work (empty restore or completed saved restore).
Then explicitly select registered chat via existing awaited `loadSession` and
assert native current-pane, no load, matching session-stream SID and OPEN
session EventSource. Initial selection additionally asserts count0/no reply before
POST. Reopen uses the saved normal native GET path; no manual transcript injection.
Existing reply occurrence, input-text, foreign-chat and provider-count assertions
are unchanged. Production visible ACK remains unimplemented/fail-closed.

```sh
python3 -B -m unittest hermes_webui_receiver.test_native_browser -v
```

```text
test_existing_frontend_live_reopen_and_foreign_chat_dom ... ok
Ran 1 test in 2.418s
OK
{"liveDOM":"PASS","reopenDOM":"PASS","foreignChat":"PASS","externalRequestsAborted":14,"pageErrors":["Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector","Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector","Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector","Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector","Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector","Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector","Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector","Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.","Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.","Failed to load resource: the server responded with a status of 400 (Bad Request)","Failed to load resource: the server responded with a status of 400 (Bad Request)"]}
```

Retained browser diagnostics are not claimed clean: blocked CDN, sandboxed service
worker and two400 resource errors were reported despite passing behavioral checks.
No network/security fence relaxed to suppress them.

```sh
python3 -B -m unittest hermes_webui_receiver.test_native_http hermes_webui_receiver.test_native_wakeup -v
```

```text
test_arrival_is_durable_in_registered_native_receive_route ... ok
test_busy_is_durable_and_never_steers_active_turn ... ok
test_collision_foreign_chat_revocation_and_browser_denial ... ok
test_crash_windows_quarantine_without_blind_retry ... ok
test_journal_persist_failure_is_scoped_fail_closed ... ok
test_owner_profile_and_old_session_binding_changes_are_denied ... ok
test_real_native_reply_duplicate_restart_and_reopen ... ok
Ran 7 tests in 35.114s
OK
```

```sh
python3 -B -m unittest hermes_webui_receiver.test_host_failure_windows hermes_webui_receiver.test_host_job test_hermes_webui_receiver test_hermes_notify_subscriber test_hermes_notify_repair test_hermes_notify_workflows test_hermes_notify_run_origin -v
python3 -B -m hermes_webui_receiver.verify_native_artifact
```

`Ran 54 tests in 0.245s / OK` (inherited repeated cases, not54 unique behaviors).
Included all six host failure-window checks and missing-native-gate/host-metadata
install denial. These are fixture tests, NOT host installation or actual restart.
Verifier both before and after:
`PASS: five patched outputs; all 107 original pins recovered exactly; native Python compiles`.
Root `git diff --check`, `git status --short`, `git rev-parse HEAD` passed;
HEAD unchanged. Existing dirty files retained. No Rhythm API/fork dependency used;
Rhythm sandbox NOTRUN/not required. Future dependent checks retain canonical
four fixture/path variables and ports4898/4897/4899, never manual API startup.

## Hashes / independent handoff / Notes

| Artifact | SHA256 after repair |
|---|---|
| test_native_dom.mjs (only code change) | 61f388991afb0240fcfe152c36f509f620a63ac4d768c355c0bd4d610e916784 |
| test_native_dom.mjs before | 4cc1c12fe6d152220dad6009874746455f88e85b9deea31a37c906f851ec89da |
| frozen test_native_http.py, unchanged | 86731b89059107ffd05234c3411c69bc8ab288388b55b48f90578546fa4a9bd4 |
| receiver.py, unedited | c1f6230a8bd861b87b2eea0da6cce438cbf9a167e19cccf65c85c7f8ad1f013f |
| native.py, unchanged | 65c1ef6551e2ac8abc0682e24233d7e9d71d0bc3d9161a421ba4ec7b2457a932 |
| native.patch, unchanged | 6f975d3c4e8cf0acb15dbde6e65ba3140a821c7f7afb4e6dc0f5acea7926957f |
| native_patch_manifest.json, unchanged | 284eced5b19461e1ae6d6df7d8a94527ea8ce8a74753bb33de2e9bbcd912a43c |
| test_native_wakeup.py, unchanged | 46e7d62bd09b6f427e3b24d74a33546e35f8b50e31e6349c68ecc641e398ef89 |
| test_native_browser.py, unchanged | 922308ca79d0aa56c860cf621cfceb5e7e1e3ef2bcca1f48e5572a2409c0193b |
| source static/boot.js, original pin | 4550e39b90d260f77dfea4803c26623a8d2e7e338cf82deecfc401467ca4eee3 |
| source static/messages.js, original pin | 80522759fb39cb815f4c32846832741c96ce6ff8422db87e232cd48e9c9932e7 |
| source static/sessions.js, original pin | c00bf0536e7ed6458d082f1f0261e3e82fb0af05821f91a630f2bad7f295dbdc |

Source bytes and receiver/patch package were not written. Verifier proves all
five patched source outputs still match manifest and all107 original pins recover
exactly; native.patch hash unchanged. Browser uses installed dependency/binary
read-only, offline ephemeral HOME/context, real server/native DOM and provider-only
deterministic seam. Owned fixture servers/browser close in finally; temporary
directories disposed by their owners; no shared process/port touched.

| Separate acceptance status | Evidence / boundary |
|---|---|
| Arrival | PASS actual durable native receive contract |
| Wake / saved correct chat | PASS real native journal, worker, provider and save |
| Wake visible | PASS exact one reply + input text in actual Chromium/native renderer |
| Foreign chat | PASS empty native saved chat and actual foreign DOM excludes reply |
| Busy | PASS held provider, second durable accepted event, no steering, 1→2 invocations |
| Duplicate | PASS exactly1 provider invocation + one submitted canonical identity |
| Fixture server restart | PASS repost after restart stays exactly1 provider invocation |
| Browser reopen | PASS settled boot + existing loadSession displays saved reply exactly1 |
| Crash / no-reply | PASS before/after journal0, after admission1; no blind retry; journal error0 |
| Production native visible ACK | NOT IMPLEMENTED; no client-bool ACK or visibility claim |
| Host job independent readiness | PENDING parent independent gate |
| Installation / AJ planned live restart | NOTRUN; parent only AFTER gates |

READY_FOR_NATIVE_INDEPENDENT_GATE for this bounded fixture repair, not the whole
feature or a historical milestone. Parent independent verifier can run exact
commands above without source write access; no independent PASS claimed here.
Do not infer deployment/install/restart permission from this result or source_guard.
