# Project State

## Current focus

Issue #868 — productionize the manually-proven local oMLX (Apple Silicon)
inference provider as an OPTIONAL provider + a constrained `local` agent
profile. Implemented in this worktree. Not yet opened as a PR.

## Active branch / PR

- **`issue-868-omlx-provider`** (worktree:
  `/Users/ajhochhalter/Documents/rhythm-worktrees/868-omlx`) — implements
  #868. No PR opened yet.
- Commit `28f4743e2`.

## In progress

- PR for `issue-868-omlx-provider` not yet opened — next step is to push
  the branch and open a draft PR, then hand off for manual smoke (an actual
  oMLX install on Apple Silicon is required to smoke-test the live provider
  end to end).

## Risks / known issues

- The shared `apps/api_server/node_modules` (symlinked into the main
  checkout, per the worktree contract) is currently missing
  `better-sqlite3`'s native build — confirmed pre-existing/unrelated to this
  change (187/233 suites fail identically on an untouched file). The full
  vitest suite could not be run in this worktree as a result; only the
  new/touched files were verified directly (46/46 pass). See
  `docs/ai/runs/2026-07-02-issue-868-omlx-provider.md` for the isolation
  evidence. Must not `npm install`/`rebuild` per the worktree's hard
  constraint — needs to be resolved by whoever owns the shared tree, then
  the full suite re-run.
- `runOmlxToolCallSmoke()` (real two-turn tool-call round trip against a
  live oMLX server) has no automated CI coverage — it requires an actual
  Apple Silicon machine with the oMLX app running. Its assertion core
  (`hasStructuredToolCall()`) IS unit-tested with mock responses.
- `detectAndUnloadCompetingOllamaModel()` only targets one named Ollama
  model (`env.omlxCompetingOllamaModel`, default `qwen3.6-work`) — a
  differently-named large local model would need the env var set.

## Test status

- Targeted vitest (new/touched files only): 46/46 pass
  (`local_omlx_provider.test.ts`, `local_omlx_tool_call_smoke.test.ts`,
  `local_omlx_route_resolver.test.ts`, `opencode_client_service.test.ts`,
  `gemini_project_config.test.ts`, `curated_mcp_servers.test.ts`).
- `tsc --noEmit`: clean for every file this change touches/adds
  (pre-existing baseline errors elsewhere unchanged).
- Full suite: NOT run (see Risks above — environment gap, not a code
  regression).
- Flutter: not touched (no Flutter change required — the model/agent picker
  is fully server-driven).
- Full detail: `docs/ai/runs/2026-07-02-issue-868-omlx-provider.md`.

## Next step

1. Push `issue-868-omlx-provider` and open a draft PR for #868 (do not
   merge — leave open for manual review/smoke).
2. Once the shared `node_modules` native-build gap is resolved, re-run the
   full api_server vitest suite to confirm no regressions beyond what was
   verified here.
3. Manual smoke handoff (requires Apple Silicon + oMLX 0.4.4 app installed
   and serving `mlx-community/gpt-oss-20b-MXFP4-Q8` on
   `127.0.0.1:8000/v1`): set `RHYTHM_LOCAL_OMLX_ENABLED=true`, restart the
   local agent server, confirm the `local` agent profile appears in the
   composer picker, start a session against it, and run
   `runOmlxToolCallSmoke()` (see the module's trailing doc comment) to
   confirm a real structured tool call completes the loop.
4. Only merge to `main` after the user confirms manual smoke passed.
