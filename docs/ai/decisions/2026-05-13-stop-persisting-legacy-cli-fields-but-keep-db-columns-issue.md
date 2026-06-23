---
index: "[[Rhythm]]"
date: 2026-05-13
repo: rhythm
tags: [decision, rhythm]
---

# Stop persisting legacy CLI fields but keep DB columns (issue #581)

**Context:** Issue #575 removed CLI-era fields from the Flutter `AgentConfig` model. The api_server repository was still reading/writing `command`, `canResume`, `resumeCommand`, `sessionIdPattern`, `outputMarker` on every insert and select.

**Decision:** `agent_configs_repository` no longer persists or returns these five fields. The SQLite columns are retained (no DROP) so a rollback to the prior client build can still read its own data.

**Consequences:**
- + API responses are clean; no legacy fields echoed back to the client.
- + Rollback to a prior client build remains possible without a schema migration.
- - Controller-side input validation still requires `command` and validates `resumeCommand`/`canResume` — tracked as a Known Gap; follow-up needed if the client ever POSTs without them.
