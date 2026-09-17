# Rhythm — Project State

## Current focus

**2026-09-17:** Root-caused and fixed the "local agent server disconnects occasionally" report on installed desktop **v0.18.64**. It is not a crash: the idle skill evaluator's full-history skill-usage scan (`countSkillToolUses`) blocks the API event loop 14–30 s about 70 s after every turn on AJ's 4 GB `rhythm.db`; `/health` times out, the desktop `HealthPoller` flips to `lostConnection`, the Agents view shows "Agent server unavailable", and Retry SIGTERMs→SIGKILLs the blocked child (orphaning the engine). Fix: chunk the scan (100 rows, yield per chunk, async) and make the poller tolerate ~40 s of slowness. Details: [run log](runs/2026-09-17-agent-server-disconnect-fix.md), [decision](decisions/2026-09-17-chunked-skill-usage-scan.md), contract `contracts/agent-server-health-flap.json`.

`main` is `2350a500` (#1497 docs catch-up on top of #1507 / #1504). Desktop v0.18.64 (from `fc5695ee`) is the installed build; iOS 1.0.8 build 2026091601 is live for the internal TestFlight group. Hosted API auto-deploys `:main` via Watchtower.

## Active branch / PR

- `fix/agent-server-health-flap` off `main` `2350a500` — draft PR pending (opened by this run; see run log for the URL once created). Do not merge before manual smoke.
- Related open issues: #1503 (event-loop stalls — the SQLite variant is fixed here; the Sep 16 gzip'd-JSON-array variant is still unattributed), #1505 (better-sqlite3 13 upgrade).

## In progress

- Manual smoke of this fix: run the branch build for 30+ min of chat on a large session; expect no "Agent server unavailable" and no `/health` gap > 3 s after turns. The orchestrator's own 44-minute soak on the real DB passed (2,539 polls, 0 failures, worst 1.41 s).
- Still pending from 2026-09-16: manual smoke of #1493 (iOS), #1495 (Electron candidate), #1492 (Org Reviewer) on v0.18.64; TestFlight device pass.

## Risks / known issues

- **The installed `/Applications/Rhythm.app` was quit at 19:10Z** for the soak; the fixed *debug* build from this branch is what is running on :4001/:4096 now. Relaunch the installed app (or `flutter run -d macos` on the branch) before normal use.
- Retry on a live-but-busy child still SIGKILLs it after 2 s (`stopGracefully`); with the stall gone this is rare, but it is the remaining hard-disconnect path. The Agents view copy "failed to start" is wrong for `lostConnection`. Both are follow-ups, not in this PR.
- Per-sweep disk I/O of the skill-usage scan is unchanged (~2.7 GB of parts JSON); only the blocking shape changed. Upgrade path (write-path counters) is in the decision record.
- `mobile web e2e` flakes locally under load (#1287): 4/71 boot-timeout failures in the PR gate, all pass on retry; mobile is untouched by this branch.
- Hosted relay crash-loops on any floating `node:24` tag while better-sqlite3 < 13 (#1505); image is pinned to 24.18.1 (#1504).
- Electron/`apps/web` is a prototype only; Flutter is the shipping client.

## Test status

- Branch `fix/agent-server-health-flap`: `ai-workflow checks --level pr` 15/16 green (flutter analyze/format/test 1,321, api_server tsc/lint/vitest/build, mcp_server tsc/vitest/build, fork typecheck + session tests, mobile static/contract/fake-server); `mobile web e2e` 67/71 with the 4 failures re-passing in isolation (#1287 flake, out of scope). Contract tests c1 (api) and c3 (Flutter) fail on `main`, pass on the branch.
- Live: 44-minute soak on the real database and engine with 6 chat turns — 0 health failures, 0 API restarts, same API pid throughout.
- CI on the branch: see the PR checks (run recorded in the run log after push).

## Next step

Open the draft PR for `fix/agent-server-health-flap`, watch CI, then hand to AJ for manual smoke (checklist in the PR body). After smoke passes: merge manually, cut the next desktop patch release (increment from v0.18.64), and pick up the follow-ups (Retry-during-stall path, `lostConnection` copy, #1503 gzip variant, #1505).
