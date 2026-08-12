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

Deployment is automatic through the host-wide Watchtower after GitHub Actions
publishes the image to GHCR. The SSH procedure below is legacy/manual fallback
for an immediate deploy or a Watchtower outage.

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

**Updates are automatic (Watchtower).** The `rhythm-api` service carries
`com.centurylinklabs.watchtower.enable: "true"`, so the host-wide Watchtower
instance (run by the statements project in label-enable mode, 30-minute poll,
GHCR credentials mounted from root's docker login) pulls each new
`ghcr.io/ajhochy/rhythm-api:main` image and recreates the container
automatically — typically within 30 minutes of the "API Image Publish (GHCR)"
workflow finishing. The data volume is preserved. `cloudflared` is
intentionally not labeled and never auto-updates.

Verify an auto-deploy landed:

```bash
curl -s https://api.vcrcapps.com/health
```

The `commit` field must equal the SHA merged to `main`.

**Manual fallback (deploy immediately, or if Watchtower is down):**

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
the rest running. The `/data` volume is preserved across restarts. Relational
data lives in Postgres (`DB_CLIENT=postgres`, see "Production API environment"),
so `/data` holds the container's file-backed state — live-artifact bytes under
`/data/live-artifacts`, plus the legacy SQLite file on pre-Postgres deploys.

Finally, **verify the new code is actually live** (issue #677 — the running
container is otherwise indistinguishable from a stale one):

```bash
curl -s https://api.vcrcapps.com/health
```

The `commit` field must equal the SHA of the commit you just merged to `main`
(compare with `git rev-parse --short origin/main`). If it still shows the old
SHA, the container did not restart on the new image.

### Routine update summary

1. Push to `main` (or merge a PR).
2. Wait for the "API Image Publish (GHCR)" GitHub Actions workflow to finish publishing `ghcr.io/ajhochy/rhythm-api:main`. **A green run means the image is published — NOT yet deployed.**
3. Wait up to ~30 minutes for Watchtower to pull the image and recreate `rhythm-api` (no SSH needed). To deploy immediately instead, run the manual fallback above (SSH → `pull` → `up -d`).
4. `curl -s https://api.vcrcapps.com/health` — confirm `commit` matches the merged SHA.

> **Note:** `sudo` is required on Synology — Docker commands will fail with permission errors without it.
>
> **Note:** Run `pull` and `up -d` as separate commands. Chaining them (e.g. with `&&`) does not reliably execute both on Synology.

The compose file expects:

- persistent data volume mounted at `/data`, holding live-artifact bytes at
  `/data/live-artifacts` (relational data is in Postgres, not on this volume)
- API exposed internally on port `4000`
- Cloudflare tunnel token in `.env.production`
- API image available in GHCR

### Production API environment

Minimum required variables:

- `NODE_ENV=production`
- `PORT=4000`
- `DB_CLIENT=postgres` (this hosted deployment is Postgres-backed; also the
  scheduler-ownership signal — see "Scheduler quarantine" below)
- `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` / `DB_SSL`
- `RHYTHM_ROLE=cloud` (recommended — disables agent-execution routes/scheduler/
  opencode engine on this host; see "Scheduler quarantine" below)
- `CORS_ALLOWED_ORIGINS=<hosted client origins>`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI=https://api.vcrcapps.com/auth/google/callback`
- `GOOGLE_AUTH_CLIENT_ID`
- `GOOGLE_MOBILE_CLIENT_ID`
- `GOOGLE_MOBILE_REDIRECT_URI=<matching reverse-client iOS redirect URI>`
- at least one of `RHYTHM_GOOGLE_ALLOWED_EMAILS=<comma-separated invites>` or `RHYTHM_GOOGLE_ALLOWED_HOSTED_DOMAINS=<comma-separated Workspace domains>`; production rejects new Google accounts when neither list authorizes them
- `PCO_APPLICATION_ID`
- `PCO_SECRET`
- `PCO_REDIRECT_URI=https://api.vcrcapps.com/auth/planning-center/callback`
- `TUNNEL_TOKEN`
- `LIVE_ARTIFACT_STORAGE_DIR=/data/live-artifacts` (server-managed artifact storage; never expose this path to clients)

## Scheduler quarantine (#1214)

`agent_scheduled_tasks` on this hosted API is a legacy, independent dataset
never reconciled with the local SQLite "owned" set the Flutter app and its
embedded agent server use (see #1213). As of this fix, `DB_CLIENT=postgres`
(above) makes `startAgentSchedulerJob()` refuse to advance or fire ANY row
here — it only logs a startup diagnostic naming how many enabled rows are
stranded. No row is deleted, disabled, or migrated automatically.

**This section is a manual operator procedure. Nothing in it is executed by
any agent or CI job — a human runs each step by hand, against the real
production database, after taking a backup.**

1. **Back up first.** Take a full backup of the production Postgres database
   (or at minimum, export `agent_scheduled_tasks`) before touching any row:
   ```bash
   pg_dump -h <host> -U rhythm_user -d rhythm -t agent_scheduled_tasks \
     > agent_scheduled_tasks_backup_$(date +%Y%m%d).sql
   ```
2. **Inspect what's stranded.** After deploying the quarantine fix, check the
   `rhythm-api` container logs for the `[AgentScheduler] QUARANTINED (#1214)`
   line — it names the enabled-row count. Read the full row set with a
   read-only query before deciding anything:
   ```sql
   SELECT id, name, enabled, created_by_user_id, last_run_status, last_run_at
   FROM agent_scheduled_tasks ORDER BY created_at DESC;
   ```
3. **Reconcile duplicates.** Cross-reference against the local SQLite
   `agent_scheduled_tasks` (via the Flutter app's Scheduler screen, or
   `GET /agent-schedules` on `:4001`). Most legacy rows here duplicate a
   working local schedule — for those, disable (never delete) the stranded
   Postgres row once its local counterpart is confirmed to exist and to have
   run successfully:
   ```sql
   UPDATE agent_scheduled_tasks SET enabled = false WHERE id = '<row-id>';
   ```
4. **Rows with no local counterpart** (e.g. any that never migrated) need a
   human decision: recreate them on the local instance (via the Flutter UI or
   `POST /agent-schedules` on `:4001`) before disabling the stranded row here,
   or consciously retire the recurring job if it's no longer needed.
5. **Never `DELETE`** a production row as part of this procedure — `enabled =
   false` is fully recoverable; a delete is not. If full removal is ever
   warranted, it requires its own explicit, separately-reviewed decision.

## Cloudflare requirements

### DNS / routing

Use this public hostname:

- `api.vcrcapps.com`

For the API, the public hostname should route through Cloudflare Tunnel to the
Synology-hosted `rhythm-api` container.

### Relay path rule (mobile relay container)

The mobile relay (`rhythm-relay` service, `RHYTHM_ROLE=relay` — see
`docs/ai/plan-synology-relay.md`) shares the `api.vcrcapps.com` hostname via a
path rule. In the Cloudflare Zero Trust dashboard, add a public-hostname entry
**above** the existing `rhythm-api` catch-all:

- hostname `api.vcrcapps.com`, path `/relay*` → `http://rhythm-relay:4000`

Setup on the NAS (one time):

1. `cp .env.relay.example .env.relay` in `/volume1/docker/Rhythm/api_server/`
   and fill it in (see the example file for the required keys).
2. `docker compose -f docker-compose.synology.yml up -d rhythm-relay`
3. Verify tunnel routing: `curl -s https://api.vcrcapps.com/relay/health`
   returns `{"status":"ok","role":"relay",...}` while
   `curl -s https://api.vcrcapps.com/health` still answers from `rhythm-api`.
4. Verify the LAN fast path used by the Mac uplink:
   `curl -s http://<nas-lan-ip>:4010/relay/health`.
5. SSE must not be buffered on the path rule: during a streaming agent turn,
   frames on `/relay/mobile-gateway/events` must arrive continuously (< 2 s
   lag), not in bursts — the issue #1287 failure class.

The relay is Watchtower-labeled like `rhythm-api`, so it auto-updates from the
same `:main` image publishes.

### OAuth callback updates

Google OAuth authorized redirect URI:

- `https://api.vcrcapps.com/auth/google/callback`

Planning Center OAuth redirect URI:

- `https://api.vcrcapps.com/auth/planning-center/callback`

## Validation checklist

### API

- `https://api.vcrcapps.com/health` returns success
- the API container stays healthy after restart
- the `/data` volume persists across container restarts, so previously stored
  live-artifact bytes under `/data/live-artifacts` are still readable
- the Postgres database reconnects after restart and `runPostgresBootstrap()`
  re-runs cleanly (it is idempotent — see "Schema migrations" below)

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
it to GHCR. It does not SSH into the Synology; host-wide Watchtower performs the
normal remote update, with the SSH procedure retained as the manual fallback.

GitHub-side requirement:

- package publish permission for the workflow `GITHUB_TOKEN`

Synology-side requirement:

- a one-time `docker login ghcr.io` with a token that can read the package

## Schema migrations

### How migrations are applied on production

The API server runs `runPostgresBootstrap()` at startup
(`apps/api_server/src/database/postgres_bootstrap.ts`). Every `ALTER TABLE … ADD
COLUMN IF NOT EXISTS` statement in that file is idempotent — it is safe to restart
the container and re-run it against an existing database. New columns are added
automatically the next time the container starts.

No manual `psql` intervention is required for columns added via `postgres_bootstrap.ts`.
Simply deploy the new image (follow **Routine update summary** above) and restart.

### Live-artifact backup and rollback

Before a live-artifact rollout, back up both production Postgres metadata and the
persistent `/data/live-artifacts` volume. Artifact bundle/state bytes are immutable
content-addressed files; Postgres stores their IDs, revisions, hashes, sharing, and
audit metadata. The migration is additive and bootstrap is idempotent: do not drop
tables, truncate rows, or rewrite artifact bytes during rollout.

To roll back an image, redeploy the prior image while preserving the `/data` volume
and all Postgres rows. Do not delete artifact directories or revision rows; a later
compatible image can recover the stable IDs and immutable bytes from those retained
stores.

### Columns added by milestone

| Column | Table | SQL | Added in |
|--------|-------|-----|----------|
| `preferred_agent` | `tasks` | `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS preferred_agent TEXT;` | Phase 5 — issue #405 |

#### Applying `preferred_agent` to an existing production database manually

If the container was not restarted after the image containing issue #405 was
deployed, run the following once via `docker exec`:

```bash
ssh <user>@<synology-ip>
sudo docker exec -it rhythm-api psql "$DATABASE_URL" \
  -c "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS preferred_agent TEXT;"
```

Or, if using SQLite (legacy single-node deploys):

```bash
sudo docker exec -it rhythm-api sqlite3 /data/rhythm.db \
  "ALTER TABLE tasks ADD COLUMN preferred_agent TEXT;"
```

Verify:

```bash
# Postgres
sudo docker exec -it rhythm-api psql "$DATABASE_URL" -c "\d tasks"

# SQLite
sudo docker exec -it rhythm-api sqlite3 /data/rhythm.db ".schema tasks"
```

Existing rows will have `preferred_agent = NULL` after the migration. PATCHing a
task with `{ "preferredAgent": "claude" }` against `https://api.vcrcapps.com`
should return 200 and persist the value.

## Notes

- The current production deployment is Postgres-backed (`DB_CLIENT=postgres`);
  `#64`'s move to a hosted production database has landed. SQLite remains the
  local development default and the source side of the one-time
  `migrate_sqlite_to_postgres` transfer (`SQLITE_MIGRATION_PATH`).
- File-backed state still needs the persistent `/data` volume: live-artifact
  bytes are written to `LIVE_ARTIFACT_STORAGE_DIR=/data/live-artifacts` and are
  not stored in Postgres.
- The GitHub workflow publishes the API image to GHCR automatically on every push
  to `main`. Host-wide Watchtower performs the normal Synology update; use the
  documented manual SSH fallback only for an immediate deployment or outage.
