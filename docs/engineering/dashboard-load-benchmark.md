# Dashboard Load Benchmark — Performance Validation

## Background

Issues #285–#288 addressed a fan-out problem on the dashboard load path:
the Flutter client was making 5+ serial HTTP requests to assemble the
dashboard view.  This document records the before/after request pattern
and explains how to reproduce the timing check on the hosted server.

---

## Before (prior to this milestone)

| # | Request | Trigger |
|---|---------|---------|
| 1 | `GET /tasks` | DashboardController.load |
| 2 | `GET /recurring-rules` | DashboardController.load |
| 3 | `GET /project-templates` | DashboardController.load |
| 4 | `GET /project-instances` | DashboardController.load |
| 5 | `GET /message-threads` | DashboardController.load |
| 6–8 | `GET /message-threads/:id/messages` (×N unread threads) | DashboardRepository.getUnreadMessagePreviews |

**Total requests per dashboard open: 5 + N** (N = number of unread
threads, up to 3 additional calls in the common case → **6–8 round
trips**).

Each call returned the full entity list.  The Flutter client then
filtered/sorted client-side to produce counts, "due this week" lists,
rhythm progress, project progress, and message previews.

Additionally, `GET /tasks` was making one SQL query per task to fetch
collaborators (N+1 issue fixed in #285).

---

## After (issues #285–#288)

| # | Request | Notes |
|---|---------|-------|
| 1 | `GET /dashboard/summary` | Single aggregated call |

**Total requests per dashboard open: 1.**

The new `GET /dashboard/summary` endpoint (`DashboardSummaryService`)
runs all queries in parallel (`Promise.all`) server-side and returns a
single JSON payload with pre-computed counts, filtered task lists, rhythm
progress, project progress, and up to 3 unread message previews.

Collaborators are now batch-fetched with a single `IN (...)` query for
the full task list (#285), eliminating the N+1.

---

## How to Measure

### Prerequisites

- Flutter app running against the hosted server (`https://api.vcrcapps.com`)
  or a local `apps/api_server` instance
- Charles Proxy, Proxyman, or macOS Network Link Conditioner for timing

### Steps

1. Open Proxyman (or equivalent) and start a capture session.
2. Launch the Rhythm desktop app and log in.
3. Navigate to the Dashboard tab.
4. In the capture, filter to the API host and inspect:
   - Number of requests fired after the Dashboard tab becomes visible
   - Wall-clock time from first request sent to last response received

### Expected result (after this milestone)

- Exactly **1** request to `/dashboard/summary` on load.
- No follow-up requests to `/tasks`, `/recurring-rules`,
  `/project-templates`, `/project-instances`, or `/message-threads`.

### Before/after summary (measured on hosted server, 2026-04-28)

| Metric | Before | After |
|--------|--------|-------|
| HTTP round trips | 6–8 | 1 |
| SQL queries per load (tasks) | N+1 (one per task for collaborators) | 2 (tasks + batch collaborators) |
| Client-side date filtering | Yes (Flutter) | No (server-side) |

Exact wall-clock numbers depend on network conditions; the request-count
reduction is the deterministic improvement.

---

## Residual Hotspots / Known Follow-ups

1. **`GET /tasks` outside Dashboard** — The Tasks view still calls
   `GET /tasks` directly.  That path now returns inline collaborators
   (batched), but the full task list is still fetched on every load.
   A pagination or incremental-sync approach would further reduce payload
   size as the task count grows.

2. **Message thread preview depth** — The summary endpoint fetches the
   last message for up to 3 unread threads sequentially (not parallel)
   to avoid overwhelming the DB.  At scale, a single denormalized
   `last_message` column on `message_threads` would be cleaner.

3. **Project instances** — `GET /project-instances` is still called
   separately by the Projects view.  A `/projects/summary` endpoint
   mirroring the dashboard pattern could help if project counts grow.

---

## Related Issues

- #285 — Batch-fetch collaborators on task list (N+1 fix)
- #286 — Surface inline collaborator data in dashboard tile badge
- #287 — Add `GET /dashboard/summary` aggregation endpoint (API)
- #288 — Migrate Flutter DashboardController to use summary endpoint
- #289 — This document
