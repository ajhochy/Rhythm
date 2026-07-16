# Project State

## Current focus

PR #1106 / issue #1082 is fully verified on the rebased local candidate: managed-skill apply → measure → revert restores the authoritative `SKILL.md` byte-for-byte instead of overwriting it from a stale database row.

## Active branch / PR

- Branch: `codex/pr-1106-hardening`
- PR: #1106 — https://github.com/ajhochy/Rhythm/pull/1106
- Candidate: `85c338223`, based directly on `main` `f7d3004b1`.
- Hosted PR head is still the pre-rebase `4c52d907b`; push and CI are pending.
- Run record: `docs/ai/runs/2026-07-16-1082-skill-revert-ondisk-snapshot.md`.

## In progress

- Update the hosted PR branch to candidate `85c338223` and require CI on that exact SHA before merge.

## Risks / known issues

- The full-suite task-controller malformed-query failure is an intermittent, pre-existing transport/global-fetch contamination issue, not part of PR #1106. Follow-up: `docs/ai/generated-issues/FOLLOWUP-flaky-tasks-controller-overdue.md`.
- PR #1106 makes rollback byte-safe; the separate workflow-prompt-fix stale-source composition concern remains owned by PR #1107.
- The hosted PR is not yet evidence for this local candidate because it still points at `4c52d907b`.

## Test status

- Static, issue, and PR workflow gates all pass on `85c338223`; the targeted suite passed 7/7 and contract c1-c7 are recorded pass.
- Vendored-engine and API builds passed.
- The dedicated API/engine sandbox on ports 4198/4197 passed health, capabilities, and auth probes.
- The live real-HTTP exact-byte rollback passed 1/1 in 19 seconds and cleanup confirmed zero residual fixtures.
- GitNexus compare reported low risk and zero affected execution flows.
- Hosted CI for `85c338223` remains pending until the rebased branch is pushed.

## Next step

Force-push the refreshed PR branch with lease protection, watch CI, then merge only candidate `85c338223` if that exact SHA is green.
