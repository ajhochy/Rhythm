---
priority: P2
area: api_server / test harness
found_by: failure-triage (AV-01 verification, 2026-08-08)
blocks: nothing — CI can be re-run, but it hides real regressions
---

## Failure

`apps/api_server`'s full vitest suite fails intermittently, ~1 run in 3–4, with
1–2 tests failing in a *different* file each time. Every victim passes when its
file is run alone. This is not caused by any one branch — it reproduces on
`main` at `617d9045`.

A second, separate hazard was found alongside it: an agent shell spawned by the
Rhythm desktop app inherits `DB_PATH=~/Library/Application
Support/Rhythm/rhythm.db`, `MEMORY_VAULT_PATH=<Obsidian>/AGENT-MEMORY`, an empty
`MEMORY_VAULT_SUBDIR`, `AGENT_LOCAL=true` and `PORT=4001`. `env.dbPath` /
`env.memoryVaultPath` let those win, so a bare `npm test` from an agent shell
runs 4 000 tests against **the user's live database and real Obsidian vault**,
and deterministically fails 10 tests while doing it.

## Repro Command

```bash
cd apps/api_server
env -u AGENT_LOCAL -u MEMORY_VAULT_PATH -u MEMORY_VAULT_SUBDIR \
  -u DB_PATH -u PORT npm test          # repeat 3–4×
```

Contamination half (do NOT run without redirecting `DB_PATH`):

```bash
env -u PORT AGENT_LOCAL=true MEMORY_VAULT_PATH=$TMPDIR/vault \
  MEMORY_VAULT_SUBDIR= DB_PATH=$TMPDIR/contam.db npm test
```

## Expected

Deterministic green: `4040 passed | 128 skipped` on `main`. And `npm test`
should never be able to reach the live desktop database or the real vault.

## Actual

| Where | Result |
|---|---|
| `feat/artifact-viewer` run 1 | 2 failed — `opc_m4_3_mcp_routes.test.ts` (2 cases) |
| `feat/artifact-viewer` runs 2–4 | 4041 passed, exit 0 |
| `main` @ `617d9045` runs 1–2 | 4040 passed, exit 0 |
| `main` @ `617d9045` run 3 | 2 failed — `notifications_agent_local_bypass.test.ts`, `opencode_commands_routes.test.ts` |
| `opc_m4_3_mcp_routes.test.ts` alone | 20 passed, exit 0 |
| contaminated env | 10 failed / 4031 passed, every run |

## Relevant Output

The contaminated-env failures are all memory-vault-layout or `AGENT_LOCAL`
auth-bypass assertions: `agent_research_owner_visibility` (×2),
`delegation_caller_identity`, `issue_1135_audit_lock_contract`,
`memory_index_rebuild`, `memory_injection` (×2), `projects_checkout`,
`issue_1219_memory_provenance` (×2).

Flake failures look like route/auth state leaking across workers — e.g.
`expected 404 to be 201`, `expected 200 to be 201`. The same signature showed up
in unrelated runs on 2026-08-07 (`agent_sessions_mcp_role`, `agent_cookbook`,
`agent_designs` — one per run), so the pool of possible victims is wide.

## Likely Cause

Two independent causes:

1. **Flake.** Cross-test state that survives between files in the same vitest
   worker — a module-level singleton (auth/session/route registry, or the
   shared SQLite handle) initialised by whichever file the worker imports
   first. Different worker/file interleavings pick a different victim, which is
   why the failing file moves and isolation is always green.
2. **Contamination.** `apps/api_server` has no test bootstrap that neutralises
   inherited process env, and the desktop app injects exactly the variables the
   suite is sensitive to (see
   `docs/ai/decisions/2026-07-02-memory-vault-env-injection-scope.md`).

## Likely Files

- `apps/api_server/vitest.config.ts` — no `setupFiles`; no isolation/pool pins.
- `apps/api_server/src/config/env.ts` — `dbPath` (~L321), `memoryVaultPath`
  (~L59/L481), `agentLocal` (~L161) all read `process.env` unconditionally.
- The recurring victims above are symptoms; do not "fix" them individually.

## Required Fix

1. Add a `setupFiles` bootstrap that, under `vitest`, hard-overrides
   `DB_PATH`, `MEMORY_VAULT_PATH`, `MEMORY_VAULT_SUBDIR`, `AGENT_LOCAL` and
   `PORT` to per-run temp/explicit values regardless of what was inherited.
   This is the higher-value half: it makes the suite unable to touch live data.
2. For the flake, bisect the leak by running with `--sequence.shuffle` +
   `--sequence.seed` to get a reproducible order, then `--isolate` /
   `poolOptions.threads.singleThread` to confirm it is worker-shared state
   before choosing between resetting the singleton in a global `afterEach` and
   pinning isolation.

## Required Tests / Evaluation

- The setup-file fix is proven by running the contaminated command above and
  getting a green suite.
- The flake fix is proven by 10 consecutive green full-suite runs on `main`
  under a shuffled order, not by one lucky green run.
