---
date: 2026-07-02
repo: rhythm
branch: issue-868-omlx-provider
pr: null
issues: [868]
status: implemented-not-pr-opened
tags: [run, rhythm]
---

# Issue #868 — productionize local oMLX provider

## Files

- `apps/api_server/src/services/local_omlx_provider.ts` (new) —
  `ensureOmlxProviderConfig()`, `buildLocalAgentPermission()`,
  `detectAndUnloadCompetingOllamaModel()`, `parseOllamaPsForModel()`.
- `apps/api_server/src/services/local_omlx_tool_call_smoke.ts` (new) —
  `hasStructuredToolCall()`, `toolCallLoopCanProceed()`,
  `runOmlxToolCallSmoke()`.
- `apps/api_server/src/services/opencode_client_service.ts` — `omlx` added
  to `KEYLESS_LOCAL_PROVIDER_IDS`; new Phase 3b in `_initializeImpl` calls
  `ensureOmlxProviderConfig()` + `detectAndUnloadCompetingOllamaModel()`
  before the engine spawns.
- `apps/api_server/src/services/agent_model_resolver.ts` — `omlx` added to
  `PROVIDER_TO_AGENT_KIND` and appended last to
  `ROUTE_FALLBACKS_BY_AGENT.opencode`.
- `apps/api_server/src/config/env.ts` — `omlxProviderEnabled`, `omlxBaseUrl`,
  `omlxModelId`, `omlxContextLimit`, `omlxOutputLimit`,
  `omlxCompetingOllamaModel`.
- Tests (new): `local_omlx_provider.test.ts` (22 cases),
  `local_omlx_tool_call_smoke.test.ts` (14 cases),
  `local_omlx_route_resolver.test.ts` (7 cases); 2 new cases added to
  `opencode_client_service.test.ts`.
- `docs/ai/decisions/2026-07-02-local-omlx-provider-productionization.md`
  (new) — full design rationale.

## Checks

- `node_modules/.bin/tsc --noEmit` (api_server) — clean for every file
  touched/added in this change. Pre-existing baseline errors unrelated to
  this issue remain (missing `ws`/`pg`/`resend` type declarations, a handful
  of implicit-`any` params in unrelated repositories) — unchanged from the
  documented baseline.
- `node_modules/.bin/vitest run` on the new/touched files directly —
  **46/46 pass**: `local_omlx_provider.test.ts` (config generation
  idempotency/preservation/malformed-file-safety/no-machine-specific-paths,
  permission-surface assertions, `ollama ps` parsing, detect+unload
  auto/manual/failure paths), `local_omlx_tool_call_smoke.test.ts`
  (structured-vs-textual tool-call detection including the literal
  Qwen3-Coder-30B `<function=...>` markup shape, mocked two-turn loop
  completion), `local_omlx_route_resolver.test.ts` (never-default route
  contract), plus the 2 new `opencode_client_service.test.ts` cases.
- **Full `vitest run` for the api_server package could NOT be completed in
  this worktree**: the shared `node_modules` (a symlink into the main
  checkout per the worktree contract) is missing `better-sqlite3`'s native
  build right now — confirmed pre-existing and unrelated to this change by
  running the SAME failure against an untouched file
  (`src/services/agent_model_resolver.test.ts`) and against the full,
  unfiltered `vitest run` (187/233 suites fail with the identical
  `Cannot find package 'better-sqlite3'` error, spanning files nowhere near
  this issue). Per the worktree's hard constraint, `npm install`/`rebuild`
  was NOT run. This should be re-verified with a full suite run once the
  shared tree's native deps are restored (likely by whichever process is
  expected to keep `apps/api_server/node_modules` current for all
  concurrent worktrees).
- Flutter: not touched. The composer's model/agent picker is fully
  data-driven from `GET /agents/capabilities` / `listAllRoutes()` — no
  provider id is hardcoded client-side (`grep` for `'ollama'` across
  `apps/desktop_flutter/lib` returns nothing), so no Flutter change is
  required for `omlx` to appear once the feature flag is enabled and the
  provider is authed.

## Notes

- **Optional/gated**: `ensureOmlxProviderConfig()` is a pure no-op (does not
  touch the filesystem at all) unless `RHYTHM_LOCAL_OMLX_ENABLED=true`.
  Cloud/default profiles are provably unaffected — see the
  "is OPTIONAL: no-ops... when disabled" test.
- **Non-machine-specific**: every value that could vary per machine
  (endpoint, model id, context/output limits, competing Ollama model name)
  comes from `env.ts`/`process.env` with documented defaults; a dedicated
  test asserts the generated config never contains `/Users/` or the current
  OS username.
- **Constrained `local` profile tool surface**: `read`, `glob`, `grep`,
  `list`, `edit`, `bash` = `allow`; `task`, `webfetch`, `websearch`, `skill`
  = `deny`; `*` (any MCP tool) = `deny`. Written via opencode's `permission`
  schema (not the deprecated `tools` boolean-map the manual POC used).
- **Structured tool-call smoke**: `hasStructuredToolCall()` is the
  unit-testable assertion core (mock OpenAI-shaped responses, no live
  server); `runOmlxToolCallSmoke()` is the live, two-turn version for manual
  verification once the oMLX app is actually installed on an Apple Silicon
  machine — it is deliberately NOT part of the automated vitest suite since
  no such server exists in CI/this dev environment.
- **Ollama unload**: `detectAndUnloadCompetingOllamaModel()` runs
  `ollama ps`, and by default auto-unloads the configured competing model
  (`qwen3.6-work` by default — matches the existing Ollama route) via
  `ollama stop`; never throws (Ollama absent is the common case), and
  surfaces the exact `ollama stop <model>` action via a warning log when
  auto-unload isn't requested or fails.

## Residual risks / follow-ups

1. **Full api_server test suite unverified in this worktree** due to the
   shared `node_modules` missing `better-sqlite3`'s native build — a
   pre-existing environment gap, not caused by this change (see Checks
   above for the isolation evidence). Should be re-run once resolved.
2. **No CI/automated coverage of `runOmlxToolCallSmoke()` against a real
   server** — inherent to the constraint (Apple-Silicon-only, requires the
   oMLX app installed and running). Flagged in the issue itself as
   acceptable ("may be gated/skipped when no local server is running").
3. **`detectAndUnloadCompetingOllamaModel()` only targets one named model**
   (`env.omlxCompetingOllamaModel`). A machine running a different
   large Ollama model under a different name would need the env var set, or
   a future enhancement to unload based on VRAM/size rather than name.
4. Not filed as a separate follow-up issue since it's explicitly noted in
   #868's own acceptance criteria as acceptable scope.
