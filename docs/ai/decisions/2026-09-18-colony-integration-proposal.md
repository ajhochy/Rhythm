---
date: 2026-09-18
status: proposed
tags: [decision, rhythm]
---

# Proposed Colony integration boundary

AJ requested a packaged, opt-in Colony tab for all Rhythm desktop users on Apple Silicon and
Intel, with a UI/menu design pass matching Rhythm Electron. The proposal keeps the existing
3D world and read-only harness adapters, adds Rhythm React controls, serves bundled scene assets
from an isolated app origin, and uses a separately owned Node 22 scanner through a bounded
private bridge. No localhost Colony service or source checkout is required by the package.

This is a proposed implementation decision, not a claim of shipped architecture. The first
contract slice must prove compatibility with the pinned Electron runtime. Rejected alternatives
for the packaged target are a permanent dependency on the user's standalone localhost server,
a full rewrite of the simulation, and renderer access to generic filesystem/shell APIs.

Source adoption, profile state/import, native design, two-architecture signed packaging,
installed acceptance and rollback are separate work units. Existing Electron host release and
Flutter retirement gates remain independent. See [the complete plan](../plans/2026-09-18-electron-colony.md).
