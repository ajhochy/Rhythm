# Issue #1231 inferred blast radius

GitNexus was explicitly waived by the orchestrator. This impact statement is
inferred from targeted call-site inspection.

## Modified symbols and callers

- `AgentSessionsRepository.setSdkSessionId`
  - Called by desktop session create, legacy resume, fork creation, and other
    engine-adoption paths.
  - New effect: when the local row has both `owner_user_id` and `project_id`,
    SDK-ID persistence and the existing mobile ownership-row insert occur in
    one SQLite transaction. Local/system/legacy rows with a null scope retain
    their previous behavior.
- `AgentSessionsRepository.listAll`, `listByProject`,
  `listByScheduledTaskId`, and `listResumable`
  - Called by `AgentSessionsController.list` and repository tests.
  - New optional owner filter is applied only when the request has an
    authenticated user; `AGENT_LOCAL` callers without auth preserve the prior
    instance-local catalog.
- `AgentSessionsRepository.reconcileMobileSession`
  - New gateway-only adoption path keyed by the existing
    `agent_sessions.sdk_session_id`.
  - Repeated list/create/update responses update one row and never copy
    transcript messages.
- `AgentSessionsRepository.deleteById`
  - Existing hard-delete callers now also release the matching ownership row
    transactionally when the row has a complete user/project/SDK scope.
- `MobileOpenCodeProxy.forward`
  - Successful allowlisted session create/list/update/delete operations now
    reconcile the already-authorized engine resource into `agent_sessions`.
  - Authorization and response shaping still occur through the existing
    fail-closed ownership checks.
- `OpencodeClientService.updateSessionCatalogMetadata`
  - New metadata-only engine update used by desktop rename and archive/restore.
  - No prompt, credential, filesystem, or transcript surface is added.
- `AgentSessionsController.create/update/list`
  - Create returns the re-read row containing its stable SDK identity.
  - Rename/archive are written to the engine before the local row.
  - Authenticated lists are user-scoped.

## Risk assessment

**Moderate.** The change touches shared session creation/list/delete paths, but
does not add or alter a table, migration, transcript format, gateway allowlist,
or credential flow. Primary risks are:

1. an older/non-fork engine rejecting metadata fields on `session.update`;
2. legacy authenticated `agent_sessions` rows with null `owner_user_id`
   disappearing from the newly fail-closed authenticated list;
3. an ownership conflict causing desktop SDK assignment to roll back instead
   of silently exposing the engine session to the wrong user/project.

The authored unit/contract and env-gated live tests target those identity,
scope, and convergence boundaries. Per the execution split, they were not run
in this worktree.
