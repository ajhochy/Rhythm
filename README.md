# Rhythm

Rhythm is a desktop-first planning hub for turning recurring responsibilities, annual projects, calendar signals, and inbox context into realistic weekly action plans.

## Project overview

Rhythm is designed for people who manage both day-to-day tasks and cyclical planning work (weekly/monthly/annual). It combines:
- One-off tasks
- Recurring task generation
- Recurring annual project generation
- Project template breakdown into scheduled steps
- Weekly planning workflow
- Future sync boundaries with Gmail, Google Calendar, and Planning Center Online

This is intentionally not a generic todo app; the core focus is planning orchestration.

## Monorepo layout

- `apps/desktop_flutter/` — Flutter desktop client (macOS-first; Windows/Linux ready structure)
- `apps/api_server/` — Node.js + TypeScript backend API
- `docs/` — Product, engineering, and architecture decision records
- `.github/` — Templates and CI scaffolding

## Architecture summary

Both frontend and backend follow MVC terminology with thin controllers:

`View -> Controller -> Service -> Repository -> Data Source / External API`

Controllers coordinate request/response and UI intent only. Business rules live in services. Repositories isolate persistence and remote API details.

## Desktop-first rationale

Rhythm starts desktop-first to support high-information planning surfaces:
- Multi-pane layout (navigation + planner + details)
- Faster weekly planning across many entities
- Better fit for power-user workflows and integrations

macOS is the first runtime target, with clean structure to extend to Windows/Linux.

## Local setup

### Prerequisites
- Flutter SDK (desktop enabled)
- Node.js 20+
- npm

### Desktop app
```bash
cd apps/desktop_flutter
flutter pub get
flutter run -d macos
```

### API server
```bash
cd apps/api_server
npm install
npm run dev
```

## Development principles

- Keep controllers thin.
- Keep domain logic in services.
- Keep repositories as persistence/integration boundaries.
- Generate concrete task instances ahead of time for recurring work.
- Prefer bounded, explicit changes with clear acceptance criteria.

## Future integrations

- Gmail (message/thread state)
- Google Calendar (event timing)
- Planning Center Online (service plan data)

Rhythm remains the source of truth for planning entities (tasks, weekly plans, project breakdown/scheduling).
