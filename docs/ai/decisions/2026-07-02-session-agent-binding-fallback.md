---
date: 2026-07-02
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Session's own agent identity outranks the app-wide default picker

## Context

Issue #867 reported two coupled defects on dispatched/subagent sessions:
the footer showed the app-wide default agent/model/permissions instead of
the session's own, and sending a reply silently re-bound the session to
whatever the app-wide picker currently had selected.

A full trace (direct source read + a dispatched background research agent
mapping `AgentsController`, `AgentSelectorPill`, `SessionModelPicker`,
`UnifiedAgentModelPicker`, `PermissionModePicker`, and the backend's
`ws_gateway.ts` / `agent_model_resolver.ts` / `agent_sessions_controller.ts`)
found:

- The **backend** already implements the correct precedence end-to-end:
  `ws_gateway.ts`'s `scopeAgentId = perTurnAgent ?? agentKind ?? null` and
  `resolveModelForSessionTurn`'s override → session's persisted
  `providerId`/`modelId` → `agent_configs` → static-fallback chain both
  already prefer the session's own state over anything else, and a
  `PATCH /agent-sessions/:id` route already exists for explicit,
  persisted session-level updates (provider/model/agentMode/permissionMode).
- **`PermissionModePicker`** and **`SessionModelPicker`/
  `UnifiedAgentModelPicker`** already read `session.permissionMode` /
  `session.providerId`+`session.modelId` directly, and only ever mutate
  them via an explicit "apply as" dialog (`This turn only` vs
  `Session default`) — fully correct, no changes needed.
- **`AgentSelectorPill`**, via `AgentsController.selectedAgentFor()`, was
  the only broken surface: its fallback chain was
  explicit-per-session-override → app-wide manager-profile default → null.
  It never consulted `AgentSession.agentId` (the session's own
  backend-resolved engine name, persisted by #858's `agentConfig.ocAgent`
  resolution at create/resume time). `sendInput()` forwards whatever
  `selectedAgentFor()` returns as the WS frame's `agent` field, so this
  single gap caused BOTH defects: the wrong display AND the wrong value on
  the wire for every turn.

## Decision

Changed `AgentsController.selectedAgentFor(sessionId)`'s resolution order
to: (1) explicit per-session override (`_selectedAgentBySession`, set only
via the user's explicit `AgentSelectorPill` pick) → (2) the session's own
`AgentSession.agentId`, when it is not a "generic" placeholder → (3) the
app-wide manager-profile default (`_managerAgentNameResolver`) → (4) `null`
(SDK default).

"Generic" placeholders (`_genericAgentIds = {'', 'claude-code'}`) are
excluded from tier 2 so they fall through to tier 3 instead:
- `''` is the wire value for a genuinely agent-less instant-create session
  (`agent_sessions_controller.ts`'s `resolvedEngineAgentKind = ''` for
  `agentId: null`).
- `'claude-code'` is the generic base-kind fallback used in multiple places
  that are NOT "a profile was dispatched to this session" — the Flutter
  `AgentSession.fromJson`'s absent-key default, and the backend
  `upsertChildSession`'s `inheritedAgentKind ?? 'claude-code'` fallback.

Without excluding these, EVERY brand-new top-level session would
permanently show/send its generic base kind instead of the app-wide
picker's intended role as the INITIAL default — exactly the regression
caught by the pre-existing `opc_m4_4_agent_selection_test.dart` c5 test
(`selector works with built-ins only`, which asserts the pill shows
`'build'`/the manager default for a session built with the test fixture's
hardcoded `agentId: 'claude-code'`).

`hasExplicitAgentSelection()` is unchanged in behavior (still keyed only
off `_selectedAgentBySession`) but its doc comment now clarifies that a
session merely displaying its own dispatched identity is NOT an "override"
for the pill's accent-color treatment — only a genuine user pick is.

## Alternatives considered

1. **Add a new `AgentSession.dispatchedAgentId` field distinct from
   `agentId`.** Rejected: `agentId` already carries exactly the right value
   (the #858-resolved engine name) for every session shape investigated
   (top-level, resumed, and `parent_session_id`-linked delegated rows all
   flow through the same `AgentSession.fromJson`/`agent_kind` column) — a
   parallel field would duplicate state with no behavioral difference,
   just migration/round-trip cost.
2. **Seed `_selectedAgentBySession[sessionId]` from `session.agentId` in
   `selectSession()`/`setActiveSessionForTest()`.** Rejected: this would
   make every session's natural identity indistinguishable from an
   "explicit override" (`hasExplicitAgentSelection` would incorrectly
   return `true` for every dispatched session), breaking the pill's
   "only accent when the user actually chose something different"
   treatment (the c6/#745 regression contract), and would need re-seeding
   on every session-list refresh rather than being a pure read-time
   resolution.
3. **Treat only `''` as generic, not `'claude-code'`.** Tried first;
   reverted after it broke the existing c5 real-surface test — see the
   project-state run entry for the concrete failure. `'claude-code'` is
   not a meaningful dispatched identity in this codebase's current usage,
   only ever a fallback value.

## Consequences

- A session whose own `ocAgent`-resolved name is not present in
  `AgentConfigsController.sessionSelectableAgents` (e.g. a
  non-session-selectable specialist profile, or one whose profile sync
  hasn't caught up yet) will display its raw engine name in the pill
  rather than a friendly label. This is pre-existing `AgentSelectorPill`
  fallback behavior (the label-resolution loop already falls back to the
  raw value), just newly reachable now that the pill can render a
  session's own agent instead of always the app-wide default. Flagged as a
  possible follow-up if raw names look unpolished in practice, not fixed
  here (out of #867's scope).
- `_pendingTurnOverride` (the model per-turn override) remains a bare
  global field rather than session-keyed. It is provably safe under normal
  navigation because `selectSession()` unconditionally clears it before
  any await on every session switch — verified by reading every write site
  (`setTurnOverride`, `setSessionModel`) and the reset site. Session-keying
  it was judged unnecessary hardening beyond #867's actual reported defect.
