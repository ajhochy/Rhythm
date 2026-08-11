# Project State

## Current focus

Live-artifact automated verification passed, but the human visual smoke **failed**: the tested native surface was a security/integration harness rather than a usable end-to-end shipping-app workflow. Existing backend, security, runtime, Dashboard tab, and same-ID agent-to-human work remains present, but it does not constitute usable completion. See `docs/ai/runs/2026-08-10-retro-live-artifact-workflow-failure.md`.

## Active branch / PR

- Branch: `feat/artifact-viewer`, pushed and tracking its remote, with `origin/main` `8a3561d9` merged.
- Draft PR: [#1338](https://github.com/ajhochy/Rhythm/pull/1338) remains **NOT READY** after failed manual smoke.
- Sharing follow-up: [#1339](https://github.com/ajhochy/Rhythm/issues/1339). Import has no issue and requires AJ approval before filing.

## In progress

- Product scope must be decided for importing existing HTML/Claude artifacts and for #1339 before implementation resumes.
- Existing unrelated follow-ups remain: on-device confirmation of #1327 subagent approvals; #1319 parent taint propagation and `rhythm_delegation_transcript`; transcript fencing for the remaining half of #1331.

## Risks / known issues

- The shipping app has no user-facing import for existing HTML/Claude artifacts, no Share dialog or collaborator management for existing artifacts, and no agent tool to update sharing after creation.
- The CI server check failed and remains separately untriaged; it is not the explanation for the product-smoke failure.
- GitNexus CLI conservatively reports **HIGH** across eight flows; all eight map to tested PCO-read or artifact-create entry points and are covered. Manager MCP reports LOW. The guarded DEBUG-only `MainFlutterWindow` registration retained its pre-impact startup-risk review and is absent from the Release binary.
- Unrelated nonblocking residual: VoiceOver traversal through offscreen dashboard rows.
- #1322 remains partial: plan mode does not make arbitrary `bash` read-only.
- Never start a bare manual `api_server` for smoke; use `tools/dev/sandbox.sh` to avoid the live engine/DB collision paths.
- The rejected demo process remains running by AJ's direction; do not manipulate it.
- `apps/api_server` still has no effective lint gate; TypeScript compilation is its static check.

## Test status

- Automated verification: **PASS** after merging `origin/main`; sanitized `ai-workflow checks --level pr` passed.
- Post-merge totals: API **4,127**, Flutter **1,129** (including **48** live-artifact), and MCP **169**; focused MCP/security **21**, AV-03 contract **11**, and real Postgres bootstrap/parity **2** passed.
- Native AV-06 A1–A10/C3–C5, secure bridge/runtime checks, Release package verification, deterministic screenshots, and the real engine/MCP → hosted API → human same-ID flow passed.
- Human visual smoke: **FAILED**; PR #1338 is not ready.

## Next step

Decide the import product scope and #1339 scope before implementation resumes. Then run an early shipping-app user-journey smoke before further hardening or any PR-readiness claim. Do not merge or deploy PR #1338.

## Recent coding-agent runs

### 2026-08-10 — issue #1355 dashboard MCP App pilot
- Files modified: existing dashboard registration/result, additive trusted app-tool helper, self-contained dashboard resource, focused MCP/security contracts, and evidence records.
- Checks run: focused MCP/security 13/13 PASS; MCP typecheck/build PASS; generic Dart host contract PASS; listener-dependent full-suite cases environment-blocked by socket EPERM.
- Decisions made: preserve the one existing tool and full fenced text fallback; expose only aggregate numeric structured metrics; keep Flutter entirely pilot-agnostic.
- Concerns: both-pilot live and packaged smoke remains release-blocking before activation.

### 2026-08-10 — issue #1357 same-server MCP App execution
- Files modified: fork proof/execution gate and endpoints; regenerated v2 SDK; API server-only proof broker and typed wrappers; Flutter `tools/call` transport policy; focused contract/live tests and run log.
- Checks run: fork focused contracts 11/11 PASS and typecheck PASS; SDK regeneration PASS; API focused contracts 4 PASS / live skipped and typecheck PASS; pure-Dart interactive transport PASS.
- Decisions made: engine signs the persisted origin/resource hash for at most 60 seconds; API retains proof only in process; proof is consumed before permission/hook/MCP side effects; current app registry, profile allowlist, and AJV input schema are rechecked at execution.
- Deviations from spec: live sandbox and packaged/debug permission smoke could not run because this worker cannot bind sockets or operate packaged UI.
- Concerns: orchestrator must run approved, permission-denied, and cross-server live fixtures plus packaged/debug smoke before enabling interactive mode.

### 2026-08-10 — issue #1353 MCP App capability broker and transport
- Files modified: additive API capability broker/authority and owned session routes; bounded Flutter transport and interactive trusted-shell integration; focused contract/live tests and run log.
- Checks run: API broker 2/2 PASS with live env-gated/skipped; API typecheck PASS; Dart transport/policy contract PASS; Flutter analyze PASS with 296 pre-existing infos.
- Decisions made: retain all seven authority fields only in the API process; preflight opaque capability/session/call/replay before engine reads; consume correlations before the next gate; stop valid requests at a deterministic 403 until #1357.
- Deviations from spec: live sandbox could not run because this worker cannot bind sockets.
- Concerns: orchestrator must run the env-gated real-stack denial and final native packaged smoke before activation.

### 2026-08-10 — issue #1351 read-only MCP App pilot
- Files modified: generic read-only host/WebView, additive completed-call descriptor parsing, generic tool-card integration, focused contract/widget/live tests, contract status, and run log.
- Checks run: pure-Dart contract PASS; fork resource/descriptor contracts 9/9 PASS; API live test env-gated/skipped and API typecheck PASS; Flutter analyze PASS; focused Flutter test BLOCKED before assertions by sandbox socket EPERM.
- Decisions made: activate only from canonical `readonly` plus strict persisted provenance; fetch by fixed localhost session/call only; keep fallback outside the WebView; retain no app-originated mutation callback.
- Deviations from spec: live isolated sandbox and Debug/packaged Release visual smoke could not run in this managed worker.
- Concerns: the HIGH-impact `ChatPart` change is additive/nullable but requires the final full Flutter gate; UI-capable orchestration must verify real Open Design compatibility before activation.

### 2026-08-10 — issue #1350 trusted MCP App shell
- Files modified: additive production Swift shell/WebKit policy plus Runner source registration; Dart bounded host lifecycle policy; native/Flutter contracts; env-gated fixture and evidence records.
- Checks run: native contract 4/4 PASS; standalone debug and optimized-release valid/malicious fixtures PASS; disabled-by-default guard and project-file lint PASS; Flutter analyze PASS; focused Flutter runtime BLOCKED before load by sandbox socket EPERM.
- Decisions made: keep the child in an opaque `allow-scripts`-only iframe, expose the native handler only through the validated outer shell/main frame, create a fresh nonpersistent store per view, and parse all non-canonical modes as off.
- Deviations from spec: interactive packaged-app evidence could not run in this non-UI managed worker; it remains explicit in the manual evidence matrix.
- Concerns: a UI-capable orchestrator must run the focused Flutter test and malicious Debug/packaged Release fixture before activation.

### 2026-08-11 — issue #1345 session-bound MCP App resource reads
- Files modified: fork provenance/policy/session route, generated OpenAPI and both SDK surfaces, api_server owned route/controller/wrapper, fixed-localhost Flutter data source, acceptance/live contracts, and run log.
- Checks run: fork #1345+#1352 9/9 PASS; fork and SDK typechecks PASS; SDK regeneration PASS; API contract 2/2 PASS with live skipped and API typecheck PASS; Flutter format/analyze PASS; Flutter and pre-existing API route tests BLOCKED before assertions by sandbox socket EPERM; GitNexus change detection MEDIUM and scoped to expected session/resource surfaces.
- Decisions made: persist a 10-minute ISO-Z provenance envelope on completed tool state; revalidate mode, exact session/call/cwd, expiry, and the current same-server app registry before the sole bounded MCP read; return only exact single text HTML content.
- Deviations from spec: live sandbox and Flutter runtime tests could not run because this worker cannot bind sockets; no commit or push made by coding-agent.
- Concerns: socket-capable orchestration must run the env-gated live path and the pre-existing route/Flutter suites before any completion claim.

### 2026-08-10 — issue #1343 MCP App isolation feasibility probe
- Files modified: disposable WebKit policy and standalone DEBUG/env-gated launcher under `apps/desktop_flutter/macos`; five-case native contract; manual evidence contract; NO-GO ADR and run log.
- Checks run: native contract 5/5 PASS; standalone Swift launcher compile PASS; disabled-by-default exit-64 guard PASS; Flutter offline pub resolution, Dart format (463 files, 0 changed), and analyze PASS.
- Decisions made: do not touch `MainFlutterWindow` or add a permanent dependency; record NO-GO because official AppBridge and interactive DEBUG/packaged Release evidence are unavailable in this worker. See `docs/ai/decisions/2026-08-10-mcp-app-isolation-probe-no-go.md`.
- Deviations from spec: interactive DEBUG and packaged Release evidence M1–M6 remains unrun; no false GO claimed.
- Concerns: a UI-capable orchestrator must resolve the official AppBridge and complete both evidence matrices before production host work can proceed.

### 2026-08-10 — issue #1352 MCP Apps negotiation and UI descriptors
- Files modified: fork MCP discovery/registry (`apps/opencode_fork/packages/opencode/src/mcp/index.ts`), three typed MCP test doubles, issue contract/live tests and contract JSON supplied by acceptance-contract.
- Checks run: focused #1352 contract plus MCP lifecycle suite 26/26 PASS (75 assertions); fork `bun run typecheck` PASS; `git diff --check` PASS; prompt/snapshot and OAuth/browser suites BLOCKED before assertions because the managed sandbox denies their HTTP server binds.
- Decisions made: accept only exact `off|readonly|interactive` values (everything else is `off`); negotiate the stable `capabilities.extensions['io.modelcontextprotocol/ui']` MIME entry; retain `_meta` in tolerant discovery; interpret UI visibility only for negotiated peers, with missing visibility defaulting to model+app and malformed/ambiguous values granting neither surface.
- Deviations from spec: env-gated live sandbox test was not run because network sockets are prohibited in this worker environment; no commit or push made by the coding-agent.
- Concerns: the later socket-capable orchestrator gate must run the live negotiation fixture and the existing server-backed fork regression suites.

### 2026-08-10 — issue #1342 MCP result envelope
- Files modified: fork session envelope/schema/plumbing (`mcp-result-envelope.ts`, `message-v2.ts`, `processor.ts`, `prompt.ts`); Flutter untrusted envelope model and collapsed JSON fallback (`chat_models.dart`, `_tool_call_part.dart`).
- Checks run: fork contract 1/1 PASS; fork typecheck PASS; API contract 2/2 PASS with live test skipped; Flutter analyze PASS with 296 pre-existing infos; Dart format PASS; Flutter focused test BLOCKED before assertions by sandbox socket-bind EPERM; API typecheck/build BLOCKED by acceptance fixture's invalid `agentKind: 'build'`; fork binary build BLOCKED by denied `models.dev` network access; Flutter macOS build BLOCKED by sandbox/Xcode workspace failure.
- Decisions made: retain only `structuredContent`, `_meta`, and `isError` in a JSON-round-tripped 1 MiB envelope; preserve `state.output` unchanged; render structured content as inert selectable text with no HTML execution.
- Deviations from spec: env-gated live sandbox test not run because loopback/socket use is prohibited in this managed sandbox; no commit made by dispatched coding-agent.
- Concerns: final gate needs the contract-owned API fixture corrected to a valid `AgentKind`, plus Flutter/live execution in a socket-capable environment.
