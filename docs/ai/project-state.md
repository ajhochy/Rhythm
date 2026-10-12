# Rhythm — project state

## Current focus
Coordinator tracks multiple runs of the existing coding workflow (workflow-orchestrator) from one chat;
bounded coding layer retired. Plan: [plans/2026-10-12-coordinator-workflow-runs.md](plans/2026-10-12-coordinator-workflow-runs.md).

## Active branch / PR
`feature/coordinator-workflow-runs` (from `codex/rhythm-deliverables-completion-20261010` @ ff0e8c84) — draft PR,
awaiting AJ's manual smoke. Never merge without AJ.
Installed app: `/Applications/Rhythm.app` 0.18.74 (unchanged; does not contain this branch).

## In progress
Manual smoke by AJ (checklist in the PR). Run log: [runs/2026-10-12-coordinator-workflow-runs.md](runs/2026-10-12-coordinator-workflow-runs.md).

## Risks / known issues
- Coordinator runs use bypassPermissions confined to their worktree (`external_directory: deny`); a goal must name
  the repo by absolute path.
- First coordinator message right after a runtime restart can return `foreground_uncertain` (engine warm-up vs 2 s
  prompt-anchor timeout); the card's Retry only replays it.
- Not run: Electron packaged smoke; one web test needing `apps/mobile` React; `sandbox_attached_transport_contract_test.mjs`.
- Fork still carries the schema-2 provider-guard protocol of the retired typed adapter.
- 3,795 historical NULL-owner sessions not backfilled; 8 pre-existing FK orphans in agent_session_messages.

## Test status
api_server full suite: 29 failed / 20 files, all pre-existing (baseline ff0e8c84: 31 / 21); mcp_server 224/224;
contract + coordinator tests 98/98; live sandbox demo + `coordinator_workflow_runs_live.test.ts` passed.

## Next step
AJ manual smoke against the sandbox (or a qualification build), then decide merge; follow-ups listed in the run log.
