# Rhythm — project state

## Current focus
Approval queue hygiene: expired approval cards are hidden; the external-content approval window is 1 hour.
Coordinator workflow runs (#1612) are merged into mega and shipped in qualification build 0.18.75.

## Active branch / PR
`fix/hide-expired-approvals` (from `mega/2026-09-29-consolidation` @ 60a6db83) — draft PR into mega.
Mega → main is draft #1598. Never merge without AJ.
Installed app: `/Applications/Rhythm.app` 0.18.75 (qualification build; does not contain this fix).

## In progress
Review of the draft PR; a 0.18.76 qualification build only if AJ asks. Run log:
[runs/2026-10-12-hide-expired-approvals.md](runs/2026-10-12-hide-expired-approvals.md).

## Risks / known issues
- Coordinator runs use bypassPermissions confined to their worktree (`external_directory: deny`); a goal must name
  the repo by absolute path.
- The approval list hides expired cards only from `status=pending`; agents that asked must ask again after 1 hour.
- Fork still carries the schema-2 provider-guard protocol of the retired typed adapter.
- 3,795 historical NULL-owner sessions not backfilled; 8 pre-existing FK orphans in agent_session_messages.

## Test status
api_server full suite on this branch: 8701 passed, 4 failed — all pre-existing or env (turn_routing D2 fails on
mega base; mcp_tool_grant_drift ×2 + skill_usage_tracker need tsx in apps/api_server/node_modules).
Web gateway spec: "post-login local boundary" fails on mega base too.

## Next step
AJ reviews the draft PR; merge into mega and cut 0.18.76 when wanted.
