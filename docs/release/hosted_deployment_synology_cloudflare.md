# Hosted Deployment: Synology + Cloudflare

This document is the concrete deployment runbook for the hosted/shared runtime
defined in [0006: Server-first Runtime for Collaboration and Mobile](../decisions/0006-server-first-runtime.md).

## Target topology

- `app.vcrcapps.com`
  - hosted web frontend
  - recommended target: Cloudflare Pages
- `api.vcrcapps.com`
  - hosted API
  - recommended runtime: Synology Docker container
  - exposed through Cloudflare Tunnel

## Repo artifacts added for this deployment path

- Web env-based API configuration:
  - [`apps/web/src/lib/api.ts`](../../apps/web/src/lib/api.ts)
  - [`apps/web/.env.example`](../../apps/web/.env.example)
- API containerization:
  - [`apps/api_server/Dockerfile`](../../apps/api_server/Dockerfile)
  - [`apps/api_server/.dockerignore`](../../apps/api_server/.dockerignore)
  - [`apps/api_server/docker-compose.synology.yml`](../../apps/api_server/docker-compose.synology.yml)
  - [`apps/api_server/.env.production.example`](../../apps/api_server/.env.production.example)

## Web deployment requirements

### Cloudflare Pages

Configure the web app with:

- project root: `apps/web`
- build command: `npm install && npm run build`
- output directory: `dist`

Set the Pages environment variable:

- `VITE_API_BASE_URL=https://api.vcrcapps.com`

Attach the custom domain:

- `app.vcrcapps.com`

## API deployment requirements

### Synology Docker runtime

Suggested deployment path:

1. Copy or pull the repo to the Synology.
2. In `apps/api_server`, create `.env.production` from `.env.production.example`.
3. Fill in the real OAuth, Planning Center, and Cloudflare values.
4. Start the API and tunnel:

```bash
cd apps/api_server
docker compose -f docker-compose.synology.yml up -d --build
```

The compose file expects:

- persistent SQLite volume mounted at `/data`
- API exposed internally on port `4000`
- Cloudflare tunnel token in `.env.production`

### Production API environment

Minimum required variables:

- `NODE_ENV=production`
- `PORT=4000`
- `DB_PATH=/data/rhythm.db`
- `CORS_ALLOWED_ORIGINS=https://app.vcrcapps.com`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI=https://api.vcrcapps.com/auth/google/callback`
- `GOOGLE_AUTH_CLIENT_ID`
- `PCO_APPLICATION_ID`
- `PCO_SECRET`
- `PCO_REDIRECT_URI=https://api.vcrcapps.com/auth/planning-center/callback`
- `TUNNEL_TOKEN`

## Cloudflare requirements

### DNS / routing

Use these public hostnames:

- `app.vcrcapps.com`
- `api.vcrcapps.com`

For the API, the public hostname should route through Cloudflare Tunnel to the
Synology-hosted `rhythm-api` container.

### OAuth callback updates

Google OAuth authorized redirect URI:

- `https://api.vcrcapps.com/auth/google/callback`

Planning Center OAuth redirect URI:

- `https://api.vcrcapps.com/auth/planning-center/callback`

## Validation checklist

### Web

- `app.vcrcapps.com` loads successfully
- network requests target `https://api.vcrcapps.com`

### API

- `https://api.vcrcapps.com/health` returns success
- the API container stays healthy after restart
- the SQLite file persists across container restarts

### Desktop

- desktop can target the hosted API instead of localhost
- Google login still succeeds
- integration callback flows complete against the hosted API

## Notes

- The current production-ready deployment path still assumes SQLite.
- `#64` is the follow-up issue for moving to a hosted production database.
- This document does not automate Cloudflare Pages or Synology deploys by
  itself; it defines the expected runtime inputs and repo artifacts needed to do
  so.
