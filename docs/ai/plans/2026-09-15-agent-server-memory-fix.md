# Agent-server memory and recovery repair plan

## Intent and constraints

Goal: ordinary completed chat turns and opening skill metadata must keep the local API alive as transcript history grows; an unexpected owned API exit must recover automatically with useful crash evidence.

Scope: skill usage counting, harvested evaluator scheduling, Flutter owned-child supervision and native stderr persistence. Preserve learning eligibility and full historical counts, edits/deletes, unknown-score safety, rewrite/quality sweeps, and Postgres no-op. No archive deletion/truncation, heap increase, learning disablement, new engine lifecycle, deployment, or installed-app restart. Only parent orchestrator launches the dev sandbox; never launch api_server by hand. Current checkout has unrelated changes; implement in the orchestrator's isolated worktree.

Design tension: reducing heap versus preserving exact mutable-history counts with the smallest trustworthy change. Cheapest full path: SQLite extracts only usage metadata, real API metadata route exposes accurate uses under constrained heap, controlled-clock tests cover delayed evaluation without requiring an external model to reproduce the database aggregation fault.

## Clarification interview

Parent reports explicit authorization for the diagnosed fix, recovery and useful parallelism. No user-facing interview was run by this bounded planning subtask; retain as known assumption that recovery restores future connectivity and does not promise continuation of an interrupted engine turn. Parent can surface that limit without delaying the proven memory fix.

## Evidence / prior art

Read current AGENTS.md, project-state, repo-map, architecture, testing guide and the September 15 diagnosis. Exact installed full-table `.all()` used about 4 GiB heap; 128 MiB additional retained state reproduced native OOM. All eight observed crashes followed the scheduling marker by about 70 seconds. A row iterator reduced heap but still decoded 2.6 billion characters. Current source counts usage for both the evaluator and `GET /opencode/skills?withMetadata=true`.

GitNexus query and context completed for countSkillToolUses, evaluateHarvestedDrafts and ApiServerService. Graph omitted evaluator's indirect countUses call, so source inspection remains necessary. Implementation workers must perform upstream impact for every edited symbol and report HIGH/CRITICAL risk. Existing local patterns to reuse: strict shared learning predicate, test dependency injection, bounded stderr tail, graceful owned-process termination, HealthPoller, sandbox live-test guard.

## Design decision: metadata-only SQLite iteration

Keep `countSkillToolUses(): Map<string, number>` synchronous and SQLite-only. Query JSON using SQLite JSON functions and iterate rows, projecting ONLY skill name and raw session classification columns. Never return parts_json, individual tool objects, state objects or outputs into JavaScript. Retain the shared `toLearningEligibilitySessionInput` / `evaluateLearningSessionEligibility` predicate in JavaScript; retain JS string trimming (SQLite trim differs for Unicode). Count each completed invocation independently. No archive age/row/byte cutoff, owner restriction, archived/hidden exclusion, or alternate eligibility rule.

Guard malformed JSON BEFORE json_each, and restrict the root to an array. Primitive/null/array elements must be harmless: json_extract on json_each.value can itself throw for a plain string, so feed extraction a CASE-guarded object value or use a proven equivalent. Require text type for name, matching tool/type/status exactly. An invalid row contributes nothing without erasing valid rows elsewhere. Preserve outer database-error catch and Postgres early return. Verify duplicate-object-key behavior if the chosen SQLite expression diverges from JSON.parse; document or resolve rather than silently changing valid telemetry semantics.

Why this choice: plain `.iterate()` still materializes/parses a 130 MiB row in V8; SQL metadata-only iteration removes unrelated payloads from V8 entirely. Cache keyed by updated_at/length can miss same-timestamp/same-length edits; rowid high-water marks miss edits/deletes and eligibility changes. A correct persistent projection needs dirty tracking for every mutation, cold historical backfill, delete reconciliation, schema/version management and session-classification invalidation. That is substantially wider risk than this repair.

Explicit limit: this is bounded JavaScript memory, not incremental CPU or constant total RSS. SQLite parses one current message natively and scans history when usage is requested. Measure native peak RSS and scan latency, especially the largest row. If it still causes unacceptable health stalls or memory, stop claiming completion and escalate to an incremental projection design; do not silently cap history. Avoiding no-work evaluator scans is part of this slice. Independent route requests still scan history; do not add a stale count cache to hide that.

## Evaluator scheduling

Preserve default 60-second coalescing from first scheduled completion (current semantics are not a sliding debounce). Add single-flight protection for the actual evaluator, including direct callers, and release in finally. Scheduler also needs an in-flight flag for its injected runFn seam; invoke through Promise.resolve().then(runFn) so a synchronous throw is caught. Calls during a running sweep should coalesce into at most one follow-up sweep after the current sweep settles plus the idle interval, avoiding dropped completed-turn evidence and overlap. Clear/reset test state safely; old promise finalizers must not corrupt a later test generation.

Move count acquisition to first valid status=draft candidate, memoizing once per sweep; no drafts means zero count scans. Do not early-return past rewriteFlaggedDrafts or quality checking: rewrite-needed drafts still require processing. Do not pre-load all draft bodies merely to determine if any exists.

## Flutter recovery and logs

Include narrowly scoped recovery now. ApiServerService owns process identity and emits unexpected owned-exit notification after stderr drain; AgentServerController owns status/backoff/start coordination. Reuse existing start/health setup. At most one start/retry at a time, generation-tag asynchronous results, and never let an old child's exit clear a replacement process. Intentional stop, stopGracefully, stopAndDispose and dispose cancel timers and suppress recovery; late health/start/capability callbacks cannot notify disposed controllers.

Auto-recover only after positively observed exit of a process this instance spawned, preferably one that reached ready. Health failure alone does not authorize killing an alive API; reused external server has no owned exit and receives existing unavailable/Retry behavior. Retry needs to join or cancel the pending recovery rather than creating another child/poller. Capped backoff with finite attempt budget; reset budget only after a stable healthy interval, not immediately at first health success. Exhaustion presents failure and manual Retry resets the budget. On replacement success refresh capabilities and reset MCP installer token dedupe so the restarted engine receives configuration.

Native crash capture must be independent of Node's logger: append bounded/rotated local file in Rhythm log directory, with UTC timestamp, owned PID, exit code, and raw native stderr chunks (including non-newline final chunk). Drain stdout and stderr without unbounded buffering; preserve existing small UI tail. Serialize writes/rotation, handle disk failures non-fatally, flush after streams drain and at shutdown, no environment/token logging. Existing stderr can contain sensitive runtime diagnostics, so use local user-only file permissions and bounded retention.

Known lifecycle consequence: API startup currently reclaims orphan engine on its configured port. Recovery can interrupt a surviving engine turn. Do not attempt adoption in this fix; document manual smoke must verify chat history persists and a new turn works after replacement. Do not promise exact in-flight continuation.

## Independent implementation ownership / issue table

| Order | Worker / title | Exclusive production files | Tests / acceptance | Dependencies |
|---|---|---|---|---|
| 1 | A: bounded accurate usage counting | apps/api_server/src/services/skill_usage_tracker.ts | C1-C2; existing skill_usage_tracker.test.ts plus isolated low-heap probe | None |
| 1 | B: coalesced non-overlapping evaluator | apps/api_server/src/services/harvested_skill_evaluator.ts | C3-C4; existing harvested_skill_evaluator.test.ts | None; unchanged counter API |
| 1 | C: owned process recovery and durable diagnostics | apps/desktop_flutter/lib/app/core/server/api_server_service.dart; apps/desktop_flutter/lib/app/core/agents/agent_server_controller.dart; optional focused log helper | C5-C6; controller/service/log tests | None |
| 2 | Parent: integrated contract + real sandbox + handoff | docs/ai/current-plan.md, docs/ai/runs/*, docs/testing/*, dedicated live contract/probe files | C7; gate, diff analysis, draft PR | A+B+C |

Contract writer should own dedicated new acceptance files; workers should coordinate before touching them. Parent copies this proposed plan into worktree current-plan and writes issue/contract artifacts. No GitHub issues required for this bounded user request unless workflow requires them.

## Acceptance criteria

- C1: Request usage metadata with historical eligible completed skill calls and unrelated/malformed telemetry; counts exactly match reference semantics. Empty DB gives no uses; malformed rows/elements don't suppress valid neighbors; numeric/blank names and incomplete/error tools don't count. Shared eligibility matrix remains exact. Same-timestamp edits, deletes, session eligibility changes and old records are reflected by the very next count. Postgres performs no SQLite access.
- C2: A standalone process using real SQLite and the real built counter completes under --max-old-space-size=128 with >150 MiB irrelevant history and exact seeded positive counts, where baseline fails; actual large-history copied/read-only diagnostic under a 256 MiB cap completes with unchanged counts. Report wall time, V8 heap and OS peak RSS separately; include an individual ~130 MiB unrelated payload to expose native allocation. No payload content in logs.
- C3: Multiple completions within the default idle window trigger one sweep; pending/running calls never produce simultaneous evaluations. A completion during a deferred sweep yields at most one later sweep and learning continues. Throw/rejection settles the guard and a later scheduling request succeeds; direct evaluator calls cannot overlap.
- C4: No valid draft candidates means zero usage scans while rewrite-needed handling still runs. One/many candidates require at most one scan. Threshold, unknown-score, dependency protection and Postgres behavior remain unchanged.
- C5: After a once-ready owned API exits unexpectedly, UI transitions to reconnecting and returns ready after a bounded delayed replacement becomes healthy. Repeated immediate crashes stop at documented attempt budget; Retry works afterward. Stop/dispose produces no replacement; concurrent Retry/exits spawn one child; old exit callbacks cannot clear the new child. Alive unhealthy and external reused processes are not killed by automatic recovery.
- C6: A child emitting native stderr without trailing newline then exiting leaves that text plus timestamp/PID/code in durable bounded log after it is gone. Rotation remains bounded, final bytes are flushed, and log failure doesn't prevent recovery.
- C7: Gated live contract with sandbox API+real fork exercises the existing skill metadata HTTP route, verifies real historical count, reflects edits/deletes on subsequent requests and retains the same healthy API process under a constrained heap. Controlled-clock tests separately exercise delayed evaluation and overlap. Record engine health, API health, RSS and scan/response durations. Separate native Flutter helper-process failure injection validates owned-exit observation, controller recovery, and durable stderr. Packaged chat history and a new model turn after recovery remain the human pre-release smoke gate.

## Validation and safety

All fixtures/disposable DB writes are inside isolated test directories. No live DB writes, real scheduler executions or port 4001/4096 kills. Read-only low-heap probe needs query_only handle and no application initialization. Parent controls sandbox start/build/teardown through tools/dev/sandbox.sh with explicit unique sandbox path and ports; workers do not launch it. Build required fork and API, run focused tests then applicable full gate. Flutter formatting and `flutter analyze --no-fatal-infos` plus relevant tests before commit. Run GitNexus detect_changes compare main before handoff and staged check before commit. Record honest runtime limits; no unrun live test is passing. Parent records Dev Dashboard run via publish-to-rhythm script and creates draft PR only; manual smoke/merge remain human handoff.

## Workflow stage checklist

- [x] Planning-agent review and bounded technical plan complete.
- [x] Parent approved metadata-only iteration without cache/schema, owned-exit-only recovery, no-draft scan avoidance, and single-flight evaluation.
- [x] Isolated worktree /private/tmp/rhythm-agent-memory-fix, branch codex/agent-server-memory-fix established by parent.
- [x] Acceptance contracts captured failing before implementation (Carson and recovery_contract coordination).
- [x] GitNexus impact and three disjoint coding slices implemented.
- [x] API focused regression and low-heap real SQLite checks pass; native-memory measurement recorded separately.
- [x] Integrated real sandbox API/engine skill metadata behavior exercised; 338 MiB fixture under 256 MiB heap, exact counts/edits/deletes and process survival.
- [x] Flutter lifecycle/log tests, format and analyze pass; native macOS helper recovery build/test passes.
- [x] Independent review, full PR verification gate, and staged scope check pass (21 files, 41 indexed symbols, LOW).
- [x] Run log, state, release-smoke checklist and retrospective recorded.
- [ ] Draft PR and Dev Dashboard publication are the final external handoff; tracked in GitHub and the dashboard.

Parent specifically requested this durable plans path rather than overwriting another task's current-plan.md. The selected implementation approach is approved; incremental projection remains a future option only if measured latency/native memory prevents acceptance.

## Measured acceptance limits

The exact full-history count succeeds under a 256 MiB V8 cap with the original 170-skill hash. It takes about 20.5 seconds and peaks near 1 GiB total RSS; SQLite scanning remains synchronous and may temporarily delay health responses. This slice addresses the reproduced V8 abort and dead-process recovery. Incremental aggregation or moving scans off the main thread remains separate performance work. The installed release and main have identical pre-change versions of all four production files in this patch.
