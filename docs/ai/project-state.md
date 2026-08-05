# Project State

## Current focus

**Mega integration `mega/run-2026-08-04`** — one branch consolidating eight PRs so
there is a single merge to `main` after smoke testing. Two themes:

1. **Scheduled-agent autonomy.** On 2026-08-04 all 8 of that day's scheduled runs
   ended `completed_no_op` or `blocked_on_approval` — none did its job unattended.
   Eight defects were diagnosed live against the running agent server on `:4001`
   and fixed; 16 of 17 enabled tasks then completed unattended, the 17th after a
   skill repair.
2. **Skill data loss.** Two independent mechanisms were destroying hand-written
   skills. Both addressed here.

## Active branch / PR

- Branch: `mega/run-2026-08-04` (off `main`)
- Consolidates **#1312, #1313, #1314, #1315, #1316, #1317, #1318, #1304** — those
  are superseded and closed in favour of one merge.
- Merge remains a manual human action after smoke testing.

## What is in the mega branch

**Scheduled-agent autonomy (#1312)**
- Taint → approval deadlock: `auto_approve_actions` was structurally unreachable,
  because any taint forced a security-bound approval and those hard-coded
  `autoApprove:false` (#1134). Fixed by widening
  `SOURCES_EXEMPT_FROM_APPROVAL_GATE` from 1 → 17 genuinely first-party sources,
  plus scheduler-originated auto-approve gated on `auto_approve_actions` AND
  `is_system` AND `scheduled_task_id`. One shared predicate,
  `isUnattendedAutoApproveSession`, serves both the enforcement and request paths.
- All-or-nothing injection scanner: 2 of 50 memory rows withheld all 50. Flagged
  first-party LIST payloads are now filtered per item.
- `MUTATION_TOOL_PATTERN` was `^`-anchored and matched 0 of the 40 real tool
  names, so no run could ever report `success`. Now segment-boundary matched, and
  both run signals traverse the delegation tree.
- Headless `ask` hang: permission-mode resolution hoisted above the #878 bash
  gate. Bare `bypassPermissions` is deliberately NOT treated as unattended.
- A clean session got 409 on `request_approval` — found only by live smoke; it had
  turned the deadlock into a different dead end.
- Curated-MCP sidecar dedupe (`requiredEnv` is UNIONED, never weakened) and a boot
  reaper for orphaned `agent_scheduled_tasks` rows.
- `api_client` rendered every structured API error as `[object Object]`.

**Engine timeouts (#1313 → #1315, #1314)**
- `glob` gained its own timeout; the guard then moved into the `Ripgrep` service so
  all six callers (`files`/`search`/`tree`) are bounded, not just `glob`.
- The provider-stream inactivity watchdog now waits out provider-executed tools,
  which is what killed `image_generation` on any render slower than 180s. The
  interim 600s global raise in `opencode_client_service.ts` was **removed** — the
  engine fix is better on both axes.

**Org optimizer (#1316, #1317)**
- Scope was parsed with an array-only helper, so 16 of 47 profiles using the
  tools-map shape read as having no tools — the source of two false high-risk
  proposals, one of which would have wiped nine tool grants if approved. Also
  fixed a dispatch-guard misread that denied granted tools at runtime.
- External adoption now fails **closed** when the judge is unavailable (it
  previously shortlisted every candidate unjudged) and has a relevance floor.

**Skill data loss (#1318, plus a follow-up in flight)**
- The test suite isolated the database but not the filesystem, so runs overwrote
  real `SKILL.md` files. `managedSkillsRoot()` now THROWS under vitest if it
  resolves to the real `~/.config/opencode/skills`.
- Separately, the harvest evaluator treated an unparseable score as 0 and disabled
  four skills in eight minutes on 2026-07-11. Fix in flight on
  `fix/harvest-eval-unknown-score-not-zero` — NOT in this branch yet.

**image_generation (#1304)** — the native OpenAI provider tool, plus the role-gate
fix that stops it being blocked.

## Risks / known issues

- **The engine binary MUST be rebuilt from this branch before smoke testing.** It
  carries fork changes (`glob`, `ripgrep`, the `llm` watchdog, `image_generation`).
- `secretary` deliberately has NO `auto_approve_actions`: `email.send` is a
  protected action and unattended sending needs an explicit human decision.
- The classifier cannot see through `bash`, so a task mutating only via `bash`
  still reports `completed_no_op`. Deliberate trade — counting `bash` would mark
  every read-only run a success.
- `APPROVALS_MODE` is unset (`manual`) and no UI can reach it.
- Skill bodies for `daily-email-triage`, `daily-dev-summary`, `monthly-gc-report`,
  `AI Trend Research…` and `monday-worship-planning` were re-authored on
  2026-08-04 and need the user's review. Backup of all 125:
  `~/.config/opencode/skills-backup-2026-08-04-2320`.
- Pre-existing, out of scope: `apps/mobile` checks fail locally on a missing
  `eslint` and a wrong npm script; they pass in CI.

## Test status

- api_server: `main` baseline 467 files pass / 0 fail / 85 skipped; every merged
  PR measured at or above that with its own additions.
- mcp_server: 153/153. Typecheck, lint, build clean in both.
- opencode fork: typecheck clean; session suite 383 pass / 0 fail; tool suite 288.
- #1312–#1318 were each green in CI on their own branch before integration.

## Next step

Rebuild the engine from `mega/run-2026-08-04`, relaunch, and drive the full smoke
list. Merge is a manual human action once smoke passes.
