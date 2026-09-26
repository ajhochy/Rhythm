---
date: 2026-09-21
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1548  # record against main; NOT the merge path for this branch
issues: []
status: landed-on-mega (record PR #1548 vs main)
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Workstream A — scheduled agent tasks failing

34 schedules; 8 enabled ones failing across three classes. All three turned out
to be *different* root causes sharing one defect: the failure was recorded in a
run-history row and a log line, and surfaced to nobody.

## Class 1 — `required_mcp_unavailable: pco-services`

5 enabled schedules (worship-volunteer-care, pco-song-usage-sync,
monday-worship-planning, daily-email-triage, daily-morning-briefing).

**Root cause (environment, fixed before this run):** `~/pco-mcp` symlinks to
`Documents/Claude Cowork/pco-mcp`, whose `.venv` had been deleted. opencode's
spawn of `.venv/bin/python` failed ENOENT. Rebuilt with
`/opt/homebrew/bin/python3.12 -m venv --clear .venv` (system python3.9 is too
old for fastmcp — that is the trap), then `POST /opencode/mcp/pco-services/connect`.

**Verified green.** `GET /opencode/mcp` reports pco-services `connected`, 32
tools. `POST /agent-schedules/<pco-song-usage-sync>/trigger-now` →
`completed_no_op` after **339s**, matching its healthy history (09-13, 09-06,
08-31 all `completed_no_op`). Its prior run failed in **22ms** at preflight.

**Code defect:** the #892 preflight detected this correctly and failed fast with
an accurate message. Nobody was told. Five schedules failed for three days.
Fix is a notification, not better detection.

## Class 2 — `model produced no output` (ai-trend-research-daily)

**Root cause:** the default opencode/Anthropic account `personal` expired
**2026-09-18T11:11:54Z** and could not be refreshed;
`AnthropicAccountsService.refreshAll` marked it `needs_relogin` and logged an
error. Nothing on the run path ever read that status — `grep -rn needs_relogin
src/` had exactly one external reader, `server.ts:765`, which only decides
whether to push the token into the engine at boot.

So runs kept dispatching against a dead credential and the operator got
"check the agent profile model (provider/modelId) is valid and the provider is
authenticated" — accurate but misdirecting, since the profile and model were fine.

**Evidence:** the failed run's session has 2 messages, an empty-text assistant
output, cost 0.

**CORRECTION — the empty model lists were neither a bug nor a symptom.**
An earlier version of this record claimed `/agents/models` was downstream of the
account expiry. That was wrong. Both observations were **parameter-less calls**:

- `GET /opencode/models` → `[]` by design; the route only serves `?provider=openrouter`.
- `GET /agents/models` → `[]` by design; the route is `GET /agents/models?agentId=<id>`.
  `GET /agents/models?agentId=claude-code` returns the full anthropic list, and
  `GET /agents/models/catalog` returns every row with `authorized: true`.

Verified live **after** the user's re-login, and the credential path is healthy:
`~/.local/share/opencode/auth.json` holds a valid `anthropic` entry of type
`oauth`. **No api_server restart is or was required.** `server.ts:764` is not the
only writer — `POST /opencode/auth/accounts/login-complete`
(`opencode_auth_routes.ts:226`) pushes the default account's credentials into the
engine as part of the login itself, and `CredentialsBridgeService` re-bridges on
a 15-minute loop plus a change-gated Keychain poll.

This also settles that the new account preflight is live-accurate without a
restart: `AnthropicAccountsStore.read()` does a `readFileSync` on every call with
no caching, so `defaultAccount()` observes a re-login on the very next run.

## Class 3 — `no progress for 600000ms (inactivity window)`

Two schedules, two *different* stalls. Neither is the ca373540 SQLite
event-loop bug (see below), and the progress-aware deadline was working
correctly — both had succeeded nine times running before 2026-09-18.

**3a — ffb-daily-dashboard-update: a structural window mismatch.** The last
tool part is a `bash` call running `refresh_all.py daily` with an explicit
`timeout: 1200000` — the engine's maximum for a single tool call. A tool call
emits no new message parts while it runs, so the activity probe cannot observe
progress for its whole duration. With a 600_000 ms inactivity window, **any**
tool call over ten minutes was a guaranteed kill of a healthy run. Aborted ~17
min in.

**3b — theological-research-daily: a hung tool.** Last part is `bash` running
`agent-reach doctor --json 2>&1`, status `running`, started 12:19:23, never
completed. The timer was right; the message ("no progress for 600000ms") named
the symptom and not the stuck command, so it was indistinguishable from a dead
engine or an unauthenticated model. The hang is **not** reproducible on demand
(see note 2) — which is the argument for naming the command in the message
rather than chasing the tool.

## ca373540 is NOT in the running bundle

The live server on :4001 is
`~/Applications/Rhythm Mega Desktop Candidate.app/.../api_server/dist/server.js`
(built Sep 19). Its `skill_usage_tracker.js` still has a **synchronous**
`countSkillToolUses`; the chunked/`setImmediate`-yielding version from ca373540
is only on `fix/agent-server-health-flap` (PR #1508) and is **not on `main`**
either. It is not implicated in class 3 — both stalls are explained by the
transcripts above — but the fix is still unshipped.

## Files

- `apps/api_server/src/services/agent_runner.ts` — Anthropic account preflight
  (auth sibling of the #892 MCP preflight, fails open on every ambiguity);
  default inactivity window now `MAX_ENGINE_TOOL_TIMEOUT_MS + 300_000` instead
  of 600_000; inactivity timeouts name the tool call they stalled on.
- `apps/api_server/src/services/agent_notifications.ts` — new; the INSERT +
  broadcast pair extracted from the controller so the scheduler raises the same
  notification `rhythm_notify` does.
- `apps/api_server/src/controllers/notifications_agent_controller.ts` — uses it.
- `apps/api_server/src/services/agentSchedulerService.ts` —
  `notifyInfraFailureOnce`: notify on the first user-actionable failure, stay
  quiet while the same cause repeats, notify again when it changes.
- `apps/api_server/vitest.setup.ts` — stop the suite reading the developer's
  real `anthropic-accounts.json` (surfaced by the new preflight).
- Two new contract test files.

## Checks

All re-run **on `mega/2026-09-18-mobile-electron-hermes`** after the port —
evidence from the main-based branch does not transfer to this one.

- `tsc -p tsconfig.json --noEmit` — clean on mega.
- `vitest run src/__tests__/workstream_a_*.test.ts` — 9/9 pass on mega.
- Red→green re-verified on mega: with `agent_runner.ts` reverted to the mega
  baseline (`HEAD~1`), 3 of 4 class-2/3 contract tests fail; the fourth is the
  fail-open guard and correctly passes on both sides.
- Full `vitest run` on mega — see below.
- Live: pco-song-usage-sync trigger-now → `completed_no_op` 339s.
- For the record, against `main`: full suite 6175 passed / 1 pre-existing flake
  (`pty_proxy.test.ts`, passes in isolation), and PR #1548 CI fully green
  (foundation, live-postgres-bootstrap, server-checks).

## Notes / user actions

1. **Re-login: DONE by the user.** Both `team` and `personal` now report `ok`
   (`personal` expires 1790035400331). No restart needed — see the correction
   above. `ai-trend-research-daily` should run on its next schedule.
2. **`agent-reach doctor --json` is not deterministically hung.** It exited 0 in
   18s on a retry, so it is state- or environment-dependent. The likely
   mechanism is in `agent_reach/probe.py` `_run_once`: it calls
   `subprocess.run(..., capture_output=True, timeout=N)` with **no `stdin=`**,
   so probed children inherit the engine's stdin, and `subprocess.run`'s timeout
   kills only the *direct* child. When that child spawned a grandchild holding
   the stdout pipe — which is exactly the shape of `mcporter` spawning stdio MCP
   servers, and the doctor output shows it invoking mcporter for `linkedin` and
   `exa_search` — the post-kill drain blocks forever.

   **A per-probe timeout cannot bound that**, which is precisely why the
   run-level inactivity window is the only backstop and why its message has to
   name the command. It now does: `…; last activity: tool `bash`
   (agent-reach doctor --json 2>&1) running`. Fixing agent-reach itself is out
   of scope and out of this repo.
3. None of this reaches the running desktop app until a rebuild.

## Retarget (same day)

Originally branched off `main` as `fix/agent-schedule-infra-preflight`
([PR #1548](https://github.com/ajhochy/Rhythm/pull/1548), CI green: foundation,
live-postgres-bootstrap, server-checks all pass) — left open as the record
against `main`.

The user then asked for the fix on the branch their running app is actually
built from. That was verified by byte-comparing the bundled
`app/src/{agent-server,main,hermes-server}.mjs` against the repo: identical to
`mega/2026-09-18-mobile-electron-hermes` @ `3641f303`. The api_server changes
were cherry-picked there and **re-verified on that branch** — evidence from the
main-based branch does not transfer. No second PR was opened.
