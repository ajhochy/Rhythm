# Architecture

## Monorepo structure
- `apps/desktop_flutter`: Desktop client UI and client-side orchestration.
- `apps/api_server`: Server APIs, sync orchestration, integration adapters.
- `docs`: Product/engineering specs and architecture decisions.

## Responsibilities
### Desktop client
- User-facing weekly planning experience
- Feature-level MVC organization per domain
- Presentation concerns, local caching, and interaction state

### Backend
- Integration orchestration and normalized data flow
- Recurrence and project generation services
- API endpoints used by desktop client

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
