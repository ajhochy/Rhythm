---
date: 2026-07-24
repo: Rhythm
issues: [1134]
tags: [decision, Rhythm, security]
---

# Session-bound external-content approval

## Context

The first #1134 implementation kept taint in a module-global boolean inside
`mcp_server` and accepted any approval row whose ID had `status=approved`.
Rhythm's opencode engine actually multiplexes many sessions through one
long-lived MCP client, so the boolean could leak across sessions. The approval
ID was also reusable across sessions, agents, actions, payloads, later Gmail
reads, and time.

## Decision

- The opencode fork injects engine-owned `sdkSessionId`, assistant-message
  `turnId`, `agentName`, and `toolCallId` into MCP request `_meta` only after
  model tool arguments are produced.
- The MCP server reads that metadata through the SDK request-extra object. It
  never accepts session/turn identity from model-visible tool arguments.
- The local api_server owns persistent taint. Every Gmail read records a
  sanitized audit event and rotates a session taint UUID before any raw result
  can reach the model.
- A security-bound approval stores the durable local session, engine agent,
  exact action, SHA-256 of canonical JSON payload, current taint UUID, source
  turn, ten-minute expiry, and consumption time. Security-bound approvals never
  inherit per-profile auto-approval.
- Approval consumption is one SQLite transaction with a conditional
  `consumed_at IS NULL` update. Any identity/action/payload/taint/expiry
  mismatch fails closed.
- `email-assistant` is read-only triage. A separate `email-outbound` role has
  write tools but no Gmail/shared-thread reads, requiring a fresh clean-context
  handoff for ordinary outbound work.

Raw email and matched text are never written to the security audit tables.
Audit diagnostics retain only validated pattern IDs/classes, a source label,
and a SHA-256 content digest.

## Alternatives

- Keep a process-global taint flag: rejected because one MCP process is shared
  by multiple engine sessions.
- Treat an approved row ID as a bearer token: rejected because it permits
  replay and cross-context substitution.
- Put session IDs in tool schemas: rejected because the model could forge them.
- Rely only on prompt fencing or role splitting: rejected because defense in
  depth requires enforcement for already-running/stale sessions too.

## Consequences

- The bundled fork is now part of #1134's enforcement chain and must be used in
  live validation.
- Direct MCP clients that do not supply trusted engine metadata cannot read
  Gmail or perform outbound writes; they fail closed.
- A failed outbound request after token consumption needs a new human approval.
  This favors non-replayability over automatic retry.
- No Rhythm MCP tools were added or removed; only per-role allowlists changed.
