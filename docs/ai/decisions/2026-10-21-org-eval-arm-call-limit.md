---
date: 2026-10-21
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

## Context

Each evaluation arm borrows one provider lease. The runtime capped a lease at 8 provider calls. Live routed recipe/task/webhook arms run a primary session plus a routed child session and issued 12–16 calls. The refused calls left the work unfinished, so every routed kind failed before scoring.

## Decision

Set the per-arm call limit to the relay maximum (16). It remains a runaway-loop guard. The user-configured whole-run token budget is the spend control. When a lease yields no usable usage, the relay records the first failure as a bounded code-owned category, and the runtime surfaces it.

## Alternatives considered

- Per-kind call limits. Rejected: no evidence that a single larger bound is unsafe, and it adds configuration.
- A pre-reservation based on token estimates instead of bytes. Not needed: actual consumption, not reservation pessimism, exhausted the 100k cap.

## Consequences

Routed arms now finish their calls, but a routed original/candidate pair consumes about 120–130k actual tokens, more than the 100k default cap. Under the default, these kinds end inconclusive for budget until the cap or default changes.
