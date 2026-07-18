---
date: 2026-07-17
repo: Rhythm
branch: mega/opencode-utilization-1042-1108
pr: null
issues: [1042, 736, 818]
status: pass
tags: [run, Rhythm]
---

# #1042 test-mock regression fix (replyToPermission)

## Context

#1042/OCU-01 changed `opencode_stream_bridge.ts`'s auto-deny paths (out-of-allowlist
tool-call backstop, plan-mode auto-deny, bypassPermissions auto-accept) to call
`opencodeClient.replyToPermission(permissionId, decision, message, dir, sdkSessionId)`
instead of the legacy `respondPermission(...)`. Two contract tests still mocked
only `respondPermission` on the `opencode_engine` module, so the mocked client
object lacked `replyToPermission` and the tests threw
`TypeError: opencodeClient.replyToPermission is not a function` at the first
out-of-allowlist tool-call assertion.

## Files changed

- `apps/api_server/src/__tests__/issue_736_contract.test.ts`
- `apps/api_server/src/__tests__/issue_818_contract.test.ts`

## Changes

Both files:
- Added a `replyToPermissionSpy` (`vi.fn().mockResolvedValue(true)`) to the
  `vi.hoisted` block, mirroring `respondPermissionSpy`.
- Wired `replyToPermission: replyToPermissionSpy` into the mocked
  `../services/opencode_engine` `opencodeClient` object (kept `respondPermission`
  mocked too — still exercised by the sibling `opencode_stream_bridge.test.ts`
  and unrelated call sites).
- Added `replyToPermissionSpy.mockClear()` in `beforeEach`.
- Updated the two assertions that previously inspected
  `respondPermissionSpy.mock.calls` for an `'accept'` 3rd arg (the old
  `respondPermission(sessionId, permissionId, decision, dir)` shape) to instead
  inspect `replyToPermissionSpy.mock.calls` for a `'once'` 2nd arg — the new
  shape's decision arg (`'once'` = accept, `'reject'` = deny). Intent
  preserved: the out-of-allowlist tool must never be auto-accepted.
- `issue_736_contract.test.ts` c1 test: added an explicit
  `expect(replyToPermissionSpy).toHaveBeenCalledWith('perm-1', 'reject', ...)`
  assertion to positively confirm the new deny call shape, not just the
  absence of an accept.

No production code changed — `opencode_stream_bridge.ts` (the #1042 change) is
correct; only the two tests' mock boundary was stale.

## Checks run

```
cd apps/api_server && HOME=/tmp/rhythm-fix-home npx vitest run \
  src/__tests__/issue_736_contract.test.ts src/__tests__/issue_818_contract.test.ts
```
Result: **2 test files passed, 15 tests passed** (0 failed).

```
cd apps/api_server && HOME=/tmp/rhythm-fix-home npm run build
```
Result: `tsc -p tsconfig.json` exit 0, postbuild copy step ran clean.

```
detect_changes({repo: "Rhythm", scope: "unstaged"})
```
Result: risk_level `low`, `affected_count: 0` (only `docs/ai/project-state.md`
section touches from a prior, unrelated in-progress edit — not part of this
fix — plus the two test files, which produced no changed-symbol/process hits
since they're test-only mock edits).

## Notes

- Pure test-mock fix (type-only/test-only change, no behavior change) — no
  live behavioral test required per AGENTS.md's exceptions clause.
- Sandbox (`tools/dev/sandbox.sh`) was already running; not needed for this
  fix per dispatch instructions — ran vitest/tsc directly against the branch
  working copy.
- Did not touch `docs/ai/project-state.md` (pre-existing unstaged edit from
  another in-progress task on this branch) — out of ownership for this fix.
- Risk: none identified. The fix only updates test doubles to match the
  already-shipped #1042 production code; it does not change `isToolAllowed`,
  `isToolAllowedForSession`, or any dispatch decision logic.
