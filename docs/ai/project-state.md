# Project State

## Current focus

Prepare the verified delegation model-override change for a draft PR. Both
`rhythm_delegate` and `rhythm_delegate_async` accept an optional validated
`{providerID, modelID}` override; omission retains the target profile default.

## Active branch / PR

- Branch: `feat/delegation-model-override`.
- PR: not opened yet. There is no associated GitHub issue; the local
  `docs/ai/contracts/issue-001.json` is a workflow contract only.

## In progress

- The orchestrator is running final Git checks, then will commit, push, and open a
  draft PR. No merge is authorized.
- Sync delegation passes `modelOverride`; async delegation passes the selected
  provider into `createSession` and the full model into `promptAsync`. Agent-profile
  scope is unchanged.

## Risks / known issues

- Five full API-suite memory failures reproduce identically on `origin/main` and
  are unrelated to this branch.
- Model-catalog custom-provider authorization was repaired: only authenticated,
  keyless, or explicitly `opencode.json`-configured providers are authorized.
  Built-in unauthenticated Zen is rejected with 400; #1143 custom-provider behavior
  remains covered.
- GitNexus pre-edit impact was LOW with zero affected processes. Final
  `detect_changes` remains with the orchestrator.

## Test status

- Verification gate: **PASS**; contract criteria C1–C9 pass.
- API: focused 40 tests pass; TypeScript and build pass.
- MCP: focused 2 and full 156 tests pass; TypeScript and build pass.
- Live: 3/3 pass. Default `google/gemini-2.5-pro` and override
  `google/gemini-2.5-flash` reached idle with expected persisted models; an invalid
  override returned 400 and created no child.
- Sandbox stopped; ports 4097 and 4098 are clear.

## Next step

Orchestrator completes final Git checks, commits, pushes, and opens a draft PR.
Human manual smoke and merge remain required.
