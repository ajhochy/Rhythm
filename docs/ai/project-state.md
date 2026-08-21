# Project State

## Current focus

Issue #1442 (D4.4): explicit auto-promotion availability and durable user
opt-in for the local optimizer API and shipping Flutter desktop Settings UI.

## Active branch / PR

- Branch: `agent-stack/si-d4-1442-optin-terra`
- Base: `bc287cc3`
- Commit: local `feat(optimizer): add auto-promotion opt-in`
- PR: none. No push, merge, or deployment was performed.

## In progress

- Parent integration/review of the completed local #1442 commit.
- #1441 experiment gate, #1443 matrix, and #1444 regression hook remain out
  of scope and unimplemented here.

## Risks / known issues

- GitNexus impact/detect is UNKNOWN because this worktree has no callable
  GitNexus integration or index. Direct caller review limits the change to the
  local optimizer API and desktop Settings path.
- The availability environment variable is a server kill switch, not consent;
  consent remains off until the authenticated, confirmed, eligible, zero-
  regression mutation succeeds.
- Sandbox fixture hygiene matters: the live proof used a generated sanitized
  fixture because the supplied one lacked the OpenCode fields/session required
  by the engine startup gate.

## Test status

- Node 22 focused API contracts and adjacent trust coverage: 18 passed.
- Node 22 API typecheck/build: passed.
- Live API behavioral test through `tools/dev/sandbox.sh`: 1 passed; sandbox
  removed and ports closed.
- Flutter focused D4.4 Settings suite: 11 passed; full Settings suite: 73
  passed; visual goldens cover the control and warning dialog.
- `dart format`, Flutter analyze (exit 0; 318 inherited infos), and
  `ai-workflow checks --level issue`: passed. The broad PR gate was started
  but its serial process was orphaned by the local execution harness, so it
  is not counted as verification evidence.

## Next step

Parent integration can review the one-issue commit without pushing, merging,
or deploying.
