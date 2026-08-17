---
date: 2026-08-12
repo: Rhythm
tags: [decision, Rhythm]
---

# Native Cloud Gateway PTY uplink

## Context

The mobile Terminal still selected a stored direct `.ts.net` origin, while the
native Cloud Gateway HTTP surface explicitly rejected PTY upgrades. Terminal
therefore bypassed the relay or failed when the direct network was unavailable.

## Decision

Carry each phone PTY WebSocket over the Mac's existing authenticated relay
uplink as scoped `pty/open`, `pty/opened`, `pty/data`, and `pty/close` frames.
The relay authenticates the phone's device token and user before asking the Mac
to open its existing project-scoped mobile-gateway PTY endpoint. Individual PTY
failures close only that terminal and do not tear down the shared uplink.

## Alternatives

- A second dedicated Mac-to-relay WebSocket would duplicate authentication,
  reconnection, and online-presence lifecycle.
- Continuing the direct-address fallback would preserve the migration gap and
  fail whenever that private network was unavailable.

## Consequences

- Terminal now uses the same configured Cloud Gateway base as other paired
  features and preserves device auth, project scope, ticket, and cursor.
- Payloads are base64-framed over the JSON uplink, adding wire overhead.
- Connection count, frame size, buffered bytes, and open time are bounded.
- The deployed Cloudflare WebSocket route and sustained physical-phone session
  still require manual smoke testing before release.
