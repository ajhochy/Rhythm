---
date: 2026-07-25
repo: Rhythm
branch: codex/1175-approval-taint-listener
pr: null
issues: [1175]
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #1175 wildcard security correction

## Files

- Replaced the role-graph wildcard exemption with a parser over the actual
  registered Rhythm tool inventory.
- Classified all 75 registered tools: 32 external/user reads, 41 protected
  mutations, one trusted ping, and `rhythm_request_approval`.
- Added centralized scan, durable taint, and untrusted fencing to automation
  detail/preview/catalog reads, agent-profile permission reads, and all three
  feedback sensors.
- Added exact action/payload authorization to the 18 consequential mutations
  omitted by the first inventory:
  - async delegation, notification send, schedule create/cancel/trigger, and
    memory update;
  - rhythm delete and rhythm-step create/delete;
  - project-template create, project-template-step create, and project-step
    update;
  - automation create/update/delete/resync;
  - agent-profile create and permission update.
- Aligned the API taint-source allowlist with every declared MCP ingress,
  including previously rejected schedule, automation, and session sources.
- Extended the built live smoke through
  `automation.preview -> automation.delete`, including a denied substituted
  payload and a successful exact signed consume.

## Checks

- `npm run typecheck` (`apps/mcp_server`) — pass.
- `npm test -- --reporter=dot` (`apps/mcp_server`) — pass, 22 files / 99 tests.
- `npm run build` (`apps/api_server`) — pass.
- `npx vitest run src/__tests__/issue_1134_external_content_security.test.ts`
  — pass, 7 tests; the 18 corrective actions each rejected substitution and
  accepted an exact signed payload.
- Human-approval/signature/security focused suite — pass, 3 files / 16 tests.
- #1175 c17/c20/c21 acceptance slice — pass, 3 tests; 2 unrelated criteria
  skipped.
- `npx vitest run
  src/security/__tests__/external_content_role_graph.test.ts` — pass, 4 tests;
  all 75 registered tools classified and the dev wildcard expanded.
- `RHYTHM_LIVE_E2E=1 npx vitest run
  src/__tests__/issue_1175_adversarial_live.test.ts` — pass, 3 tests against
  the rebuilt sandboxed API.
- Full API suite — 379 files / 3292 tests pass, with six test failures in four
  files owned by the concurrent c11/c15/schema workstream. None intersects the
  files or behavior in this corrective slice.
- `ai-workflow checks --level issue` — pass: Flutter analyze/format plus API
  and MCP TypeScript.
- GitNexus corrective scope — LOW, 26 files / 21 symbols / zero affected
  flows. Aggregate compare-to-main remains CRITICAL because the branch
  inherits 617 files / 3,385 symbols / 24 flows from parallel #1076–#1175
  workstreams.

## Notes

The first focused API run failed because the MCP and API independently
maintained ingress-source allowlists. Failure triage showed that the drift also
pre-dated this correction for scheduled-task, automation-list, and
agent-session reads. The full API inventory was aligned and the role graph now
asserts every MCP source is accepted by the API.
