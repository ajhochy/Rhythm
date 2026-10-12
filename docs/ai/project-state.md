# Rhythm current state

## Current focus

Coordinator coding runs on mega: one Rhythm Coordinator chat starts one existing workflow-orchestrator run per
captured goal, in its own worktree of the repo the goal names; Details → Runs lists/opens/stops them. The bounded
chat workflow and typed Coding Workflow adapter are retired.

## Active branch / PR

`feature/coordinator-workflow-runs-mega` from `mega/2026-09-29-consolidation` @ edb7158c — local only, not pushed,
no PR. Port of `feature/coordinator-workflow-runs`; see runs/2026-10-12-coordinator-workflow-runs-mega-port.md.

## In progress

Hand-off to the coordinator for push/PR decision and manual smoke.

## Risks / known issues

- Runs use bypassPermissions confined to their worktree (`external_directory: deny`); a goal must name the repo
  by absolute path, otherwise it is held as repo_required.
- Live sandbox demo and Electron packaged smoke not run on this port.
- Dayflow schema-2 workflow provider-guard protocol remains (unwired) in api_server and the fork.

## Test status

api_server full suite: 0 failed (baseline edb7158c also 0; no new failures). api/mcp/web typecheck clean;
mcp_server 224 passed; web unit 79/79.

## Next step

Coordinator decides push + draft PR; AJ manual smoke in a sandbox (`tools/dev/sandbox.sh`, never 4001/4096).
