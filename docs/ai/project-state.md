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

- `main` @ d1891bed7. **No open PRs.**
- **MERGED (PR #979, AJ sign-off, 2026-07-09):** Phase B/D ids + quality wave —
  **#945, #960, #951, #954, #970, #943**. Built by 5 parallel Codex worktree
  runs, orchestrator-reviewed, behaviorally gated, integrated (full suite
  **2626/0** + tsc + flutter analyze clean), CI green. See
  `docs/ai/runs/2026-07-09-phaseBD-ids-quality-wave.md`.
  - #943 (Session History screen) shipped **without a visual smoke** — the UI
    was merged on sign-off; a real click-through is still worth doing.

## Risks / known issues (act before relying on runtime)

1. ~~**Fork rebuild pending**~~ **DONE (2026-07-09).** Rebuilt + re-signed →
   bundle is now `0.0.0-main-202607092109` (was the #949 `0.0.0--202607092057`).
   Live-verified: #928 null-clear 2/2, #939 retry 56/56 unit, Codex leg completes
   (`gpt-5.6-terra`→PONG/1s; unsupported models return clean error frames, no
   hang → #952 was quota, not a bug). See
   `docs/ai/runs/2026-07-09-phaseA-fork-rebuild-verify.md`. **Caveat:** ChatGPT-
   account Codex only serves `luna`/`terra`/`sol` tier models — a fallback leg
   pinning `openai/gpt-5.3-codex` will 400 for a ChatGPT account.
2. **#947 real-config migration NOT run (approval-gated → #961).** Real
   `~/.config/opencode/rhythm-managed-skills` + quarantined stubs still present.
   `populateWorkflowSkillsOnce` runs once (copy-if-absent) on next real start;
   the legacy-dir move is behind `RHYTHM_MIGRATE_MANAGED_SKILLS=1`.
3. **`OPENCODE_DISABLE_EXTERNAL_SKILLS=1` ships** — next real start stops the
   engine scanning `~/.claude`/`~/.agents` skills (intended).
4. Cache coherence for continuous refinement: `reloadSkills` is per-directory;
   a refinement must fan out to all live engine instances (#976).

## Test status

- **Draft-PR branch `workflow/run-2026-07-09-ids-quality`**: `tsc` clean
  (api_server + mcp_server); full api_server suite **2626 passed / 0 failed**;
  `flutter analyze` clean. #960/#945 live-gated against a real running server.
- Prior `main` integrated result: full suite 2612/0 (2026-07-09 non-mobile wave).

## Next step

1. **#961** real-config remediation — **UNBLOCKED** (#960 merged); still
   approval-gated (real `~/.config/opencode` + DB). Plan: sandboxed dry-run
   (temp HOME + `.backup` DB) → show the exact diff → AJ go → apply. Re-wire the
   5 #958-lint miswirings (config-doctor, AI-Trend-Researcher, research→domain-intel,
   secretary, Theological-Researcher), backfill UUID labels, remove stub dirs,
   run the #947 migration (`RHYTHM_MIGRATE_MANAGED_SKILLS=1`).
2. Held epics (strict order): **#977** (retire DB→file skill-content shadow —
   conflicted with the now-merged #951/#954 skill-content paths, so rebase-aware)
   → **#971** → **#976** (org-optimizer approval loop + skill-refinement generator).
3. Optional: visual smoke of the shipped #943 Session History screen.
- **#952** closed (Codex "hang" was ChatGPT quota exhaustion, not a bug —
  confirmed live 2026-07-09: `gpt-5.6-terra` completes, unsupported models return
  clean error frames, no hang).
