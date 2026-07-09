---
date: 2026-07-09
repo: Rhythm
branch: workflow/run-2026-07-09-ids-quality
pr: [pending]
issues: [960, 945, 951, 954, 970, 943]
status: verified-draft
tags: [run, Rhythm, parallel-worktree, codex]
---

# Phase B/D — ids + quality wave (5 issues, parallel Codex worktrees)

Dispatched 5 independent issues to **parallel Codex runs** (gpt-5.5/high) on
isolated git worktrees; orchestrator (Opus) reviewed + ran the behavioral gates
+ integrated. No agent authored brittle standalone test scripts — the approval
gate was live behavior against the real backend + the existing e2e suites.

## What landed (integration branch `workflow/run-2026-07-09-ids-quality`)

- **#945 + #960** — `POST /agent-configs` accepts an optional slug id (400
  non-slug, 409 dup, 400 reserved); no-id create derives a slug from the label
  (UUID fallback only when empty/reserved/colliding); org-optimizer create-agent
  applier treats a UUID-shaped slug as absent; Flutter `AgentConfig.displayLabel`
  + `OpencodeSkillEntry.displayName` render label/description, never a bare UUID.
- **#951** — harvester strips the ws_gateway `## Known context` memory preface
  from `input` rows in `distillFromSession`, so the distiller sees real
  conversation, not the standing memory instruction.
- **#954** — `lazy_deps_turn_hook` reads skill frontmatter off-disk via
  `readSkillContentAtLocation(location)` instead of the engine's frontmatter-
  stripped `content`, so `python_dependencies` actually resolve (#876 was inert).
- **#970** — harvest judge model pinned to a reliable authed tier
  (`resolveReliableAuthedFallbackModel`, excludes openrouter/free) + each judge
  call wrapped in a `Promise.race` timeout (`RHYTHM_HARVEST_JUDGE_TIMEOUT_MS`,
  default 60s) so one hanging judge skips that draft non-fatally instead of
  halting the whole self-regulation sweep.
- **#943** — new Flutter Session History feature: lists background/scheduled
  agent sessions (`GET /agent-sessions`) + read-only transcript view
  (`GET /agent-sessions/:id/messages`), sidebar entry. **Needs a human VISUAL
  smoke** (a new screen can't be curl-gated).

## Verification (approval gate = behavior, not agent-written scripts)

- **#960/#945** — LIVE behavioral gate: booted the worktree api_server on a
  sandboxed `DB_PATH` and exercised `/agent-configs` directly — all 7 pass:
  no-id→`web-researcher` slug; custom id honored; dup→409; non-slug→400;
  reserved `build`→400; `sunday-prep` derived; slug-collision→UUID fallback.
  Regression: supertest `agent_configs_routes.test.ts` 33/33.
- **#951** — focused `skill_extractor.test.ts` 10/10; diff reviewed for
  over-strip safety (only strips a *leading* exact header+bullet block).
- **#954** — focused `lazy_deps_turn_hook.test.ts` 14/14 (RED-confirmed-first;
  fixture writes a real on-disk `SKILL.md`, not a mocked return).
- **#970** — `harvested_skill_evaluator.test.ts` 22/22 including the acceptance
  case (a hanging judge on draft N still lets draft N+1 evaluate).
- **#943** — `flutter analyze --no-fatal-infos` clean; data contract verified
  against the real routes (`{ sessions, resumable }` / `{ messages }`).

## Combination gate (per-branch green ≠ merge green)

Merged all 5 onto `workflow/run-2026-07-09-ids-quality` — **zero conflicts**
(disjoint files; agents' `project-state.md` edits discarded, one authoritative
update written here instead). On the merged tree:
- `tsc --noEmit`: clean (api_server + mcp_server).
- Full api_server suite: **2626 passed / 0 failed / 23 skipped** (308 files).
- `flutter analyze --no-fatal-infos`: 0 errors/warnings (272 pre-existing test
  infos only).
- **One failure caught + fixed by this gate:** `agent_configs_repository.test.ts`
  asserted the pre-#960 always-UUID `insert()`; updated to assert the new
  label-derived slug. Per-branch tests didn't cover it — the combination gate did.

## Environment notes (for future parallel-worktree runs)

- Worktrees need BOTH `apps/*/node_modules` AND the **root** `node_modules`
  symlinked — the repo is an npm workspace and hoists `better-sqlite3`/`ws`/`pg`/
  `resend` to root. app-level symlink alone → `Cannot find module 'better-sqlite3'`.
- The root `node_modules` symlink is NOT matched by a `node_modules/` (dir-only)
  gitignore, so never `git add -A` in a worktree — use `git add -u` + explicit
  new-file adds. (Codex's own `rm node_modules` cleanup also removed the shared
  symlink; re-link before re-gating.)
- Codex ran on `gpt-5.5`/high (the `~/.codex/config.toml` default; no `--model`
  passed).

## Handoff

Draft PR pending. Merge is manual after AJ sign-off + the #943 visual smoke.
