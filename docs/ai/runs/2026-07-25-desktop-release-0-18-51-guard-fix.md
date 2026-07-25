---
date: 2026-07-25
repo: Rhythm
branch: fix/release-0.18.51-mcp-guard
pr: null
issues: []
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

## Files changed

- `.github/workflows/desktop_release.yml` in commits `68e47875a` and `7248b6918`: syntax-tolerant, labeled bundled-MCP assertions.

## Checks run

- Independent verification: **PASS** — actionlint, MCP build, exact stage/install, three registrations, seven required names, dynamic 81-tool listing, negative labeled-error helper test, and GitNexus with no affected symbols or processes.

## Notes

- Desktop Release run `30171540897` failed bundled-MCP payload verification because three grep patterns expected direct calls, while CommonJS emitted `(0, module.registerX)(server, ...)`.
- The payload was healthy: 81 tools, including all seven required new names.
- The original `v0.18.51` release was not created. Rerun only after the hotfix merges to `main`.
