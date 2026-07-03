---
tags: [decision, rhythm]
---

# Nested Task-card delegation navigation (#861)

## Context

Issue #699 (OPC-M3-6, already on `main`) implemented single-hop child-session
navigation: tapping a top-level "Task" delegation card in the parent
transcript opens the child (subagent) session's transcript in place, with a
breadcrumb back to the parent. Issue #861 required this to also work for
**nested** delegation — parent → orchestrator → specialist — with a clear way
back from each hop, and a disabled/non-clickable state when a child id can't
be resolved.

Investigating the existing implementation found two blockers to nested
delegation, both silent (no crash, no error — the nested card simply never
rendered as tappable):

1. **Flutter**: `AgentsController` tracked child-session navigation with three
   single-value fields (`_activeChildSessionId`, `_activeChildParentSessionId`,
   `_activeChildParentName`). Opening a second (grandchild) child would
   overwrite these, and `closeChildSession()` unconditionally cleared them —
   so there was no way to represent "currently viewing a grandchild whose
   immediate parent is an intermediate child" at all.
2. **Flutter**: `ChildTranscriptView` rendered `task` tool parts found in a
   child message as a static `⚙ task` text summary, never as a `TaskChip`.
   Even if the controller could track nesting, there was no nested chip to
   tap.
3. **Backend**: `GET /agent-sessions/:id/children` and
   `GET /agent-sessions/:id/children/:childSdkId/messages` both start with
   `repo.findById(req.params.id)` and 404 if it returns null. Child/subagent
   sessions are never persisted as local DB rows (by design — see the
   existing comments in `agent_sessions_controller.ts`), so calling either
   endpoint with a child's own SDK id (exactly what a grandchild lookup
   requires) always 404'd.

## Decision

- **Backend**: relax the `:id`-not-found guard in `getChildren` and
  `getChildMessages`. When `repo.findById(id)` returns a row, behavior is
  unchanged (resolve via `resolveSdkSessionId`, empty array on no active
  mapping). When it returns null, treat `id` as already being a raw SDK
  session id and call the SDK directly (`listChildren(id)` /
  `listMessages(childSdkId)` — the latter was already keying off
  `childSdkId`, not `id`, so the `getChildMessages` change is really just
  "stop erroring before reaching code that already worked"). A genuinely
  invalid id now surfaces as the SDK's own error (via `next(err)`) instead of
  a synthetic 404 — this is an intentional narrowing of what "not found"
  means for this route, since "no local row" is the *expected* shape for
  every child/grandchild id, not an error condition.
- **Flutter**: replace the three single-value fields with
  `List<_ChildFrame> _childStack`, where `_ChildFrame` carries
  `{fetchParentId, childSdkId, parentDisplayName, displayName}`.
  `openChildSession` pushes a frame (works identically for the first hop and
  for any nested hop — the caller just passes the enclosing child's own SDK
  id as `parentSessionId`). `closeChildSession` pops exactly one frame. The
  existing public getters (`activeChildSessionId`, `activeChildParentName`)
  now derive from the top of the stack, preserving their single-hop meaning
  for all existing callers; `activeChildDisplayName` and `childStackDepth`
  are new.
- **Flutter**: `ChildTranscriptView` extracts `task` tool parts from a
  message's raw `parts` via a small `_childTaskParts` helper (same
  `ChatPart.fromJson` construction path already used for parent-level
  parts) and renders each as a `TaskChip`, using this child's own SDK id as
  `parentSessionId` and its own display name (`ownDisplayName`, new field)
  as `parentSessionName` — so a nested tap correctly targets the next hop
  and its breadcrumb points at the CURRENT child, not the top-level parent.

## Alternatives considered

- **Recursive widget nesting** (mount a `ChildTranscriptView` inside a
  `ChildTranscriptView` for each hop, rather than swapping a single
  transcript area via a stack): rejected — would require re-plumbing the
  scroll/composer-hiding logic per level and makes "how many hops deep am I"
  awkward to query from outside the widget tree (tests, other UI). The stack
  keeps a single swap-point in `_TranscriptPanel`, matching the existing
  pre-#861 architecture.
- **Keep 404 and have the client pre-check via a session-exists probe**:
  rejected — adds a round-trip per navigation hop for no benefit; the SDK
  already errors clearly for a genuinely bad id, and "no local row" is
  categorically not evidence of an invalid id for this route.

## Consequences

- `AgentsController.openChildSession` gained an optional `childDisplayName`
  parameter (defaults to `parentSessionName` — backward compatible with
  every existing call site and test).
- `ChildTranscriptView` gained an optional `ownDisplayName` parameter
  (defaults to `parentSessionName` — backward compatible).
- The two backend tests that previously asserted "unknown id → 404" now
  assert "no local row → SDK called directly with that id" instead; a
  genuinely bad id from the SDK's perspective still produces an error via
  `next(err)`, just not a synthetic 404 from `repo.findById` returning null.
- `AgentsController.selectSession()` still does not reset the child-nav stack
  when switching top-level sessions — this was true before #861 too, and is
  out of scope for this issue, but is worth revisiting.
