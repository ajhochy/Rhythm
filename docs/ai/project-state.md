# Project State

## Current focus

**Non-mobile wave merged to `main` (@ 882e75bbc, 2026-07-09).** 15 PRs / 20
issues landed and verified (tsc clean, full api_server suite 2612 passed / 0
failed on the integrated tree; each issue live-gated before merge). See
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

- `main` @ 882e75bbc. **No open PRs** — the whole set is merged.
- Merged after the main wave (AJ sign-off, "the runs tested them"): **#953**
  (per-profile opencode core permissions + permission-audit MCP tools) and
  **#939** (delegated-agent retry — a `opencode_fork` change: retry cap,
  TaskTool child-failure surfacing, LLM stream-concurrency gate).

## Risks / known issues (act before relying on runtime)

1. **Fork rebuild pending** — #928 (allowlist null-clear) AND #939 (retry/task
   handling) are fork *source* changes; `apps/opencode_bin/opencode` is still
   the #949 build. Rebuild + re-sign the fork for either to take effect at
   runtime (the release build does this automatically).
2. **#947 real-config migration NOT run (approval-gated → #961).** Real
   `~/.config/opencode/rhythm-managed-skills` + quarantined stubs still present.
   `populateWorkflowSkillsOnce` runs once (copy-if-absent) on next real start;
   the legacy-dir move is behind `RHYTHM_MIGRATE_MANAGED_SKILLS=1`.
3. **`OPENCODE_DISABLE_EXTERNAL_SKILLS=1` ships** — next real start stops the
   engine scanning `~/.claude`/`~/.agents` skills (intended).
4. Cache coherence for continuous refinement: `reloadSkills` is per-directory;
   a refinement must fan out to all live engine instances (#976).

## Test status

- Integrated result: `tsc` clean (api_server + mcp_server); full api_server
  suite **2612 passed / 0 failed**. All per-issue live gates passed pre-merge;
  #947 proven by a sandboxed full-server double-boot (restart no-clobber).

## Next step (all approval-gated / queued)

1. **#961** real-config remediation (needs AJ go — real data): re-wire the 5
   #958-lint miswirings (config-doctor, AI-Trend-Researcher, research→domain-intel,
   secretary, Theological-Researcher), backfill UUID labels (**#960** first),
   remove stub dirs, run the #947 migration.
2. Quality trio: **#951** (harvester distills memory prefaces), **#954**
   (lazy_deps stripped frontmatter), **#952** (Codex-account fallback leg — the
   Gemini leg landed; issue reopened for Codex).
3. **#960 + #945** (human-readable ids/titles). **#943** (bg-sessions UI, deferred).
4. Future-run epics: **#970** (judge hardening), **#971** (org-optimizer apply
   loop), **#976** (org-optimizer skill-refinement generator), **#977** (retire
   the DB→file content shadow).
