---
date: 2026-07-25
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Mixed-ingress mutations require payload-bound human approval

## Context

Rhythm roles can read attacker-controlled email, messages, calendar/PCO data,
tasks, memory, research, triggers, and other user-authored records. Protecting
only external sends still let prompt injection mutate internal state such as
tasks, reservations, memory, research jobs, and delegation.

## Decision

Every consequential Rhythm mutation granted to a role that can consume
external or user-authored data uses the same server-owned taint epoch and an
exact action/payload-bound, expiring, single-use human approval. The role graph
mechanically classifies every granted Rhythm tool and fails if a mutation lacks
a declared MCP/API `SecurityAction`, per-tool authorization call, or payload.
Direct PCO/Calendar role bypasses were removed where they could evade taint.

## Alternatives considered

- Treat internal writes as trusted. Rejected because they can destroy or
  persist attacker-directed state.
- Remove all mutation grants from mixed roles. Rejected because it would break
  core workflows that remain safe with explicit approval.
- Rely on prompt fencing alone. Rejected because fencing is defense in depth,
  not authorization.

## Consequences

Clean trusted sessions keep working without an approval. After any classified
read, the next consequential mutation requires a human-approved exact payload;
substitution, replay, stale taint, wrong agent/session, and missing trusted
metadata fail closed. Adding a new role grant now requires an explicit read,
write, trusted-read, approval, or verified-unavailable classification.
