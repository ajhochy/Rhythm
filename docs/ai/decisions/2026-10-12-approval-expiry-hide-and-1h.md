---
date: 2026-10-12
repo: Rhythm
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

## Context
External-content approval cards expired after 10 minutes but stayed in the queue; Approve then 403'd with a
generic access-denied message. Expiry exists because a late approval once started a coding run 51 minutes after the
request (b31c60b3).

## Decision
Keep expiry, hide expired cards from the pending queue, and widen the window to 1 hour (AJ chose this, 2026-10-12).

## Alternatives considered
- Never expire — rejected: a card approved days later still fires a stale side effect (email, coding run).
- Hide only, keep 10 min — rejected: too short for a human to see and act on a notification.

## Consequences
An agent whose card expired must ask again; history (`status=all`) still shows expired cards.
