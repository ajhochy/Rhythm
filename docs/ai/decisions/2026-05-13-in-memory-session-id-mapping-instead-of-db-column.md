---
date: 2026-05-13
repo: rhythm
tags: [decision, rhythm]
---

# In-memory session ID mapping instead of DB column

**Context:** The WS gateway needs to route user input from a local session ID to the correct Opencode SDK session.

**Decision:** Use an in-memory `Map<string, string>` (`opencodeSessionMap`) rather than adding a migration to store SDK session IDs in SQLite.

**Consequences:**
- + No database migration needed
- + Ephemeral (matches session lifecycle — sessions don't persist across server restarts)
- - Mapping is lost on server restart (acceptable — SDK sessions wouldn't survive a restart either)
- - Map entries must be explicitly deleted on session close to avoid unbounded growth (fixed in code review: `opencodeSessionMap.delete` now called in `remove()`)
