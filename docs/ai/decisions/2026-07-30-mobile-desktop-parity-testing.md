---
date: 2026-07-30
repo: Rhythm
tags: [decision, Rhythm]
---

# Mobile ↔ Desktop parity testing strategy (T0–T3)

## Context

MSP-001…007 exposed a recurring failure class: the mobile app and the desktop
client disagree about the same underlying data (sessions with no transcripts,
Tools tabs loading the wrong project's records, #1271's two-different-stores
Gallery split). We asked: should an agent drive a simulator or a Playwright
browser against the live server and compare the two UIs?

A design workflow plus hostile review concluded: **UI-driving is the wrong
primary tool for a data question.** The mobile and web bundles share the same
TypeScript service layer, so a browser is a valid oracle for *which server was
asked and what came back* — but a JSON diff of the two transport paths is a
strictly stronger, faster, flake-free assertion for "same records?". The
simulator earns its keep only for native behavior (keyboard, scroll insets,
Dynamic Type, VoiceOver), and a physical phone is irreplaceable for Keychain,
push, Tailscale transport, and release-variant builds — MSP-005 shipped
through exactly that last gap.

## Decision — four tiers, each gating a different promise

- **T0 (every PR, blocking):** existing `verify:foundation` — lint, types,
  node suites, Playwright web specs against the fake server. Proves shared
  logic and web rendering didn't regress.
- **T1 (every PR, blocking): `tools/dev/parity-gate.sh` — THIS deliverable.**
  Boots a disposable sandbox (API + engine + mobile gateway on private ports
  4098/4097/4099), pairs a throwaway device through the real pairing
  handshake, then runs `msp-006-live-parity.test.mjs`: all Tools payloads
  fetched via the phone path (Device token + project header against the
  hardened gateway listener) must equal the desktop path byte-for-byte after
  normalizing volatile/sensitive keys. Catches the #1271 class directly.
- **T2 (nightly + required for native-touching diffs):** simulator dev-client
  build pointed at the sandbox gateway; a handful of snapshot assertions
  (composer/keyboard, scroll insets, Dynamic Type, VoiceOver labels). A native
  fix may NOT be called verified on T0/T1 evidence alone.
- **T3 (release candidate, human):** TestFlight on a physical iPhone — QR
  pairing, Face ID/Keychain, push, Tailscale reachability, production-variant
  guards.

Flutter desktop UI automation: none, deliberately. The desktop's local API is
read directly as the parity source; add a rendering harness only when a
desktop rendering bug actually ships.

## Security preconditions (issue #1273) — folded into this change

`sandbox.sh` previously left the mobile gateway on its default port 4002 —
the port `tailscale serve` publishes to the tailnet — while serving a fully
credentialed copy of the live DB. Fixed here: the sandbox now assigns its own
gateway port (default 4099), validates it, refuses to start when it's taken,
and preserves the startup log past teardown so bind failures are diagnosable.
The engine directory is overridable (`RHYTHM_SANDBOX_ENGINE_DIR`) so harnesses
reuse an already-built fork binary instead of a ~10-minute rebuild.

## Alternatives rejected

- **Agent drives two UIs and compares screenshots:** 100× the cost of a JSON
  diff for a weaker assertion; screenshot noise; still blind to which store
  the data came from.
- **Playwright straight at the live desktop server:** the hardened phone
  gateway has no browser CORS surface by design; would need a local proxy and
  would still touch real data. The sandbox + fake-cloud pattern keeps shipped
  auth code unmodified while never exposing real credentials.

## Consequences

- "Does the phone show the same data as the desktop?" is now a one-command,
  seconds-fast, evidence-producing gate (`.agent-stack/evidence/t1-parity-gate/`).
- T2 exists as a designed-but-not-built tier; build it after T1 stays green
  while an iPhone-only bug ships (est. 3–4 days, mostly build/boot flake).
- Pairing bootstrap requires no security changes: the harness holds a one-run
  capability secret hashed into `HUMAN_APPROVAL_CAPABILITY_SHA256` and a
  one-run bearer resolved by a local fake-cloud `/auth/me` stand-in.
