# Claude Collaborator Service Account Setup

One-time operational runbook for provisioning the `worship@visaliacrc.com`
service account that the Claude as Rhythm Workspace Collaborator (CCR) routine
uses to authenticate with the API server.

Related issues: #332 (env var support), #338 (/claude-triggers endpoints), #344 (this runbook).
Design spec: `docs/superpowers/specs/2026-05-04-claude-collaborator-design.md`

---

## Prerequisites

- Production API server is running at `https://api.vcrcapps.com` (Synology Docker).
- `CLAUDE_USER_ID` env var support is deployed (#332).
- `/claude-triggers` endpoints are deployed (#338).
- SSH access to the Synology, or the ability to exec into the running container.
- Access to the team's password manager to store the resulting session token.

---

## Step 1 — Confirm the user record exists

Connect to the production database. For the Synology SQLite deployment, exec
into the container:

```bash
docker exec -it rhythm-api sh
sqlite3 /data/rhythm.db
```

Run:

```sql
SELECT id, email FROM users WHERE email = 'worship@visaliacrc.com';
```

**Expected:** exactly one row. Note the `id` value — this becomes `CLAUDE_USER_ID`.

**If no row exists:** The easiest path is to have someone log in via Google OAuth
in the Rhythm Flutter desktop app once using `worship@visaliacrc.com`. Alternatively,
insert the user directly:

```sql
INSERT INTO users (name, email, created_at)
VALUES ('Claude (Worship)', 'worship@visaliacrc.com', datetime('now'));
```

Then re-run the SELECT to confirm and capture the `id`.

---

## Step 2 — Generate a session token

### Easiest path
Log into the Rhythm Flutter app once as `worship@visaliacrc.com` via Google OAuth.
The app creates a session automatically on login.

### Alternate path (direct DB insert)
Still inside the SQLite shell, run:

```sql
INSERT INTO sessions (token, user_id, created_at, expires_at)
VALUES (
  lower(hex(randomblob(16))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))),2) || '-' ||
    substr('89ab',abs(random()) % 4 + 1, 1) ||
    substr(lower(hex(randomblob(2))),2) || '-' ||
    lower(hex(randomblob(6))),
  <id from step 1>,
  datetime('now'),
  datetime('now', '+365 days')
);
```

Then read it back:

```sql
SELECT token FROM sessions
WHERE user_id = <id from step 1>
ORDER BY created_at DESC
LIMIT 1;
```

### Token expiry policy

Sessions have a **365-day TTL** (set in
`apps/api_server/src/repositories/sessions_repository.ts`,
`DEFAULT_SESSION_EXPIRY_DAYS = 365`). Tokens expire after one year. Plan to
rotate the token annually:

1. Log in again as `worship@visaliacrc.com`, or run the direct DB insert above.
2. Update the token stored in the password manager.
3. Update the token in the CCR routine prompt on claude.ai.

**IMPORTANT:** Do NOT commit the session token to the repository. It lives only
in the team password manager and in the CCR routine prompt on claude.ai.

Save the token in the team password manager as:

> **Label:** Rhythm Claude service account session token  
> **Username:** worship@visaliacrc.com  
> **Value:** \<token UUID\>  
> **Expires:** \<today + 365 days\>

---

## Step 3 — Set the CLAUDE_USER_ID environment variable

On the Synology, edit `.env.production` at
`/volume1/docker/Rhythm/api_server/.env.production` and add:

```
CLAUDE_USER_ID=<id from step 1>
```

Then restart the API server container:

```bash
cd /volume1/docker/Rhythm/api_server
docker compose -f docker-compose.synology.yml up -d
```

Verify the server came back up cleanly:

```bash
curl https://api.vcrcapps.com/health
# Expected: 200 OK
```

Check container logs for any CLAUDE_USER_ID parse errors:

```bash
docker logs rhythm-api --tail 50
```

---

## Step 4 — Smoke-test the endpoint gate

### Non-Claude user should get 403

```bash
# Use your own session token here
curl -i -H "Authorization: Bearer <your_personal_token>" \
  https://api.vcrcapps.com/claude-triggers
# Expected: HTTP/1.1 403 Forbidden
```

### Claude service account should get 200

```bash
curl -i -H "Authorization: Bearer <claude_token_from_step_2>" \
  https://api.vcrcapps.com/claude-triggers
# Expected: HTTP/1.1 200 OK
# Body: [] (empty array if no triggers are pending)
```

---

## Acceptance checklist

- [ ] `worship@visaliacrc.com` user record confirmed in production DB; `id` noted
- [ ] Session token generated and saved in team password manager (with expiry date)
- [ ] `CLAUDE_USER_ID=<id>` added to `.env.production` on Synology; server restarted
- [ ] `GET /claude-triggers` returns 403 for a non-Claude session token
- [ ] `GET /claude-triggers` returns 200 with `[]` for the Claude session token
- [ ] Token expiry reminder added to team calendar (365 days from token creation date)
