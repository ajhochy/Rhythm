---
date: 2026-10-07
repo: Rhythm
branch: codex/coordinator-conversation-20261007
pr: null
issues: []
status: investigating
tags: [run, Rhythm, coordinator, capabilities]
---

# Coordinator original-brief capability inventory

## Scope and evidence boundary

This is a source-and-test inventory, not a claim that the installed Secretary or
any configured model can use a capability in its current session. Runtime catalog
and tool-execution proof remain separate. No production, installed-app, or
sandbox configuration was changed while gathering this evidence.

## Current project and calendar observations

`apps/api_server/src/services/coordinator_conversation_runtime_adapters.ts`
constructs `owner_local_google_calendar_mirror` strictly from local account,
selection, and shadow-event records. Its source contract says it must not contact
a provider, refresh a token, or write. It labels account binding as `unproven`
and external completeness as `unknown`.

The same adapter's `createProjectSessionsReader` exposes only accessible,
non-archived root chat sessions owned by the current user. It makes bounded
recent-window claims and withholds a source when its final local recheck fails.
`apps/api_server/src/services/coordinator_conversation_service.ts` states that
`rhythm_get_coordinator_status`, when actually scoped, describes cached calendar
and project-session observations only. `apps/api_server/src/__tests__/coordinator_calendar_project_context.test.ts`
covers owner isolation, corrupt selection, empty/unknown state, redaction,
truncation, and changed-during-read withholding.

This is not a live Google Calendar reader, and no Coordinator-specific current
GitHub reader was found in this review.

## GitHub and host commands

The profile-scope implementation can represent server and per-tool grants
(`apps/api_server/src/services/agent_profile_scope.ts` and
`mcp_allowlist_expander.ts`), but a profile row or host `gh` authentication does
not prove a tool is advertised to, or executable by, an existing model session.
The active Electron profile database's Secretary row was read only as a
configuration observation: revision 5, model default `anthropic/claude-sonnet-5-5`,
and a server-level MCP list of `gmail-personal`, `gmail-work`, `obsidian`,
`pco-services`, and `rhythm`.

The generated Secretary projection at
`~/.config/opencode/agents/secretary.md` was also read without modification
(SHA-256 `72f3ca8e0ad50e1b0594e7a2d4e16810b1d2c1d6660cfb13c7bc5cc94c020fce`).
It projects the same five all-tools MCP servers (`tools: []`), so it has no
GitHub or standalone Calendar server. Its `bash` policy allows the broad tool
but marks `sh`, `bash`, and `zsh` as `ask`; `gh` is consequently only a possible
host command through a granted bash call, not an independently advertised model
capability. This generated file is stronger evidence of configured projection,
but still cannot prove the effective engine catalog or a session override.

A requested runtime read at `127.0.0.1:8198` / `:8242` found no listeners in
this shell namespace and both HTTP connections were refused. Therefore this run
has no effective Secretary catalog or executable `bash`/`gh` proof. Host CLI
access must not be reported as model access.

## Direct memory authentication versus catalog visibility

`apps/api_server/src/routes/agentMemoryRoutes.ts` requires local-or-cloud bearer
authentication for `/memory/search-select` and `/memory/search-managed`.
`agentMemoryController.ts` returns unauthenticated `401`, and turns a signed-call
refusal into `403 FORBIDDEN: Managed memory search refused`.
`apps/api_server/src/__tests__/memory_search_cloud_auth.test.ts` proves both
identity paths, missing/invalid bearer rejection before admission, and a cloud
authenticated forged signed call rejected before evidence storage.

Tool discovery/catalog presence is separate from this route admission. No
runtime trace was captured here that establishes the reported direct-memory
`401` for a particular Secretary conversation; preserve that as an evidence gap
rather than treating it as a new product defect.

## Native and async descendants

Native descendants are available through
`GET /agent-sessions/:id/children` and child-message routes in
`apps/api_server/src/routes/agent_sessions_routes.ts`, backed by the engine's
`session.children` client wrapper in `opencode_client_service.ts`. Owned mobile
mirror reads can answer children while the engine is unavailable through
`mobile_mirror_reads.ts` and the relay gateway. Existing tests include
`opc_m3_6_child_sessions.test.ts`, `issue_1379_mirror_reads*.test.ts`, and the
recursive native accounting cases in `coding_workflow_coverage_inspection.test.ts`.

Async delegation has status/cancel coverage and explicit scope preservation in
`async_delegation_status.test.ts` and `async_delegation_permission_scope.test.ts`.
These sources establish API paths and test coverage, not a configured-model
proof that it can discover active descendants without pasted IDs. That original
acceptance remains unobserved.

## Goal, workstream, proposal card, and routing

`coordinator_conversation_model_status_service.ts` validates trusted proposal
and start tools against the current conversation, selected goal, reference,
profile revision, and same-chat human approval card. `chat_bounded_workflow.ts`
provides the bounded workstream linkage; the coordinator foreground prompt in
`coordinator_conversation_service.ts` directs the exact proposal, signed
human-decision, and dedicated-resume path. Existing vertical/canonical coverage
includes the coordinator conversation, coding-workflow canonical-path, and
goal-approval-resume test suites.

This supports the existing C17 proposal/card/routing implementation. It does
not replace a successful current configured-model run, so no real-model C17
acceptance is claimed.

## Remaining runtime gates

1. Capture the actual Secretary session's effective advertised tool inventory,
   then distinguish its scoped tools from host-only commands and profile defaults.
2. Capture the diagnostic direct-memory failure with request identity and route
   outcome, without exposing authorization material.
3. Run a configured-model conversation that finds real native and/or async
   descendants without pasted identifiers.
4. Obtain a successful configured-model proposal/card/routing receipt before
   claiming C17 behavior.
