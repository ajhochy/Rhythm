# Hosted Deployment: Synology + Cloudflare

This document is the concrete deployment runbook for the hosted/shared runtime
defined in [0006: Server-first Runtime for Collaboration and Mobile](../decisions/0006-server-first-runtime.md).

## Target topology

- `api.vcrcapps.com`
  - hosted API
  - recommended runtime: Synology Docker container
  - exposed through Cloudflare Tunnel

The previous web client under `apps/web` has been retired. A replacement web
client can be deployed later, but it is not part of the current hosted rollout
or acceptance criteria for this deployment.

## Repo artifacts for this deployment path

- API containerization:
  - [`apps/api_server/Dockerfile`](../../apps/api_server/Dockerfile)
  - [`apps/api_server/.dockerignore`](../../apps/api_server/.dockerignore)
  - [`apps/api_server/docker-compose.synology.yml`](../../apps/api_server/docker-compose.synology.yml)
  - [`apps/api_server/.env.production.example`](../../apps/api_server/.env.production.example)
- GitHub Actions image publish workflow:
  - [`.github/workflows/api_deploy_synology.yml`](../../.github/workflows/api_deploy_synology.yml)

## API deployment requirements

### Synology Docker runtime

Suggested deployment path:

1. Copy or pull the repo to the Synology once so the compose file and env file exist there.
2. In `apps/api_server`, create `.env.production` from `.env.production.example`.
3. Fill in the real OAuth, Planning Center, and Cloudflare values.
4. Log in to GHCR on the Synology host:

```bash
echo '<ghcr-read-token>' | docker login ghcr.io -u '<github-username>' --password-stdin
```

5. Pull and start the API and tunnel:

```bash
cd apps/api_server
export RHYTHM_API_IMAGE=ghcr.io/ajhochy/rhythm-api:main
docker compose --env-file .env.production -f docker-compose.synology.yml pull
docker compose --env-file .env.production -f docker-compose.synology.yml up -d
```

Routine updates are now:

1. push to `main`
2. let GitHub publish the new `ghcr.io/ajhochy/rhythm-api:main` image
3. run the two `docker compose` commands above on the Synology host

The compose file expects:

- persistent SQLite volume mounted at `/data`
- API exposed internally on port `4000`
- Cloudflare tunnel token in `.env.production`
- API image available in GHCR

### Production API environment

Minimum required variables:

- `NODE_ENV=production`
- `PORT=4000`
- `DB_PATH=/data/rhythm.db`
- `CORS_ALLOWED_ORIGINS=<hosted client origins>`
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

Use this public hostname:

- `api.vcrcapps.com`

For the API, the public hostname should route through Cloudflare Tunnel to the
Synology-hosted `rhythm-api` container.

### OAuth callback updates

Google OAuth authorized redirect URI:

- `https://api.vcrcapps.com/auth/google/callback`

Planning Center OAuth redirect URI:

- `https://api.vcrcapps.com/auth/planning-center/callback`

## Validation checklist

### API

- `https://api.vcrcapps.com/health` returns success
- the API container stays healthy after restart
- the SQLite file persists across container restarts

### Desktop

- desktop can target the hosted API instead of localhost
- Google login still succeeds
- integration callback flows complete against the hosted API

Hosted desktop builds should use:

- `RHYTHM_SERVER_URL=https://api.vcrcapps.com`
- `RHYTHM_USE_EMBEDDED_API=false`

Local development builds should keep:

- `RHYTHM_SERVER_URL=http://localhost:4000`
- `RHYTHM_USE_EMBEDDED_API=true`

## GitHub Actions and credentials

The GitHub workflow verifies the API, builds the container image, and publishes
it to GHCR. It does not SSH into Synology or perform remote deploys.

GitHub-side requirement:

- package publish permission for the workflow `GITHUB_TOKEN`

Synology-side requirement:

- a one-time `docker login ghcr.io` with a token that can read the package

## Notes

- The current production-ready deployment path still assumes SQLite.
- `#64` is the follow-up issue for moving to a hosted production database.
- The GitHub workflow publishes the API image to GHCR; Synology deployment is a
  manual `docker compose pull && up -d` step.
