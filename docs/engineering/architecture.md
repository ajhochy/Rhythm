# Architecture

## Monorepo structure
- `apps/desktop_flutter`: Desktop client UI and client-side orchestration.
- `apps/api_server`: Server APIs, sync orchestration, integration adapters.
- `docs`: Product/engineering specs and architecture decisions.

## Runtime model

Rhythm is desktop-first in UX, but server-first in product runtime.

Real user operation should assume:

- one hosted API
- one hosted canonical database
- desktop, web, and mobile clients pointed at that shared backend

The embedded desktop API and local SQLite storage are development/runtime
convenience only unless explicitly documented otherwise.

See [0006: Server-first Runtime for Collaboration and Mobile](../decisions/0006-server-first-runtime.md).

## Responsibilities
### Desktop client
- User-facing weekly planning experience
- Feature-level MVC organization per domain
- Presentation concerns, local caching, and interaction state
- Optional local development runtime bootstrap

### Backend
- Integration orchestration and normalized data flow
- Recurrence and project generation services
- API endpoints used by desktop client
- Canonical shared state for collaboration and mobile

## MVC usage
Rhythm uses MVC terminology but enforces thin controllers.

Flow:
`View -> Controller -> Service -> Repository -> Data Source / External API`

## Why services and repositories exist
- Services hold reusable business logic (generation, scheduling, merge rules).
- Repositories isolate storage and external API details.
- Controllers stay easy to test and modify.

## Integration boundaries
- Gmail boundary: message/thread metadata state.
- Google Calendar boundary: event timing and availability signals.
- Planning Center boundary: plan/schedule data.
- Rhythm boundary: tasks, project breakdown, weekly plan decisions.

## Runtime modes

### Hosted/shared mode
- default mode for real users
- hosted API + hosted database are authoritative
- collaboration, Facilities, and mobile sync assumptions are valid

### Local development mode
- desktop may launch an embedded API server
- local SQLite may be used for isolated development/testing
- state is local and non-canonical

### Future cache/offline mode
- local cache may mirror hosted data
- hosted backend remains the source of truth
- reconciliation flows back to the hosted backend
