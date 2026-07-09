---
date: 2026-07-09
repo: Rhythm
branch: main
pr: [963, 964, 965, 966, 967, 968, 972, 973, 975, 978, 940, 955, 956]
issues: [944, 922, 931, 958, 957, 928, 959, 927, 952, 969, 930, 929, 933, 934, 935, 936, 947, 946]
status: merged
tags: [run, Rhythm]
---

# Non-mobile wave — merged to main (main @ 26f5e6e96)

Drove every open non-mobile issue to a live-gated draft PR, then integrated all
of them to `main` in one verified pass (user sign-off: "merge all, I trust the
testing").

## What landed (13 PRs → main via fast-forward integration `578b9d946..26f5e6e96`)

- **#944** (#963) — removed the GitHub issue tool from the rhythm MCP (`gh` covers it).
- **#922** (#964) — surface degraded (401) MCP auth in the Agent Profile sheet.
- **#931** (#965) — surface fail-closed / deny-all MCP+skill scope config errors.
- **#958** (#966) — agent↔workflow-skill wiring lint (`GET /agent-configs/skill-wiring`) + generator guard. Live gate found 5 real miswirings (see below).
- **#957** (#967) — stop agent role-text being seeded as colliding skill stubs on startup (root cause: `skill_seed_importer` scanned the opencode agents dir; run-once guard re-armed on row delete).
- **#928** (#968) — fork session schema `Schema.optional(Schema.NullOr(...))` so a null PATCH clears the allowlist. **FORK CHANGE — needs a fork rebuild to take effect at runtime (see Risks).**
- **#927 + #952-gemini** (#973) — Gemini projectId via `OPENCODE_GEMINI_PROJECT_ID` env (survives turns, no re-auth click) + unscoped Gemini routed through deferred-MCP so it never exceeds the ~512 tool cap.
- **#930** (#940) — automatic model fallback chain + cross-provider re-dispatch.
- **#929 → #959 → #969** (#955/#972/#975, self-reg stack) — harvested-skill loop: usage tracking + evaluate, the dependency guard (never disable a skill an agent depends on → route to `rewrite-needed`), and the rewrite wiring (one-shot, loop-safe refine of `rewrite-needed` drafts; live gate showed a 10→97 rewrite).
- **#947** (#978, on #957) — `~/.config/opencode/skills` is the sole skill source; `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`; recurring boot seed replaced with a **one-time durable-marked population** (copy-if-absent) so self-improvement refinements survive restarts. Closes #946.
- **#933-936** (#956) — workflow-failure-signal extractor → audit snapshot → optimizer proposals.

## Checks (on the integrated result, not per-branch)

- `tsc --noEmit` clean.
- Full api_server suite: **2612 passed, 23 skipped, 0 failed** (299 files).
- Each issue passed its own `RHYTHM_LIVE_E2E` live gate against the real fork
  engine before integration (see per-issue run logs). Notable: #947 proven by a
  sandboxed full-server **double-boot** (modify a skill file → real restart →
  byte-identical + engine serves it; real config untouched).
- Merge conflicts resolved: `rhythm_managed_skills.ts` fs-import (kept the #947
  superset) + `docs/ai/project-state.md` (docs); everything else auto-merged.
  The #959/#969 divergence (each built the evaluator/test) auto-merged and was
  validated by the full suite passing on the combination.

## Not merged / flagged

- **#939** (codex delegated-agent-retry) — a fork change never gated this wave; left open.
- **#953** (agent-profile core permissions) — CONFLICTING, not part of this wave; left open.
- **#932** — closed (superseded; it was the pre-split #928+#931 combined branch).

## Follow-ups filed (future runs)

- **#970** — evaluator judge is unpinned+untimed; one hanging judge stalls the sweep (pin model + timeout + concurrent judge calls).
- **#971** — org-optimizer approval loop (approved→applied→re-evaluated); design + contracts preserved on `origin/salvage/org-optimizer-approval-loop`.
- **#976** — org-optimizer skill-refinement generator (the human-gated "improve the whole corpus" engine; reframed from the closed #974) + cache-fan-out constraint.
- **#977** — retire the DB→file skill-content shadow (one file source; keep the lifecycle sidecar).

## #958 lint — the 5 real miswirings (for #961)

config-doctor→config-doctor (not-enabled); AI-Trend-Researcher→AI-Trend-Researcher (not-in-allowlist,not-enabled); research→domain-intel (not-in-allowlist); secretary→secretary (not-in-allowlist,not-enabled); Theological-Researcher→Theological-Researcher (not-in-allowlist,not-enabled). Plus 2 orphaned UUID managed-dir stub subdirs.

## Risks / must-do before relying on runtime behavior

1. **Fork rebuild needed** — #928's null-clear is a fork *source* change; the bundled `apps/opencode_bin/opencode` is still the #949 build. Rebuild the fork + re-sign for the null-clear to work at runtime (release build does this automatically).
2. **#947 real-config migration is approval-gated (#961), NOT run.** The real `~/.config/opencode/rhythm-managed-skills` + quarantined stubs still exist. Next real server start: `populateWorkflowSkillsOnce` runs once (copy-if-absent); the legacy `rhythm-managed-skills → skills` move is behind `RHYTHM_MIGRATE_MANAGED_SKILLS=1`.
3. **`OPENCODE_DISABLE_EXTERNAL_SKILLS=1` now ships** — the next real start stops the engine scanning `~/.claude`/`~/.agents` skills. Intended, but a real behavior change.

## Next step

#961 real-config remediation (approval-gated): re-wire the 5 miswired agents, backfill UUID labels (#960 first), remove stub dirs, run the #947 migration. Then the quality trio (#951, #954, #952-Codex leg) and #960+#945.
