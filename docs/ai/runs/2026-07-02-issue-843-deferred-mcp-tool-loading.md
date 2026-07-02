---
date: 2026-07-02
repo: Rhythm
branch: issue-843-fork-deferred-tool-loading
pr: TBD (draft, opened after this run)
issues: [843]
status: implemented, unit+e2e green, real-binary smoke NOT yet run (documented as required follow-up)
tags: [run, rhythm, opencode, mcp, tokens]
---

# #843 (tokens-03): deferred MCP tool schema loading in the opencode fork

## Upstream prior-art check (required first step)

Searched `apps/opencode_fork` (vendored `sst/opencode` v1.14.49) and the prior
investigation doc (`docs/ai/decisions/2026-06-25-per-session-mcp-scoping-investigation.md`,
Q3) for existing deferred/lazy MCP tool loading. **None exists upstream.**
sst/opencode issues #5373, #3756, #3612, #2888, #1101 are all open/unresolved
and describe the exact same "schemas stay in model context regardless of
gating" gap this issue addresses — no merged upstream fix to mirror.

The fork DOES already carry an equivalent pattern for a different resource
type: **skills** (`tool/skill.ts` + `session/skill_allowlist.ts`, #775). Skills
are advertised to the model as a cheap `name: description` list in the system
prompt (`session/system.ts#skills` → `Skill.fmt(list, {verbose:true})`), and
ONE dispatcher tool (`skill`) loads the full skill body only when the model
calls it by name. This is the closest thing to "prior art" in the codebase and
is the pattern this issue's implementation mirrors for MCP tools — new code,
but shaped identically to an existing, already-shipped, already-tested
pattern, which keeps the patch minimal and easy to reconcile with subtree
syncs.

## Design

- `session/mcp_deferred_tools.ts` (new, pure helpers, mirrors
  `session/mcp_allowlist.ts` / `session/skill_allowlist.ts`):
  - `buildDeferredToolCatalog` / `formatDeferredToolCatalog` — build and
    render the names-only `<available_mcp_tools>` catalog.
  - `isDeferredMcpToolAllowed` — dispatch-time allowlist re-check, delegating
    to the exact same semantics as `filterMcpToolsByAllowlist` (undefined =
    unrestricted; explicit tool key OR server-level match).
  - `MCP_DISPATCH_TOOL_ID = "mcp_dispatch"`.
- `session/session.ts` — added `deferred?: boolean` to the existing
  `McpAllowlist` schema (not a new top-level session field). Rides the
  existing `mcp_allowlist` JSON column — **no DB migration**. Absent/false =
  eager mode (100% back-compat with every session created before this patch).
- `session/session.sql.ts` — widened the `mcp_allowlist` column's `$type<>` to
  include the optional `deferred` field (JSON column, no schema change).
- `session/prompt.ts` (`resolveTools`) — the actual behavior change:
  - Extracted the existing per-tool wrapping (permission `ctx.ask`, plugin
    `tool.execute.before/after` triggers, output truncation/attachment
    handling — previously inlined in the eager loop) into a reusable
    `wrapMcpTool(key, item)` closure. The eager path's behavior is
    byte-identical to before — it now just calls the extracted closure
    instead of inlining it.
  - When `session.mcpAllowlist.deferred === true`: instead of looping over
    every allowlisted MCP tool and injecting a full JSON Schema for each
    (the eager path), inject exactly ONE tool (`mcp_dispatch`) whose own
    schema is small and fixed (`{name, arguments}`), whose description is the
    names-only catalog. `mcp_dispatch.execute` re-checks the allowlist via
    `isDeferredMcpToolAllowed` (defense in depth, mirrors `tool/skill.ts`'s
    execute-time `isSkillAllowed` guard from #775), looks up the real MCP
    tool by name, calls `wrapMcpTool` on it (schema resolution + full
    permission/plugin/truncation pipeline happen HERE, lazily, only now),
    and executes it.
  - When `deferred` is false/absent: unchanged eager loop, now just calling
    `wrapMcpTool` per key — verified byte-identical behavior via the existing
    Cases A-D e2e tests (still 4/4 green, same offered-tool-name sets as
    before this patch).
  - The `resolveTools complete` DEBUG log gained `deferredMcpActive` and
    `deferredMcpCatalogSize` fields (measurement instrument, same log line
    the existing "MCP allowlist smoke" already reads).

## Files

- `apps/opencode_fork/packages/opencode/src/session/mcp_deferred_tools.ts` (new)
- `apps/opencode_fork/packages/opencode/src/session/mcp_deferred_tools.test.ts` (new, contract tests)
- `apps/opencode_fork/packages/opencode/src/session/session.ts` (modified: `McpAllowlist.deferred`)
- `apps/opencode_fork/packages/opencode/src/session/session.sql.ts` (modified: widened `mcp_allowlist` column type)
- `apps/opencode_fork/packages/opencode/src/session/prompt.ts` (modified: `resolveTools` deferred branch, `wrapMcpTool` extraction)
- `apps/opencode_fork/packages/opencode/test/session/mcp_allowlist_e2e.test.ts` (modified: added Cases E/F/G/H; fixed a pre-existing shared-mutable-fixture bug — see below)
- `docs/ai/testing-guide.md` (modified: new "Deferred MCP tool schema loading smoke" section)
- `docs/ai/contracts/issue-843.json` (new)

## Checks run

- `cd apps/opencode_fork/packages/opencode && bun run typecheck` — only the
  pre-existing, unrelated `test/session/system.test.ts` `Skill.Service` stub
  error (confirmed present identically on the base branch before this patch,
  via `git stash`/`git stash pop` diff). Zero new typecheck errors.
- `bun test src/session/mcp_deferred_tools.test.ts` — 10/10 pass (new pure-unit contract tests).
- `bun test src/session/mcp_allowlist.test.ts` — 5/5 pass (unchanged, #765/#775 unit coverage untouched).
- `bun test test/session/mcp_allowlist_e2e.test.ts` — 8/8 pass:
  - Cases A-D (pre-existing, eager mode): unchanged, byte-identical offered-tool-name sets to before this patch.
  - Case E (new): deferred mode offers ONLY `mcp_dispatch`, never the individual `rhythm_*`/`obsidian_*` schemas; the names-only catalog (with descriptions) is present in `mcp_dispatch`'s own description, correctly filtered by the server-level allowlist.
  - Case F (new): empty allowlist + deferred mode → catalog renders "No MCP tools are currently available.", no tool names leak into the description.
  - Case G (new): dispatching `mcp_dispatch({name:"rhythm_ping"})` actually executes the real underlying tool and returns its real output (not a stub) — proves "first use loads the schema" is genuinely wired end-to-end, not just a smaller catalog.
  - Case H (new): dispatching an out-of-scope tool name (`obsidian_get_file` under a `servers:["rhythm"]` allowlist) is rejected at execute time and does not run the real tool — the #765-class regression guard.
- `bun test test/session/ src/session/` — 613-614/613-614 pass (varies 613/614 across two runs due to unrelated flaky-timing skips noted pre-existing in project-state.md), 0 fail, matching/exceeding the documented "325+ pass, 0 fail" baseline in testing-guide.md.
- `bun test test/tool/ src/tool/` — 8/8 (after fixing a missing `packages/plugin` node_modules symlink in this worktree, an environment issue unrelated to the patch) + full combined run 614 pass / 0 fail across tool+session suites.
- Falsification (required): temporarily commented out the `isDeferredMcpToolAllowed` guard in `prompt.ts`'s `mcp_dispatch.execute`. Re-ran Case H — it failed exactly as expected (`expect(String(asAny.state.output)).not.toBe("ok")` failed because the out-of-scope tool's real output "ok" DID come back, proving the guard is load-bearing). Restored the guard from a backup; re-ran the full mcp test set — back to green (23/23 across the three mcp-focused files).

## Bug found and fixed along the way (test infrastructure, not production code)

`test/session/mcp_allowlist_e2e.test.ts`'s `mcpWithAllTools` layer returned the
SAME module-level `MOCK_MCP_TOOLS` object from every `tools()` call.
`resolveTools` (both the pre-existing eager loop and the new deferred
dispatch path) mutates `item.execute`/`item.inputSchema` **in place** — this
has always been true of the eager loop, but was invisible before because
Cases A-D operate within a single `resolveTools` call each and never call
`wrapMcpTool` on the same object twice across tests. The real
`mcp/index.ts#tools()` builds a brand-new `dynamicTool()` object on every
call (verified in source), so this in-place mutation is safe in production.
The test fixture violated that "fresh object per call" contract. Case G
(dispatch-and-execute) was the first test to actually re-wrap an
already-wrapped object across two different tests' `resolveTools` calls,
exposing the gap. Fixed by making `mcpWithAllTools.tools()` build a fresh
`Record<string, Tool>` per invocation (`freshMockMcpTools()`), matching the
real implementation's contract. This is a test-fixture fix, not a production
code change — flagged here for visibility since it affects a shared,
multi-issue fixture file.

## Measured token drop (issue-843-c2)

**Method:** the tokens-01 `estimateToolSurface` (`apps/api_server/src/services/tool_surface_estimator.ts`)
gives the "before" (eager) session-start token estimate directly, unmodified,
using its existing calibrated 500-chars/tool JSON-Schema estimate. The
"after" (deferred) estimate is calculated the same way but replaces each
tool's 500-char schema cost with a 120-char names-only catalog-entry cost
(name + server + one-line description — the fork's own
`formatDeferredToolCatalog`, proven by `mcp_deferred_tools.test.ts`
issue-843-c1 to contain no JSON Schema fields) plus one fixed 500-char
dispatcher schema.

| Scenario | Before (eager) | After (deferred) | Drop |
|---|---|---|---|
| Secretary role (36 allowlisted MCP tools) | 6125 tokens | 2830 tokens | **3295 tokens (53.8%)** |
| Unscoped/dev session (~20 connected servers, inherit-all estimate, 500 tools) | 64125 tokens | 16750 tokens | **47375 tokens (73.9%)** |

**This is an analytical estimate derived from the existing #841 estimator, not
a live-engine byte count.** A true live-session confirmation requires the
signed/built fork binary per `docs/ai/testing-guide.md`'s new "Deferred MCP
tool schema loading smoke" section — **not run in this environment** (no
signed-binary build pipeline available here). Recorded as `mode: manual` /
`not_tested` in `docs/ai/contracts/issue-843.json` with this reasoning, and
as the explicit required follow-up smoke below.

## Real-binary smoke: NOT run (explicit, honest status)

Per the task's validation instructions: "If you cannot complete a full
signed-binary smoke in this environment, implement + unit-test the fork logic
and CLEARLY document the remaining real-binary smoke as a required manual
step." This environment has no code-signing/notarization pipeline available,
so:

- **Ran:** fork `bun test` (mcp/tool-loading + allowlist areas), full
  `test/session/` + `src/session/` + `test/tool/` + `src/tool/` suites,
  `bun run typecheck`, and falsification — all as detailed above.
- **NOT run (required before merge):** the live signed-binary smoke described
  in `docs/ai/testing-guide.md`'s "Deferred MCP tool schema loading smoke"
  section — building the fork (`bun run build --single`), running it as the
  real engine, opening a `deferred: true` session, and confirming the
  `resolveTools complete` log's `deferredMcpActive`/`deferredMcpCatalogSize`
  fields plus a live token-count drop. This is a manual step for the human
  reviewer per the project's `AGENTS.md` "real-binary smoke required" rule
  for this vendored subtree.

## Deviations from spec

- The issue's AC says "first use (or explicit expand) loads the schema."
  This implementation always defers to "first use" (dispatch by name); there
  is no separate "explicit expand without executing" call, because the
  underlying AI SDK (`ai` package) has no API to advertise a tool's schema
  to the model without also making it callable, and the model has no way to
  request "just the schema" short of calling the tool — mirroring exactly how
  the existing `skill` tool works (loading = calling). This is the same
  minimal-and-consistent tradeoff the codebase already made for skills;
  flagging it as a deliberate scope interpretation rather than a gap.
- `deferred` defaults to `undefined`/false (opt-in), not a repo-wide default,
  per the "keep the patch minimal" instruction and to avoid any change in
  behavior for existing sessions/callers. Turning it on for real profiles
  (e.g. wiring `agentConfigId` → `deferred: true` in the api_server's
  session-create path) is a follow-up, not part of this issue's scope
  (issue #843 is fork-only; `apps/api_server` org_*/generators/migrations
  were explicitly out of ownership for this task).

## Risks

- **Real-binary smoke unconfirmed.** The unit/e2e suite proves the request
  body reaching the (mocked) LLM server is correct, but the actual live
  Anthropic/OpenAI-compatible model's ability to reliably use a
  dispatch-by-name pattern (vs. native per-tool schemas) has NOT been
  confirmed with a real model in this environment. This is a behavioral risk
  (models may be less reliable calling tools indirectly) that only the
  manual smoke can rule out.
- **`deferred` is per-session, not yet wired to any real profile/UI.** No
  caller in this codebase sets `mcpAllowlist.deferred: true` yet — this PR
  ships the mechanism only. A follow-up issue is needed to actually flip it
  on for real sessions (likely gated by tool-surface size, per tokens-01's
  reporting) once the live smoke confirms behavior.
- **GitNexus impact tool could not target this worktree** (multi-repo-index
  path-matching issue, reported but not resolved in this run); impact
  analysis was done manually via grep-based call-site enumeration instead
  (`resolveTools` has exactly one caller; `filterMcpToolsByAllowlist` has
  exactly one production caller). Risk assessed LOW given the manual trace
  and the full green test suite.
