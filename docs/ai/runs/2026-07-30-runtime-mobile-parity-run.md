---
date: 2026-07-30
repo: Rhythm
branch: codex/fix-session-isolation-runtime-performance (+13 lane branches)
pr: "#1254–#1268"
issues: none (workstream-spec run, P0 + R1–R6 + MSP-001–007)
status: lanes verified; human smokes + MSP-007 parity gate pending
tags: [run, Rhythm]
---

# Runtime / session-isolation / performance + mobile parity run

Lead orchestrator (Claude) dispatching Codex gpt-5.6-sol workstreams in
isolated in-repo worktrees; every lane contract-first (red→green), verified
independently by the orchestrator, published as a draft PR. No merges, no
releases, no production changes.

## PR ledger (all draft)

| PR | Lane | CI | Live gate |
|---|---|---|---|
| #1254 | prereq desktop owner-inheritance (pre-existing branch, audited) | green | physical desktop→iPhone smoke = human |
| #1255 | R2 curator flag + idle animation (d3f7aaa69) | green | PASS — decline-path idle on real engine |
| #1256 | R6 plugin identity + telemetry dedupe (9631f10e1) | green | PASS — sandbox config: 1 telemetry entry, 0 stale paths |
| #1257 | R4 progress-aware deadline (bfe4e939b) | green | PASS — progressing run outlives old wall |
| #1258 | R1 child-session isolation (stacked #1254) | green | PASS 1/1 real API/WS |
| #1259 | MSP-005 composer scroll-before-cap (ad93451b4) | green | physical iPhone walk = human gate |
| #1260 | R3 scheduled failure classification | green | PASS 1/1 |
| #1261 | P0 memory-injection relevance (15692f389+54567c539) | green | PASS 1/1 after 2 live-found fixes |
| #1262 | MSP-006 project-scoped Tools (+cc37ace57 e2e-scope repair) | green | parity test w/ creds → MSP-007 |
| #1263 | MSP-001 session/profile contract (+3a9fb8a67 repair) | green | needs device token → MSP-007 |
| #1264 | MSP-004 atomic open (stacked #1263, d482f6bcb) | 2 reachability specs in repair | — |
| #1265 | MSP-003 shared pending interactions (stacked #1261) | green | PASS 1/1 real engine continuation |
| #1266 | MSP-002 profile-first sessions (stacked #1263) | rerunning after base merge | — |
| #1267 | R5 minimal DTO + transcript pagination (72d33400f) | green | PASS 2/2 |
| #1268 | integration branch (all runtime lanes, 82/82 combined) | green | one-pass desktop smoke checklist in PR body |

## Live-gate discoveries (would not have surfaced from unit suites)

- **P0 owner visibility**: strict-equality owner filter blinded owned sessions
  to instance-global vault notes at every layer (SQL ×3 + post-filters ×5).
  Fixed: owned = own + global; unknown owner stays global-only (fail-closed).
- **P0 relevance stopwords**: scorer's stopword list omitted interrogatives
  the probe list already ignored; realistic question phrasings scored 0.50.
  RELEVANCE_STOPWORDS now derived from STOPWORDS; corpus separation improved
  (positives {0.86, 1.00} vs negatives {0.00, 0.25} at 0.60).
- **R4 knob semantics**: inactivity window == old wall makes real model-turn
  gaps trip the stall detector — documented; defaults are safe.
- **Pre-existing flake**: live_e2e_948_949 draft-file assertion (LLM decline +
  90s curator cold-window silent drop in queueSkillExtraction) — test-design
  follow-up, documented in PR #1255.

## Mobile CI repairs (root-caused from Playwright artifacts, no assertions weakened)

- MSP-001: capability defaults lost for metadata-free direct sessions;
  session-dependent refresh identity churned SSE effects; fake gateway lacked
  catalog/state endpoints; revocation race. 8 failing specs → 69/69.
- MSP-006: E2E runtime classified as unauthorized-pairing before E2E mode was
  honored; fake project scope replaced by worktree path. ~20 specs → 69/69.
- MSP-003: permission route re-pinned to the new idempotent resolution
  contract (200 + interaction; mapping preserved via action argument).
- MSP-004: 2 issue-1237 reachability specs (offline exit, single recovery
  refresh) in repair at time of writing.

## Operational notes

- Codex sandboxes cannot commit (worktree git metadata outside writable root)
  → orchestrator verifies + commits; several tasks later self-committed.
- codex-rescue wrappers can inherit the orchestrator shell cwd as sandbox
  root → explicit cd + verify-after-launch protocol added to every dispatch.
- GitNexus MCP/index version drift (pinned 1.6.7 vs npx 1.6.9) fixed by
  upgrading the pinned install; MCP reconnect next session.
- Installed-DB owner backfill was pre-run by the user; never re-run here.
- MEMORY: memory/project_codex_rescue_dispatch_gotchas.md

## Remaining before completion claims

- MSP-004 foundation repair → re-run → push → CI.
- MSP-002 (#1266) CI on merged base.
- Human: integration-branch desktop smoke (#1268 checklist), physical iPhone
  composer walk (#1259), desktop→iPhone pairing (#1254).
- MSP-007 cross-client parity gate (needs paired user, 2 projects, 3 profiles,
  throwaway device creds) — evidence + release recommendation only.
- failure-postmortems after each human smoke (pass or fail).
- Historical telemetry dedupe + contaminated-transcript cleanup = separately
  reviewed destructive migrations (deferred by spec).
