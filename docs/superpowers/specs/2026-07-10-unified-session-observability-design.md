# Unified Session Observability — design

**Date:** 2026-07-10
**Status:** approved (design) — implementation not started
**Owner:** AJ

## Goal

Make **every LLM call in Rhythm observable in one place** — the Agents view's
session list — organized by a category filter, so the list stays tidy by
default but nothing runs invisibly.

Three categories, selected via the existing "CHATS" dropdown:

1. **Chats** — normal, user-triggered interactive sessions. *(Default view.)*
2. **Scheduled Tasks** — runs of user-configured `agent_scheduled_tasks`
   (morning briefing, email triage, memory consolidation, etc.).
3. **Background self-improvement** — the autonomous optimizer/harvest machinery
   (diagnosis, refine/measure judges, harvest evaluator, consolidation drafter).

Sub-agent (delegated) runs continue to **nest under their parent session**, and
that nesting is preserved inside every filter (not a separate category).

## Non-goals

- No "All" firehose view — deliberately omitted to avoid bloat.
- No separate sub-agent filter — nesting already covers it.
- No change to how the LLM is actually called (models, auth, engine) — only how
  runs are **recorded** and **surfaced**.

## Current state (why this splits into two phases)

- **Chats** are recorded by `AgentRunner.run()` → `_recordSession()` with
  `is_system = 0`. Already shown in the Agents list.
- **Scheduled Tasks** are recorded by `AgentRunner` with `scheduled_task_id`
  set and `is_system = 1` — deliberately hidden from the chat list
  (`agent_sessions_repository.listAll` filters `WHERE is_system = 0`). Session
  History surfaces them today via a **second** fetch (`listByScheduledTaskId`).
- **Background self-improvement loops do NOT create `agent_sessions` rows.**
  They call `opencodeClient.createSession()` + `.prompt()` directly, bypassing
  `AgentRunner`:
  - `generators/workflow_signal_generator.ts:692` (optimizer diagnosis)
  - `skill_refiner.ts:146,249` (`skill-refine-judge`, `skill-measure-score`)
  - `org_proposal_measure.ts:518` (behavioral re-run)
  - (audit the harvest evaluator + consolidation drafter for the same pattern)
  So they are **not observable at all** today.

Data already present on `agent_sessions`: `scheduled_task_id`,
`parent_session_id` (#743, enables nesting), `delegation_depth`, `is_system`.
No field distinguishes "scheduled task" from "self-improvement".

## Phase A — Unified session list + Chats/Scheduled filters

Uses data that already exists; ships independently.

- **Server:** add an opt-in `scope` query param to `GET /agent-sessions`:
  `scope=chats` (default, current `is_system=0` behavior) | `scope=scheduled`
  | `scope=self_improvement`. The handler relaxes the `is_system=0` filter per
  scope. Rows already carry the fields the client needs to render/nest.
  - *Rejected alternative:* keep merging client-side (Session History's second
    fetch). This is the split we're removing — one endpoint = one source of truth.
- **Client (Agents view):** the "CHATS" dropdown becomes a category filter
  (`Chats` default · `Scheduled Tasks` · `Background self-improvement`). The
  list requests the active scope. Sub-agent nesting (`parent_session_id`) is
  preserved in every scope. Add a sort control (recent / status / name).
- **Nav:** retire the standalone **Session History** nav item; fold its
  transcript-detail reuse into the Agents session detail (same view — #999/#1006
  apply unchanged).
- Phase A's `Scheduled` filter is fully populated immediately. `Background
  self-improvement` is empty until Phase B records those runs.

## Phase B — Make self-improvement loops observable (via AgentRunner)

- **Reuse `AgentRunner.run()`** for every background-loop LLM call instead of
  the direct `opencodeClient.createSession/prompt`. One recording path — the
  loops get an `agent_sessions` row, the directory-scoping (#1002) fix, the
  boot-recovery, and status tracking for free.
- **Add a `category` column** to `agent_sessions`
  (`chat | scheduled | self_improvement`), stamped at session creation:
  - `chat` — interactive (default).
  - `scheduled` — when `scheduledTaskId` is set.
  - `self_improvement` — when the caller is a background loop.
  Legacy rows: derive (`scheduled_task_id` → scheduled, else chat). The `scope`
  param filters on `category` once present.
- **Call sites to migrate** (each: replace direct createSession/prompt with an
  `AgentRunner.run({ category: 'self_improvement', sessionName: '<loop>', … })`):
  optimizer diagnosis, refine judge, measure score, behavioral re-run, harvest
  evaluator, consolidation drafter. Audit for any others via
  `grep -rn "opencodeClient.createSession" src/services`.
- Keep these `is_system=1` (they must never pollute the default Chats view);
  the new `category` is what the `self_improvement` scope filters on.

## Verification (per repo DoD — live backend probe, not just tsc/unit)

- **Phase A:** standalone server; `GET /agent-sessions?scope=scheduled` returns
  the scheduled-task sessions; `?scope=chats` excludes them; sub-agent rows nest
  under their parent in each scope. Drive a scheduled task (trigger-now) and see
  it appear under `Scheduled`.
- **Phase B:** trigger an optimizer run (respect the 90s cold-start window);
  confirm a new `agent_sessions` row with `category='self_improvement'` appears
  under the `Background self-improvement` filter with a real transcript.
- Flutter: `dart format` + `flutter analyze --no-fatal-infos`; api_server
  `tsc --noEmit` + full suite.

## Risks / notes

- Migrating the loops to `AgentRunner` is the largest change; do it loop-by-loop
  with a live probe each, not all at once.
- `AgentRunner` records to the local agents DB (:4001) — confirm the background
  loops run in that context (they do; they're local-server services).
- Retiring Session History: keep the transcript detail view + its data source
  (reused by the Agents detail); only the nav entry and the list-merge logic go.
- Scope guardrail: **separate branch/PR from #1005** (which is verified/ready).
```
