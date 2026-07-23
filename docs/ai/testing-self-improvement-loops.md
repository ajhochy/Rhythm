# Self-Improvement Engine Loop Triggers (#1116)

This guide provides targeted session prompts to exercise each part of the self-improvement harvest/discovery/adoption/publish loop that shipped in #1116.

**Prerequisites:**
- Sandbox running: `tools/dev/sandbox.sh up` (API at `http://localhost:4098`)
- Fork binary built: `cd apps/opencode_fork/packages/opencode && bun run build --single`
- api_server + fork engine launched against isolated DB + sandbox ports (via `tools/dev/sandbox.sh`)
- Live e2e test suite ready: `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 ...`

---

## Loop 1: Harvest Cost Gating (Issue #1109 + #1110)

**Goal:** Verify that a session triggers skill extraction at most once, and that self-improvement runs use cheap models instead of frontier.

### 1a. Single harvest per session (per-session guard + cooldown)

**Setup:**
```bash
# Start sandbox and prepare a copy of the DB
tools/dev/sandbox.sh up
cp ~/Library/Application\ Support/Rhythm/rhythm.db /tmp/rhythm-harvest-test.db

# Export forked opencode binary
export RHYTHM_OPENCODE_BIN_DIR=$(pwd)/apps/opencode_fork/packages/opencode/dist

# Launch api_server against isolated DB
cd apps/api_server
DB_CLIENT=sqlite DB_PATH=/tmp/rhythm-harvest-test.db \
AGENT_LOCAL=true \
npm run build && npm start &

# Wait for health check
sleep 5
curl http://localhost:4098/opencode/health
```

**Session prompt (triggers harvest once, then repeated turns should NOT trigger again):**

```
Name: Harvest gating test

Agent: claude-code
Prompt:

You are testing a skill extractor. Your task:
1. Write a simple TypeScript utility function that validates email addresses
2. Run it through at least 3 more turns (arbitrary refinements)
3. Each turn should be small enough to fit in context

After you write the email validator, refine it 3 times. Each turn is an opportunity for the engine to harvest — verify it only extracts once per session.

---

Context:
- This is a code-improvement task that should trigger skill extraction
- Harvest guard allows max 1 LLM call per session
- Cooldown (90s) throttles bursts across sessions
- Look at the api_server logs for "queueSkillExtraction" / "skill extraction" evidence
```

**Verification in logs:**
```bash
# Check api_server logs
tail -f /tmp/rhythm-dev-sandbox/api_server.log | grep -i "extraction\|harvest"

# Expected output (ONE of these per session, never repeated):
# [skill-extractor] queueSkillExtraction triggered
# [skill-extractor] Stage A: generating skill draft
# [skill-extractor] → draft routed to evaluator

# Run the session end-to-end
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_DB_PATH=/tmp/rhythm-harvest-test.db \
RHYTHM_LIVE_SERVER_LOG=/tmp/rhythm-dev-sandbox/api_server.log \
npx vitest run --reporter=verbose src/__tests__/live_e2e_inert_regressions.test.ts
```

**Acceptance:**
- [ ] Session runs 4+ turns
- [ ] Skill extraction triggers exactly once
- [ ] api_server logs show only ONE "queueSkillExtraction" call
- [ ] Re-running the same session shows cooldown gate active (no 2nd session extraction for 90s+)

---

### 1b. Cheap model for self-improvement runs (#1110)

**Setup:** Same sandbox as above.

**Session prompt:**

```
Name: Self-improvement harvest cost test

Agent: claude-code (or any agent)
Prompt:

Generate a small TypeScript library for URL slug generation.
Output:
- A function slugify(text: string): string
- 3 unit tests
- A brief JSDoc comment
```

**Verification in logs:**

```bash
# Watch the opencode fork engine logs (not api_server)
# Look for the self_improvement task model selection

RHYTHM_OPENCODE_BIN_DIR=$(pwd)/apps/opencode_fork/packages/opencode/dist \
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_DB_PATH=/tmp/rhythm-harvest-test.db \
npx vitest run src/__tests__/live_e2e_inert_regressions.test.ts \
  2>&1 | grep -i "model\|cheap\|task_kind"
```

**Expected behavior:**
- Self-improvement tasks (distill/score/judge/rewrite) appear with `taskKind: 'self_improvement'` in logs
- Model selection shows cheap-tier model (e.g., `anthropic/claude-haiku-4.5` or cost-tier equivalent)
- NOT a frontier model (e.g., not `claude-opus`)
- Skill allowlist is empty: `allowedSkillsJson: '[]'`

**Acceptance:**
- [ ] Self-improvement LLM calls use cheap model, not frontier
- [ ] Logs show `taskKind: 'self_improvement'` + cheap model selection
- [ ] Cost per call is measurably lower (check OpenRouter billing or token counts)

---

## Loop 2: Gap Detection & Postgres Persistence (Issues #1113 + #1112)

**Goal:** Verify that capability gaps persist across server restarts and that gap-driven discovery schedules immediately.

### 2a. Capability gaps persist to Postgres (Postgres parity)

**Setup:**
```bash
# Start fresh sandbox with Postgres instead of SQLite
tools/dev/sandbox.sh down

# (Optional) Use a Docker Postgres for isolation:
docker run --rm -d \
  -e POSTGRES_PASSWORD=test123 \
  -p 5432:5432 \
  postgres:16

# Grab the DB URL
PG_URL="postgres://postgres:test123@localhost:5432/postgres"

# Launch api_server against Postgres
cd apps/api_server
DB_CLIENT=postgres \
DATABASE_URL="$PG_URL" \
AGENT_LOCAL=true \
npm run build && npm start &

sleep 5
curl http://localhost:4001/opencode/health
```

**Manually insert a capability gap:**

```bash
# Connect to Postgres via psql (or use the API if a route exists)
psql "$PG_URL" << 'EOF'
INSERT INTO agent_capability_gaps (
  agent_id,
  gap_kind,
  description,
  created_at
) VALUES (
  'test-agent',
  'gap-pco-api',
  'Need to query Planning Center Online schedules',
  NOW()
);
EOF

# Verify it was inserted
psql "$PG_URL" << 'EOF'
SELECT id, agent_id, gap_kind, description FROM agent_capability_gaps WHERE agent_id = 'test-agent';
EOF
```

**Kill and restart the server:**

```bash
pkill -f "npm start"  # Kill api_server

sleep 2

# Restart (same DB_URL)
cd apps/api_server
DB_CLIENT=postgres \
DATABASE_URL="$PG_URL" \
AGENT_LOCAL=true \
npm start &

sleep 5
```

**Verification:**

```bash
# Query Postgres again — gap should still be there
psql "$PG_URL" << 'EOF'
SELECT COUNT(*) FROM agent_capability_gaps WHERE gap_kind = 'gap-pco-api';
EOF
```

**Acceptance:**
- [ ] Gap persists in Postgres across server restart
- [ ] Row count is non-zero before and after restart
- [ ] SQLite fallback (pre-fix) would have lost the gap on restart (was in-memory :memory:)

---

### 2b. Gap-driven discovery schedules immediately (#1112)

**Setup:** Same Postgres setup as above.

**Session prompt to trigger gap insertion:**

```
Name: Gap detection trigger

Agent: claude-code
Prompt:

I need to integrate with our church's Planning Center Online system to pull the weekly schedule. 
Can you design a TypeScript wrapper for the PCO API? Start with:
1. Authentication flow (OAuth)
2. Fetching the Sunday schedule
3. Parsing the events
```

**Verification:**

Watch the api_server logs for gap-insertion + discovery scheduling:

```bash
tail -f /tmp/rhythm-dev-sandbox/api_server.log | grep -i "capability\|gap\|discovery"

# Expected sequence:
# [skill-extractor] Stage A step 3: new capability gap detected → gap_pco_api
# [gap-discovery-scheduler] NEW gap_pco_api → scheduleGapDrivenDiscovery()
# [external-discovery] Running debounced discovery for 1 gap(s)
# [external-discovery] Searching registry for gap_pco_api...
```

**Acceptance:**
- [ ] Session completes and detects a PCO API gap
- [ ] api_server logs show `scheduleGapDrivenDiscovery()` call within 5s
- [ ] Discovery runs *immediately*, not waiting for the next weekly cron
- [ ] Proposals appear in `/agent-org-proposals` within 10s

---

## Loop 3: MCP Server Discovery & Adoption (Issue #1114)

**Goal:** Verify the engine discovers, proposes, and auto-installs MCP servers to fill gaps.

### 3a. MCP discovery from registry

**Setup:**
```bash
# Point to a test MCP registry (you can use the real one or a stub)
export RHYTHM_MCP_REGISTRY_SEARCH_URL="https://registry.mcp.io/search"

# Or stub it locally with a tiny registry:
export RHYTHM_MCP_REGISTRY_SEARCH_URL="http://localhost:3333/search"

# If using stub, run this mock server in another terminal:
npx json-server --watch mcp-registry-stub.json --port 3333
```

**mcp-registry-stub.json** (minimal example):
```json
{
  "search": [
    {
      "name": "pco-mcp",
      "description": "Planning Center Online MCP connector",
      "maintainer": "rhythm-team",
      "license": "MIT",
      "install_command": "npm install @mcp/pco-connector",
      "verified": true
    }
  ]
}
```

**Trigger discovery:**
```bash
# Via API (if a route exists) or manually insert a gap:
curl -X POST http://localhost:4098/agent-org-optimizer/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(AGENT_LOCAL=true && echo 'bypass')" \
  -d '{"force": true}'

# Or wait for the next scheduled discovery pass (60s default)
```

**Verification:**

```bash
# Check proposals endpoint
curl http://localhost:4098/agent-org-proposals | jq '.proposals[] | select(.kind == "external-adoption")'

# Expected output:
# {
#   "id": "PROP-xxx",
#   "kind": "external-adoption",
#   "status": "proposed",
#   "targetMcpName": "pco-mcp",
#   "targetGapId": "gap-pco-api",
#   "riskLevel": "low",
#   ...
# }
```

**Acceptance:**
- [ ] Proposal appears with `kind: "external-adoption"`
- [ ] Proposal targets the correct gap (e.g., `gap_pco_api`)
- [ ] `riskLevel` is accurately classified (low/medium/high)

---

### 3b. MCP adoption (scoped install)

**Setup:** Same registry + proposal from 3a.

**Approve the MCP adoption proposal:**

```bash
# Get the proposal ID from the previous step
PROP_ID="PROP-xxx"

# Approve it
curl -X POST http://localhost:4098/agent-org-proposals/$PROP_ID/approve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(AGENT_LOCAL=true && echo 'bypass')" \
  -d '{}'
```

**Verification:**

```bash
# Check proposal status changed to 'applied'
curl http://localhost:4098/agent-org-proposals/$PROP_ID | jq '.status'
# Expected: "applied"

# Check the requesting agent's allowedMcpsJson was updated
curl http://localhost:4098/agent-configs/test-agent | jq '.allowedMcpsJson'
# Expected: {"pco-mcp": {...}}

# Verify OTHER agents' allowedMcpsJson was NOT modified (scoped, not global)
curl http://localhost:4098/agent-configs/other-agent | jq '.allowedMcpsJson'
# Expected: {} (unchanged)

# Check the originating gap was marked 'resolved'
curl http://localhost:4098/agent-capability-gaps?status=resolved | jq '.'
# Expected: the gap_pco_api is in the list with status='resolved'
```

**Acceptance:**
- [ ] Proposal transitions from `proposed` → `applied`
- [ ] Requesting agent's allowedMcpsJson includes the new MCP
- [ ] Other agents' allowedMcpsJson is untouched (scoped install works)
- [ ] Originating gap transitions to `resolved`
- [ ] Gap no longer triggers discovery on future runs

---

## Loop 4: Org Skill Library Publishing (Issue #1056)

**Goal:** Verify approved skills can be published to the org library.

### 4a. Publish an approved skill

**Setup:**
```bash
# Ensure /org-skills endpoint is running and reachable
curl http://localhost:4098/org-skills/index.json
# Expected: 200, empty index or existing published skills

# Create or find an approved (non-rejected) managed skill in the database
# (Assume one exists from prior harvest or manual creation)
```

**Session prompt to create a publishable skill:**

```
Name: Create a publishable skill

Agent: claude-code
Prompt:

Write a brief TypeScript utility for rate limiting. Include:
1. A simple token-bucket implementation
2. JSDoc comments
3. 2 unit tests

This will become a published skill for the org library.
```

**After the session, manually create or harvest a skill, then approve it:**

```bash
# Verify the skill appears in the managed skills
curl http://localhost:4098/agent-skills \
  -H "Authorization: Bearer ..." | jq '.[].name'

# Find a skill to publish, then create a publish proposal via the API or manually insert:
curl -X POST http://localhost:4098/agent-org-proposals \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "publish-skill",
    "status": "proposed",
    "targetSkillName": "rate-limiter",
    "riskLevel": "low"
  }'
```

**Approve the publish proposal:**

```bash
PROP_ID="PROP-publish-xxx"

curl -X POST http://localhost:4098/agent-org-proposals/$PROP_ID/approve \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Verification:**

```bash
# Check the skill now appears in the org-skills index
curl http://localhost:4098/org-skills/index.json | jq '.skills[] | select(.name == "rate-limiter")'

# Expected output:
# {
#   "name": "rate-limiter",
#   "source": "org",
#   "body": "...",
#   ...
# }

# Check the proposal transitioned to 'applied'
curl http://localhost:4098/agent-org-proposals/$PROP_ID | jq '.status'
# Expected: "applied"
```

**Acceptance:**
- [ ] Published skill appears in `/org-skills/index.json`
- [ ] Skill body (SKILL.md frontmatter + content) is intact
- [ ] Proposal status is `applied`
- [ ] Source badge shows "Org" in the UI

---

### 4b. Unpublish a skill

**Setup:** Skill already published from 4a.

**Create and approve an unpublish proposal:**

```bash
curl -X POST http://localhost:4098/agent-org-proposals \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "unpublish-skill",
    "status": "proposed",
    "targetSkillName": "rate-limiter",
    "riskLevel": "low"
  }'

PROP_ID="PROP-unpublish-xxx"

curl -X POST http://localhost:4098/agent-org-proposals/$PROP_ID/approve \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Verification:**

```bash
# Check the skill no longer appears in the org-skills index
curl http://localhost:4098/org-skills/index.json | jq '.skills[] | select(.name == "rate-limiter")'
# Expected: null (no match)

# Direct fetch of the skill should 404
curl http://localhost:4098/org-skills/rate-limiter/SKILL.md
# Expected: 404
```

**Acceptance:**
- [ ] Published skill removed from `/org-skills/index.json`
- [ ] Direct fetch returns 404
- [ ] Proposal status is `applied`

---

## Loop 5: Session Hygiene — Background Sessions Hidden (Issue #1090)

**Goal:** Verify that `self_improvement` and background sessions don't leak into the Chats list.

### 5a. Background session filtering on WS insert

**Setup:**
```bash
# Launch Flutter app pointing to sandbox
cd apps/desktop_flutter
RHYTHM_LOCAL_SMOKE=1 \
RHYTHM_API_BASE_URL=http://127.0.0.1:4098 \
flutter run -d macos
```

**Trigger a self_improvement session (via api_server log injection or harvest trigger):**

```bash
# Option 1: Manually insert a self_improvement session
psql "$PG_URL" << 'EOF'
INSERT INTO agent_sessions (
  id,
  agent_id,
  category,
  title,
  status,
  created_at
) VALUES (
  'bg-session-test',
  'test-agent',
  'self_improvement',
  'Harvest Eval',
  'running',
  NOW()
);
EOF

# Trigger a WebSocket insert event
curl -X POST http://localhost:4098/agent-sessions/bg-session-test/notify \
  -H "Content-Type: application/json" \
  -d '{"event": "created"}'
```

**Verification in Flutter UI:**

```
[ ] Navigate to Agents → Sessions
[ ] Do NOT see "Harvest Eval" or any session with category='self_improvement' in the list
[ ] The session list contains only user-initiated sessions (category='default' or other visible categories)
[ ] Server logs show the session was inserted but filtered on WS broadcast
```

**Acceptance:**
- [ ] Background sessions exist in the database
- [ ] They do NOT appear in the Chats/Sessions UI list
- [ ] WebSocket filtering logic is confirmed in api_server logs

---

## Loop 6: Org-Optimizer Reliability — Undici Timeout Fix (Issue #1115)

**Goal:** Verify that long-running synchronous org-optimizer passes don't timeout after 300s.

### 6a. Long-running optimizer with >300s execution

**Setup:**
```bash
# Simulate a long-running optimizer pass by seeding many capability gaps
psql "$PG_URL" << 'EOF'
INSERT INTO agent_capability_gaps (agent_id, gap_kind, description, created_at)
SELECT 'test-agent', 'gap-' || i, 'Gap ' || i, NOW()
FROM generate_series(1, 50) i;
EOF

# Ensure RHYTHM_ORG_OPTIMIZER_TIMEOUT is set to a value >300s (default is now higher)
export RHYTHM_ORG_OPTIMIZER_TIMEOUT=600000  # 10 minutes
```

**Trigger a long-running optimizer pass:**

```bash
# Time the request
time curl -X POST http://localhost:4098/agent-org-optimizer/run \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

**Verification:**

```bash
# Timing should complete without timeout
# Expected: 200 response + JSON result (not 502 "fetch failed")
# Duration should be >300s if many gaps are being searched

# Check api_server logs for undici configuration
grep -i "undici\|timeout\|dispatcher" /tmp/rhythm-dev-sandbox/api_server.log

# Expected: evidence of timeout being set to a high value
# Example: "Agent maxIdleTimeout: 600000ms"
```

**Acceptance:**
- [ ] Request completes even after 300s+ of execution
- [ ] Response is 200 (not 502 "fetch failed")
- [ ] api_server logs show undici timeout configuration
- [ ] Pre-fix behavior (300s timeout) is no longer present

---

## End-to-End Smoke (all loops combined)

**One integrated prompt that exercises multiple loops:**

```
Name: Self-improvement loop smoke test

Agent: claude-code

Prompt:

I need a complete email notification system. Build:

1. A TypeScript email validator (uses `emailjs` library)
2. A rate-limited sender that queues emails
3. Unit tests for both

Make this complete enough that the engine might want to adopt it as a published skill, 
and include notes on what external dependencies or capabilities would make it stronger.

---

Expected side effects:
- Session triggers skill extraction (once)
- Harvest runs use cheap models
- Engine detects a capability gap (e.g., "need email service provider integration")
- Gap discovery runs immediately, searches for an MCP server
- If an MCP exists, a proposal appears for adoption
- Human approves → MCP is scoped to your agent, gap marked resolved
- If the harvested skill is good, another proposal appears to publish it to org library
- When published, it appears in /org-skills/index.json with "Org" badge
- Throughout, no background sessions appear in your Chats list
```

**Full verification checklist:**
- [ ] Session completes 4+ turns without duplicate extraction
- [ ] api_server logs show exactly 1 harvest attempt
- [ ] Cheap model used for self_improvement tasks
- [ ] Capability gap detected and persisted to DB
- [ ] Gap survives a server restart (Postgres)
- [ ] Discovery scheduler triggers within 5s of gap insertion
- [ ] MCP proposals appear if registry has candidates
- [ ] Approved MCP installs scoped to requesting agent only
- [ ] Skill publish proposals appear for approved skills
- [ ] Published skills appear in `/org-skills` with "Org" badge
- [ ] No background sessions leak into Chats list
- [ ] Long optimizer runs complete without 502 timeout errors

---

## Quick Reference: Key Endpoints & Queries

| Task | Endpoint | Example |
|------|----------|---------|
| List capability gaps | `GET /agent-capability-gaps` | `curl http://localhost:4098/agent-capability-gaps` |
| List proposals | `GET /agent-org-proposals` | `curl http://localhost:4098/agent-org-proposals` |
| Approve proposal | `POST /agent-org-proposals/:id/approve` | `curl -X POST http://localhost:4098/agent-org-proposals/PROP-1/approve` |
| View org-skills index | `GET /org-skills/index.json` | `curl http://localhost:4098/org-skills/index.json` |
| Fetch org skill file | `GET /org-skills/:name/:file` | `curl http://localhost:4098/org-skills/rate-limiter/SKILL.md` |
| Run optimizer manually | `POST /agent-org-optimizer/run` | `curl -X POST http://localhost:4098/agent-org-optimizer/run` |
| Check health | `GET /opencode/health` | `curl http://localhost:4098/opencode/health` |

---

## Debugging

### Logs to watch
```bash
# api_server (main loop, proposals, discovery scheduling)
tail -f /tmp/rhythm-dev-sandbox/api_server.log

# Fork engine (harvest evaluation, gap detection)
RHYTHM_OPENCODE_BIN_DIR=... npm start 2>&1 | grep -i "skill\|gap\|harvest"

# Postgres (data persistence, queries)
psql "$PG_URL" -c "SELECT * FROM agent_capability_gaps;"
psql "$PG_URL" -c "SELECT * FROM agent_org_proposals;"
```

### Common issues
| Issue | Check | Fix |
|-------|-------|-----|
| Gap not persisting across restart | `agent_capability_gaps` table exists in Postgres | Run `npm run migrate` if missing |
| MCP discovery not running | `RHYTHM_MCP_REGISTRY_SEARCH_URL` env var set | Export URL; restart server |
| Org-skills returning 404 | `/org-skills` route mounted | Confirm route exists in routes/org-skills.ts |
| Optimizer timeout 502 | Undici dispatcher timeout config | Ensure `RHYTHM_ORG_OPTIMIZER_TIMEOUT` > request duration |
| Background sessions visible in UI | WS session filtering logic | Confirm `category !== 'self_improvement'` guard in bridge |

