---
date: 2026-05-13
repo: rhythm
tags: [decision, rhythm]
---

# Fresh sessions, no migration

**Context:** Existing agent sessions were stored in local SQLite with PTY output.

**Decision:** Start fresh. Old sessions are orphaned but not migrated. Opencode SDK handles session persistence going forward.
