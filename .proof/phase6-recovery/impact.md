# Phase 6 recovery — inferred blast radius

GitNexus impact analysis is waived for this task. The following blast radius is
inferred from direct call-site and consumer inspection before implementation
edits.

## IMPORTANT-7 — mobile session-catalog reconciliation

- `reconcileCatalogSession` is private to
  `apps/api_server/src/services/mobile_opencode_proxy.ts` and is called from
  `MobileOpenCodeProxy.forward`.
- Mutating callers are successful `session.create` and `session.update`
  responses. These operations create, rename, or archive a session and must not
  report success when the authoritative `agent_sessions` write fails.
- Read-only callers are `session.list` and `experimental.session.list`.
  Reconciliation here is opportunistic repair while serving an engine-backed
  list, so persistence failure must remain non-fatal.
- `session.delete` uses a separate authoritative `AgentSessionsRepository`
  lookup/delete path in `forward`; its existing thrown persistence failures
  already flow to the gateway error handler and are not swallowed by
  `reconcileCatalogSession`.
- The direct HTTP consumer is the `/mobile-gateway/opencode/*` route in
  `mobile_gateway_routes.ts`. Thrown `AppError` values are rendered by its
  mobile-safe error middleware as `{ error: { code, message } }`, without raw
  persistence details, request bodies, credentials, or project paths.
- Downstream behavioral consumers are mobile session creation, rename/archive,
  deletion, and session-list surfaces, plus the desktop session catalog that
  reads the reconciled `agent_sessions` rows.

## IMPORTANT-8 — paired-host health-probe cadence

- `PairedHostProvider` owns the shared `PairedHostStore`, its bounded
  `runBoundedRefresh`, the automatic probe scheduler, the AppState foreground
  listener, and the public `refresh()` callback used for user retries.
- Consumers of the provider snapshot and refresh behavior include Settings,
  the OpenCode provider, agent chat state, and chat/session screens. They rely
  on the provider as the single authoritative paired-Mac reachability state.
- The initial connected-state probe cadence participates in issue #1237's
  bounded first-offline transition. It must remain 5 seconds with the existing
  4-second per-probe abort timeout.
- Backoff affects only probes scheduled after an offline or
  `tailscaleUnavailable` snapshot is established. Recovery, an AppState
  transition to `active`, and the public user-initiated `refresh()` reset the
  next automatic delay to the 5-second base cadence.
- Scheduling changes can affect battery/network usage while unreachable and
  reconnection latency, but do not alter pairing credentials, transport
  request contents, or the store's reachability classification.
