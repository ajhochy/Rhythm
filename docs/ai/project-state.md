# Rhythm — project state

**Focus:** Repairing the four deliverables (Coordinator coding workflow,
workflow-skill loading, Router/Memory/Dayflow, routing UI).

**Branch:** `codex/rhythm-deliverables-completion-20261010` · no PR open.

## In progress

Four product defects repaired and demonstrated live against an isolated
sandbox (API `:4098`, engine `:4097`); see
`docs/ai/runs/2026-10-11-deliverables-repair-four-fixes.md`.

1. Coding-execution proposals were unparseable — the construction site spread
   the 7-field foreground binding into a 22-key exact schema, so no approval
   card could ever be created. Fixed and guarded.
2. AGENT_LOCAL no-bearer requests created sessions with `owner_user_id` NULL.
   Fixed at the bypass; ambiguous ownership still fails closed.
3. The credentials watcher never attached when `auth.json` was absent, so a
   first sign-in fired nothing and the catalogue stayed stale until relaunch.
   Fixed; the misleading "watching" log is gone.
4. The four workflow skills existed nowhere in Rhythm's skill store. Seeded via
   `config_seeds`, marker bumped to `config_seeds_v4` for backfill.

## Demonstrated

- **Coordinator happy path (D1)** — run 12 delivered a 7/7 independently
  verified result to the original chat; see
  `docs/ai/runs/2026-10-11-d1-coordinator-delivery-demonstrated.md`. Approval
  was agent-clicked under AJ's go-ahead, not a demonstrated human approval.

## Blocked (precise missing action)

- **Desktop UI checks** — the isolated shell profile stops at "Sign in to
  Rhythm — Continue with Google". An interactive-smoke instance is attached to
  the sandbox (pid may be stale) awaiting that sign-in.
- **Router UI (deliverable 4)** — canonical policy confirmed but not
  implemented; see risks below.

## Risks / stale facts

- `CLAUDE.md` calls `apps/web` a non-shipping prototype. The shipped Electron
  bundle serves it from `Resources/app/web/dist`. The Flutter client is not
  what the qualification candidate runs.
- Canonical routing policy is `GridCategory('coding'|'design'|'knowledge') ×
  GridTier(1..4)` → ordered `{model, effort, cost_per_task}`, with tier 4
  easiest and tier 1 hardest. The shipped UI instead shows Cheap/Standard/
  Frontier price buckets. The labels "Simple/Routine/Complex/Demanding" do not
  exist in the repo.
- `resolveProposal` still has no integration coverage; the existing proposal
  test builds terms from a helper and never reaches the construction site.

## Test status

`tsc --noEmit` clean. api_server suite: 8993 passed / 36 failed / 385 skipped.
The 36 failures are pre-existing and were A/B-verified against the pre-change
middleware.

## Next step

D1 recovery/cancellation cases and managed-work UI; expired-card decide fix;
D3 remainder; D4 router UI; package a qualified candidate (installed 0.18.69
still runs old code and freezes the chat on coding worker rows).
