---
date: 2026-07-30
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Inherit tokenless desktop sessions from one paired Mac owner

## Context

The shipping desktop creates sessions through its loopback API. Its cloud
bearer is not guaranteed to resolve in the local SQLite `sessions` table, so
`POST /agent-sessions` can be authenticated only by the trusted local boundary.
Those sessions were persisted with `owner_user_id = NULL`; the mobile gateway
then correctly filtered them out because its catalog is fail-closed on both
user and project ownership.

Each personal Mac is paired to its user's own mobile devices. Revoking or
replacing an iPhone must not erase the Mac's durable user association.

## Decision

An authenticated request user remains authoritative. For an unauthenticated
request to the local SQLite API, inherit the owner only when all historical
`mobile_devices` rows, including revoked devices, identify one distinct user.
Return no inferred owner when pairing history is absent, malformed, or contains
more than one distinct user.

Project ownership continues to come from the existing explicit `projectId` or
longest registered `cwd` prefix. Once the engine SDK ID is persisted, the
existing atomic ownership-claim path publishes the session to the mobile
catalog.

## Alternatives

- Require the cloud bearer on every loopback request: rejected because the
  local API does not share the cloud session store and this already failed in
  the shipping path.
- Use only active paired devices: rejected because replacing or revoking the
  current phone would make the Mac forget its established owner.
- Select the first paired user: rejected because ambiguous history must fail
  closed rather than expose one user's sessions to another.
- Disable server-side owner filtering: rejected because it would break the
  mobile gateway's security boundary.

## Consequences

New interactive desktop sessions on a normally paired personal Mac are visible
to that user's mobile app without weakening hosted authentication or
cross-project filtering. Fresh unpaired Macs and anomalous multi-user pairing
histories continue to create unowned local sessions until ownership is
unambiguous.
