# Project State

## Current focus

Manager-agent profile projection now defaults to direct in-scope work and treats
delegation as an explicit exception. The shared source change is verified; no
generated files in the installed app were edited.

## Active branch / PR

- Branch: `fix/manager-agents-direct-work`
- PR: not opened yet
- Run record: `docs/ai/runs/2026-07-15-manager-agents-direct-work.md`

## In progress

- Prepare the verified change for a draft PR and human manual review.

## Risks / known issues

- The host exports an empty `MEMORY_VAULT_SUBDIR`; full API tests require the
  documented `MEMORY_VAULT_SUBDIR=memory` override.
- API source changes do not affect the installed Rhythm app until the API bundle
  is rebuilt into a new app build, Rhythm/API is restarted, and the Secretary,
  Theologian, and Coding Workflow profiles are resynced.
- The isolated sandbox reports HTTP 200 while its engine is still initializing;
  behavioral probes must wait for `/opencode/health` JSON status `ready`.

## Test status

- Focused writer tests: 2 files, 26 tests passed.
- Issue and PR workflow gates passed; the PR gate included the full API Vitest
  suite. API typecheck and production build passed.
- Live isolated behavior passed after freshly rebuilding the fork and API:
  `/health` was `ok`, `/opencode/health` was `ready`, and the real resync test
  passed for `secretary`, `theologian`, and `workflow-orchestrator`.
- GitNexus compare against `origin/main`: low risk, one changed production
  symbol, zero affected execution flows. `git diff --check` passed.

## Next step

Open a draft PR only, then hand it to AJ for the repository's manual smoke and
release decision. Never merge or deploy automatically.
