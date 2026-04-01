# Rhythm API Server

Node.js + TypeScript API scaffold for Rhythm.

## Principles
- Thin controllers
- Service-layer business logic
- Repository abstraction over persistence/integrations
- Clear external integration boundaries

## Scripts
- `npm run dev` - run in watch mode
- `npm run build` - compile TypeScript
- `npm test` - placeholder tests

## Auth config
- `GOOGLE_AUTH_CLIENT_ID` - OAuth audience accepted by `POST /auth/google/login` (set this to the Firebase Apple client ID currently used by the macOS app)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` - existing Google integration OAuth settings
