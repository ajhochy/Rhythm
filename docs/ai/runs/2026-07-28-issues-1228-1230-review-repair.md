---
date: 2026-07-28
repo: rhythm
branch: codex/mobile-1172-agents-activity
pr: 1165
issues: [1228, 1229, 1230]
status: passed
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Issues #1228–#1230 — review repairs

## Files changed

- Enforced authenticated ownership before synchronous or asynchronous agent
  delegation can create child work.
- Hardened memory-vault writes against symlink traversal and parent-directory
  replacement during atomic promotion.
- Bound Cloud-authenticated mobile users to immutable local Google subjects
  instead of trusting colliding numeric identifiers.
- Added executable acceptance contracts, focused regressions, and isolated
  live tests for delegation ownership and Cloud/local identity binding.

## Checks run

- All three executable acceptance contracts — PASS.
- Focused delegation, memory-vault, repository, Cloud identity, and mobile
  gateway suites — PASS.
- API TypeScript and full serial Vitest suite — PASS.
- `python3 scripts/run_ai_workflow.py checks --level pr` — PASS across all
  configured desktop, API, MCP, fork, and mobile gates.
- Isolated real API/OpenCode sandbox health — PASS.
- #1228 live cross-user delegation rejection — PASS, 1/1.
- #1230 live numeric-collision pairing resolves the Google-subject-bound local
  user — PASS, 1/1.
- `git diff --check` — PASS.

## Notes

- The first #1230 live attempt returned 403 because the throwaway approval
  capability was hashed with a trailing newline but sent without it.
  Failure-triage classified this as test-environment setup, normalized the
  generated value, and the unchanged test/product code passed on rerun.
- The memory-vault implementation anchors and rechecks the parent device/inode
  around atomic rename. Node does not expose descriptor-relative `renameat`,
  so a minimal OS-level interval remains between the last check and rename.
- GitNexus was unavailable in this session. Direct caller inspection, full
  branch tests, focused contracts, live sandbox tests, and staged-diff review
  are recorded as fallback evidence, not as a GitNexus pass.
