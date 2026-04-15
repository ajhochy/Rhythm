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

Deployment is manual — GitHub Actions builds and publishes the image to GHCR,
then you SSH into the Synology and pull + restart the container.

### First-time setup

1. Place `docker-compose.synology.yml` and `.env.production` on the Synology at:
   `/volume1/docker/Rhythm/api_server/`
2. Create `.env.production` from `.env.production.example` and fill in all values.
3. Log in to GHCR once on the Synology host (needs a GitHub personal access token
   with `read:packages` scope):

```bash
echo '<ghcr-read-token>' | docker login ghcr.io -u '<github-username>' --password-stdin
```

### Deploying an update

After CI publishes a new image to GHCR (happens automatically on every push to
`main`), SSH into the Synology and run:

```bash
ssh <user>@<synology-ip>
```

Then navigate to the deployment directory and pull the new image:

```bash
cd /volume1/docker/Rhythm/api_server
sudo docker compose -f docker-compose.synology.yml --env-file .env.production pull
```

Restart the containers with the new image:

```bash
sudo docker compose -f docker-compose.synology.yml --env-file .env.production up -d
```

The `up -d` command recreates any container whose image changed and leaves
the rest running. The SQLite data volume is preserved across restarts.

### Routine update summary

1. Push to `main` (or merge a PR).
2. Wait for the GitHub Actions workflow to finish publishing `ghcr.io/ajhochy/rhythm-api:main`.
3. SSH into the Synology.
4. `cd /volume1/docker/Rhythm/api_server`
5. `sudo docker compose -f docker-compose.synology.yml --env-file .env.production pull`
6. `sudo docker compose -f docker-compose.synology.yml --env-file .env.production up -d`

> **Note:** `sudo` is required on Synology — Docker commands will fail with permission errors without it.
>
> **Note:** Run `pull` and `up -d` as separate commands. Chaining them (e.g. with `&&`) does not reliably execute both on Synology.

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
it to GHCR. It does not SSH into the Synology or perform any remote deploy —
that step is always done manually as described above.

GitHub-side requirement:

- package publish permission for the workflow `GITHUB_TOKEN`

Synology-side requirement:

- a one-time `docker login ghcr.io` with a token that can read the package

## Notes

- The current production-ready deployment path still assumes SQLite.
- `#64` is the follow-up issue for moving to a hosted production database.
- The GitHub workflow publishes the API image to GHCR automatically on every push
  to `main`. Synology deployment is always a manual SSH + `docker compose pull &&
  up -d` step — there is no automated remote deploy.
