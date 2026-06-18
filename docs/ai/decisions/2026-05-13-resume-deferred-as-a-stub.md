---
date: 2026-05-13
repo: rhythm
tags: [decision, rhythm]
---

# `resume()` deferred as a stub

**Context:** The old PTY path had `ptyRunner.resume()` that reconnected a subprocess to an existing session token. The Opencode SDK has no "resume" concept — sessions are stateless from the SDK's perspective.

**Decision:** `resume()` currently validates the session and sets status to `starting`, but does not create an SDK session or start the stream bridge. This is a known gap.

**Next step:** Implement resume as "create a new SDK session with the same cwd/name and start streaming." Filed as a follow-up task.
