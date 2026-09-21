---
date: 2026-09-21
repo: Rhythm
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

# The run inactivity window must exceed the engine's max tool timeout

## Context

`AgentRunner`'s progress-aware deadline has two timers: an inactivity window
(rearmed whenever the session's message/part fingerprint changes) and a hard
ceiling measured from run start. The inactivity default was 600_000 ms.

The engine grants a single `bash` tool call up to **1_200_000 ms**, and a tool
call publishes **no new message parts while it runs**. So the activity probe
cannot observe progress during one, by construction — not a gap in the probe,
a property of the data it reads.

That makes any inactivity window at or below the engine's tool cap a guaranteed
kill of a healthy run that makes one long tool call.
`ffb-daily-dashboard-update` hit this on 2026-09-18 and 2026-09-21: a
`refresh_all.py daily` call that explicitly requested `timeout: 1200000` was
aborted ~17 minutes in, after nine consecutive successful runs.

## Decision

The default inactivity window is derived from the engine's tool cap:
`MAX_ENGINE_TOOL_TIMEOUT_MS + 300_000` (1_500_000 ms), not a standalone
magic number. The hard ceiling stays 3_600_000 ms and remains the real bound.

The two values are now coupled on purpose. If the engine's tool cap changes,
`MAX_ENGINE_TOOL_TIMEOUT_MS` is the one place to change, and a contract test
asserts the ordering rather than the literal.

## Alternatives

- **Treat an in-flight tool part as continuous progress.** Rejected: it makes a
  genuinely hung tool immortal until the hard ceiling, and we have a live
  example (`agent-reach doctor --json`, hung with no timeout at all). We cannot
  distinguish a working 20-minute call from a hung one, so we should not pretend
  the inactivity timer can.
- **Raise the window to an arbitrary larger number (e.g. 1_800_000).** Same
  behavior today, but nothing records *why*, so the next person who trims it for
  faster stall detection reintroduces the bug.
- **Lower the engine's tool timeout to fit the window.** Inverts the dependency —
  the tool cap is the engine's, and a legitimate 20-minute script is a real
  workload.

## Consequences

- A dead run now takes up to 25 minutes to be declared stalled instead of 10.
  Acceptable: the hard ceiling is unchanged, and a *false* stall killed real
  work while a slow true stall only delays a retry.
- Inactivity timeout messages now name the tool call they stalled on
  (`…; last activity: tool `bash` (agent-reach doctor --json) running`), which is
  what makes the longer window diagnosable rather than merely more patient.
- `AGENT_RUN_INACTIVITY_TIMEOUT_MS` / `AGENT_RUN_TIMEOUT_MS` still override, so
  any deployment that had tuned this keeps its value.
