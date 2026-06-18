---
date: 2026-05-13
repo: rhythm
tags: [decision, rhythm]
---

# All WS input goes through the prompt method

**Context:** The old PTY approach sent raw terminal input via `ptyRunner.sendInput()`. The SDK doesn't have a terminal input channel.

**Decision:** Forward WS `session.input` messages to `opencodeClient.prompt()`. Terminal resize messages are no-ops.

**Consequences:**
- + Clean structured communication instead of raw terminal bytes
- - Real-time streaming depends on SSE events, not synchronous return values
