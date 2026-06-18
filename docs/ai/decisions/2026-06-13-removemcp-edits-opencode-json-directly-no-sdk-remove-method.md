---
date: 2026-06-13
repo: rhythm
tags: [decision, rhythm]
---

# removeMcp edits opencode.json directly (no SDK remove method) (#702)

**Context:** The opencode SDK v1.14.49 `Mcp` class has `status`, `add`, `connect`, `disconnect` but NO `remove`/`delete` method.

**Decision:** `removeMcp(name)` in `opencode_client_service.ts` implements removal as: (1) disconnect best-effort (swallows errors), (2) reads `~/.config/opencode/opencode.json`, removes the `mcp[name]` key, writes back. Uses Node `fs` (sync reads, atomic write).

**Alternatives considered:**
- Expose a "disable" flag: SDK `McpLocalConfigInput` has `enabled?: boolean`. Setting `enabled:false` via `addMcp` would hide the server but leave it in config. Rejected — users expect "Remove" to actually remove.
- Wait for SDK to add remove: Out of scope for this milestone.

**Consequences:** Fragile if opencode changes its config file location or format. The config path `~/.config/opencode/opencode.json` is a known opencode convention but not a public contract. If opencode v2 changes this, `removeMcp` will silently fail to clean up config (the disconnect still works). Track as a follow-up when SDK adds a native remove API.
