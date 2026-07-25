# OCU-35B — Deliver an isolated remote-workspace execution vertical slice

**Type:** feature / infrastructure / security · **Priority:** deferred
**Supersedes:** the workspaces/control-plane portion of #1076
**Depends on:** a concrete staff remote-execution use case and either graduation
of `OPENCODE_EXPERIMENTAL_WORKSPACES` or an explicit decision to own a stable
Rhythm adapter

## Summary

Allow a user to start one agent session in an explicitly selected remote
workspace (for example the managed NAS worker), observe it from the shipping
desktop client, and recover safely across disconnects. This is not a generic
“turn on experimental workspaces” task: it owns the trust boundary, workspace
inventory, project authorization, lifecycle, and a single end-to-end product
slice.

## Product trigger

Before implementation, attach a concrete workflow that local execution cannot
serve, naming the project, operator class, expected workload, data residency,
and recovery requirement. If no such workflow exists, keep the issue deferred.

## Acceptance criteria

1. Architecture defines the control plane, worker identity, user/project
   authorization, secret boundary, network path, data residency, retention, and
   failure ownership.
2. The server exposes an authenticated inventory of approved remote workspaces;
   clients never accept arbitrary hosts, filesystem roots, or worker-supplied
   project authority.
3. A user can create one session in an approved remote workspace and receive
   streamed messages, tools, permissions/questions, terminal output, status,
   and cancellation through the existing Rhythm surfaces.
4. Workspace and session IDs are opaque and tenant-scoped. Cross-user,
   cross-project, revoked-worker, and stale-token operations fail closed.
5. Disconnect/restart recovery is idempotent: the session is resumed or shown
   as a durable actionable failure, never duplicated or silently abandoned.
6. Local execution remains unchanged and is the default. The remote capability
   has an explicit kill switch and can be disabled without data loss.
7. Observability records operator, workspace, project, lifecycle state, and
   sanitized failure reason without credentials, transcripts, or host paths.

## Likely files

- `apps/opencode_fork/packages/opencode/src/control-plane/`
- `apps/opencode_fork/packages/opencode/src/workspace/`
- `apps/api_server/src/services/opencode_client_service.ts`
- `apps/api_server/src/services/`
- `apps/api_server/src/controllers/`
- `apps/api_server/src/routes/`
- `apps/api_server/src/database/postgres_bootstrap.ts`
- `apps/desktop_flutter/lib/features/agents/`
- `docs/ai/architecture.md`
- `docs/release/hosted_deployment_synology_cloudflare.md`

## Required tests / evaluation

- Unit/contract coverage for inventory, tenant/project authorization, token
  revocation, lifecycle transitions, and log redaction.
- Real local-control-plane plus sandbox-worker E2E for create, prompt/stream,
  terminal, permission/question, cancel, disconnect, server restart, and resume.
- Negative E2E from a second user/project proving every ID-addressed operation
  is denied.
- Postgres and SQLite schema parity checks for any new durable state.
- Desktop widget smoke against the real sandbox worker.
- Threat-model review, GitNexus compare-to-main, and a rollback drill.

## Safety / out of scope

- No arbitrary hostname/root input from clients.
- No production worker enrollment or destructive remote cleanup in the first
  vertical slice.
- No credential material, raw host paths, or unredacted transcript content in
  control-plane logs.
- Do not enable an upstream experimental flag without a Rhythm-owned rollback
  and authorization layer.
