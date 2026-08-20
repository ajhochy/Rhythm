---
date: 2026-08-19
repo: Rhythm
branch: agent-stack/si-d2-post-apply-lifecycle
pr: 1454
issues: [1434]
status: ready-for-verification
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# D2.4 (#1434) — current verification evidence

## Contract

- Contract: `docs/ai/contracts/issue-1434.json`.
- D2.4 restores exhausted repairs through `revertProposal` and persists a redacted full-trail alert.
- `revertProposal` enforces `UNSAFE_WHOLE_FIELD_SCOPE_FIELDS`; the `allowedSkillsJson` regression leaves the live field unchanged and persists `revert_failed` plus an alert.
- `extractValidatedConfigPatch` is shared by apply and revert paths and narrows only fields in `CONFIG_PATCH_FIELDS`.
- The CAS-race test now parses the persisted alert and directly asserts `revert.outcome === 'revert_failed'` and `revert.conflict.reason === 'proposal-cas-conflict'`.

## Acceptance RED

- Falsification command: `cd apps/api_server && npx vitest run src/services/__tests__/auto_revert_service.test.ts`.
- Temporarily expected `wrong-proposal-cas-conflict` for the persisted conflict reason.
- Result: **1 file / 7 tests: 6 passed, 1 failed**. The assertion received `proposal-cas-conflict`, proving the new persisted-fact check catches drift. The required expectation was restored before final checks.

## Files

D2.4 and its root-cause fix modify existing:

- `apps/api_server/src/services/org_proposal_apply.ts`
- `apps/api_server/src/services/org_proposal_apply_service.ts`
- `apps/api_server/src/__tests__/org_proposal_apply.test.ts`

They add the auto-revert service and focused test, and update the contract, this run note, and `docs/ai/project-state.md`.

## Checks

- `npx vitest run src/services/__tests__/auto_revert_service.test.ts`: **1 file / 7 tests pass**.
- `npx vitest run src/services/__tests__/auto_revert_service.test.ts src/__tests__/org_proposal_apply.test.ts`: **2 files / 116 tests pass**.
- Maintained D2.4 regression suite: **9 files / 359 tests pass**.
- `node_modules/.bin/tsc --noEmit`: **PASS**.
- `npm run build`: **PASS**.
- Independent verifier full suite: **694 files / 5675 tests: 5488 pass, 7 known unrelated fail, 180 skipped**.
- `node -e "JSON.parse(...)"`: **PASS** for `docs/ai/contracts/issue-1434.json`.
- Stale-claim scan across the contract, this run note, and auto-revert test comments: **zero stale claims**. The only listed-number match is the intentional **7 tests / 6 passed / 1 failed** acceptance falsification above, not superseded final evidence.
- `git diff --check`: **PASS**.

## Environment and risk

- GitNexus risk is **UNKNOWN**. The index points at a stale checkout and cannot map the worktree-only symbols.
- Sandbox verification is **BLOCKED** before services launch by missing `@opentui/solid/preload`; cleanup passed. It was not rerun for this repair.
- No production behavior or dependencies changed in this follow-up.

## Current status

D2.4 is implemented and awaiting this final verification follow-up. D2.5 is not started. PR #1454 remains draft.
