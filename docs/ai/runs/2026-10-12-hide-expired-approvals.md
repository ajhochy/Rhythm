---
date: 2026-10-12
repo: Rhythm
branch: fix/hide-expired-approvals
pr: draft into mega
issues: []
status: verified
tags: [run, rhythm]
index: "[[Rhythm]]"
---

## Files
- `apps/api_server/src/repositories/agent_approvals_repository.ts` — `list('pending')` excludes `expires_at <= now`.
- `apps/api_server/src/services/external_content_security_service.ts` — `APPROVAL_TTL_MS` 10 min → 60 min.
- `apps/web/src/gateway/approvals.ts` — a 403 whose server message mentions expiry shows that message.
- Tests: `issue_1382_approval_lanes.test.ts` (real HTTP route; red without the fix), `tests/gateway/gateway.spec.ts`.

## Checks
- api_server `tsc --noEmit` clean; full vitest 8701 passed / 4 failed (pre-existing: turn_routing D2 on base,
  tsx-path env ×3). Web `npm run build` OK; new gateway test passes.

## Notes
- Trigger: AJ saw "Approval access denied…" on an approval card. Server log showed
  `FORBIDDEN … This approval expired; ask for a new proposal` — identity was fine, the card was expired (b31c60b3).
- Decision: [decisions/2026-10-12-approval-expiry-hide-and-1h.md](../decisions/2026-10-12-approval-expiry-hide-and-1h.md).
