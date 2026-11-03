---
date: 2026-10-20
repo: Rhythm
branch: local AI feature worktree
pr: null
issues: []
status: repairing
tags: [run, rhythm, mcp, contract]
---

# MCP canonical execution guidance: test-first contract

This is a local acceptance contract, not a GitHub issue. Its `issue: null` and `local_contract_id` in `docs/ai/contracts/local-mcp-canonical-guidance.json` explicitly mark the exception to the issue-numbered acceptance-contract schema. Three new expectations were written before production edits; the existing ambiguous-name guard is retained as the fourth criterion. No production symbol, running backend, native app, model loan, or key was changed in this phase.

## Recorded RED and baseline

- Fork real `SessionPrompt`/deferred dispatcher with the repository's scripted provider, focused Case M: **RED** at `executeName` missing from `describe` output after registered-name lookup. The preceding 15 assertions proved current search, bare-name denial, canonical wrapped execution, and exact one-tool effect. Command from repository root: `npm run build:guard -- /bin/sh -c 'cd apps/opencode_fork/packages/opencode && bun test test/session/mcp_allowlist_e2e.test.ts -t "Case M"'`.
- Fork focused `local-mcp-canonical-guidance-c2`: **RED** because the denied bare-name execute response contains only `not permitted`; the test had already observed two denied calls, one canonical successful call, exactly one allowed effect and zero out-of-scope effects. Same guarded command with `-t "local-mcp-canonical-guidance-c2"`.
- MCP server `local-mcp-canonical-guidance-c3`: **RED** because the status tool description lacks canonical guidance. Command: `npm run build:guard -- /bin/sh -c 'cd apps/mcp_server && ./node_modules/.bin/vitest run src/tools/__tests__/coordinatorConversation.test.ts -t local-mcp-canonical-guidance-c3'`.
- Existing fork Case N: **GREEN 1/1**, ambiguous registered name denied with zero effects. Guarded command with `-t "Case N"`. It is an existing security baseline, not a newly discovered failure.

GitNexus upstream impact before test edits returned LOW/zero for `mcpCall` and `registerCoordinatorConversationTools`; the global Rhythm index is **320 commits behind this worktree**, so that graph is not current. `fixture` in the MCP test was not indexed; its local use is visible in the one test file. No HIGH result was reported. Manual scope: test-only changes in the fork dispatcher E2E and MCP registration tests, plus this local contract and run note.

## Minimal implementation proposal and boundary

The dispatcher already returns canonical `name` and informational `registeredName` from a fresh eligible inventory and explicitly says to execute canonical names. The native failure was a real Luna choice to execute the registered names after a valid describe. The start-goal description and `goalId` schema also say `rhythm_get_coordinator_status`, a bare registered name; this may have contributed, but causality is not established. Add `executeName: selected` to the existing describe response, tighten its generic canonical retry guidance on a rejected execute, and revise only the Coordinator tool descriptions/schema to say to describe and then execute the returned canonical name. Preserve canonical-only execute, exact server-scoped allowlist, ambiguous-name denial, no denied-name exposure, signing, and no alias resolver or fallback.

The generic dispatcher description/error change affects all deferred MCP sessions, and the Coordinator prose is visible to direct MCP clients; review those shared surfaces and keep existing Case M/N/O/P plus #765/#789 scope guards. The existing `mcp_allowlist_e2e.test.ts` uses a scripted model server against the real engine `SessionPrompt` and wrapped MCP executor, so it deterministically exercises the bad bare-call path without paid LLM sampling. It does **not** launch the API server or packaged UI. A follow-up live behavioral check can run the exact rebuilt fork and API/MCP inside the documented sanitized `tools/dev/sandbox.sh` on API 4098 / engine 4097; this phase did not start it. The signed packaged Coordinator workflow and real-model recovery remain independently unverified.

## Small source repair and focused checks

`apps/opencode_fork/packages/opencode/src/session/prompt.ts` now includes `executeName: selected` in the permitted describe output, instructs canonical execution in the dispatcher description, and appends a generic describe/executeName hint to a denied MCP name. The hint does not resolve a requested alias, reveal a denied candidate, or change the denial or execution path. `apps/mcp_server/src/tools/coordinatorConversation.ts` changes only the status/start tool prose and `goalId` schema description to use the described canonical execution identifier. There is no alias execution, scope, signing, approval, route, or handler change.

The Coordinator prose is client-neutral: a direct MCP client can use its catalog's canonical tool identifier, while a deferred dispatcher client can use `executeName` when supplied. It does not require the `mcp_dispatch` wrapper for direct clients. After this wording adjustment, guarded MCP tools tests again reported **135 passed / 1 skipped** and MCP typecheck exited 0.

- Guarded fork real `SessionPrompt` scripted-provider Cases H/M/N/O/P plus new c2: **6 passed / 0 failed**. Covers denied server, alias denial, canonical one-effect execution, ambiguous name, and revocation before describe/execute and during the pre-execution hook.
- Guarded fork `mcp_deferred_tools.test.ts` + `lazy_loading_default.test.ts`: **33 passed / 0 failed**.
- Guarded MCP server `src/tools/__tests__`: **135 passed / 1 skipped**, 20 test files passed and one explicit live-only file skipped.
- Guarded MCP `npm run typecheck` and fork `bun run typecheck`: both exit 0. `git diff --check` exits 0.

These are focused source/engine-with-scripted-provider checks, not an API 4098/engine 4097/MCP sandbox run and not a paid native Coordinator rerun. The approved read-only baseline at `/private/tmp/rhythm-catalog-primary-fixture-20261020-a` has a small SQLite DB and a `rhythm` local-command MCP config; only its filenames, permissions and top-level config keys were inspected here. A separate derived approved fixture root outside the sandbox is required before `tools/dev/sandbox.sh up`: its DB/config must be read-only, sanitation rechecked, its MCP command must resolve to the rebuilt local MCP server, and a local scripted provider endpoint must be wired for deterministic tool calls without a key. The parent owns builds, sandbox launch, runtime checks and teardown. No sandbox, API, engine, native app or model was launched by this source-repair phase. Exact signed native C1 behavior remains pending a rebuilt bundle and fresh bounded loan.
