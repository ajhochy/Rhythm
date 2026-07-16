# Project State

## Current focus

PR #1106 hardens issue #1082 so managed-skill apply → measure → revert restores the authoritative `SKILL.md` byte-for-byte instead of overwriting it from a stale database row.

## Active branch / PR

- Branch: `codex/pr-1106-hardening`
- PR: #1106 — https://github.com/ajhochy/Rhythm/pull/1106
- Base: rebasing onto `main` after merged PR #1104 (`f7d3004b1`).
- Run record: `docs/ai/runs/2026-07-16-1082-skill-revert-ondisk-snapshot.md`.

## In progress

- Finish the rebase onto current `main`, rerun the post-rebase verification gate, update the hosted PR branch, and require CI on the resulting SHA before merge.

## Risks / known issues

- The full-suite task-controller malformed-query failure is an intermittent, pre-existing transport/global-fetch contamination issue, not part of PR #1106. Follow-up: `docs/ai/generated-issues/FOLLOWUP-flaky-tasks-controller-overdue.md`.
- PR #1106 makes rollback byte-safe; the separate workflow-prompt-fix stale-source composition concern remains owned by PR #1107.
- Other open PRs must remain sequentially rebased and verified against the latest `main`.

## Test status

- All issue #1082 contract criteria c1-c7 pass.
- Acceptance plus related regressions passed; the isolated real-HTTP contract passed against a freshly built fork/API and restored exact pre-apply content.
- API typecheck/build, vendored-engine build, sandbox health probes, and the complete PR-level workflow gate passed on the local candidate.
- GitNexus compare reported low risk and zero affected execution flows.
- Final post-rebase checks and hosted CI are still pending.

## Next step

Complete the rebase, rerun verification on the clean commit, force-push the refreshed PR branch with lease protection, watch CI, then merge only that exact green SHA.
