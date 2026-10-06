---
date: 2026-10-06
repo: Rhythm
branch: codex/lazy-tool-loading-default-20261006
pr: null
issues: []
status: unverified
tags: [run, rhythm, lazy-tool-loading, mcp]
---

# Lazy tool loading default

Base and current source SHA: `5da2f764b5f240bb9650c58ce558a32aac2381e1`.

## Files

- `apps/opencode_fork/packages/opencode/src/session/mcp_deferred_tools.ts`
  defaults legacy and new sessions to deferred MCP tools, bounds the bootstrap
  catalog, parses `search` / `describe` / `execute`, and measures serialized
  definition bytes (exact UTF-8) separately from a labeled bytes/4 heuristic.
- `apps/opencode_fork/packages/opencode/src/session/prompt.ts`
  exposes only `mcp_dispatch` as the eager MCP control, resolves the current
  allowlisted inventory at dispatch time, returns a selected tool's complete
  schema on `describe`, and preserves the original SDK call options through
  the selected underlying MCP execution. It records only numeric request-size
  counters at the request-build boundary.
- `apps/opencode_fork/packages/opencode/src/session/run-state.ts`
  temporarily maps the actual running native `mcp_dispatch` call to its
  selected MCP key. The mapping retains the real assistant ID, tool-call ID,
  tool part, and user message ID; it is cleared on completion, cancellation,
  runner idle, and active-processor cleanup.
- `apps/api_server/src/services/tool_surface_estimator.ts` and
  `apps/api_server/src/services/opencode_client_service.ts`
  keep lazy loading on after profile expansion/ranking/provider capping without
  changing resolved grants. The former 25-tool/server estimate remains only
  reporting metadata and never selects loading mode.
- Focused tests: `src/session/lazy_loading_default.test.ts`,
  `src/session/run-state.deferred.test.ts`, `src/mcp/security_context.test.ts`,
  `apps/api_server/src/services/lazy_tool_loading_default.test.ts`, and the
  existing `test/session/mcp_allowlist_e2e.test.ts` default-surface cases.

The only eagerly defined MCP bootstrap/control tool is `mcp_dispatch`.
Existing skill-body lazy loading is unchanged. An explicit historical
`mcpAllowlist.deferred: false` retains its eager compatibility escape hatch.

## Checks

- Before source changes, from checkout root:

  ```sh
  bun test ./apps/opencode_fork/packages/opencode/src/session/lazy_loading_default.test.ts
  ```

  Result: exactly two expected red assertions: legacy default returned eager
  (`false`, expected `true`), and the 500-tool catalog was `705934` bytes
  (target at most `6000`).

- Focused fork unit tests after implementation:

  ```sh
  cd apps/opencode_fork/packages/opencode
  bun test src/session/lazy_loading_default.test.ts src/session/mcp_deferred_tools.test.ts src/session/run-state.deferred.test.ts src/mcp/security_context.test.ts
  bun typecheck
  ```

  Result: 21 tests / 58 expectations and `tsgo --noEmit` succeeded.

- Focused API tests after implementation:

  ```sh
  cd apps/api_server
  npx vitest run src/services/lazy_tool_loading_default.test.ts src/services/opencode_client_service.test.ts
  node /Users/ajhochhalter/Documents/Rhythm/apps/api_server/node_modules/typescript/bin/tsc --noEmit
  ```

  Result: 75 tests across two files and TypeScript succeeded. `npx tsc --noEmit`
  itself was not usable because it attempted a registry lookup and failed with
  `ENOTFOUND`; no install was attempted. The source-matching read-only
  TypeScript binary above was used instead.

- The existing prompt E2E fixture was updated for the new default, but its
  focused command could not execute in this sandbox:

  ```sh
  cd apps/opencode_fork/packages/opencode
  bun test test/session/mcp_allowlist_e2e.test.ts
  ```

  It failed before an assertion when its pre-existing `TestLLMServer` tried to
  listen on ephemeral port `0` and received `EADDRINUSE`. The fixture source
  confirms it constructs `NodeHttpServer` with `{ port: 0 }`; no retry or
  alternate listener was attempted under the no-server constraint.

- `git diff --check` was clean after the source packet.

## Serialized synthetic fixture measurement

A 500-tool public synthetic input was serialized through the same
`measureSerializedMcpToolSurface` helper used at request build. Result:

```json
{
  "catalogBytes": 4500,
  "eagerDefinitionBytes": 1052591,
  "lazyBootstrapBytes": 4781,
  "eagerBytesDiv4Estimate": 263148,
  "lazyBytesDiv4Estimate": 1196
}
```

(Fields were named `eagerEstimatedTokens`/`lazyEstimatedTokens` when measured;
the values are ceil(UTF-8 bytes / 4), renamed in the follow-on pass below.)

This is synthetic serialized fixture evidence only, not actual Secretary/provider evidence. Production/provider usage,
cache, and cost counters are not inferred from it.

## Composition seams

- The fork owns actual request-build inventory/schema measurement and the
  default when legacy callers omit an allowlist. API create/update adds the
  same `deferred: true` default after provider capping; mobile shares that API
  allowlist shaping path. No mobile, desktop, profile, coordinator, Dayflow,
  permission, or grant source was changed.
- Deferred selected-tool execution carries the real outer `mcp_dispatch`
  `ToolExecutionOptions`; it does not synthesize a ULID or empty messages.
  `SessionRunState.activeToolCall` translates only the active outer call to
  the selected key, allowing the existing `/rhythm-active-tool` handler and
  existing MCP identity lookup to prove the same native binding.
- Dispatch intersects the request's originally advertised keys with the
  current session allowlist/current engine inventory. Unknown, out-of-scope,
  revoked, or no-longer-deferred tools therefore fail closed. Search stays
  bounded and describe returns the selected current schema before execution.

## Missing runtime gates

No app, engine, API server, installed client, private transcript, credentials,
or user setting was read or changed. Builder-owned composed fork/API fixture
proof remains required for actual current inventory/schema delivery, deferred
execution, active native authority binding, revocation during execution,
provider-specific request behavior, desktop/mobile/profile paths, and normal
app acceptance. Contract criteria `c3` through `c8` remain unverified.

## Final source rerun

- From the checkout root, the required contract command completed with 4 tests
  and 13 expectations. All were green.
- From `apps/opencode_fork/packages/opencode`, the affected focused command
  completed with 21 tests and 58 expectations, followed by `bun typecheck`
  (`tsgo --noEmit`), all exit 0.
- From `apps/api_server`, the affected focused Vitest command completed with
  75 tests across two files, followed by the source-matching TypeScript
  `--noEmit` command, all exit 0.
- `git diff --check` exited 0.

These source checks do not supersede the missing runtime gates above.

## Correction + hosted-builtin pass (supersedes the "not executed" pass below)

Direct `bun test` / `bun run typecheck` were permitted and run in the fork package
(the earlier "all Bash denied" claim was overbroad). Source-tested only; no
live app/API/provider, install, commit, or credential change.

**Fixes (root causes)**
- **G** — `Deferred MCP call is not active`: the AI SDK starts `execute()` on the
  `tool-call` chunk concurrently with the processor persisting the native part as
  `running` (`processor.ts` `tool-input-start`→pending, `tool-call`→running;
  `toolCallIdentity` returns only running parts). The identity lookup in
  `run-state.ts` `withDeferredMcpToolCall` therefore saw a pending part and threw.
  Now it waits up to ~2s (10ms polls) for the REAL running part, re-checking the
  same record/projection/busy after every await; pending is never authorized; a
  cancelled/replaced run or a never-running (stale/forged) call still throws.
  Red reproduced before the fix (Case G failed at `toBeDefined`); Case G green after.
- **I** — search/describe now return `{title, metadata, output}` (standard tool
  result) instead of a raw string; Case I now covers search + describe + four
  malformed calls (zero executions) + one valid call (exactly once).
- **F1 dialect/cache** — the SDK validator is Ajv draft-07 (`strict:false`) and
  ignores unknown keywords. `validateDeferredMcpArguments` now (a) refuses, before
  any effect, schemas using 2019-09/2020-12-only keywords it cannot enforce
  (`prefixItems`, `unevaluated*`, `dependentSchemas/Required`, `min/maxContains`,
  `contentSchema`, `$dynamicRef/Anchor`, `$recursiveRef/Anchor`, `$anchor`,
  `$vocabulary`; property NAMES equal to a keyword are not refused), and (b) builds
  a fresh validator per call so a reused `$id` can never resolve to a different
  tool's or an older schema. Accepted: draft-07 semantics, including documents that
  declare `$schema` 2019-09/2020-12 but use only keywords draft-07 enforces. No new
  dependency (`ajv/dist/2020` is only a transitive dep; not imported). Tests: unit
  cases and request-level Case J (2020-12 `prefixItems` wrong type → refused, 0
  effects; two tools sharing one `$id` each validate against their own schema).

**Hosted builtins (lazy default)** — `prompt.ts`/`mcp_deferred_tools.ts` only;
`registry.ts`, `llm.ts`, processor and builtin implementations unchanged.
- Every registry tool except `invalid` is withheld from the request and reached via
  `mcp_dispatch` with `family:"builtin"` (omitted family = `mcp`, legacy form). The
  bootstrap catalog lists builtin names on one compact line; search/describe give
  descriptions and the exact provider-transformed schema.
- Eligibility is re-resolved from the CURRENT session at discovery and at execute:
  `registry.tools(current skillAllowlist/permission)` ∩ deferred ids, then the same
  gate `LLM.resolveTools` applies to eager keys (`user.tools !== false` and
  `Permission.disabled`). MCP grants are never consulted for builtins; (family,name)
  is the key, so a builtin id cannot be satisfied by `family:mcp`.
- Execution runs the unchanged wrapped executor (`runBuiltin`, extracted from the
  eager loop and shared by it): original Effect Schema decode, `ctx.ask` permission,
  plugin before/after hooks, abort, metadata, attachments/truncation, with the real
  outer `options` (call id, signal). `ctx.metadata` now writes the native outer
  input (dispatcher args) rather than the underlying args.
- Defaults cover legacy and new sessions/providers; `invalid` stays eager because
  `llm.ts` `experimental_repairToolCall` rewrites unknown/malformed calls to
  toolName `invalid`.
- Tests (request level, synthetic LLM): Case K — only `mcp_dispatch` offered;
  search/describe builtin; `read {}` rejected by original Schema decode;
  real `read` executes; session-denied `bash` neither discoverable nor executable;
  unknown id rejected; `family` omitted cannot reach a builtin; native part keeps
  dispatcher input. Unit: family parse/format/search.

**Existing tests updated (fixture opt-out, same harness)** — tests whose subject is
direct builtin behavior now create sessions with explicit
`mcpAllowlist:{servers:[],tools:[],deferred:false}`: prompt.test.ts (task
advertisement ×3, running-task metadata, interrupted-bash truncation),
snapshot-tool-race.test.ts, mcp_gemini_cap S2:3/S2:4. mcp_gemini_cap S1 now
asserts the byte-bounded catalog's "searchable on demand" tail rather than listing
tool #604 (it already contradicted the bounded catalog before this pass).

**Results** (fork package, direct commands)
- `bun test test/session src/session` → 430 pass / 5 skip / 0 fail (before the
  fixture opt-outs: 377 pass / 6 fail, all builtin-direct tests).
- `bun test src/session test/session/mcp_allowlist_e2e.test.ts
  test/session/mcp_gemini_cap_e2e.test.ts` → 66 pass / 0 fail;
  `bun test src/mcp/security_context.test.ts` → 2 pass.
- `bun run typecheck` (tsgo) → exit 0; `git diff --check` → clean.
- F2 guard: `withDeferredMcpToolCall` post-await recheck preserved (now inside the
  poll loop); lifecycle tests still green. Sol's earlier guard-removal RED/GREEN
  evidence applies to the original block; I did not re-run removal.

**Eager matrix after this pass**
| Family | Status |
| --- | --- |
| `mcp_dispatch` | eager bootstrap (required) |
| `invalid` | eager — required by the `experimental_repairToolCall` target |
| `image_generation` | eager provider-native, only when existing approval offers it (not in registry; untouched) |
| `_noop` | eager conditional protocol placeholder (llm.ts predicate, untouched) |
| `StructuredOutput` | eager — added by the loop for `format: json_schema` with `toolChoice: required`; not routed through the dispatcher |
| All other registry builtins (bash, read, glob, grep, task, webfetch, todowrite, skill, edit/write/apply_patch, question, websearch, repo_*, lsp, plan_exit) and custom/plugin registry tools | **lazy** (family=builtin) |
| Sessions with explicit `deferred:false` or non-empty `deferredServers` | compatibility opt-out: builtins and MCP stay eager |

**Not proved**: real provider/model behavior with the `family` argument; interactive
`question`/`task` and permission-ASK (not allow/deny) through the dispatcher;
`apply_patch` vs edit/write model selection under deferral; plugin
`tool.definition` hooks and custom-tool name collisions; user-tool revocation
(`lastUser.tools`) at execution; builtin metadata updates during a long-running
call; real Secretary/profile measurement; installed app. All-tools acceptance
remains unproved beyond this synthetic source evidence.

## Final hosted corrections (Sol review of frozen c429d40c)

Witnessed first: `bun test test/session/sol-lazy-hosted-verification.test.ts` →
9 pass / 2 fail (path-specific revoke returned `SYNTHETIC_REVOKED_CONTENT`; legacy
`deferredServers` kept `read` eager).
- **Permission** — `prompt.ts` `context.ask` (shared by builtin and MCP wrappers)
  now reads the CURRENT session by the original ID at EVERY ask and merges its
  permissions with the existing agent rules; the old request snapshot is no longer
  authority. A failed lookup or mismatched id dies (fail closed). Native outer
  message/call IDs, pending ask/reply, approved-rule handling, abort, decode, hooks,
  metadata are unchanged; no permission-service change.
- **Before-hook window** — Case L (`mcp_allowlist_e2e.test.ts`) installs a real
  `.opencode/plugin` `tool.execute.before` hook that awaits a gate; a
  `read:secret.txt=deny` is installed while it awaits; the read errors and no
  content reaches the part. (Falsification by temporarily restoring the snapshot
  merge was not run.)
- **Legacy default** — `deferHostedBuiltins = mcpAllowlist?.deferred !== false`;
  `deferredServers` alone no longer keeps builtins eager (MCP selective behavior and
  family namespaces unchanged; explicit `deferred:false` still eager). The
  dispatcher is now also created whenever hosted builtins are deferred.
- **Dialect wording** qualified in `validateDeferredMcpArguments`: SDK Ajv
  draft-07 semantics; only listed keywords refused; arbitrary declared-modern schema
  coverage unproved. No validator redesign, no dependency.
- Accepted eager exceptions (Astra): `mcp_dispatch`, `invalid` (repair target),
  `StructuredOutput` (json_schema runs), provider-native `image_generation` when
  approved, conditional `_noop`.

Results: Sol hosted file 11 pass / 0 fail. Affected set (`src/session`, Sol file,
mcp_allowlist_e2e, mcp_gemini_cap_e2e, prompt.test, snapshot-tool-race) → 140 pass /
0 fail. `bun run typecheck` exit 0. Source-tested synthetic only.

Remaining limits: the API create/update repair of legacy sessions was not exercised
here; existing-session callback ingress, real provider behavior, installed app, and
whether the frontend task-child link normalizer needs an adaptation for the outer
`mcp_dispatch` part (read-only Sol review; UI/processor untouched) are unproved.
All-tools acceptance is not claimed.

## Follow-on pass (F1/F2/F3) — earlier write-up (was written before commands were run)

Author: Sonnet 5.5 (sole writer). **No command could be executed in this
session** (every Bash call except `echo` was denied for lack of an approval
surface), so nothing below was run: no red/green, no `bun test`, no
`bun typecheck`, no `git diff`/hash capture. These are source edits only.
Sol/Astra must run the checks; expected-failure points are marked.

- **F1** — `src/session/mcp_deferred_tools.ts` adds
  `validateDeferredMcpArguments(schema, args)` using the pinned SDK 1.27.1
  export `@modelcontextprotocol/sdk/validation/ajv` (`AjvJsonSchemaValidator`;
  already a dependency of `packages/opencode`, no install). Missing/non-object
  schema or a schema Ajv cannot compile returns an error (fail closed). Caveat:
  the SDK Ajv is draft-07 (`strict:false`); a schema declaring
  `$schema: 2020-12` may fail to compile and is therefore refused, not skipped.
  `src/session/prompt.ts` calls it in the `mcp_dispatch` execute branch after
  the existing optional `validate` hook and before `wrapMcpTool`, validating the
  raw advertised schema (not the provider-transformed one). Eager-path MCP
  tools with JSON-schema-only definitions are unchanged (pre-existing gap,
  out of this bounded edit; the AI SDK does not validate them either).
  Tests: unit case in `src/session/lazy_loading_default.test.ts`; request-level
  Case I in `test/session/mcp_allowlist_e2e.test.ts` adds a `rhythm_strict`
  fixture tool built with plain `jsonSchema(...)` (no validate hook) and an
  execution counter; asserts describe schema, four malformed calls → error with
  zero executions, valid call → exactly one execution. A true RED against
  pre-edit source is expected (malformed calls would execute) but was not
  observed.
- **F2** — `withDeferredMcpToolCall` guard left untouched. New lifecycle tests in
  `src/session/run-state.deferred.test.ts` use the real
  `SessionRunState.layer` + Runner: cancel while identity suspended, replacement
  runner/projection while suspended, and valid parallel calls with success and
  failure cleanup, each asserting underlying-effect count and
  `activeToolCall`. Expected GREEN; regression sensitivity (temporarily removing
  the post-await recheck) was not demonstrated. Harness assumption to verify:
  that `ensureRunning` resolves after `onIdle` deletes the old record, so the
  replacement test starts a fresh runner.
- **F3** — `SerializedMcpToolSurface` now exposes exact UTF-8 `*Bytes` plus
  `eagerBytesDiv4Estimate`/`lazyBytesDiv4Estimate` (heuristic ceil(bytes/4),
  documented as not provider tokens/cost). `prompt.ts` debug-log fields renamed
  to `eagerMcpBytesDiv4Estimate`/`lazyMcpBytesDiv4Estimate`. Unicode test added
  (`naïve café 日本語 🚀`: bytes > JS length). No other source reads the old
  `*EstimatedTokens` names (grep verified); API estimator untouched.

### Hosted-builtin lazy extension — NOT STARTED (stopped, returned to Astra)

Reason: the extension rewrites `prompt.resolveTools` builtin/plugin wrapping,
`llm.ts` hosted-family filtering and possibly `registry.ts` in a ~3000-line
Effect module, and it requires the red/green request-level loop and
`bun typecheck`, neither of which was runnable here. Landing unverified edits at
that authority boundary was judged worse than holding it. **All-tools
acceptance remains held; MCP-only loading must not be reported as all tools.**
Affected files when resumed: `src/session/prompt.ts` (registry wrap, discovery,
dispatch family discriminator), `src/session/mcp_deferred_tools.ts`,
`src/session/llm.ts`, `src/tool/registry.ts` if extraction is needed.

### Eager definition matrix at this packet (unchanged by this pass)

| Family | Status |
| --- | --- |
| `mcp_dispatch` | Allowed eager bootstrap |
| `image_generation` | Allowed eager (provider-native, only when existing approval admits) |
| `_noop` | Allowed conditional protocol placeholder (exact existing predicate) |
| `invalid` | Eager; need NOT yet demonstrated (repair path unverified) |
| `bash read glob grep task webfetch todowrite skill edit/write or apply_patch question websearch repo_clone repo_overview lsp plan_exit`, custom/plugin tools | **Still eager — not lazy; no exception qualifies** |
| MCP with explicit `deferred:false` / non-empty `deferredServers` | Compatibility opt-out (eager) |

### Gates

Source-tested: none (unexecuted). Installed/live: none. Blocked: all execution
(approval surface absent), existing E2E loopback listener run, typecheck, file
hashes. Changed paths this pass: `src/session/{mcp_deferred_tools.ts,prompt.ts,
lazy_loading_default.test.ts,run-state.deferred.test.ts}`,
`test/session/mcp_allowlist_e2e.test.ts`, this log (all under
`apps/opencode_fork/packages/opencode/` except the log).
