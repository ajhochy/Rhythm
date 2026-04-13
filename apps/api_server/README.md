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
- the GitHub workflow [`.github/workflows/api_deploy_synology.yml`](/Users/ajhochhalter/Documents/Rhythm/.github/workflows/api_deploy_synology.yml) now publishes the API image to GHCR
- Synology deployment is a manual `docker compose pull && docker compose up -d` step against that image

Relevant production settings:

- `DB_CLIENT=sqlite` today, with `postgres` config now recognized during startup for connection validation ahead of the repository cutover
- `DB_PATH=/data/rhythm.db`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` for the future Postgres runtime
- `CORS_ALLOWED_ORIGINS=<hosted client origins>`
- `GOOGLE_REDIRECT_URI=https://api.vcrcapps.com/auth/google/callback`
- `PCO_REDIRECT_URI=https://api.vcrcapps.com/auth/planning-center/callback`
