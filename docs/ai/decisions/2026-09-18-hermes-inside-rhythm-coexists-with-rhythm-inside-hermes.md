---
tags: [decision, rhythm]
---

# Hermes inside Rhythm coexists with Rhythm inside Hermes

## Context

The Hermes campaign has two deliberate host directions. B1 packages Rhythm's approved non-agent workspace and bounded tools inside Hermes. B3 embeds the supervised Hermes dashboard inside Rhythm Electron. They share security and UI assets, but neither direction proves that one host can replace the other.

## Decision

Support both directions in parallel. Keep the unified Rhythm feature pack for Hermes and the isolated Hermes dashboard tab for Rhythm Electron. Neither direction authorizes a host cutover, OpenCode retirement, or a change to Rhythm's default agent engine.

Keep credentials backend- or main-process-owned. The Hermes tab loads the supervised loopback dashboard through its native token bootstrap and exposes only the bounded `navigate-session` and `new-chat` intents. The Rhythm feature pack talks only to the pinned hosted Rhythm origin and uses Hermes approval policy for its three native tools.

## Alternatives

- Pick one direction and remove the other: rejected because the two integrations serve different host contexts and their release evidence is incomplete.
- Treat the Hermes tab as an engine replacement: rejected because the campaign does not qualify provider parity, session migration, signed packaging, or fallback removal.
- Bridge credentials or arbitrary messages through the renderer: rejected because it would broaden the trust boundary and violate the campaign's secret-isolation contract.

## Consequences

Both hosts remain independently usable. The shared workspace package and semantic operations can be reused without coupling lifecycle or credentials. Release claims must continue to name the qualified direction and gate: fork install/live evidence for Rhythm inside Hermes, and Electron sidecar/view/package evidence for Hermes inside Rhythm.

OpenCode remains the default engine, Flutter remains the shipping client until its replacement gates pass, and any later cutover requires a separate decision.
