---
date: 2026-07-16
repo: Rhythm
branch: codex/pr-1106-hardening
pr: 1106
issues: [1082]
status: verified-locally-awaiting-remote-CI
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# #1082 — byte-exact managed-skill rollback

## Files changed

- `apps/api_server/src/services/rhythm_managed_skills.ts` adds a confined exact-byte read path for a managed `SKILL.md`.
- `apps/api_server/src/services/org_proposal_appliers_wiring.ts` scans revised content before any mutation and snapshots the authoritative file separately from the DB state.
- `apps/api_server/src/services/org_proposal_apply.ts` restores the DB snapshot and exact file bytes independently; DB rendering is used only when the original file was absent.
- `apps/api_server/src/__tests__/issue_1082_skill_revert_ondisk.test.ts` verifies the independent semantic DB and byte snapshots.
- `apps/api_server/src/__tests__/issue_1082_acceptance_contract.test.ts` covers criteria c1 and c3-c7.
- `apps/api_server/src/__tests__/live_e2e_1082_skill_revert.test.ts` covers c2 through the real sandboxed HTTP apply → measure → revert path.
- `docs/ai/contracts/issue-1082.json` records all seven criteria as passed.
- `docs/ai/testing-guide.md` documents the isolated live command and required safety flags.

## Checks run

- Acceptance contract reproduced the prior defect first: 5 failed / 1 passed before hardening.
- Acceptance plus related proposal regressions: 5 files / 31 tests passed after hardening.
- Final rebased candidate: `85c338223`, directly atop `main` `f7d3004b1`.
- Static, issue, and PR workflow gates passed; the targeted verification set passed 7/7.
- Contract `docs/ai/contracts/issue-1082.json` records all seven criteria c1-c7 as pass with no untested criteria.
- API typecheck/production build and vendored-engine `bun run build --single` passed.
- Dedicated sandbox API/engine ports 4198/4197 passed health, capabilities, and auth probes.
- Live isolated HTTP contract: 1/1 passed in 19 seconds. Approval returned `measuring`; the proposal became `reverted`; final HTTP-visible content exactly matched the authoritative pre-apply file rather than the stale DB body.
- Live cleanup completed with zero residual skill/proposal fixtures.
- `git diff --check` passed. GitNexus compare reported low risk and zero affected execution flows.
- The hosted PR still points at old head `4c52d907b`; candidate push and CI are not claimed in this local record.

## Notes

- Snapshot shape: authoritative semantic file body, exact base64 file bytes, explicit `managedFileWasPresent`, separate `priorDbBody`, and prior status.
- Unsafe revisions are rejected before DB, managed-file, or proposal-lifecycle mutation.
- Missing-file rollback deliberately recreates `SKILL.md` from the DB fallback; an existing file never uses that fallback.
- Failure-triage summary: the first full-suite verification attempt intermittently saw a task-controller malformed-date request return HTTP 200. Triage found the affected production validator, route, test, and real-server helper unchanged from `origin/main`; the named test passed 26/26 in isolation, and the exact PR gate plus subsequent full-suite stress reruns passed. The likely cause is out-of-scope transport/global-fetch contamination, so no task-controller assertion or production code was weakened. Follow-up: `docs/ai/generated-issues/FOLLOWUP-flaky-tasks-controller-overdue.md`.
- Live-test setup recovery was environmental: the fresh worktree needed its declared Bun dependencies installed, and the 5-second default Vitest timeout was reconciled with the recon-observed 17.7-second scorer/revert path. The bounded test now uses a 130-second outer timeout around its existing 120-second poll.
- No push, merge, deployment, or GitHub mutation is included in this local verification record.
