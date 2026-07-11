# Project State

## Current focus

**Non-mobile issue wave (2026-07-11)** — 9 standalone open bugs coded by Codex
terra across per-issue worktrees, integrated to one wave branch, verified
(tsc + unit + fork test + flutter analyze/tests + live-e2e), pushed as a wave
PR. Issues: **#1006, #1007, #1008, #1009, #1010, #1012, #1013, #1014, #1015**.
See `docs/ai/runs/2026-07-11-nonmobile-wave-codex-terra.md`.

## Active branch / PR

- **PR (wave, this run):** `workflow/run-2026-07-11` — the 9 issues above.
  Verified pre-PR; awaiting CI + manual UI smoke. Do NOT merge without smoke.
- **OPEN, awaiting manual smoke (PR #1005):** `workflow/run-2026-07-10-nonmobile-issues`
  — #999/#1000/#1002/#1003/#1004/#981 (live-verified; the user's to smoke+merge).
  This wave did **not** rebuild those.
- **MERGED (PR #982, 2026-07-10):** org-optimizer approval loop + skill-content
  -shadow retirement (#977/#971/#976 + gap #1).

## In progress

- **Plan A/B epic (#983–#997, milestones 87/88)** — reuse-before-reinvent +
  discover/adopt. Dependency chain (shared-contract #983 first). Queued as the
  next Codex wave; not started.

## Risks / known issues

1. **#1012 subagent scoping** verified via the fork's own `task.test.ts` (10/10)
   on the built binary + binary-live confirmation; the full parent→task→child
   live delegation path wasn't force-run (unit covers the 513-tool Gemini case).
2. **Flutter UI issues (#1006/#1009/#1010/#1013)** pass analyze + widget tests;
   true visual confirmation (errored transcript, Thinking stream, Pacific
   timestamps, proposal diff) is the manual-smoke handoff.
3. Live-e2e used a second api_server on :4011 sharing the app's SQLite DB
   (torn-read caveat) — session-row inspection avoided; endpoint/file/log
   evidence used instead.
4. Org-optimizer cron stays OFF pending safety review (unchanged).

## Test status

- api_server `tsc --noEmit` clean; targeted vitest 75/75 (agent_runner,
  agent_configs routes, opencode_agent_writer).
- Fork `bun run build --single` → `0.0.0-workflow/run-2026-07-11`; `task.test.ts` 10/10.
- Flutter `dart format --set-exit-if-changed` clean; `flutter analyze` 0/0;
  touched-area tests 529 pass.
- Full CI suites run on push (watch `gh run watch`).

## Next step

1. Watch CI on the wave PR to green; hand off manual UI smoke (checklist in the run log).
2. Launch the **Plan A/B epic** Codex wave (#983 shared contract first, then A2–A6, then Plan B).
3. After merge, real-app smoke of the 4 Flutter UI fixes.
