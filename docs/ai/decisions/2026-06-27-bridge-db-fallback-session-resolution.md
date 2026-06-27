---
date: 2026-06-27
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Bridge resolves engine events via durable sdk_session_id, not just the in-memory map

## Context
`OpencodeStreamBridge` mapped engine SSE events to a local session purely
through the ephemeral in-memory `opencodeSessionMap` (sdkId → localId reverse
lookup). That map is wiped on api_server restart and is not populated on every
session lifecycle path, so a miss silently dropped *all* events for a session
(issue #751: stuck on "Starting", 0 messages, no child sessions).

## Decision
Treat `agent_sessions.sdk_session_id` (persisted at create/resume) as the
durable source of truth. When the in-memory reverse-lookup misses, the bridge
falls back to `findBySdkSessionId` and lazily repopulates the map. The map
remains a fast in-memory cache, no longer the sole resolver.

## Alternatives considered
- **Re-order/guarantee map registration before events stream.** Fixes the
  freshly-created race but not the restart-wipe or other unpopulated paths; the
  map stays inherently fragile.
- **Persist the whole map / rebuild it on boot.** More moving parts; the DB
  column already is the durable record — query it on demand.
- **Watchdog that reconciles stale `starting` rows.** Treats the symptom, not
  the dropped-event cause.

## Consequences
- Engine events resolve as long as the session row has its `sdk_session_id`,
  surviving restarts and registration gaps. (+)
- One indexed DB lookup per genuinely-unmapped event; benign background
  sessions with no DB row fall through to the generic broadcast as before. (−,
  negligible at this scale)
- Note: opencode delivers session events only to the **in-process /
  engine-spawning** subscriber — external attach clients see only
  `server.connected`. Diagnose event flow with an in-process bridge, not a
  foreign `event.subscribe`/`curl /event` probe.
