---
date: 2026-07-10
repo: Rhythm
branch: workflow/run-2026-07-10-nonmobile-issues
pr: (pending)
issues: [1002, 1000, 1004, 1003, 1001, 999, 981, 971, 976, 977, 961, 962]
status: in-progress
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Non-mobile issue wave — live-backend-verified fixes

DoD for this run (per AJ): **"done" = a live behavioral probe against the real
backend** (real api_server + real fork opencode engine), not tsc/unit. Unit
tests are supporting evidence only. Probe harness: standalone `node
dist/server.js --parent-pid=1` on a spare port (:4077) against a **copy** of the
real DB + a copy of the managed skills dir, real `RHYTHM_OPENCODE_BIN`.

## Files

### #1002 (LINCHPIN) — headless/scheduled agent runs
- `services/agent_runner.ts` — `_runOnce()` now uses `effectiveCwd` (not the raw,
  undefined `cwd`) for `prompt`/`abortSession`/`listMessages`. opencode sessions
  are directory-scoped; headless callers (scheduler, cookbook) pass no cwd, so the
  post-creation calls hit the engine's *default* instance → empty parts → bogus
  "model produced no output". Interactive worked because ws_gateway re-reads cwd
  from the persisted row.
- `repositories/agent_sessions_repository.ts` — `resetStaleRunning()` now recovers
  `'starting'` as well as `'running'` on boot (sessions never enter `running`, so
  the 45+ stuck-`starting` rows were never freed).

### #1000 — scheduled-task save 500
- `repositories/agent_scheduled_tasks_repository.ts` — `updateAsync` coerces JS
  boolean `enabled` → 0/1 for better-sqlite3 (Postgres keeps native boolean).

### #1004 — tighten-scope over-prune
- `services/org_audit_service.ts` — `sessionCountByProfile` counts only EXECUTED
  sessions (excludes `starting`/`error`), so #1002's failed sessions can't make a
  never-run agent read as "over-scoped".

### #1003 — un-approvable grant-delegation proposals
- `services/generators/workflow_signal_generator.ts` — `delegation-change`
  diagnosis routed to `null` (log-only; the deterministic #825 generator covers
  real gaps). No new un-approvable proposals.
- `services/org_proposal_appliers_wiring.ts` — `validateDelegationChangeShape`
  gives an actionable refusal for legacy diagnosis-envelope items instead of the
  cryptic `agentConfigId is required`.

### #1001 — live-E2E test-agent leak
- `__tests__/_live_e2e_guard.ts` (new) — `assertLiveE2EIsolation()` refuses to run
  unless `DB_PATH` is a non-real path AND `RHYTHM_LIVE_E2E_ISOLATED=1`.
- Wired into the 5 config-creating suites (929, 927_952_gemini, 930, 948_949,
  958). 7 leaked profiles + agent files deleted from the real config via API.

### #999 — empty transcripts for tool-using sessions
- `controllers/agent_sessions_controller.ts` — `GET /agent-sessions/:id/messages`
  now calls `listBySessionStructured` (parts) not `listBySession` (text-only).

### Test reconciliations (behavior intentionally changed)
- `issue_857_contract.test.ts`, `org_audit_service.test.ts` — fixtures mark
  sessions `idle` (executed) for the #1004 floor.
- `issue_738_agent_runner.test.ts` — prompt/abort now assert `process.cwd()`
  (effectiveCwd) per #1002.

### #981 — org-optimizer refine-task kind
- (in progress — worktree subagent) new proposal kind end-to-end.

## Checks

- `tsc --noEmit`: **exit 0** across all changes.
- Full api_server suite: **2616 passed, 0 failed, 23 skipped** (gated live-E2E).
- CI (server-checks): pending on push.

## Live probes (the real DoD)

- **#1000**: `PATCH /agent-schedules/:id {enabled:true}` → HTTP **200** (was 500),
  persisted; toggle back 200.
- **#1002 boot**: 46 `starting` → boot log `"Reset 46 stale running session(s)"`
  → **0 `starting`**.
- **#1002 core**: created + `trigger-now` a scheduled task → scheduler fired →
  session reached **`idle`, `last_preview:"pong"`**, task `last_run_status:success`
  (was "model produced no output"/`error`). Real fork engine + real anthropic auth.
- **#1004**: real built `detectTightenGaps` — flipped profiles (≥10 total, <10
  executed) drop from tighten gaps; total **30 → 18**.
- **#1003**: approve diagnosis-envelope grant-delegation → HTTP 400 with the new
  **actionable** message (not `agentConfigId is required`).
- **#1001**: guarded suite without isolation → refuses at setup; with isolation →
  proceeds. 7 leaked profiles gone (census: 0).
- **#999**: transcript endpoint returns 63/63 messages, 248 parts (tool/reasoning/
  step); 58 previously-"(empty message)" now carry content.

## VERIFY & CLOSE (already on main via PR #982) — closed with evidence
- **#971, #976, #977, #961, #962** — LIVE-CONFIRMED (code trace + real server
  :4001). #977 crux: `agent_skills.body` is only a measurement/version snapshot,
  never served as content; files are the sole source. Closed on GitHub.

## Notes / follow-ups
- **Manual smoke (handoff):** #999 (Session History renders tool transcripts) and
  #1000 (cron enable/disable toggle) need a real app click-through.
- **Follow-up candidate:** #1004's optional dependency guard (mirror #959: never
  prune an MCP the profile's prompt/skills reference) — not implemented (out of
  the narrow steer); with #1002 fixed the measure/revert net works again.
- **Optional cleanup:** 3 legacy diagnosis-envelope `grant-delegation` proposals
  remain `proposed` in the real DB — now show the actionable refusal on approve;
  left untouched (rejecting them was beyond the named scope).
- **DEFER (untouched):** #983–#988 (Plan A), #989–#997 (Plan B) — left open per AJ.
