---
date: 2026-09-24
status: constrained
tags: [decision, rhythm, issue-1177, remote-access, security]
---

# OCU-35B remote-access trust boundary

## Context

AJ's two accepted use cases are Cloudflare-relayed mobile access (#1373) and
secondary-desktop continuation (#1374). The existing relay is a Rhythm-owned
control plane; it is not an adoption of experimental OpenCode workspaces.

## Decision

Use the NAS relay only as an authenticated, fail-closed broker and bounded
mirror. The Mac remains the worker and repeats project/session authorization.
The architecture section in `docs/ai/architecture.md` is the shared boundary
for both child issues.

## Current limits and open decisions

1. The relay serves exactly one `(host,user)` enrollment. AJ must decide
   whether the intended product remains single-household/single-worker or needs
   a tenant-scoped enrollment inventory before expanding access.
2. First enrollment on a fresh relay database is currently impossible: the
   production hello gate requires the sole enrollment before it accepts the
   Mac, while device rows replicate only after that hello. AJ must choose a
   separately authenticated bootstrap ceremony or a reviewed administrative
   provisioning path; weakening hello validation is not acceptable.

#1374 also needs an explicit default-off kill switch before implementation.
No flag name is invented here because there is no secondary-desktop runtime to
gate yet.

## Consequences

#1373 cannot claim a fresh-install pairing flow until bootstrap is resolved.
#1374 cannot reuse device or project authority implicitly and remains unbuilt.
Local execution stays unchanged and default; disabling either remote path must
not delete local session or pairing data.
