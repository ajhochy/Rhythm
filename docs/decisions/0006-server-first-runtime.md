# 0006: Server-first Runtime for Collaboration and Mobile

Status: Accepted

## Context

Rhythm started as a desktop-first product with an embedded local API server and
local SQLite storage. That model works for single-machine development and local
testing, but it breaks down once the product needs:

- real multi-user collaboration
- shared Facilities reservations and room management
- consistent roles and permissions across devices
- shared messages and notification state
- a mobile companion app that sees the same data as desktop

In the current local-first shape, each desktop install can own its own database.
That leads to divergent tasks, reservations, permissions, and message state
across machines. It also creates ambiguity between repo-local development
databases and the runtime database created in the app support directory.

## Decision

Rhythm adopts a server-first runtime model for real user operation.

The canonical product runtime is:

- one hosted API
- one hosted canonical database
- desktop, web, and mobile clients talking to that shared backend

The embedded desktop API and local database remain valid only for:

- local development
- isolated testing
- optional future cache/offline concerns

They are not the source of truth for collaborative product data.

## Canonical server-owned data

The hosted API and hosted database own the canonical state for:

- users
- auth/session state
- roles and permission flags
- tasks and task ownership
- facilities, rooms, reservations, reservation groups, and recurring series
- messages, thread participation, read state, and notifications
- projects, rhythms, and other shared planning entities
- integration account ownership and integration-produced shared records

Any feature that must be visible and consistent across devices must be modeled
against the hosted backend first.

## Client-local-only data

Clients may keep local-only state for:

- cached session tokens and login state
- UI preferences
- window/layout state
- view filters and last-opened screens
- optional local cache layers that mirror server state

Local client state must not become the canonical owner of collaborative data.

## Runtime modes

Rhythm now has three conceptual runtime modes.

### 1. Hosted/shared mode

This is the default real-user mode.

- clients point to the hosted API
- the hosted database is authoritative
- collaboration and mobile sync assumptions are valid

All production behavior should be designed around this mode.

### 2. Local development mode

This mode exists to support developer iteration.

- desktop may launch an embedded local API
- the local API may use a disposable or local SQLite database
- data is non-canonical and local to that machine

This mode must be documented clearly so it is not confused with real
collaborative behavior.

### 3. Future cache/offline mode

This is optional and not yet a product requirement.

- clients may cache hosted data locally
- the hosted backend remains the source of truth
- reconciliation rules must flow back to the hosted backend

Offline support is an extension of the server-first model, not an exception to
it.

## Development and production rules

### Production/runtime rules

- desktop, web, and mobile should target the hosted API
- shared features must be backed by the hosted database
- environment configuration should make the hosted API the default production
  target

### Development rules

- local embedded API/server behavior is development-only unless explicitly
  documented otherwise
- repo-local databases and app-support databases must be treated as local test
  artifacts, not shared truth
- new collaboration features should not be validated solely against local
  desktop state

## Migration implications

This decision drives the following sequencing:

1. Define the server-first runtime contract in repo docs.
2. Make hosted API configuration the expected production path for clients.
3. Execute hosted deployment and routing work.
4. Move persistence from local SQLite assumptions toward a hosted production
   database.
5. Complete collaboration, permissions, and mobile sync work on top of that
   hosted runtime.

## Consequences

### Positive

- collaboration behavior becomes coherent
- Facilities, tasks, messages, and permissions can be trusted across devices
- mobile has a clear backend model
- local development remains possible without defining product behavior

### Tradeoffs

- hosted deployment becomes a real platform requirement, not an optional later
  optimization
- some current local-runtime assumptions must be retired or limited to dev/test
- persistence and environment configuration work become more important earlier

## Related issues

- `#155` Define server-first runtime architecture for hosted collaboration and
  mobile
- `#138` Deployment roadmap: Cloudflare Pages + Synology API + Cloudflare
  Tunnel
- `#64` Migrate persistence from SQLite to hosted production database
- `#62` Model workspaces, membership, and permissions
- `#70` Support mobile/desktop sync for task changes
