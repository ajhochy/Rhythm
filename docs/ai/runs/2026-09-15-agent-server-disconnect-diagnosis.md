---
date: 2026-09-15
repo: Rhythm
branch: feature/org-reviewer
pr: null
issues: []
status: cause-reproduced-unfixed
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Running desktop agent-server disconnect diagnosis

Subsequent implementation and verification: [memory and recovery fix](2026-09-15-agent-server-memory-fix.md). This report preserves the earlier diagnostic evidence.

## Files

- Diagnostic notes and project-state snapshot only; no application code, settings, credentials, databases, or running processes changed.
- Inspected the installed Flutter app and its bundled API JavaScript as well as repository source. Installed version: 0.18.63, build 148. The current checkout has unrelated existing changes, which were preserved. No branch switch, commit, PR, deployment, or restart was performed for this investigation.

## Checks

- `ps -axo pid,ppid,lstart,etime,%cpu,%mem,command` filtered to Rhythm/API/engine: Flutter PID 11980 started September 14 at 16:10:47 PDT; its API child is absent. Engine PID 13890 is orphaned under PID 1 and still listening on 4096.
- `lsof -nP -iTCP:4001 -iTCP:4096`: no API listener on 4001; engine listener on 4096.
- `curl --noproxy '*' -sS --max-time 4 http://127.0.0.1:4001/health`: connection refused, HTTP 000.
- `curl --noproxy '*' -sS --max-time 4 http://127.0.0.1:4096/global/health`: HTTP 200, healthy true, PID 13890, engine version `0.0.0--202609141819`.
- Read-only native UI inspection: “Agent server unavailable,” explanatory failure text, and Retry button.
- Parsed `~/Library/Logs/DiagnosticReports/node-2026-09-14-*.ips`, filtering to parentProc Rhythm and its bundled Node executable. Eight reports contain SIGABRT and `node::OOMErrorHandler` / `v8::internal::V8::FatalProcessOutOfMemory`. Crash times (PDT): 15:08:54, 15:15:30, 15:52:34, 16:00:31, 16:02:22, 16:04:19, 16:10:05, 16:13:29. Six include JSON object/array parsing; two include ArrayIsArray and Node timer dispatch. Last report: `node-2026-09-14-161336.ips`, API PID 11983, parent 11980.
- `tail -150 ~/Library/Logs/Rhythm/api_server.log`: latest startup 23:13:44 UTC; last log 23:24:52 UTC September 14, without a shutdown message. At 23:13:44 the new API reclaimed the previous orphan engine (PID 11996) with SIGTERM. The final API disappearance after 16:24 PDT has no matching captured native crash report, so its exact exit cause is not independently established.
- Read-only SQLite aggregate queries (no transcript bodies) against the local Rhythm database: 105,772 message rows; 2,737.47 MiB of parts JSON; largest message 129.70 MiB. The largest messages date to August, so their direct involvement in yesterday's crashes is unproven. Recently active root transcripts were approximately 18.58 and 12.60 MiB. Relay outbox: 75 rows, 0.69 MiB; no large current relay backlog demonstrated.
- GitNexus CLI queries for WebSocket/transcript, relay, and skill-usage/evaluation flows completed. No symbol edits or commits, so no impact/detect-changes gate was required. Follow-up standalone diagnostic processes are recorded below; no model requests or additional API/engine launches occurred.

## Notes

**Confirmed recurring failure:** the bundled local Node API exhausts its JavaScript heap and aborts. This closes desktop agent connections. The native crash bypasses the API's SIGTERM/SIGINT cleanup, leaving its engine alive and orphaned. The engine's current healthy response therefore does not mean the agent server is available.

**Confirmed recovery gap:** `api_server_service.dart:349` only clears the process reference on exit. `agent_server_controller.dart:153` only changes connection status when health checks fail; `retry()` is an explicit user action. WebSocket reconnection cannot restart a dead process. A subsequent API startup reclaims the orphan engine, also interrupting work that survived the API crash.

**Reproduced allocating path:** `skill_usage_tracker.ts:94-104` selects every non-null message's `parts_json` across the database into one `.all()` array. It retains all those strings while parsing eligible rows at line 60. `harvested_skill_evaluator.ts:555` calls this counter unconditionally, even before checking whether any draft needs evaluation. Interactive turn completion schedules this evaluator after 60 seconds (`opencode_stream_bridge.ts:1862`, `harvested_skill_evaluator.ts:199`). The installed bundle contains this exact code. Standalone execution of the installed function consumed roughly 4 GiB of heap; with 128 MiB reserved to simulate other server state it aborted with the same V8 JSON-parser OOM. This supersedes the initial one-second polling hypothesis.

Additional risk factors: transcript pages are bounded by row count rather than bytes (`agent_session_messages_repository.ts:528`); every row's parts JSON is parsed wholesale (line 99); streaming deltas also parse/rewrite full message parts (line 343). Large stored payloads can amplify allocation pressure. None of these is conclusively identified as the allocating source of an individual crash.

Repair target: remove the full-table `.all()` materialization in skill-usage counting; use bounded/incremental usage aggregation and avoid parsing unrelated tool payloads. Streaming rows demonstrated much lower memory but still reads the entire archive, so it is a mitigation rather than a complete performance design. Add an evaluator in-flight guard and API process supervision/backoff with durable native stderr/exit capture. No application repair or recovery was attempted in this task.

### Follow-up: why the polling exists and when it changed

- `git blame` identifies commit `bfe4e939bcadf8339c6f4c8c8d656cbeb1f1434b`, July 30, 2026, as the introduction of both the one-second timer and full-history activity probe. Commit title: “feat(api): progress-aware agent-run deadline replacing blanket 600s abort”; workstream R4 / PR #1257.
- The purpose was to keep a productive headless run alive beyond the old blanket ten-minute timeout. A changed conversation snapshot resets a ten-minute inactivity window, with an independent one-hour ceiling. The decision chose polling to avoid introducing another SSE subscription. See [decision](../decisions/2026-07-30-progress-aware-agent-runner-deadline.md).
- `git tag --contains bfe4e939b` includes `v0.18.55` (August 7) and subsequent releases. `git log v0.18.62..v0.18.63` over AgentRunner, OpenCode client/bridge/fork, message repository, and Flutter API service returns no commits. The installed bundle includes this older loop. It is not new in v0.18.63.
- The loop runs while AgentRunner's synchronous prompt is pending, not for every open chat; it skips a tick if the previous probe is still in flight. The full transcript travels over localhost from engine to API, not from the model provider.
- This history check initially left the recent onset unresolved. The subsequent reproduction below identifies a different older scan and a data-size threshold; the July 30 polling change does not explain these crashes.

### Follow-up reproduction: automatic skill evaluator exhausts heap

Private diagnostic artifacts: `/private/tmp/rhythm-oom-diagnosis-20260915/`. The probe uses the installed Node v24.18.1, installed `better-sqlite3`, and installed `countSkillToolUses` function. It supplies `setDb` with a read-only, `query_only` SQLite handle; no database initialization, migrations, writes, API startup, engine startup, or external model calls occur. Instrumentation records memory and caller stacks, not transcript content.

Commands (run from the repository root):

```bash
/Applications/Rhythm.app/Contents/Resources/node/bin/node /private/tmp/rhythm-oom-diagnosis-20260915/skill-scan-probe.cjs
PROBE_BASELINE_MIB=128 /Applications/Rhythm.app/Contents/Resources/node/bin/node /private/tmp/rhythm-oom-diagnosis-20260915/skill-scan-probe.cjs
PROBE_BASELINE_MIB=128 PROBE_BEFORE=2026-08-28 /Applications/Rhythm.app/Contents/Resources/node/bin/node /private/tmp/rhythm-oom-diagnosis-20260915/skill-scan-probe.cjs
PROBE_BASELINE_MIB=128 PROBE_ITERATE=1 /Applications/Rhythm.app/Contents/Resources/node/bin/node --max-old-space-size=1024 /private/tmp/rhythm-oom-diagnosis-20260915/skill-scan-probe.cjs
```

| Probe | Observed result |
|---|---|
| Exact installed counter, otherwise minimal process | Exit 0; `.all()` returned 104,029 rows and immediately occupied 4,137,224,896 heap bytes. Sampled peak 4,019 MiB. Returned 170 skill names after parsing 82,457 eligible rows. Default heap limit 4,496,293,888 bytes. |
| Same counter plus explicit 128 MiB retained array | Exit 134/SIGABRT; `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`; native stack includes `JsonParser<unsigned short>::ParseJsonObject` / `ParseJsonArray`. The allowance simulates other server state; it is not a measurement of the dead API's baseline. |
| Same 128 MiB allowance; query restricted to records created before August 28 | Exit 0; sampled peak 3,139.6 MiB. This is a reconstruction from current records' creation dates, not a historical database backup. |
| Same current data/128 MiB allowance; diagnostic adapter returns SQLite iterator instead of `.all()` array | Exit 0 under a 1,024 MiB old-space cap; sampled peak 417.4 MiB, 170 skill names, same 82,457 parsed rows and 2,595,274,197 parsed characters. This tests allocation strategy, not a shipped source fix or full API integration. |

Raw outputs: `skill-scan-probe.log`, `skill-scan-128m.log`, `skill-scan-before-aug28.log`, `skill-scan-iterate.log`. Sampled peaks are lower bounds; instrumentation does not capture every transient allocation.

All eight September 14 native OOM captures follow a turn-completion marker from the same handler that schedules evaluation:

| Crash UTC | Scheduling-handler marker UTC | Delay |
|---|---|---:|
| 22:08:54 | 22:07:44 | 69.7 s |
| 22:15:30 | 22:14:21 | 69.6 s |
| 22:52:34 | 22:51:24 | 69.9 s |
| 23:00:31 | 22:59:21 | 69.4 s |
| 23:02:22 | 23:01:11 | 70.5 s |
| 23:04:19 | 23:03:07 | 72.0 s |
| 23:10:05 | 23:08:55 | 69.6 s |
| 23:13:29 | 23:12:10 | 79.1 s |

The 60-second timer plus roughly 10–19 seconds for materialization/parsing/GC fits the recorded failures and the reproduced stack. Existing native crash reports do not retain JavaScript callers; the reproduction and timing establish the strong attribution rather than those native frames alone.

**Why now:** the full-table counter dates to July 8 (`bc4cfce1b`), its timer to July 16 (`413fdfd8e`), and eligibility handling to August 24 (`23af71978`); this path is unchanged between v0.18.62 and v0.18.63. Current stored JSON text grouped by message creation date grows from approximately 2,085 MiB through August 27 to 2,737 MiB through September 14. Materialized JavaScript strings/rows need substantially more heap than that character count. The counter now consumes nearly the whole default heap before ordinary server state and temporary parsed objects are included. This is an older unbounded algorithm exposed by accumulated history, not a new one-second download loop.

**Earlier hypothesis ruled out as common trigger:** task/run records show no scheduled AgentRunner runs around the crashes; short skill-extraction runs had already completed. Ordinary `resolveRunModel` logs also come from interactive WebSocket handling and are not evidence that `AgentRunner.run` was active. Separately, 20 one-second SDK fetch/fingerprint iterations on the 582-message current root completed with post-GC heap steady near 23 MiB. That small probe alone does not prove polling is universally safe, but neither it nor the run records support polling as this incident's cause.

Diagnostic scope: no shipped code changed, no release tests or full behavioral verification of a repair were run, and no backend feature is claimed fixed. Installed engine PID 13890 remained listening on 4096 after the probes; API 4001 remained absent. Existing unrelated checkout changes were preserved.
