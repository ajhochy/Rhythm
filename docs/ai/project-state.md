# Rhythm — Project State

## Current focus
Bucket E has a separate HIGH-risk Postgres bootstrap prerequisite in draft PR #1464.
Preserve the Org Optimizer workflow and PR records #1383, #1453, #1459, #1460, #1461, #1462,
and #1463; each outstanding draft remains subject to its documented manual smoke.

## Active branch / PR
- Current prerequisite branch: `codex/prereq-postgres-agent-sessions-bootstrap` → draft PR #1464.
- Active drafts: Numbat observability #1453, H1 #1459, mobile relay #1460, H2 #1461,
  Electron packaging #1462, and task-sharing prerequisite #1463.
- Mobile rebuild PR #1383 is merged; preserve its completed verification and manual-smoke record.
- Org Optimizer remains a separate parallel workflow.

## In progress
- Fresh Postgres bootstrap previously failed because the QA foreign key referenced
  `agent_sessions` before that table was created.
- The prerequisite moves the byte-identical `agent_sessions` CREATE block after the role guard and
  task bootstrap. It does not rewrite the SQL.
- Bucket E remains blocked until this prerequisite is integrated and Bucket E's Postgres diagnostic
  reruns.

## Risks / known issues
- This prerequisite is HIGH risk because it changes production Postgres bootstrap ordering, despite
  preserving the CREATE block byte-for-byte.
- Base-branch test failures remain out of scope for this prerequisite.
- Existing full-suite parallel flakes may still occur in api_server vitest or mobile Playwright;
  isolated reruns pass.

## Test status
- Verification PASS `9883dccb-0412-47b4-85f9-6d6aa09b0c4e`; contract
  `docs/ai/contracts/task-postgres-agent-sessions-bootstrap-order.json` passed 9/9.
- Default, all, and local roles create `agent_sessions`; cloud and relay skip it. Role assertions
  passed 7/7, sentinel/idempotency checks passed, and role separation passed 28/28.
- API build and TypeScript checks passed. Base failures were confirmed out of scope.

## Next step
Manually review draft PR #1464's ordering-only diff, then rerun Bucket E's Postgres diagnostic on
the stacked branch. Do not unblock Bucket E before both steps complete.
