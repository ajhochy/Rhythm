---
date: 2026-07-30
repo: Rhythm
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

# Progress-aware AgentRunner deadline

## Context

`AgentRunner` used one absolute `AGENT_RUN_TIMEOUT_MS` deadline for MCP
preflight, session creation, and the complete synchronous prompt. The default
was 600,000 ms. A prompt with hundreds of successful tool calls was therefore
aborted at exactly ten minutes even though its OpenCode session was still
producing message and part updates.

## Decision

Use two finite limits:

- `AGENT_RUN_INACTIVITY_TIMEOUT_MS` defaults to 600,000 ms. A changed
  `session.messages` snapshot resets this window. The legacy
  `AGENT_RUN_TIMEOUT_MS` remains a fallback alias for existing deployments.
- `AGENT_RUN_HARD_TIMEOUT_MS` defaults to 3,600,000 ms. It is measured from
  the beginning of the run and is never extended, even by continuous
  progress.

Progress is derived from OpenCode's existing message/part state: message IDs,
part counts, streamed text/reasoning, and tool state/output. AgentRunner polls
that existing runtime surface once per second while the synchronous prompt is
pending; it does not add a second event subscription.

On either timeout, AgentRunner still calls `abortSession` once for the parent
SDK session. The OpenCode task tool retains responsibility for propagating
that parent abort signal to active child sessions. The API server's Undici
headers/body timeout is set to the configured hard ceiling plus five minutes
so transport cannot preempt the policy.

## Alternatives

- Increasing the old wall timeout only postpones the same false abort.
- Subscribing AgentRunner to a second SSE stream duplicates the established
  stream bridge and creates ordering/cleanup risk.
- Removing all limits permits wedged runs to consume concurrency forever.

## Consequences

Active tool-heavy runs may continue past ten minutes, stalled stages still
release their concurrency slot after the inactivity window, and every run
remains bounded by a one-hour default ceiling. Operators can tune both limits
without losing the old inactivity override during migration.
