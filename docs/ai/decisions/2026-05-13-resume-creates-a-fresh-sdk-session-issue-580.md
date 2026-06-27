---
index: "[[Rhythm]]"
date: 2026-05-13
repo: rhythm
tags: [decision, rhythm]
---

# `resume()` creates a fresh SDK session (issue #580)

**Context:** Follow-up to the stub above. Users need a working "resume" action even though the SDK is stateless.

**Decision:** `AgentSessionsController.resume()` now mirrors `create()` — it calls `opencodeClient.createSession(name, cwd)`, registers the local→SDK mapping in `opencodeSessionMap`, starts the SSE stream bridge, and transitions status to `starting`. Prior SDK conversation history is NOT reattached; resumed sessions begin clean.

**Consequences:**
- + Resume now produces a working agent session instead of a hanging "starting" status.
- - Conversation history from the previous SDK session is lost (acceptable per #580 scope; revisit if users need cross-session continuity).
- Landed on branch `opencode-engine-issue-564`, pending merge.
