---
date: 2026-07-16
repo: Rhythm
branch: epic1116/cluster-e-session-leak
tags: [decision, rhythm, agents, cluster-e]
index: "[[Rhythm]]"
---

# #1090 fix widens file ownership to include the AgentSession model

## Context

Cluster E's dispatch scoped the fix for #1090 (background/scheduled/
self_improvement sessions leaking into "chats" on live WS insert) to a single
file: `agents_controller.dart` (plus its test). The plan's diagnosis
(`docs/ai/current-plan.md`) states the WS payload "already carries `isSystem`
+ `category`, so no server change is needed" — true of the wire JSON
(`ws_gateway.ts:114` broadcasts the full server-side `AgentSession`, which has
both fields; `apps/api_server/src/models/agent_session.ts:91` and the
`category` column documented alongside it).

What the diagnosis did not verify: the Flutter `AgentSession` model
(`apps/desktop_flutter/lib/features/agents/models/agent_session.dart`) never
parsed `isSystem` or `category` out of that JSON. Confirmed by grep — neither
name appeared anywhere under `apps/desktop_flutter/lib/` or `test/` before
this change. The required predicate (`_belongsToScope(session, scope)`,
mirroring `chats = !isSystem && category=='chat'` etc.) cannot be written
against fields the model doesn't expose.

## Decision

Add `isSystem` (bool, default `false`) and `category` (String, default
`'chat'`) to `AgentSession`: constructor param, field, `fromJson` parsing,
and `copyWith` preservation (mirroring the file's existing per-field
convention, e.g. `projectId`'s copy-without-override-param pattern). Treat
this as a narrow, disclosed exception to the "controller file only"
ownership boundary, not a new precedent for touching other Flutter files —
`agent_skills_view.dart` and Cluster C's other files remain untouched.

Left `toJson()` alone: grepped for callers and found none for `AgentSession`
in the app; extending unused code would be scope creep with no test to
justify it.

Did **not** add scope-filtering to the full-load path (`AgentsController.load`).
Discovered via `agents_nav_column_mounted_test.dart` (`#1025 scope dropdown
switches scope and reloads`, ~line 900) that existing tests call
`loadSessions(scheduled)` / `loadSessions(selfImprovement)` against fixtures
whose `category` defaults to `'chat'` (via a local `_makeSession` helper in
that file) — filtering `load()`'s result through `_belongsToScope` would
silently exclude those fixtures and break that pre-existing, out-of-scope
test. This is consistent with the current design: full-load already trusts
the server's `?scope=` query entirely; only the live WS path needed a
client-side mirror because it's broadcast to every connected client
regardless of which scope they're viewing.

## Alternatives

- **Stop and report instead of touching the model.** The dispatch prompt's
  stop condition was specifically "if the fix needs a *server* change" —
  which it doesn't; the server already sends the fields. Stopping here would
  have returned a report saying "cannot implement as scoped" for a two-field,
  additive, empirically-verified-safe model change, with no other cluster
  contending for the file. Rejected as overly rigid given Auto Mode's bias
  toward making the reasonable call and disclosing it.
- **Add scope-filtering to `load()` too**, reasoning that "the classification
  rule lives in one shared place used by both full-load and incremental
  paths" (acceptance criteria wording) literally requires `load()` to call
  `_belongsToScope`. Rejected: it breaks an existing test in a file outside
  my ownership (`agents_nav_column_mounted_test.dart`), and the full-load
  path has no behavioral bug to begin with (the server already filters
  correctly per `agent_sessions_repository.ts:141-142, 196-207`). Interpreted
  the acceptance wording as "the same conceptual rule, documented once,"
  satisfied by `_belongsToScope`'s doc comment cross-referencing the
  server-side SQL condition it mirrors.
- **Also guard the `isArchived` / `resumable` sub-branches of
  `SessionUpdatedMessage`.** Defensible (those lists are also scope-relative
  on full load) but unrequested — the plan's cited root-cause lines and
  acceptance criteria name only the `_sessions` ("chats") list. Left as a
  documented residual risk rather than silently expanding the diff.

## Consequences

- `AgentSession` gains two fields; every existing constructor call site
  (23 direct callers per GitNexus impact) is unaffected because both new
  params are optional with defaults matching prior implicit behavior.
  Verified via the full `flutter test` suite (872/872 pass) and a
  byte-identical `flutter analyze` diff against the pre-change baseline.
- A future change to the archived/resumable sub-branches of
  `SessionUpdatedMessage` may still need the same `_belongsToScope` guard if
  a background session's archive/resumable transition while off-scope is
  ever reported as a bug — not currently in scope or covered by a test.
