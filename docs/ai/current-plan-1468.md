---
date: 2026-09-24
repo: rhythm
branch: mega/2026-09-18-mobile-electron-hermes
base: e93eac6e
issues: [1468]
status: planning (design gate: waiting on Astra review before GPT-6 Sol codes)
tags: [plan, rhythm, gemini, mcp-scope, api_server]
---

# Plan: #1468 Gemini gets more than 512 function declarations

## Goal

Every Rhythm turn routed to provider `google` must carry at most 512 function
declarations. The bound must be deterministic, set before the engine builds the
request, and must never drop a tool. Tools that don't fit are moved behind the
fork's existing `mcp_dispatch` dispatcher. OpenAI and Anthropic requests must stay
byte-for-byte unchanged.

## Constraints

- This pass is planning only. It contains no product code. The implementer is GPT-6 Sol, after Astra reviews the plan.
- **Do not edit `apps/opencode_fork`.** #1468 is not an `mcp-scope-*` issue. The fork work this plan needs is listed as follow-ups F1 and F2.
- Tests must not use real credentials. The live qualification runs only through `tools/dev/sandbox.sh`, with a stub Google endpoint and a fake key literal. A real Gemini run happens only at a manual gate that AJ performs.
- Don't truncate arbitrarily and don't let the result depend on order. The #884 count-trim is order-dependent and estimate-based, so this plan removes it.
- Telemetry may record counts, provider/model ids, session ids and MCP server names. It must never record tool schemas, descriptions, arguments, prompt text, request bodies, credentials or paths.
- AJ is AFK, so every open question below has a safe default.

## What investigation found (refs at `e93eac6e`; code-traced, not executed)

**Data.** I queried the live DBs read-only (`Rhythm/rhythm.db` and `Rhythm Electron/rhythm.db`). They hold 20 `function_declarations` failures, **created 2026-06-29 → 2026-07-13**. The issue's "→ 2026-08-20" comes from a bulk `updated_at` touch. 16 of the 20 are **engine `task`-tool children**:
- `@general` children of *scoped* Secretary/config-doctor parents.
- `@workflow-orchestrator`/`@coding-agent` children created before #1012 (merged 2026-07-11).

The last cap failure was 2026-07-11. There have been no Google-primary profiles since then. Later Google errors are license or project errors, plus the #1091 anyOf bug.

**Existing mitigations** (`apps/api_server/src/services/gemini_tool_cap.ts`):
- #884 `capMcpAllowlistForProvider` (:99-162) drops entries in input order. It charges each inherit-all server a flat 25 tools, so it misses real surfaces (rhythm about 90, propresenter 150+).
- #952 `geminiUnscopedDeferredAllowlist` (:195-201) defers every server for unscoped Google.
- Both run only inside `OpencodeClientService.createSession` (:1198-1243), `updateSessionAllowlist` (:1365-1415) and mobile create (`mobile_opencode_proxy.ts:652-666`).

**Gaps that are still open on mega:**

1. **Engine task children, the dominant path.** `task.ts:59-75 childMcpAllowlist` reads only `agent.options.mcpAllowlist`. Native `general` has none, so the child gets **all 31 configured servers eagerly** (`agent.ts:163-176`). That child inherits the parent's Google model (`task.ts:158-161`), so the request overflows. The same code also lets a scoped parent's `@general` child reach every server: a privilege widening, because `childSkillAllowlist` (:44-57) inherits the parent's scope but MCP does not. Every profile may delegate to `general`/`explore` (`opencode_agent_writer.ts:244,276-280`), and the writer never projects builtins (:284-292). The DB's `general` row (`["rhythm"]`) is therefore ignored. `explore` escapes only because its `"*": deny` removes MCP in `llm.ts:643-649`, and a bypass-mode parent permission (`*: allow`) re-opens that.
2. **Prompt paths that don't push a scope matched to the provider.** `agent_approval_continuation_service.ts:111` and `async_delegation_completion_service.ts:214` prompt with the *profile* model, which can differ from the last WS turn's provider. `ws_gateway.ts:767-775` treats a failed allowlist push as non-fatal and sends anyway.
3. **Mobile proxy.** A legacy create with no `profileId` (:612) and inherit-all profiles (:652) get no Google bound. The `session.prompt`/`prompt_async` forwards (:1184-1228) never push a scope.
4. **Scoped Google with inherit-all servers.** This is the #884 estimate miss described above.

**What the fork already offers (no edit needed):**
- The `mcpAllowlist` fields `deferred` and `deferredServers`, set on create or via PATCH (`prompt.ts:640-645,769-842`), plus a re-check at dispatch time (:812-817).
- `GET /session/:id` returns `mcpAllowlist`.
- `cfg.agent.<name>.options` merges into builtins (`agent.ts:303`).
- `childMcpAllowlist` already forces `deferred: true` for Google whenever a scope exists (`task.ts:73`).
- `GET /mcp/tools` → `listMcpToolIds` (:3025) and `GET /experimental/tool/ids` → `listToolIds` (:3039).

**What the fork cannot do without an edit:** make children inherit the parent's scope; run an exact count guard over the final tool map with a typed error; apply the Gemini-family rule beyond `providerID === "google"`.

**Sibling enum defect (the 19th failure).** `@ai-sdk/google` 3.0.63 converts `const` to `enum: [const]` without stringifying it (`node_modules/.bun/@ai-sdk+google@3.0.63…/dist/index.mjs:323-324`). This happens *after* the fork's `sanitizeGemini`, which stringifies only `enum` (`transform.ts:1408-1458`). A `const: true` in an MCP schema therefore becomes `enum:[true]`. Fixing it needs a fork edit (see F2; #1091 set the precedent).

## Design

| Approach | What it does | Trade-offs | Verdict |
|---|---|---|---|
| **A. Scoped catalog bounded per provider (deferral)** | For `google`, every api_server-controlled session ends up with `mcpAllowlist.deferred = true`. It keeps the profile's scope exactly; a session with no profile gets all servers. Gemini then sees the builtins plus one `mcp_dispatch`. The bound is enforced at one prompt choke point, at the mobile proxy, and in engine config for the native subagents. | Nothing is dropped, and the result depends only on provider, never on order or counts. It matches the fork's existing rule for Google children. Cost: Gemini sees a catalog of names and descriptions, not argument schemas, which is the #952 trade-off already accepted. | **Recommended** |
| B. Capability grouping / filtering per provider | Load explicit profile tools eagerly and defer inherit-all servers (`deferredServers`), or define capability groups. | Gives Gemini better argument fidelity. But it needs exact counts (`listMcpToolIds` prefix matching is ambiguous for `gmail`/`gmail-work`) plus a group taxonomy. That is more code for a provider nobody uses as primary today. | Rejected for now. Add it when Gemini becomes a primary model and dispatcher argument-guessing measurably hurts. |
| C. Refuse with an actionable error | Before sending a Google turn, count `listToolIds + listMcpToolIds`; refuse above 512. | Simple, but profile-less Gemini stays unusable and engine-internal children aren't covered. | Kept only as the **backstop inside A**: used when the bound can't be applied. |
| Rejected: truncation | The #884 drop-by-order trim. | Silently changes capability, depends on order, and is based on estimates. | Removed. |
| D. Fork guard (future) | Child inherits the parent's scope, plus an exact count check on the final tool map with a typed error. | This is the correct root fix for the child path and gives the exact count AC4 wants. It needs `mcp-scope` reclassification. | Follow-up F1 |

**How A works in detail**

- **Policy (pure, in `gemini_tool_cap.ts`).**
  - `capMcpAllowlistForProvider(allowlist, 'google')` returns `{...allowlist, deferred: true}`. The server and tool sets are unchanged, `trimmed` is always `false`, and nothing is dropped.
  - For any other provider it returns the same object (`===`).
  - A new function `googleBoundedAllowlist(current, connectedServers)` returns `null` when `current?.deferred === true`. If `current` is undefined it returns `{servers: sorted(connectedServers), tools: [], deferred: true}`; otherwise `{...current, deferred: true}`.
  - The result never widens the scope: its servers and tools equal the input's, or equal all servers when the input was undefined, which is what "unscoped" already means.
- **Choke point.** Add `OpencodeClientService.ensureGoogleBoundedTurn(sdkSessionId)` (public, so mobile can reuse it). `prompt` (:1663) and `promptAsync` (:1720) call it first when `model?.providerID === 'google'`. It does GET session → `googleBoundedAllowlist` → a PATCH only if needed.
  - This covers ws_gateway, agent_runner, delegation, continuation, wake and redispatch with one guard.
  - Non-Google turns make zero extra engine calls.
  - If the GET or PATCH fails, the turn is **refused** (not sent). It returns `false`/`null` and records a status message such as "Gemini's 512-tool limit could not be applied to this session; the turn was not sent. Retry or switch to a non-Google model (up to N tools connected)." N comes from the two list calls; it is left out if those fail.
- **Mobile.** `applyMobileSessionCreateScope` gives Google a bounded allowlist for legacy creates with no profile (using `body.model`) and for inherit-all profiles. `forward` calls `ensureGoogleBoundedTurn` before `session.prompt`/`prompt_async` when `body.model.providerID === 'google'`. Refusal returns 409 with the same message.
- **Native subagents (interim fix without a fork edit).** `ensureManagedDefaults` (`opencode_plugin_config.ts:312`) owns `agent.<general|explore>.options.mcpAllowlist = {servers: sorted(Object.keys(parsed.mcp)), tools: []}` in opencode.json and preserves all other keys. It runs again after MCP add/remove. The fork then derives each child's allowlist:
  - **Non-Google child:** every configured server is kept eagerly, identical to today's `undefined`.
  - **Google child:** `deferred: true`, so the request is bounded.
  - This does **not** fix the widening; F1 does. Mark it `// ponytail:` and delete it when F1 lands.
- **Error path.** The session.error case in `OpencodeStreamBridge._relayEvent` gets a single-line call, mirroring the #913 `TOOL_PAIRING_ERROR_PATTERN` handling (:164, :2083-2087), to a pure `describeGeminiToolLimitError(message)`:
  - `/At most (\d+) function declarations/` becomes "Google Gemini accepts at most {cap} tool declarations per request and this turn sent more. …scope the agent's MCP servers or use a non-Google model", with `errorClass: 'provider_tool_limit'`.
  - The raw text goes to the logger only. The user-facing text contains no `function_declarations[` paths.
- **Telemetry.** One log line, `[GeminiToolBound] sdk=<id> action=<unchanged|patched|refused> reason=<unscoped|scoped|already-deferred|patch-failed> servers=<n> explicitTools=<n>`. It contains counts only; server names are allowed, but nothing listed as forbidden in Constraints.
- **Prioritization.** Not needed, because deferral never drops anything. If a future provider forces an eager subset, the fixed order is: engine builtins (never touched), then `mcp_dispatch`, then explicit profile tools, then inherit-all server tools. Within each tier, sort by composed key in ASCII order. Not implemented.
- **Residual gaps (accepted).**
  - `dispatchCommand` (:2729) passes no model, so a slash command that is the *first* Google turn isn't guarded. Later turns are covered because the PATCH persists.
  - Gemini reached through `openrouter`/`google-vertex`/`opencode` isn't covered, which matches the fork's child rule. See Q3.
  - Resumed `task_id` children created before this fix keep their old scope.

**User journey**

| Job | Entry point | Visible success | Slice |
|---|---|---|---|
| Chat with a Gemini model, including delegating to `@general` | Electron/Flutter composer with a Gemini model override (`session.input` → ws_gateway) | The reply arrives; the child finishes; no proto error | S1, S3; S5/S6 validate |
| Chat with Gemini from mobile | Mobile gateway create or prompt | Same | S2; S5 validates |
| Understand a failure | Session error banner | The message names Gemini's 512 cap and what to do next | S4 |

## File structure

| File | Responsibility |
|---|---|
| `apps/api_server/src/services/gemini_tool_cap.ts` | Replace the drop trim with deferral; add `googleBoundedAllowlist` and `describeGeminiToolLimitError` (pure functions) |
| `apps/api_server/src/services/opencode_client_service.ts` | Add `ensureGoogleBoundedTurn`; call it at the top of `prompt`/`promptAsync`; refuse on failure |
| `apps/api_server/src/services/mobile_opencode_proxy.ts` | Google bound on create when there's no profile or an inherit-all profile; guard before forwarding a prompt |
| `apps/api_server/src/services/opencode_plugin_config.ts` | Project `agent.{general,explore}.options.mcpAllowlist` in `ensureManagedDefaults` |
| `apps/api_server/src/routes/opencode_mcp_routes.ts` (the only caller of `opencodeClient.addMcp`/`removeMcp`; S3 stays out of `opencode_client_service.ts`) | Re-run `ensureManagedDefaults` and reload the config after add/remove |
| `apps/api_server/src/services/opencode_stream_bridge.ts` | One-line translation in the session.error case |
| `apps/api_server/src/services/__tests__/gemini_tool_cap.test.ts` (existing) + new `opencode_client_google_bound.test.ts`, `opencode_plugin_config_native_scope.test.ts`, mobile proxy test | Unit and regression tests |
| `apps/api_server/src/__tests__/live_e2e_1468_gemini_tool_bound.test.ts` + fixture helpers (stub Google/OpenAI-compatible HTTP server that records only declaration counts and names; stdio MCP server exposing 600 no-op tools) | Live behavioral qualification in the sandbox |
| `docs/ai/runs/<YYYY-MM-DD of S5 run>-1468-gemini-tool-bound.md` | Run log |

## External dependencies

- Gemini's cap of 512 is taken from the provider's own error string in the DB rows (primary evidence). UNVERIFIED: Vertex and OpenRouter enforce the same cap.
- The `@ai-sdk/google` 3.0.63 request shape is `tools[].functionDeclarations`, sent to `…/models/<id>:streamGenerateContent`. **Implementer's first probe:** read the installed `dist/index.mjs` for the exact request and SSE response schema before writing the stub. Also confirm that sandbox `provider.google.options.{baseURL,apiKey}` reaches the SDK, and that no `opencode-gemini-auth` plugin exists in the sandbox HOME. UNVERIFIED until that probe is done.
- The live repro is predicted red on `e93eac6e` for S5 scenarios 3–4 and green for scenario 1 (#952). S5 must prove the red first.

## Issue table

| # | Title | Likely files | Acceptance criteria (falsifiable) | Deps | Required validation |
|---|---|---|---|---|---|
| S1 | Bound every Google prompt deterministically (defer, never drop) | `gemini_tool_cap.ts`, `opencode_client_service.ts`, tests | (a) For `google`, `capMcpAllowlistForProvider` output has the same `servers`/`tools` sets as the input plus `deferred:true`; every permutation of the input gives equal sets; `trimmed===false`. (b) For `anthropic`/`openai`/`undefined`, the return value `===` the input. (c) `promptAsync`/`prompt` with a non-Google model call `session.get`/`session.update` 0 times. (d) Google + undefined allowlist → exactly one PATCH `{servers: sorted listMcp keys, tools: [], deferred:true}` before the prompt. (e) Google + eager scoped allowlist → PATCH equals the input plus `deferred:true`. (f) Google + already deferred → no PATCH. (g) GET or PATCH failure → the engine prompt is never called and the status message contains `512` and `not sent`. (h) The log line contains none of `inputSchema`, `properties`, prompt text or the `apiKey` value. | none | `cd apps/api_server && npx vitest run src/services/__tests__/gemini_tool_cap.test.ts src/services/__tests__/opencode_client_google_bound.test.ts && npx tsc --noEmit`; the full `npx vitest run` suite keeps its pre-existing pass/fail set |
| S2 | Mobile gateway Google bound | `mobile_opencode_proxy.ts`, `src/__tests__/issue_1169_mobile_opencode_proxy.test.ts` | (a) A legacy create with `body.model.providerID:'google'` and no `profileId` sends `mcpAllowlist.deferred===true` over all servers. (b) A create with an inherit-all profile and a Google model does the same. (c) A `session.prompt_async` forward with a Google model triggers `ensureGoogleBoundedTurn` before the fetch; if that fails, the response is 409 and the engine sees 0 fetches. (d) Non-Google create and prompt bodies are byte-identical to the current output. | S1 (helper) | `cd apps/api_server && npx vitest run src/__tests__/issue_1169_mobile_opencode_proxy.test.ts` |
| S3 | Project a scope for native subagents (interim; delete when F1 lands) | `opencode_plugin_config.ts`, `routes/opencode_mcp_routes.ts`, test | (a) With config `mcp:{b,a}`, `agent.general.options.mcpAllowlist` and the `explore` equivalent deep-equal `{servers:["a","b"],tools:[]}`. (b) Existing `agent.general.*` keys are preserved. (c) A second run returns `false`. (d) After addMcp/removeMcp, the projected list matches the new `mcp` keys. (e) In the sandbox, the engine's agent listing shows `general.options.mcpAllowlist`. | none (disjoint from S1) | Unit test via `npx vitest run`; (e) is proven in S5 |
| S4 | Actionable Gemini tool-limit error | `gemini_tool_cap.ts` (pure helper), `opencode_stream_bridge.ts` (1 line) | (a) The raw DB proto string maps to a message containing `Gemini`, `512` and a next step, with `errorClass:'provider_tool_limit'`, and without `function_declarations[` or `GenerateContentRequest`. (b) Messages that don't match are returned unchanged, and the #913 tests still pass. | S1 (same helper file; run after it) | `cd apps/api_server && npx vitest run src/services/__tests__/gemini_tool_cap.test.ts src/services/__tests__/opencode_stream_bridge.test.ts src/services/__tests__/opc_event_stream_bridge.test.ts src/__tests__/issue_1123_stream_bridge.test.ts` |
| S5 | Live behavioral qualification in the sandbox, without credentials | the live test + fixtures, run log | All counts are observed by the stub. (1) Unscoped Google root: ≤512 declarations, `mcp_dispatch` present, no fixture tool as a top-level declaration, turn completes. (2) Scoped profile with the 600-tool inherit-all server on Google: same. (3) Google root whose stub replies `functionCall task{subagent_type:"general"}`: the child request is ≤512 and the child and parent both complete. (4) A continuation or wake prompt using the profile's Google model after an OpenAI-compatible turn: ≤512. (5) OpenAI-compatible stub, unscoped: count equals the full eager count (600 + builtins), unchanged from base. (6) Dynamic tools: after addMcp of a second fixture server, the next Google turn's `mcp_dispatch` catalog contains its sentinel tool name, and a new `general` child's allowlist includes it. **Before the fix, (3) and (4) are recorded red on `e93eac6e`.** | S1–S4 | `cd apps/opencode_fork/packages/opencode && bun run build --single`; `cd apps/api_server && npm run build`; fixture env as in AGENTS.md, using a synthetic fixture root under `/private/tmp`, an empty migrated DB and a fixture opencode config (stub `baseURL`s, `apiKey:"sandbox-fake-key"`, local-command MCP map); `tools/dev/sandbox.sh up && tools/dev/sandbox.sh status`; `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://localhost:4098 npx vitest run src/__tests__/live_e2e_1468_gemini_tool_bound.test.ts`; `tools/dev/sandbox.sh down`; record the output in the run log |
| S6 | Manual real-Gemini credential gate (AJ) | run log only | Using AJ's own Code Assist credential (never committed), in the sandbox (`RHYTHM_LIVE_URL=:4098`) or a rebuilt desktop: (a) an unscoped Gemini turn completes; (b) a Gemini turn that delegates to `@general` completes; (c) the same prompts on Anthropic and OpenAI behave as before. Record pass, fail, or **BLOCKED** (licence/project errors were seen 2026-08-20/26). BLOCKED is not a pass. | S5 green | Extended `live_e2e_927_952_gemini.test.ts` pointed at the sandbox, plus manual smoke steps in the run log |

Parallel slices: S1 and S3 have disjoint file ownership and can run at the same time. S2 and S4 follow S1. S5 goes after everything else.

## Follow-ups (file them; don't implement here)

- **F1 — required, `mcp-scope-NN` (fork edit allowed under that label).** In `task.ts childMcpAllowlist`, fall back to `parent.mcpAllowlist` (mirroring `childSkillAllowlist`); when the result is unscoped and the model is Google, return all-servers deferred. Add an exact final-count guard for Google in `prompt.ts` `resolveTools`/`llm.ts` that raises a typed `ProviderToolLimitError{provider,limit,count}` before the request. Delete S3.
  - Security reason: a scoped parent currently widens to every server through `@general` (Secretary → `@general` rows, 2026-06-29).
- **F2 — separate issue, needs AJ approval for a fork edit.** In `sanitizeGemini` (and `packages/llm` `gemini-tool-schema.ts`), stringify `const` because of the AI SDK conversion from `const` to `enum`. Identify the MCP tool that emits `const: true` (graphic-designer scope, declarations [24]/[25]).
- Out of scope: the parent stall in #1458/#1466.

## Coverage matrix

| Requirement | Slice | Falsifiable check | Validation |
|---|---|---|---|
| AC1: capped deterministically before the request is built | S1, S2, S3 (exact version: F1) | S1a/d/e, S5 1–4 counts ≤512 | vitest + S5 |
| AC2: trimming is explicit and logged | S1 (nothing is ever dropped; deferral is logged) | S1h, the log line | vitest |
| AC3: profile-less sessions get a bounded default | S1/S3 for Google; other providers unchanged (Q1) | S5 1, 3 | S5 |
| AC4: actionable error naming the cap and the count | S4 (cap), S1g (count on refusal); exact count on a raw provider error comes from F1 | S4a, S1g | vitest |
| AC5: Google regression test above 512 | S1 unit tests, S5 | S5 3 red → green | S5 |
| No real credentials in tests | S5 stub + fake key; S6 is manual | grep the test for key patterns | review |
| OpenAI/Anthropic regression | S1b/c, S2d, S5 5, S6c | identity / 0 extra calls / full count | vitest + S5 + S6 |
| Dynamic tools / builtins | S3d, S5 6 | catalog sentinel present | S5 |
| Fork untouched | all | `git diff --stat e93eac6e -- apps/opencode_fork` is empty | review |

## GitNexus impact (index is main `648f8d58`; mega is +167 commits, so run `node .gitnexus/run.cjs analyze` in the worktree before coding)

- `capMcpAllowlistForProvider`: **LOW**. d1: `createSession`, `updateSessionAllowlist`, `applyMobileSessionCreateScope`. d2: `turn_redispatch.prepare`, `ws_gateway.handleInputFrame`, `delegateToAgentAsync`, `agent_runner._runOnce`, controller `create`/`resume`, `MobileOpenCodeProxy.forward`.
- `OpencodeClientService.promptAsync`: GitNexus reports LOW (3 direct), but it **under-reports** because of `.bind` in ws_gateway and the cast `.call` in turn_redispatch. Grep finds 5 callers plus `prompt()` from agent_runner. Treat it as **MEDIUM**: it's on the hot path of every agent turn. The mitigation is that the branch runs only for Google, and S1c proves non-Google turns make zero extra calls.
- `OpencodeStreamBridge._relayEvent`: **HIGH** (d1 = 2, affects the `resume`/`fork`/`create` flows). ⚠️ Mitigations: one added line calling a pure helper, following the existing #913 pattern; all other branches untouched; the existing bridge suite must pass.
- `applyMobileSessionCreateScope`: **LOW** (the `createMobileGatewayRouter` flow). `ensureManagedDefaults`: **LOW** (called only at startup, `server.ts:580`).
- Before committing: `detect_changes({scope:"compare", base_ref:"e93eac6e"})` must show only the symbols above.

## Doubt review

This plan is wrong if any of these is true:

- **(1)** opencode.json `agent.general.options` doesn't reach `Agent.Info.options`. For example, a projected `.md` could shadow it, or config validation could strip it. Then children stay unbounded. The cheapest probe is S3e / S5-3.
- **(2)** Gemini rejects the deferred catalog for another reason, such as a size limit on one very long `mcp_dispatch` description listing more than 600 names. That is UNVERIFIED. Only S6 can reveal it, and #952 shipped the same shape.
- **(3)** The Code Assist path (opencode-gemini-auth) assembles tools differently from the AI Studio stub. Only S6 catches this.
- **(4)** Callers send Google turns with no model. The choke point is then skipped, which is documented as a residual.

Primary sources checked: the live DB rows, the fork source at `e93eac6e`, and the installed `@ai-sdk/google` 3.0.63 dist. The prior-art swarm was skipped because the request said not to dispatch; the key contracts were verified locally instead.

## Open questions (safe defaults apply if AJ doesn't answer)

1. Extend the bounded (deferred) default to profile-less **OpenAI/Anthropic** sessions, which is AC3 read literally? **Default: no.** Their behavior stays unchanged.
2. Reclassify the child fix as `mcp-scope` now and skip S3? **Default: keep S3 as the interim fix and file F1.**
3. Treat `google-vertex` and Gemini through `openrouter`/`opencode` as bounded too? **Default: `google` only**, matching the fork's child rule.
4. File F2 (the const→enum bug) with fork-edit approval? **Default: file it, don't implement it.**

The implementation dispatch should start from a fresh or `/compact`ed context: this planning pass produced a lot of exploration output.
