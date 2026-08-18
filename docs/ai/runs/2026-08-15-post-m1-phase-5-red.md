---
date: 2026-08-15
repo: Rhythm-react-electron-live-suite
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-5]
status: pending
tags: [run, rhythm-react-electron-live-suite]
---

# Post-M1 Phase 5 acceptance-contract RED preparation

## Files

- `apps/web/tests/post-m1-phase-5-live-fixtures.ts`
- `apps/web/tests/post-m1-phase-5-permissions.redspec.ts`
- `apps/web/tests/post-m1-phase-5-questions.redspec.ts`
- `apps/web/tests/post-m1-phase-5-approvals-delegation.redspec.ts`
- `apps/web/tests/post-m1-phase-5-catalogs-commands.redspec.ts`
- `apps/web/tests/post-m1-phase-5-gateways.redspec.ts`
- `apps/web/tests/post-m1-phase-5-fixture-playwright.config.ts`
- `apps/api_server/src/__tests__/post_m1_phase_5_route_contract.test.ts`
- `docs/ai/contracts/post-m1-phase-5.json`

No product source, Electron source, gateway source, page source, SHA256SUMS-listed file, branch, worktree, or commit was changed.

## Checks

### Playwright collection (final)

Command:

```text
cd apps/web && npx playwright test --config tests/post-m1-phase-5-fixture-playwright.config.ts --list
```

Observed output:

```text
Listing tests:
  post-m1-phase-5-approvals-delegation.redspec.ts:4:1 › post-m1-p5-c2b: pending human approval is shared by review and originating transcript
  post-m1-phase-5-approvals-delegation.redspec.ts:34:1 › post-m1-p5-c2d: child identity remains separate and its isolated transcript is read only
  post-m1-phase-5-catalogs-commands.redspec.ts:4:1 › post-m1-p5-c3d: profile MCP policy is authored from live servers and exact tools
  post-m1-phase-5-catalogs-commands.redspec.ts:29:1 › post-m1-p5-c3e: profile skill policy is authored from the live exact-name catalog
  post-m1-phase-5-catalogs-commands.redspec.ts:54:1 › post-m1-p5-c3g: live command discovery dispatches session.command instead of session.input
  post-m1-phase-5-gateways.redspec.ts:21:1 › post-m1-p5-c1b: permission gateway owns pending/reply and bounded retry behavior
  post-m1-phase-5-gateways.redspec.ts:27:1 › post-m1-p5-c2a: approval gateway lists pending rows and submits signed decisions
  post-m1-phase-5-gateways.redspec.ts:33:1 › post-m1-p5-c2c: delegation gateway preserves scoped parent/child identity and status
  post-m1-phase-5-gateways.redspec.ts:39:1 › post-m1-p5-c2e: delegation status is a bounded metadata-only live boundary
  post-m1-phase-5-gateways.redspec.ts:45:1 › post-m1-p5-c3a: MCP gateway exposes the canonical live catalog
  post-m1-phase-5-gateways.redspec.ts:50:1 › post-m1-p5-c3b: MCP gateway exposes the complete credential/OAuth/lifecycle surface
  post-m1-phase-5-gateways.redspec.ts:55:1 › post-m1-p5-c3c: skill gateway exposes metadata, content, reload, and managed CRUD
  post-m1-phase-5-gateways.redspec.ts:60:1 › post-m1-p5-c3f: session tool surface supports scoped deferred MCP dispatch
  post-m1-phase-5-permissions.redspec.ts:4:1 › post-m1-p5-c1a: translated permission card sends exactly one canonical decision
  post-m1-phase-5-permissions.redspec.ts:43:1 › post-m1-p5-c1c: reconnect rehydrates once and permission.replied closes the card
  post-m1-phase-5-permissions.redspec.ts:73:1 › post-m1-p5-c1e: permission mode uses canonical persisted values
  post-m1-phase-5-questions.redspec.ts:4:1 › post-m1-p5-c1d: full multi-question shape replies once with answers:string[][] and honors remote resolution
Total: 17 tests in 5 files
```

Chromium was not launched and no Playwright test was executed, per the unit constraint. Therefore these criteria remain `pending`; collection alone is not RED evidence.

An earlier collection, before the c2a and c2e gateway criteria were added, also completed successfully:

```text
Listing tests:
  post-m1-phase-5-approvals-delegation.redspec.ts:4:1 › post-m1-p5-c2b: pending human approval is shared by review and originating transcript
  post-m1-phase-5-approvals-delegation.redspec.ts:34:1 › post-m1-p5-c2d: child identity remains separate and its isolated transcript is read only
  post-m1-phase-5-catalogs-commands.redspec.ts:4:1 › post-m1-p5-c3d: profile MCP policy is authored from live servers and exact tools
  post-m1-phase-5-catalogs-commands.redspec.ts:29:1 › post-m1-p5-c3e: profile skill policy is authored from the live exact-name catalog
  post-m1-phase-5-catalogs-commands.redspec.ts:54:1 › post-m1-p5-c3g: live command discovery dispatches session.command instead of session.input
  post-m1-phase-5-gateways.redspec.ts:21:1 › post-m1-p5-c1b: permission gateway owns pending/reply and bounded retry behavior
  post-m1-phase-5-gateways.redspec.ts:27:1 › post-m1-p5-c2c: delegation gateway preserves scoped parent/child identity and status
  post-m1-phase-5-gateways.redspec.ts:33:1 › post-m1-p5-c3a: MCP gateway exposes the canonical live catalog
  post-m1-phase-5-gateways.redspec.ts:38:1 › post-m1-p5-c3b: MCP gateway exposes the complete credential/OAuth/lifecycle surface
  post-m1-phase-5-gateways.redspec.ts:43:1 › post-m1-p5-c3c: skill gateway exposes metadata, content, reload, and managed CRUD
  post-m1-phase-5-gateways.redspec.ts:48:1 › post-m1-p5-c3f: session tool surface supports scoped deferred MCP dispatch
  post-m1-phase-5-permissions.redspec.ts:4:1 › post-m1-p5-c1a: translated permission card sends exactly one canonical decision
  post-m1-phase-5-permissions.redspec.ts:43:1 › post-m1-p5-c1c: reconnect rehydrates once and permission.replied closes the card
  post-m1-phase-5-permissions.redspec.ts:73:1 › post-m1-p5-c1e: permission mode uses canonical persisted values
  post-m1-phase-5-questions.redspec.ts:4:1 › post-m1-p5-c1d: full multi-question shape replies once with answers:string[][] and honors remote resolution
Total: 15 tests in 5 files
```

### Web TypeScript check

Command:

```text
cd apps/web && npm run typecheck
```

Observed output:

```text
> rhythm-desktop-agents@1.0.0 typecheck
> tsc -b
```

### API route and vocabulary guard

Command:

```text
cd apps/api_server && npm test -- --run src/__tests__/post_m1_phase_5_route_contract.test.ts
```

Observed output:

```text
> rhythm-api-server@0.1.0 test
> vitest run --run src/__tests__/post_m1_phase_5_route_contract.test.ts


 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server


 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  19:49:15
   Duration  111ms (transform 18ms, setup 0ms, import 25ms, tests 3ms, environment 0ms)
```

This passing guard proves the web contracts do not depend on invented HTTP endpoints and that `permissionMode` uses `default | acceptEdits | plan | bypassPermissions`.

### Repaired collection invocation

One verification command was initially run from `apps/web` while still using repository-root paths. It failed before collection with the following output; the command was corrected by running from the repository root, after which the final 17-test collection above succeeded.

```text
rg: apps/api_server/src/services/ws_gateway.ts: No such file or directory (os error 2)
rg: apps/api_server/src/__tests__/opc_m3_4_command_dispatch.test.ts: No such file or directory (os error 2)
rg: apps/web/src/endpointMap.ts: No such file or directory (os error 2)
jq: error: Could not open file docs/ai/contracts/post-m1-phase-5.json: No such file or directory
```

### Sandbox and residue

Observed status and nonce checks:

```text
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
live-artifact storage: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox/live-artifacts
api :4098 listener: 27366
engine :4097 listener: 27394
gateway :4099 listener: 27366
rows|0
sessions|0
worktrees=0
branches=0
codex/react-electron-live-suite
```

Sandbox OpenCode files were read-only checked. Both reported `has_lmstudio_auth: false`. This unit did not change providers, models, auth, ports, processes, rows, or sessions.

## Routes verified

- `PATCH /agent-sessions/:id`, `GET /agent-sessions/:id/pending-permissions`, `POST /agent-sessions/:id/permissions/:permissionID/reply`, and `POST /agent-sessions/:id/question/:callId/:action` — `apps/api_server/src/routes/agent_sessions_routes.ts:68,98-115`.
- `GET /agent-approvals` and `PATCH /agent-approvals/:id` — `apps/api_server/src/routes/agent_approvals_routes.ts:43-53`.
- `POST /agent-delegation/delegate`, `POST /agent-delegation/delegate-async`, `GET /agent-delegation/status`, and `POST /agent-delegation/:id/cancel` — `apps/api_server/src/routes/agent_delegation_routes.ts:29-35`.
- `GET/POST /opencode/mcp`, credentials, OAuth start/status, connect, disconnect, and remove — `apps/api_server/src/routes/opencode_mcp_routes.ts:80-208,274-342,371-448`.
- `GET/POST /opencode/skills`, content, update, and remove — `apps/api_server/src/routes/opencode_skills_routes.ts:170-301,313-341,397-455`.
- `POST /system/refresh` — `apps/api_server/src/routes/system_routes.ts:33-53`.
- `GET/POST /opencode/commands`, content, update, and remove — `apps/api_server/src/routes/opencode_commands_routes.ts:43-63,68-91,96-150,155-215,220-243`.
- WS `session.command` is explicitly handled as a frame, not an HTTP route — `apps/api_server/src/services/ws_gateway.ts:202-233,979-982`.
- Mounts are present at `/agent-approvals`, `/agent-configs`, `/agent-delegation`, `/opencode/mcp`, `/opencode/skills`, `/system`, and `/opencode/commands` — `apps/api_server/src/app.ts:205,209-210,245-258,274`.

## Notes

- The tests use `page.route`, `page.routeWebSocket`, and gateway-boundary assertions. No product-only `window.__*` injection hook was added.
- The live fixture uses API-native roles and fields (`role: output`, `permissionID`, `callId`, `answers: string[][]`, `permissionMode`, `allowedMcpsJson`, `allowedSkillsJson`, and `{v:1,type:'session.command',id,command,arguments}`).
- Four packaged-app criteria are `not_tested`: this unit was explicitly prohibited from editing Electron, launching Electron, or running a GUI.
- Orchestrator action: execute `cd apps/web && npx playwright test --config tests/post-m1-phase-5-fixture-playwright.config.ts`, capture each assertion failure, and change only actually observed assertion failures from `pending` to `red`.
