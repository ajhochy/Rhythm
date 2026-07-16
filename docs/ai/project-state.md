# Project State

## Current focus

Issue #1038 / draft PR #1104 fixes the shipping Flutter client's Projects
background so both Active Projects and Templates follow light and dark themes
with readable header contrast. Verification is complete on the local candidate.

## Active branch / PR

- Candidate branch: `codex/pr-1104-verify` at `e68ab156d`.
- Draft PR: #1104 — https://github.com/ajhochy/Rhythm/pull/1104
- The production fix, issue contract, and four golden baselines are still dirty
  in this worktree for orchestrator integration.
- Run record: `docs/ai/runs/2026-07-16-issue-1038-projects-dark-mode.md`.

## In progress

- No implementation or verification work remains for #1104.
- The merge-train orchestrator still needs to integrate the verified dirty files,
  rebase the PR onto the then-current `main`, and run the final post-rebase gates.

## Risks / known issues

- Open PRs must be rebased and merged sequentially; #1106 precedes #1107, and
  #1100 remains last because it changes the shipping engine binary.
- Other train gates remain unresolved outside #1104: #1105 live-sandbox
  attestation, #1102 legacy nullable MCP scopes, #1095 Postgres owner isolation,
  #1101 DST/production cron restoration, and #1103 model/fallback availability.
- A sandbox may return HTTP 200 while its engine initializes; backend probes must
  wait for `/opencode/health` JSON status `ready`. This UI-only PR does not use the
  backend, so a live backend behavioral test is not applicable.

## Test status

- Issue contract: 1/1 passed; full Flutter suite: 864/864 passed.
- `dart format . --set-exit-if-changed`, `flutter analyze --no-fatal-infos`, and
  both `ai-workflow checks --level issue` / `--level pr` passed.
- `flutter build macos --release` passed; packaged app size was 68.4 MB.
- Four contract goldens and native packaged dark-mode screenshots of both
  Projects panes were visually inspected; backgrounds were dark and headers
  remained readable.

## Next step

Integrate the verified #1104 candidate into its PR branch, rebase it onto the
latest merge-train `main`, rerun the same automated gates, and merge only after
the rebased checks remain green.
