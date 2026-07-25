---
date: 2026-07-24
repo: Rhythm
branch: codex/1164-agent-run-scheduler
issues: [1164]
tags: [decision, Rhythm]
---

# Provider-agnostic model-stream scheduling

## Context

The vendored OpenCode fork held one of two OpenAI-only semaphores for the
entire parent stream. A parent executing the synchronous `Task` tool could
therefore wait on a child while retaining the capacity that child needed.
Issue #1164 explicitly authorizes a minimal fork change outside the earlier
MCP-scoping-only boundary.

## Decision

Replace the OpenAI semaphore with one process-wide model-stream scheduler:

- default global concurrency is 50, configurable through
  `experimental.model_stream_scheduler.max_concurrency`;
- optional provider ceilings are configured through `provider_limits`;
- queue admission is round-robin by root session so one swarm cannot keep an
  unrelated interactive root behind its entire backlog;
- provider 429/throttling signals install a provider-local cooldown without
  blocking other providers;
- `Task` relinquishes its current parent lease immediately before awaiting the
  child prompt. The current response is already paused at a tool call; the
  parent's next model turn acquires a fresh lease normally;
- abort, error, completion, and explicit parent-yield releases are idempotent;
- structured acquire/queue/release/backpressure logs and an in-memory snapshot
  expose ownership, wait time, and wait reason.

## Alternatives

- Raising the existing constant from 2 to 50 leaves circular starvation at a
  larger swarm size.
- Reserving a fixed number of child slots still fails with enough concurrent
  nested parents and wastes capacity when there is no nesting.
- Reacquiring the parent lease before returning from `Task` can itself block
  the child result behind unrelated queued work; relinquishing the completed
  provider turn and acquiring normally on the next turn avoids that cycle.

## Consequences

This is a small maintained divergence in `llm.ts`, `task.ts`, config schema,
and one dedicated scheduler module. Provider limits remain opt-in; dynamic
backpressure applies only after a throttling signal. The env-gated 50-child
live contract must be run against the isolated sandbox before merge.
