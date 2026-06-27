---
index: "[[Rhythm]]"
date: 2026-06-17
repo: rhythm
tags: [decision, rhythm]
---

# Deferred: per-user access control on the local opencode/agent integration

**Context:** Different macOS users (or anyone who logs into Rhythm) on the *same* machine currently see the *same* local agent sessions — opencode session history, transcripts, terminal output, file diffs. This data lives in local SQLite served over `localhost:4001` with the `AGENT_LOCAL` auth bypass (no user identity on those requests); it never syncs to production or across the workspace. Production data (tasks/messages/etc.) IS per-user (login-gated Postgres); the local agent data is NOT scoped to a user. Question raised: is per-user access control worth adding?

**Threat model:** The only exposure path is a *shared physical machine* — e.g. someone logs into Rhythm as themselves on a coworker's Mac and sees that coworker's agent history. Agent sessions are the most sensitive *local* data (full transcripts, terminal output, broad MCP reach: Gmail/Calendar/PCO/tasks). But: nothing is network-exposed or shared org-wide, and a person already on someone else's macOS account has far broader access than Rhythm anyway. Church-staff devices are effectively 1:1 (user:device), so the shared-machine case is rare.

**Decision:** **Do not build per-user ACL now (YAGNI).** Cost is real — `owner_id` on `agent_sessions`/messages + migration + filtering every agent query + threading the logged-in user identity through the `AGENT_LOCAL` bypass (which deliberately carries no user today) — for a narrow, local-only, rare-scenario risk. Record as a known limitation instead.

**Revisit trigger:** a genuinely shared machine enters use (e.g. a front-desk/kiosk Mac).

**Cheap mitigation if revisited (preferred over a full row-level ACL):** clear or scope the local agent state on user-switch/logout, which covers the borrowed-machine case for a fraction of the effort.

**Consequences:**
- + No work spent hardening a local-only surface against a rare scenario; `AGENT_LOCAL` bypass stays simple.
- − Known gap: on a shared machine, an authenticated user sees the prior user's local agent sessions. Documented, accepted.
