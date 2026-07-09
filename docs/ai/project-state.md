# Project State

## Current focus

Four major workstreams have each landed as a PR, all awaiting manual merge
(no auto-merge in this repo):

1. **#933-#936 — workflow-failure-signals chain**, verified live on branch
   `issues-933-936-workflow-signals`; PR open (draft). Read-only failure
   extractor → org audit snapshot → existing optimizer lanes, with
   dedup/cap/stale-fixed safeguards. See
   `docs/ai/runs/2026-07-09-933-936-workflow-signals-live.md`.
2. **#949 — skill harvester writes draft `SKILL.md` + auto-binds to source
   agent** — MERGED to `main`.
3. **#930 — model fallback chain / cross-provider handoff** — draft PR #940.
4. **#929 — skill self-regulation / bad-harvest detection** — draft PR #955.

## Active branch / PR

- `issues-933-936-workflow-signals` — PR open (draft), fixes #933-#936.
  Cut from `origin/main` **before #949 merged**, so it does not contain
  #949; unrelated files, merge independently.
- PR #950 / `issue-949-harvest-to-file` — MERGED to `main` (fixes #949).
- PR #940 / `issue-930-model-fallback-chain` — draft, awaiting manual merge
  (fixes #930).
- PR #955 / `issue-929-skill-self-regulation` — draft, awaiting manual
  merge (fixes #929).

## In progress

- Nothing mid-flight in this worktree; #933-#936 chain is verified and
  ready for review.
- Manual merges of PR #940 and PR #955 are pending (independent of each
  other and of the #933-#936 PR).

## Risks / known issues

- **#952 — dead providers.** Follow-up needed; not yet fixed.
- **#951 / #954 — follow-ups** from the #949/#930/#929 work, not yet
  started.
- `AgentSkillsRepository` + `agent_skills` table still not deleted (32
  direct callers) — only the `distillFromSession` write site changed in
  #949. Cleanup remains a follow-up.
- Pre-existing unrelated test failures (22, memory-vault +
  auth-middleware, ENOENT temp-dir + 401 auth env issues) predate the
  #933-#936 branch.

## Test status

- **#933-#936**: live E2E gate passed twice (incl. verbose) against the
  real fork-engine backend; full api_server unit suite 290 files / 2485
  passed / 2 skipped (the live-gated tests); `tsc --noEmit` clean.
- **#949**: `tsc --noEmit` clean; `skill_extractor.test.ts` 9/9; resolver
  suites 59/59; live #948/#949 phases verified manually.
- **#930 / #929**: see PR #940 / PR #955 for their own test status.

## Next step

1. Push `issues-933-936-workflow-signals` and open/refresh its draft PR for
   review (this run).
2. Manual merge of PR #940 (#930) and PR #955 (#929) — independent of each
   other and of the #933-#936 PR.
3. Pick up #952 (dead providers) and the #951/#954 follow-ups.

## Recent coding-agent runs

### 2026-07-09 — 933-936-workflow-signals-live
- Files modified: workflow-failure-signal extractor, org audit snapshot
  wiring, optimizer lane mapping, dedup/cap/stale-fixed safeguards, gated
  live E2E test, `docs/ai/runs/2026-07-09-933-936-workflow-signals-live.md`.
- Checks run: live E2E gate PASS (twice, incl. verbose); full api_server
  suite 2485 passed / 2 skipped; `tsc --noEmit` clean.
- Bug found by the live gate: create-recipe dedup key collapsed on empty
  agent profile for agent-less sessions, suppressing distinct proposals;
  fixed via a stable per-category `dedupToken` (commit `e3feef0cd`).
- Deviations from spec: none.
- Concerns: branch predates #949 — merge #940/#955 independently of this
  PR.

### 2026-07-06 — issue-batch-917-918-919-921
- Files modified: `apps/api_server/src/database/migrations.ts` (profile data repair), `apps/api_server/src/services/agent_runner.ts` (fallback model), `apps/api_server/src/services/opencode_agent_writer.ts` (disabled projection gate), focused API tests, `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (trigger profile routing), docs run log.
- Checks run: `npx tsc --noEmit` pass; targeted Vitest pass (`6 files, 50 tests`); full `npm test` failed under sandbox bind restrictions (`listen EPERM`, `1971 passed / 423 failed / 58 skipped`); Flutter `dart format .` and `flutter analyze --no-fatal-infos` blocked by SDK cache write permission.
- Decisions made: #921 uses trigger-only routing to `secretary` instead of globally scoping `claude-code`/`codex`, preserving manual escape-hatch behavior.
- Deviations from spec: full Vitest and Flutter checks could not complete cleanly in this sandbox; local stale opencode agent files could not be removed from `~/.config`.
- Concerns: orchestrator should rerun full API/Flutter checks in an environment allowed to bind ports and write the Flutter SDK cache.
