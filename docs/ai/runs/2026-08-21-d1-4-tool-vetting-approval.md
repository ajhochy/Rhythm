---
date: 2026-08-21
repo: Rhythm
branch: agent-stack/si-d1-tool-vetting-sonnet
pr: null
issues: [1429]
status: pass
tags: [run, rhythm, d1, tool-vetting]
---

# D1.4 tool vetting approval gate

## Files

- Central policy + reusable apply/controller guard, report fingerprint migration/repository/model, unattended-lane refusal, D1 route/policy/live tests, and D1.4 contract.

## Checks

- RED: `npx vitest run src/services/__tests__/tool_install_safety_policy.test.ts` failed because the policy module did not exist.
- Focused D1.1–D1.4 + adjacent proposal matrix: 12 files, 298 passed / 1 env-gated live skipped. After the final unattended-path refusal, the affected policy/route/apply subset passed 149/149.
- Node 22: `npx tsc --noEmit` and `npm run build` passed.
- Docker: accepted vetter focused safe + broken-candidate classifications, 2 passed / 55 skipped; vetter owns exact container teardown.
- Live: `RHYTHM_LIVE_E2E=1 ... npx vitest run src/__tests__/d1_tool_install_approval_live_e2e.test.ts --no-file-parallelism` passed 1/1 against `tools/dev/sandbox.sh` on API/engine/gateway 4298/4297/4299. `status`, `/health`, and `/opencode/health` were healthy; exact `down` removed the D1 sandbox and released all three ports.
- `git diff --check` passed. Added-line scan found only test variable names/authorization header references, no secret values.
- GitNexus detect-changes: UNKNOWN. The local index lists other Rhythm worktrees but not this one; no reindex was run.

## Notes

- The first accepted fixture had an invalid `mcp.rhythm` shape; it was torn down immediately. The final live run used the separate read-only sanitized fixture with a valid closed local MCP entry. No production DB/config/process was touched.
