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

## Production deployment

For the Synology + Cloudflare deployment track:

- use [`Dockerfile`](./Dockerfile)
- use [`docker-compose.synology.yml`](./docker-compose.synology.yml)
- start from [`.env.production.example`](./.env.production.example)

Relevant production settings:

- `DB_PATH=/data/rhythm.db`
- `CORS_ALLOWED_ORIGINS=<hosted client origins>`
- `GOOGLE_REDIRECT_URI=https://api.vcrcapps.com/auth/google/callback`
- `PCO_REDIRECT_URI=https://api.vcrcapps.com/auth/planning-center/callback`
