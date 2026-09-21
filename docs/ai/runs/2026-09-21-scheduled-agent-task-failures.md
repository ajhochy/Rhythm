---
date: 2026-09-21
repo: Rhythm
branch: fix/agent-schedule-infra-preflight
pr: 1548
issues: []
status: draft-pr-open
tags: [run, Rhythm]
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

**The empty model lists are a symptom, not a second bug.**
- `GET /opencode/models` → `[]` is **by design**: the route only serves
  `?provider=openrouter` and returns `[]` for anything else. Unrelated.
- `GET /agents/models` → `[]` **is** downstream of the expiry: `server.ts:764`
  pushes credentials into the engine only when `status === 'ok'`, so `auth.json`
  loses its `anthropic` entry, `listAuthedProviders()` drops `anthropic`, and
  every anthropic-backed row is filtered out. It should refill after re-login.

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

**3b — theological-research-daily: a genuinely hung tool.** Last part is
`bash` running `agent-reach doctor --json 2>&1`, status `running`, started
12:19:23, never completed. The timer was right; the message
("no progress for 600000ms") named the symptom and not the stuck command, so it
was indistinguishable from a dead engine or an unauthenticated model.

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

- `tsc -p tsconfig.json --noEmit` — clean.
- `vitest run src/__tests__/workstream_a_*.test.ts` — 9/9 pass.
- Red→green verified: with `agent_runner.ts` reverted to `origin/main`, 3 of 4
  class-2/3 contract tests fail; the fourth is the fail-open guard and correctly
  passes on both sides.
- Full `vitest run` — see PR.
- Live: pco-song-usage-sync trigger-now → `completed_no_op` 339s.

## Notes / user actions

1. **Re-login the `personal` account** (Settings → the agent settings re-login
   flow). Not done here by design — it is an OAuth flow the user must perform.
   `ai-trend-research-daily` stays broken until then, and `GET /agents/models`
   stays `[]`.
2. **`agent-reach doctor --json` hangs.** The runner change makes this
   diagnosable and bounded, not fixed. Worth a timeout in the skill itself.
3. None of this reaches the running desktop app until a rebuild — the live
   bundle is from Sep 19.
