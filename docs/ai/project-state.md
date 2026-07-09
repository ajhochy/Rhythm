# Project State

## Current focus

**Non-mobile wave merged to `main` (@ 26f5e6e96, 2026-07-09).** 13 PRs / 18
issues landed in one verified integration (tsc clean, full api_server suite
2612 passed / 0 failed; each issue live-gated before merge). See
`docs/ai/runs/2026-07-09-non-mobile-wave-merged.md`.

The agent/skill self-improvement architecture is now coherent:
- **Source of truth = files** in `~/.config/opencode/skills` (#947); external
  scans off (`OPENCODE_DISABLE_EXTERNAL_SKILLS=1`); one-time durable-marked
  population (no boot-seed clobber).
- **Harvest loop = automatic, drafts only** (#929 evaluate → #959 guard →
  #969 rewrite). Hand-off to the org-optimizer at draft→active promotion.
- **Org-optimizer = human-gated, whole-org** (proposed→approved→applied→
  measured→re-evaluated). The "improve every active skill over time" engine is
  the org-optimizer's job (#976), not a new auto-loop.

## Branch / PR

- `main` @ 26f5e6e96. No open wave PRs (all merged/closed).
- Open PRs left deliberately: **#939** (fork delegated-agent-retry, never gated),
  **#953** (agent-profile core permissions, conflicting, out of wave).

## Risks / known issues (act before relying on runtime)

1. **Fork rebuild pending** — #928's allowlist null-clear is a fork *source*
   change; `apps/opencode_bin/opencode` is still the #949 build. Rebuild +
   re-sign the fork for it to take effect (release build handles it).
2. **#947 real-config migration NOT run (approval-gated → #961).** Real
   `~/.config/opencode/rhythm-managed-skills` + quarantined stubs still present.
   `populateWorkflowSkillsOnce` runs once (copy-if-absent) on next real start;
   the legacy dir move is behind `RHYTHM_MIGRATE_MANAGED_SKILLS=1`.
3. **`OPENCODE_DISABLE_EXTERNAL_SKILLS=1` ships** — next real start stops
   scanning `~/.claude`/`~/.agents` skills (intended).
4. Cache coherence for continuous refinement: `reloadSkills` is per-directory;
   a refinement must fan out to all live engine instances (#976).

## Test status

- Integrated result: `tsc` clean; full api_server suite **2612 passed, 23
  skipped, 0 failed**.
- All per-issue live gates passed pre-merge (fork engine + api_server); #947
  proven by a sandboxed full-server double-boot (restart no-clobber).

## Next step (all approval-gated / queued)

1. **#961** real-config remediation (needs AJ go — real data): re-wire the 5
   #958-lint miswirings (config-doctor, AI-Trend-Researcher, research→domain-intel,
   secretary, Theological-Researcher), backfill UUID labels (**#960** first),
   remove stub dirs, run the #947 migration.
2. Quality trio: **#951** (harvester distills memory prefaces), **#954**
   (lazy_deps stripped frontmatter), **#952** (Codex-account fallback leg).
3. **#960 + #945** (human-readable ids/titles). **#943** (bg-sessions UI, deferred).
4. Future-run epics: **#970** (judge hardening), **#971** (org-optimizer apply
   loop), **#976** (org-optimizer skill-refinement generator), **#977** (retire
   the DB→file content shadow).
