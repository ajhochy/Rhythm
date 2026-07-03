---
date: 2026-07-02
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Parallel worktree coding agents must not share a mutable node_modules

## Context

The 2026-07-02 run (#882) used the proven pattern: N parallel git worktrees, one
coding agent each, folded sequentially. To give each worktree its Node deps cheaply,
`apps/api_server/node_modules` (and `apps/mcp_server/node_modules`) were **symlinked**
from the main checkout into every worktree.

Several agents independently decided to run `npm ci` / `npm install` /
`npm rebuild better-sqlite3` when a worktree looked like it was missing a package.
Because the symlink pointed all of them at the **same** physical `node_modules`, those
installs raced: the tree was repeatedly left mid-install (missing `better-sqlite3`'s
native build), which then made DB-backed vitest suites fail for *other* agents that
were only reading. Time was lost diagnosing phantom "better-sqlite3 missing" reports
that were really a shared-mutable-state race, not a code problem.

## Decision

When running parallel worktree-isolated coding agents:

1. **Never let a mutating dependency operation touch a shared tree.** Either (a) give
   each worktree its **own** `node_modules` (real install / copy), or (b) symlink a
   shared tree **and forbid reinstalls** in the agent prompt: *"deps are installed and
   healthy; do NOT run npm install/ci/rebuild — if a package seems missing, STOP and
   report it."*
2. The orchestrator **repairs the shared tree once** (`npm ci` + a `better-sqlite3`
   sanity `require`) **between waves**, when no agent is using it — never while agents
   are live.
3. Flutter is safe to `flutter pub get` per-worktree (writes only that worktree's
   `.dart_tool`); the hazard is specifically npm's shared `node_modules`.

Wave 2 of this run applied rule 1(b) explicitly and saw no further corruption.

## Alternatives considered

- **Per-worktree `npm ci` up front.** Correct but slow/disk-heavy for 8 worktrees;
  acceptable when agents genuinely need to mutate deps. Chosen mitigation (symlink +
  no-reinstall rule) is cheaper and sufficient because agents only need to *read* deps.
- **Copy node_modules per worktree.** Same cost as per-worktree install, no benefit.
- **Run all agents against the main checkout serially.** Defeats the parallelism the
  pattern exists for.

## Consequences

- Add the "deps ready — do not reinstall" line to every parallel worktree coding-agent
  prompt by default; repair the shared tree only between waves.
- The full integration suite is still the authoritative gate — run it once against a
  freshly-repaired tree after all folds, not per-agent (agents' in-worktree suite runs
  can false-fail during a concurrent race and should be treated as advisory).
