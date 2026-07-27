---
date: 2026-07-26
repo: Rhythm
status: accepted
tags: [decision, Rhythm]
---

# Memory verification actors and ownership

## Context

The local agent-memory API serves vault notes whose derived SQLite rows are
usually instance-global (`owner_user_id IS NULL`), while imported or future
rows may carry a concrete owner. Verification is security-sensitive because a
`human:` actor raises a memory to the highest trust tier. The local agent server
also bypasses bearer authentication in `AGENT_LOCAL=true` mode, so MCP and
desktop traffic cannot safely share an implicit actor.

## Decision

- Human HTTP verification resolves its actor on the server. An authenticated
  request uses that user; local auth-bypass mode resolves the first non-system
  local user. Request body identity fields are ignored.
- The Rhythm MCP uses a separate server endpoint that can stamp only
  `agent:rhythm-mcp/1`. It cannot request a `human:` actor.
- A concrete-owner row is mutable only when its owner matches the resolved
  human user. Missing or mismatched ownership returns not-found so existence is
  not disclosed.
- Null-owner vault rows retain the existing local-instance behavior established
  by memory update routes: any resolved local human may act on them. The MCP may
  act only on these null-owner rows because it has no human ownership context.
- Verification and deprecation always mutate the vault first and refresh the
  disposable SQLite index second.

## Alternatives

- Accepting an actor in the request body was rejected because it permits human
  trust forgery.
- Treating every auth-bypassed local request as human was rejected because MCP
  confirmations would become indistinguishable from explicit user review.
- Denying all null-owner mutations was rejected because current vault notes are
  intentionally instance-global and the existing desktop update path already
  operates on them.

## Consequences

Human trust remains tied to an actual local identity, machine confirmations
remain machine-tier, foreign-owned notes fail closed, and existing local vault
workflows continue to work without a backfill.
