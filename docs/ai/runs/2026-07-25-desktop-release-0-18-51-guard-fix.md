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

## Follow-up

- PR #1180 merged as `6fcabbcc`.
- Rerun `30174560655` then failed in Build CLI server because `skill_schema_parity.test.ts` still asserted the removed direct-call workflow literals.
- Commit `7927da098` aligns the parity test with the helper contract and three labeled CommonJS-safe guards while preserving the UUID and seven-tool checks.
- Independent verification: **PASS** — exact CI test (8/8), API build, actionlint, sandbox smoke, and diff scope limited to one test file.
- `v0.18.51` is still not created. Next: merge the follow-up and rerun the release workflow.
