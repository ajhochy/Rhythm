---
date: 2026-07-28
repo: rhythm
branch: codex/mobile-1172-agents-activity
pr: 1165
issues: [1227]
status: passed
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Issue #1227 — guided creative dependency setup

## Files

- Replaced the incomplete offline-bundle gate with disclosed, deterministic setup plans.
- Bound install, repair, and uninstall approvals to the exact plan digest.
- Added hash-locked wheel-only Python resolution/install and integrity-locked, script-free npm cache/install.
- Added structured progress, verification, durable dependency/license/source receipts, and managed-root-only removal.
- Updated the existing MCP tool and Rhythm Setup prompt without adding an MCP tool.

## Checks

- `cd apps/api_server && npx vitest run src/contract/issue_1227_creative_installer_hermetic.test.ts --no-file-parallelism` — PASS, 6/6.
- Focused API service/seed/migration tests — PASS, 26/26.
- Focused real HTTP route test — PASS, 1/1.
- `cd apps/api_server && npx tsc -p tsconfig.json --noEmit` — PASS.
- Focused MCP registration/tool tests — PASS, 4/4.
- `cd apps/mcp_server && npm run typecheck` — PASS.
- `python3 scripts/run_ai_workflow.py checks --level pr` — PASS across
  Flutter, API, MCP, OpenCode fork, and mobile gates.
- Built the vendored OpenCode fork with `bun run build --single` — PASS;
  binary version smoke passed.
- Built the API with `npm run build` — PASS.
- Isolated sandbox on test-only ports 5797/5798 — API health `ok`, OpenCode
  health `ready`, and all seven setup plans returned through the real API.
- Gated sandbox behavior (`RHYTHM_LIVE_E2E=1`) — PASS, 1/1 live assertion
  with 2 intentionally skipped download-heavy cases.
- Shared live issue checks: #1228 delegation ownership PASS, 1/1; #1230
  immutable Cloud/local identity binding PASS, 1/1.
- Sandbox shutdown verification — PASS; both test listeners were released and
  the throwaway approval capability was deleted.

## Notes

- GitNexus impact/detect tooling was unavailable in this worktree. Bounded direct caller inspection covered the capability list, installer, creative API route, existing MCP tool, Setup seed, and focused tests; this is not recorded as a GitNexus pass.
- No caller-controlled command, path, registry, URL, checksum, or destination was added.
- Model installation retains a separate Stability AI license acknowledgement.
- Independent review found and repaired an approval-binding gap: the disclosed
  plan and installer now share one direct-artifact recipe table, including
  exact URLs and SHA-256 pins in the plan digest. The disclosure also corrects
  Blender to GPL-2.0-or-later.
- The first #1230 live attempt returned 403 because the sandbox hash included a
  generated capability file's trailing newline while the test header did not.
  Failure triage isolated the mismatch to test setup, normalized the throwaway
  value before hashing, and the unchanged product/test code passed on rerun.
  No follow-up issue was required.
- GitNexus remained unavailable after tool discovery; this run does not claim
  a graph-analysis pass. Full PR checks, direct caller inspection, diff review,
  stale-copy search, and `git diff --check` were used as documented fallbacks.
