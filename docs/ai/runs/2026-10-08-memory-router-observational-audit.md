---
date: 2026-10-08
repo: Rhythm
branch: mega/2026-09-29-consolidation
pr: null
issues: []
status: audit-recorded-runtime-not-qualified
tags: [run, Rhythm, audit, memory, routing]
index: "[[Rhythm]]"
---

# Memory and model-router observational audit

## Files

- This run note and `docs/ai/project-state.md` only; existing code changes were preserved.
- Detailed report and private paired evidence remain outside the repository at `~/Documents/Codex/2026-10-08/rhythm-memory-router-audit/audit.md`. Session content was not copied into repository documentation.

## Checks

- Three low-cost `gpt-6-luna` readers gathered memory, routing and deployed-build evidence; the parent agent performed the evaluations.
- Running signed candidate package receipt maps to `237f54db60bb0f58f42e8f0fbce3b1069a70c652`, distinct from checkout `18705742`. Confirmed runtime window: October 7 18:14:56Z through October 8 17:43:04Z.
- SQLite was opened with `mode=ro` and query-only reads. Primary memory evidence came from engine `message.data.system` joined to the same message's prompt, not UI text or current-note reconstruction.
- Exact injected-system match assertions: 73/73. Fixed-window population: 399 role-user messages; 122 human root turns, 71 with injected memory. Remaining inputs were separated into child, scheduled/system, async delegation and explicit simulator categories.
- Parent's generous relevance assessment of the 71 injected human turns: 12 had at least one potentially useful contextual lead, 14 had only weak/generic/uncertain context, 45 had no useful task-specific context. These are qualitative ratings, not calibrated accuracy or global recall.
- Independently re-queried routing: 24 current-process attempts across 5 sessions, all shadow/error/request_failed, no chosen tier or confidence, 0 applied. Since the October 6 parser-fix commit timestamp: 56/56 errors across 8 sessions; earlier deployed-code identity is uncertain.
- Read-only effective config GET confirmed System One/Kev at port 8009, shadow, first_prompt, threshold 0.55. Listener inspection and GET health found no service on the configured port.
- `git diff --check -- docs/ai/project-state.md docs/ai/runs/2026-10-08-memory-router-observational-audit.md`: exit 0, no output. No new tests/build, model invocation, restart, configuration change, database write, commit, push or PR.

## Notes

- Memory delivery works; selection quality is poor. Broad historical archives, stale operational notes and cross-project matches repeatedly fill the context. Querying short acknowledgments without task context is a major observed pattern. Native ranking admits canonical excerpts without a calibrated absolute relevance gate.
- Latest-only provenance is supplementary: it cannot explain every historical no-injection turn. A contemporaneous 20-session snapshot contained 7 used, 10 timeout, 2 unavailable and 1 unmapped outcomes; do not treat that as a turn-level success rate.
- Router is not qualified for On. There are no successful post-fix decisions to evaluate. Current classifier unavailability is consistent with immediate request_failed records. Earlier successful records used another backend and continuation prompts; synthetic calibration is not operational qualification.
- Follow-up priorities: context-aware memory queries/abstention, scoped intact excerpts and retrieval timing diagnostics; supervised Kev availability and a representative initial-task shadow cohort with would-be concrete model selection.
- This is a read-only observational checkpoint under project-state-updater, not implementation verification. No Dev Dashboard publisher was invoked.

### Dayflow follow-up

- Effective configuration: enabled, automatic import on, selected journal ready, active authenticated source consent.
- Confirmed 404 imported context notes in canonical storage and the Rhythm memory index. Engraph has all 404 files/chunks/embedding BLOBs/FTS entries; all canonical files match indexed hashes and mtimes. A separate Dayflow preference explains the 405-marker aggregate.
- Latest completed import observed October 8 at 17:48:35Z; index metadata at 17:49:05Z. Source activity/card writes continued around 18:01Z; normal import cadence is 15 minutes. This snapshot is not proof of current import stalling.
- Fifteen pending-create records date to October 5 and reference deleted timeline cards. No cause/retry detail is persisted in their ledger entries.
- Generic interactive automatic memory excludes Dayflow. AgentRunner calls the retrieval builder without that admission filter, so its indexed auto-injectable rows may be candidates there; this is a code-path finding, not observed exposure.
- Thirteen accepted Coordinator dispatch manifests record 70 Dayflow candidate references. Inspection of their stored engine generic-memory blocks found no imported Dayflow excerpt; the separate provider overlay requires its own final-payload evidence.
- Detailed private follow-up: `~/Documents/Codex/2026-10-08/rhythm-memory-router-audit/dayflow-audit.md`. No import/reindex, model call, restart or configuration change.

### Scheduled failure diagnosis and repair handoff

- Parent independently re-queried all 12 scheduled runs since the confirmed process-start cutoff. Eleven engine transcripts contain `Dayflow provider guard held this request (history_ambiguous)`, zero reported tokens and no tool calls. Each session has NULL owner/project and no recorded Dayflow exposure. The twelfth failed before SDK dispatch because `nfl_mcp` was unavailable.
- Installed `dayflow_receiving_context_repository.js:367-380` classifies missing owner/project fields as ambiguous; `dayflow_receiving_history_guard.js:324-326` holds immediately. The native middleware throws before its provider call. This is a scheduled-session metadata/admission regression, not a model judging all activity records ambiguous. No replay/network trace was performed.
- Generic Dayflow exclusion first tracked in `a34fefc3`, October 5 at 19:53:31 PDT; its integration freeze existed at 18:20:56. The distinct native provider guard first tracked in `65fe0338`, October 6 at 05:36:08 PDT. Both are in the running candidate. The guard was intended to prevent invalid retained Dayflow context from reaching a provider; it also rejects these zero-exposure scheduled sessions.
- Kev comparison history explicitly stopped the server October 6. Cached adapter/base model files remain; no serving checkout/environment or persistent launcher was found in the inspected locations. Restoring serving runtime is the first router repair, not evidence for On.
- Wrote private `dayflow-filter-history.md` and `repair-agent-prompt.md` beside the audit. Prompt priorities: restore scheduled execution with optional historical context, improve memory relevance, then restore and evaluate Kev shadow decisions. User requested a prompt; no implementation or service startup was performed.
