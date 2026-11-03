---
date: 2026-10-22
tags: [decision, rhythm]
---
# Real-cloud web verification may create and delete marked test records

## Context
The Tailscale web app forwards cloud-backed pages (tasks, planner, dashboard, ...) through `/cloud/*` to the production API that church staff use. Synthetic tests prove the forwarder; proving the confirmed-working cloud features on the web needs the real account.

## Decision
AJ (2026-10-22): real-cloud Playwright checks may create and then delete clearly marked test records. Required safeguards:
- every created record carries a unique per-run marker, e.g. `[rhythm-web-e2e <run-id>]`;
- records are assigned/visible only to AJ; no messages, notifications or shares to other staff;
- teardown deletes only the ids the run created and reads back to prove deletion;
- a cleanup failure stops the run and lists every leftover id.

## Alternatives
Read-only checks (rejected by AJ: cannot prove create/edit/complete/delete parity).

## Consequences
Cloud write specs must record created ids and run teardown in `afterEach`/`afterAll` even on failure. Never run them against another staff member's account.
