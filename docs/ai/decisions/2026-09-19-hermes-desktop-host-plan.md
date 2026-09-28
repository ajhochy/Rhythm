---
date: 2026-09-19
status: proposed
repo: Rhythm
tags: [decision, Rhythm]
---

# Proposed Hermes Desktop host boundary

## Context

The mega branch implemented the Hermes web dashboard. The user corrected the requirement to Hermes Desktop and requested a replacement plan. Existing Desktop code owns a full Electron application and expects its native preload API. A dashboard health check does not prove the intended app.

## Decision proposed

Reuse the actual Hermes Desktop renderer and native service implementations from an immutable Hermes fork revision. Extract an explicit embedded-host entry; let Rhythm own application lifecycle and the containing WebContentsView. First prove a local signed Desktop chat/history/draft flow, then qualify the complete feature inventory and packaging. This is a proposed architecture; no implementation was performed.

## Alternatives

- Changing the dashboard URL/CLI command: still fails the Desktop requirement.
- Importing the complete Hermes main entry: conflicts with app/window/IPC/update ownership.
- Launching a separate Hermes app: does not meet the requested in-tab experience.
- Reimplementing the Desktop UI in Rhythm: duplicates and diverges from the requested app.

## Consequences

Work spans both draft PRs, includes native-service extraction and an Electron-version compatibility gate, and preserves current login/runtime repairs. Python distribution remains a separate unresolved qualification gate. See [full plan](../plans/2026-09-19-hermes-desktop-in-rhythm.md).
