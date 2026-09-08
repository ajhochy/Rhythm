# Rhythm — Project State

## Current focus

Org Reviewer replacement is implemented and automated verification passed on `feature/org-reviewer`. All 14 live acceptance checks passed, including the actual scheduled `openai/gpt-5.6-sol` reviewer. Draft PR creation and AJ's manual smoke remain pending.

## Active branch / PR

- `feature/org-reviewer`, based on `origin/main` at `0bc46a5e`; draft PR pending.
- Evidence: [run](runs/2026-09-07-org-reviewer.md), [decision](decisions/2026-09-07-org-reviewer.md), [contract](contracts/org-reviewer.json).
- No merge, deployment, main edits, or direct live database access. The temporary sandbox and its authorized OpenAI credential copy were removed.

## In progress

- Commit/push and draft PR handoff; contract criterion c11 stays pending until the actual draft PR is recorded.
- AJ's review and [manual smoke](../testing/org-reviewer-manual-smoke.md).

## Risks / known issues

- The scheduled reviewer uses its projected identity, one owned skill, two MCP tools, and default permission mode with explicit denials. Shared AgentRunner upstream impact is HIGH; the behavior change is restricted to `org-reviewer` and ordinary-agent regressions pass.
- Ownerless sessions see global evidence only; owned reviewers see their own and global evidence. Missing or oversized current-state proof suppresses proposals.
- GitNexus reports LOW for indexed changes; new reviewer files are not indexed and were inspected manually and exercised live. This does not replace the AgentRunner impact warning.
- Human approval/reject/revert remains authoritative. Reviewer proposals cannot enter automatic promotion. Manual smoke has not yet been performed.

## Test status

- API final gate: 6,102 passed, 245 skipped; 654 files passed, 125 skipped; 439.26 seconds. API typecheck/build pass. Lint remains the repository's existing TODO placeholder.
- MCP final gate: 188 passed, 2 skipped; 32 files passed, 2 skipped; 3.98 seconds. MCP typecheck/build pass.
- Actual API/fork sandbox: 14/14 live acceptance checks passed, 206.73 seconds. The real model clustered recurring failures, skipped fixed/injection findings, traced dispatch overrides, and submitted one actionable proposal. Signed ownership, stale-proof, deduplication, schedule, and permission checks passed.
- Existing optimizer safety smoke script exited 0 after an authorized IPC rerun. Unchanged Flutter, fork, and mobile PR-gate stages passed.

## Next step

Open a draft PR, record its URL and draft status in the run/contract, and hand off the manual smoke checklist to AJ. Merge and deployment remain outside this task.
