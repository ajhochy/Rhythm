# Project State

## Current focus

**Non-mobile issue wave (2026-07-11)** — 9 standalone open bugs coded by Codex
terra across per-issue worktrees, integrated to one wave branch, verified
(tsc + unit + fork test + flutter analyze/tests + live-e2e), pushed as a wave
PR. Issues: **#1006, #1007, #1008, #1009, #1010, #1012, #1013, #1014, #1015**.
See `docs/ai/runs/2026-07-11-nonmobile-wave-codex-terra.md`.

## Active branch / PR

- **PR #1016 (wave):** `workflow/run-2026-07-11` — the 9 bug issues above.
  CI green (Desktop + Server). Awaiting manual UI smoke. Do NOT merge without smoke.
- **PR #1017 (epic, stacked on #1016):** `epic/skill-reuse-adopt-2026-07-11` —
  skill reuse (Stage A #983–988) + external discovery/adoption (Stage B #989–996),
  built by Sonnet 5 agents. tsc clean, 57 unit tests, Plan A live-probe PASS, Plan B
  chain live-verified (+ a download-path defect found & fixed). #997 deferred (full
  adopt/measure live arc). Merge #1016 first, then this retargets to main.
  See `docs/ai/runs/2026-07-11-skill-reuse-adopt-epic.md`.
- **OPEN, awaiting manual smoke (PR #1005):** `workflow/run-2026-07-10-nonmobile-issues`
  — #999/#1000/#1002/#1003/#1004/#981 (live-verified; the user's to smoke+merge).
  This wave did **not** rebuild those.
- **MERGED (PR #982, 2026-07-10):** org-optimizer approval loop + skill-content
  -shadow retirement (#977/#971/#976 + gap #1).

## In progress

- **Plan A/B epic — implemented (PR #1017).** Awaiting CI + manual smoke + merge.
  Follow-up: #997 full adopt→measure→KEPT/REVERTED live arc (judge scored 0/0 in
  the bare standalone probe; existing #930 `scoreSkillBody` machinery).

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

## Recent coding-agent runs

- 2026-07-11 — `codex/fix-inert-1014-1007-997`: repaired the three adversarially
  confirmed inert paths (#1014 same-session delegate-cache refresh, #1007
  scheduled content-derived naming, #997 provider-distinct external-discovery
  scoring with explicit 0/0 human-review handling). Acceptance contracts and
  isolated live evidence are recorded in
  `docs/ai/runs/2026-07-11-inert-fixes-live-e2e.md`.
