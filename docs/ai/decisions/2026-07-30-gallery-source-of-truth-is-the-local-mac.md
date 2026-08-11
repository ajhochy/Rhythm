---
date: 2026-07-30
tags: [decision, Rhythm]
---

> **Superseded by #1309:** generated image and video bytes now have a durable,
> checksum-addressed media artifact store for authenticated desktop and mobile access.

# Gallery source of truth is the local Mac, not Rhythm Cloud

## Context

The MSP-006 Tools inventory (`docs/ai/mobile-tools-project-scope-inventory.md`)
surfaced a genuine divergence rather than a bug: the Gallery tab reads from two
different data sources depending on client.

- Desktop reads designs from the **local** agent API (`GET /agent-designs`).
- Mobile reads designs from **Rhythm Cloud** —
  `rhythm-tools-service.ts:949` calls `cloudRequest('/agent-designs')`.

There is currently **no** `/mobile-gateway/tools/agent-designs` route on the
local gateway, so mobile has no paired path to the local data even in principle.

Because the two clients read different stores, they can legitimately disagree,
and no amount of project-scope work (MSP-006) reconciles them. Email is also
cloud-on-both-sides, which is consistent and therefore fine.

## Decision

**The local Mac is the source of truth for Gallery.** The artifacts that the
gallery entries link to live on the Mac's filesystem, so the machine holding the
artifacts owns the index that points at them. Mobile must read Gallery through
the paired gateway, not through the cloud.

## Consequences

1. Needs a new scoped gateway route (`/mobile-gateway/tools/agent-designs`) plus
   an entry in the 4002 surface allowlist, following the ownership/scope pattern
   every other paired Tools row already uses.
2. Mobile switches that one screen from `cloudRequest` to the scoped paired
   request, inheriting MSP-006's `X-Rhythm-Project-ID` threading, shape
   normalization, and failure-state classification for free.
3. **The non-trivial part: artifact bytes.** Listing designs is metadata; the
   gallery also renders the artifacts themselves. Local file paths are not
   reachable from a phone, so serving/streaming artifact content through the
   paired gateway is required. That decision interacts directly with the
   Cloudflare routing work — any artifact endpoint becomes part of the remotely
   exposed surface and must stay behind the Device credential, be
   project-scoped, and refuse path traversal outside the registered project
   root.
4. Offline/degraded behavior changes for this screen: with the Mac asleep,
   Gallery becomes unavailable rather than cloud-served. That is the correct
   trade for correctness, and it should render as "paired Mac offline" (the
   existing classifier state), never as an empty gallery.
5. Cloud `/agent-designs` is not deleted by this decision; it stops being what
   mobile reads. Whether it remains a mirror or is retired is a separate call.

## Alternatives rejected

- **Make cloud authoritative and sync artifacts up.** Rejected: it uploads
  potentially large local artifacts to production for a read-only view, and the
  artifacts' home is the Mac by design.
- **Leave the divergence and document it.** Rejected: two stores behind one tab
  guarantees the phone and desktop eventually disagree with no way for a user to
  tell which is right.
- **Fold this into MSP-006 (#1262).** Rejected: that lane is finished and CI
  green; artifact streaming is materially new work with a security surface of
  its own. Tracked separately.
