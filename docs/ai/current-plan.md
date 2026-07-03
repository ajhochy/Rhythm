---
date: 2026-07-03
repo: Rhythm
branch: main
status: planning
issues: [857, 859, 860, 858, 861, 814, 856, 815]
tags: [plan, Rhythm]
index: "[[Rhythm]]"
---

# Plan — Finish all open non-mobile issues

Kickoff plan for the next session. Everything from the 2026-07-02 mega build-out
is merged to main; this closes out the remaining open work EXCEPT the mobile
issues (#418, #71, which stay separate).

## Goal

Complete and open PRs for the 8 open non-mobile issues below, in the given
order, via the AI workflow (workflow-orchestrator → contract → coding-agent →
verification-gate → project-state-updater). Do NOT merge — leave PRs for human
review.

## Read first (context)

- `docs/ai/project-state.md` — current state + how to run the fork in dev.
- `docs/ai/runs/2026-07-02-mega-buildout-fork-eval-memory.md` — the full prior session.
- `docs/ai/decisions/2026-07-02-agent-memory-in-obsidian-vault.md` — memory model.

## Pre-flight (landmines that cost time last session)

1. The main checkout may be on a stray branch — `git checkout main && git pull`,
   branch from main.
2. **Run the FORK engine, not stock opencode.** Dev falls back to stock 1.14.40
   (no scoping patches). Build: `cd apps/opencode_fork/packages/opencode && bun
   install && bun run build --single` → cp `dist/opencode-darwin-arm64/bin/opencode`
   to `apps/opencode_bin/opencode`, chmod +x, ad-hoc codesign with
   disable-library-validation, relaunch. Startup log states the engine + whether
   fork patches are active.
3. Memory consolidation must MERGE only genuine overlap — keep distinct memories
   distinct (don't over-merge).

## Issues (in order)

### 1. #857 — CRITICAL, first (gates the optimizer cron)
Org-optimizer over-prunes on thin data. Add a minimum-observation-window /
data-sufficiency guard to the tighten/prune generator ("no data yet" != "unused"),
AND a supported revert path for an already-`active` proposal (the #817 state
machine blocks active->reverted). Keep the seeded optimizer cron OFF until this
lands. Policy: full-autonomy-with-rollback; human-gate only new-agent + external.

### 2. #859 — memory consolidation + interview-quality capture
Merge-into-canonical during capture (no N near-duplicate notes); a consolidation
pass (mirror skill-consolidation, reversible); support a "memory interview" flow
that yields a clean deduplicated set. Also fix the bug in this issue: `forget`
(DELETE /agent-memory/:id) 404s on the ULID that `remember` returns.

### 3. #860 — collapse the two parallel memory stores
Migrate worthwhile entities from the `memory` knowledge-graph MCP
(`~/Documents/Claude-Memory/memory.jsonl`) into the Obsidian AGENT-MEMORY vault,
then remove the `memory` MCP from agent scopes. Single source of truth.

### 4. #858 — UUID-keyed agents can't be chat-prompted
Session-create sends the config id, not `oc_agent`, to the engine -> "Agent not
found". Make session-create/resume use `agentConfig.ocAgent`; make
`agent_profile_sync` set `oc_agent` = engine name for all profiles + backfill
NULL/UUID rows. Consider a `PATCH /agent-configs/:id` route.

### 5. #861 — clicking a delegated "Task" card opens the subagent session
Carry the child session id on the card; navigate the session view to it; works
for nested delegation; back-affordance. Wire a REAL mounted surface + a test that
pumps it (see the "agents inspector was orphaned" lesson).

### 6. #814 — pin/bundle the rhythm MCP server version
So a stale global can't shadow the `npx -y @ajhochy/rhythm-mcp-server` invocation.

### 7. #856 — engine reloads provider credentials on auth change
Avoid an app restart after a Claude account switch. Lowest-risk first cut: an
api_server-side auth-file watch + engine bounce.

### 8. #815 — VERIFICATION ONLY
The native ask-notification feature is implemented and its #833 blocker is fixed.
Confirm it fires live (role-scoped agent raises a question -> notification appears),
then close.

## Approach

- Parallel worktree-isolated coding agents off main, contract-first (failing test
  -> implement -> falsify), full check suite between folds, CI watched to green.
  Suggested groups: [memory: #859+#860] · [optimizer: #857] · [agents/session:
  #858+#861] · [infra: #814+#856]; #815 is a live verification.
- Constraints (AGENTS.md/CLAUDE.md): dart format + flutter analyze clean;
  api_server tsc + vitest green; real-binary smoke for any fork change
  (#814/#858 may touch the fork); never couple agent traffic to
  serverConfigService.url; SQLite-only agent tables never in postgres_bootstrap.
- Open PRs for review — do NOT merge. Update project-state + a run log + decisions
  when done. File follow-ups rather than expanding scope.

## Out of scope

- Mobile issues #418 (smoketest fail) and #71 (mobile MVP scope) — separate track.

## Validation

- Per-issue contract tests green; `ai-workflow checks --level pr`; org-optimizer
  safety smoke; live fork run for anything touching scoping/engine; #815 live check.
