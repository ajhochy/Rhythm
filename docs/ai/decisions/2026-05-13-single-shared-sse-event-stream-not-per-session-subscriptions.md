---
date: 2026-05-13
repo: rhythm
tags: [decision, rhythm]
---

# Single shared SSE event stream, not per-session subscriptions

**Context:** Opencode SDK provides one event stream for the entire client, not per-session streams.

**Decision:** `OpencodeStreamBridge` subscribes once on first session creation and keeps the stream alive for all sessions. Session routing uses `opencodeSessionMap` reverse-lookup (O(n) scan per event).

**Consequences:**
- + One connection instead of N connections for N sessions
- - If the stream dies and re-subscribes, a short window exists where two `streamSession` callers could both attempt subscription. Guarded by the `subscribed` flag (set before the await), but not tested.
- - If `subscribeToEvents()` returns null (SDK not ready), `subscribed` must be reset to `false` to allow retry (fixed in code review).
