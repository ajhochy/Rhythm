---
date: 2026-09-17
repo: Rhythm
branch: fix/agent-server-health-flap
pr: https://github.com/ajhochy/Rhythm/pull/1508
issues: [1503]
status: verified-awaiting-manual-smoke
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Local agent server "disconnects" on v0.18.64: cause and fix

## Files

- `apps/api_server/src/services/skill_usage_tracker.ts` — `countSkillToolUses` is now async and scans `agent_session_messages` in 100-row id chunks with a `setImmediate` yield between chunks.
- `apps/api_server/src/services/harvested_skill_evaluator.ts`, `src/routes/opencode_skills_routes.ts` — await the counter.
- `apps/api_server/src/__tests__/contract_agent_server_health_flap.test.ts` (new, c1), `skill_usage_tracker.test.ts`, `fixtures/skill_usage_tracker_heap_child.ts` — awaited.
- `apps/desktop_flutter/lib/app/core/agents/agent_server_controller.dart` — `HealthPoller` `failureThreshold: 3`.
- `apps/desktop_flutter/lib/app/core/server/api_server_service.dart` — `checkHealth` timeout 2 s → 10 s.
- `apps/desktop_flutter/test/contract/agent_server_health_flap_contract_test.dart` (new, c3); `pubspec.yaml`/`pubspec.lock` declare `fake_async`.
- `docs/ai/contracts/agent-server-health-flap.json`, `docs/ai/decisions/2026-09-17-chunked-skill-usage-scan.md`, `docs/ai/project-state.md`.

## Evidence (installed v0.18.64, app launched 11:24 PDT / 18:24Z)

- `~/Library/Application Support/Rhythm/logs/agent-server-crash.log` does not exist: #1494's owned-exit recorder never fired, so no API child crashed on its own. Hypothesis 3 (new crash) ruled out.
- `~/Library/Logs/Rhythm/api_server.log` shows four API starts in the session: 18:22:21Z `SIGTERM received` → restart; 18:24:26Z `PARENT_GONE` (app relaunch, parent 42126 → 14041); 18:36:22Z `SIGTERM received` → restart; the 18:36:25Z process then vanished with **no shutdown line** and the 18:38:19Z start `reclaimed :4096 from stale opencode PID 32712`. The only SIGTERM senders are `stopGracefully()` (Retry button, `AgentsController.reconnectSession`, quit). A process whose loop is blocked cannot run its SIGTERM handler, and `stopGracefully` escalates to SIGKILL after 2 s — that is the silent death and the orphaned engine. Hypothesis 4 partially confirmed: the Retry path turns a stall into a real disconnect.
- Engine log `~/.local/share/opencode/log/2026-09-17T183625.log` ends `permission.asked` 18:38:03Z … `global event disconnected` 18:38:18Z — the turn was killed mid-flight.
- Live reproduction on the dev build against AJ's 4 GB `rhythm.db` (turn finished 19:11:59Z): `/health` failed 19:13:08Z–19:13:22Z (14 s, RSS 838 MB). `sample` of the API pid during the stall: main thread 1490/1492 samples in `StatementIterator::Next → sqlite3_step → vdbeColumnFromOverflow → accessPayload → pread`, invoked from a timer → microtask (the idle skill evaluator, 60 s debounce). Hypothesis 1 confirmed; this is the residual `#1494` warned about ("counting still scans history synchronously in SQLite").
- HealthPoller math on the old constants: 15 s interval, 2 s timeout, 2 consecutive failures → any stall ≥ ~17 s flips `AgentServerController` to `failed/lostConnection`; the Agents view swaps the chat for "Agent server unavailable — The agent server failed to start" with Retry. Retry during the stall = SIGKILL.
- Hypothesis 2 (WebSocket drops independent of process health): no evidence; `[OpencodeStreamBridge] global stream error: terminated` appears only after the SIGTERMs.
- The Sep 16 `#1503` sample (gzip'd JSON array parse via undici) did **not** reproduce; `GET /agent-sessions/31dbda97…/diff` (Codex lane's top candidate) is 1.4 KB in 8 ms. A temporary `JSON.parse` hook only caught `listAgents` (2.6 MB, ≤ 11 ms). Left open on #1503.

## Checks

- `ai-workflow checks --level pr` (final, after the temporary diagnostic was reverted): 15/16 green — flutter analyze, dart format, api_server tsc, mcp_server tsc, flutter test (1,321), api_server lint, api_server vitest (serial), api_server build, mcp_server vitest + build, opencode fork typecheck + session tests, mobile static/contract/fake-server. `mobile web e2e` failed 4/71 (`flows.spec.mjs:278`, `:319`, `issue-1172-deltas.spec.mjs:37`, `issue-1174-parity.spec.mjs:149`) on Expo boot `toBeVisible` timeouts; re-run in isolation with `--retries=1`: 1 passed, 3 flaky-then-passed. `git diff main -- apps/mobile` is empty. failure-triage: environment flake per #1287 (CI uses `retries: 2`), OUT OF SCOPE.
- Contract: c1 (`contract_agent_server_health_flap.test.ts`) and c3 (`agent_server_health_flap_contract_test.dart`) both failed on the unmodified code and pass on the branch; c2 = existing tracker suite (18) green awaited.
- Smoke probes on the running fixed build: `/health` 200 in 0.9 ms, `/opencode/health` `ready`, `/agents/capabilities` 200.
- Environment fixes needed to run the PR gate locally (not committed): `npm ci` in `apps/api_server`, `apps/mcp_server`, `apps/mobile`; `bun install` in `apps/opencode_fork` (reverted its `bun.lock` drift); `playwright install chromium` for the mobile package's pinned `chromium_headless_shell-1217`.

## Soak (fixed dev build, `RHYTHM_DIAG_BIGPARSE=1`, real DB + engine)

- Window 19:29:14Z–20:13:43Z (44 min), 6 scripted multi-step chat turns (ls/date/wc + reply) in a dedicated test session, each followed by the idle skill-evaluator sweep on the 4 GB database.
- `/health` polled every second: 2,539 polls, **0 failures, 0 polls over 3 s**; worst single poll 1.41 s (19:45:21Z, mid-sweep), p95 41 ms. Before the fix the same sweep blocked `/health` for 14 s at 19:13Z.
- API child pid 85416 alive for the whole window; 0 `listening on :4001` restarts, 0 SIGTERM/PARENT_GONE, 0 Flutter `lostConnection` transitions.
- With 500-row chunks (first soak attempt, 19:26–19:29Z) one poll hit 3.2 s; dropping to 100-row chunks removed it.
- Temporary `JSON.parse` hook (`RHYTHM_DIAG_BIGPARSE=1`, not committed) caught only `listAgents` responses of 2.6 MB parsed in ≤ 11 ms — the Sep 16 gzip'd-array stall did not appear.

## Notes

- GitNexus: `impact(countSkillToolUses)` LOW (1 direct caller indexed; a second, `opencode_skills_routes.ts`, was found by `tsc`), `impact(HealthPoller)` MEDIUM (2 direct), `impact(checkHealth)` LOW; `detect_changes` low risk, 0 affected processes.
- Follow-ups: (a) the Retry path should not SIGKILL a live-but-busy child (wait for the loop instead); (b) the "failed to start" copy in `agents_view.dart` is wrong for `lostConnection`; (c) `#1503` gzip-array stall still unattributed; (d) write-path skill-usage counters if per-sweep I/O ever matters (see decision).
- The installed app was quit at 19:10Z for the dev-build soak; AJ must relaunch `/Applications/Rhythm.app` (or the fixed build) after smoke.
