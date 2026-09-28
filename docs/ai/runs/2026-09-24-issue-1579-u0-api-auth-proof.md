---
date: 2026-09-24
repo: Rhythm
branch: swarm/issue-1579
pr: null
issues: [1579]
status: pass
tags: [run, Rhythm]
---

## Files

- This run receipt only. No product, manifests, lockfiles, or contract files changed; ignored worktree-local dependency/build directories installed.

## Checks

- `pwd && git branch --show-current && git status --short --branch && git rev-parse --show-toplevel && git status --porcelain=v1` in `/private/tmp/rhythm-swarm-1579`: correct root, `swarm/issue-1579`, clean.
- `npm ci` in `apps/api_server` and `apps/mcp_server`; `bun install --frozen-lockfile --ignore-scripts` in `apps/opencode_fork`: succeeded; npm reported existing dependency advisories (API 16, MCP 15), no audit fix attempted.
- `node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-1579-u0-fixture-20260924-01`: fresh synthetic read-only fixture (two synthetic users, first owner bearer).
- `RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-1579-u0-fixture-20260924-01 RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-1579-u0-fixture-20260924-01/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-1579-u0-fixture-20260924-01/opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-1579-u0-runtime-20260924-01 RHYTHM_SANDBOX_API_PORT=6198 RHYTHM_SANDBOX_ENGINE_PORT=6197 RHYTHM_SANDBOX_GATEWAY_PORT=6199 DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow tools/dev/sandbox.sh up`: API and MCP builds succeeded; sandbox engine ready on 6197, API on 6198. No relay. `tools/dev/sandbox.sh status` with the same sandbox/port env reported gateway 6199 and owned listeners.
- Sandbox-copy-only seed: `sqlite3 /private/tmp/rhythm-1579-u0-runtime-20260924-01/rhythm.db "INSERT INTO sessions(token,user_id) VALUES ('u0-second-owner-synthetic-not-secret',2); INSERT INTO agent_sessions(id,agent_kind,status,cwd,name,owner_user_id) VALUES ('18aa886d-0f9e-4530-ac35-767bf3d1ce91','build','idle','/private/tmp/rhythm-1579-u0-runtime-20260924-01','Synthetic U0 owned session',1);"`. No production data accessed.
- Real `fetch('http://127.0.0.1:6198/agent-sessions/'+id+'?transcriptLimit=1', {headers: token ? {Authorization: 'Bearer '+token} : {}})` via `node -e` with `assert/strict`, five sequential cases, asserted expected status, UUID/session owner on success, array messages, and transcriptPage fields. Observed:

  | Case | HTTP | Response keys | Relevant fields |
  | --- | --- | --- | --- |
  | anonymous, existing UUID | 200 | `session,messages,transcriptPage` | `session.id=18aa886d-0f9e-4530-ac35-767bf3d1ce91`, `ownerUserId=1`, `messages=[]`, `transcriptPage={nextCursor:null,hasMore:false}` |
  | invalid present bearer | 401 | `error` | `UNAUTHORIZED / Invalid session token` |
  | owner bearer | 200 | `session,messages,transcriptPage` | matching UUID, owner 1, array messages, page cursor/null + hasMore/false |
  | different-owner bearer | 404 | `error` | `NOT_FOUND / AgentSession not found` |
  | unknown UUID, owner bearer | 404 | `error` | `NOT_FOUND / AgentSession not found` |

  Output: `PASS: isolated HTTP auth/schema matrix 5/5`.
- `RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-1579-u0-runtime-20260924-01 RHYTHM_SANDBOX_API_PORT=6198 RHYTHM_SANDBOX_ENGINE_PORT=6197 RHYTHM_SANDBOX_GATEWAY_PORT=6199 tools/dev/sandbox.sh down`; `lsof -nP -tiTCP:<port> -sTCP:LISTEN` each 6198/6197/6199: all CLEAR. `git status --short --branch`: only this run receipt; `git diff --` scoped to package/lock files: empty. Sanitized sandbox diagnostics saved outside worktree at `/private/tmp/rhythm-1579-u0-runtime-20260924-01.evidence.cFMJ5b`.

## Notes / frozen dispatch corrections

WAIVED: This request changes no product behavior; verification is a live, isolated HTTP auth/schema matrix and a clean worktree check.

- U1: the main-side caller must refuse to fetch unless it holds a **nonempty main-owned bearer**. `AGENT_LOCAL` permits missing Authorization and returned the owned session anonymously (200), so the route is not the main-side auth gate. Use the **local UUID**, not the engine SDK ID; consume `{session,messages,transcriptPage}` rather than assuming a bare session; handle 401 without an anonymous retry.
- U2: freeze the same bearer/ownership invariant across the downstream flow: an invalid present bearer is 401, a different valid owner is 404, and an unknown UUID is 404. Do not downgrade 401/404 to no-header retry or route a notification from an unverified session. No U1/U2 product changes were made here.
- No packaged banner/manual click requested in this U0 proof. No commit, push, merge, stash, or clean.
