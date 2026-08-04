---
date: 2026-08-03
repo: Rhythm
branch: workflow/run-2026-08-03-config-doctor
pr: 1303
issues: [1302]
status: ci-green-awaiting-live-smoke
tags: [run, rhythm]
---

## Files

- `apps/api_server/src/services/opencode_client_service.ts` — `ensureCuratedMcps`
  merges existing `environment` instead of replacing it wholesale.
- `apps/api_server/src/__tests__/opc_curated_mcp_ensure.test.ts` — new c6
  regression test (env survives re-ensure), scoped via `opts.servers` to
  avoid the machine-local `curated_mcp_servers.local.json` sidecar noise.
- `apps/api_server/src/__tests__/issue_723_mcp_remove_reconcile.test.ts` —
  sandboxes `HOME` via `vi.stubEnv` so the suite can never again write to
  the developer's real `~/.config/opencode/opencode.json` /
  `~/.config/rhythm/mcp-deletions.json`.
- `apps/mcp_server/src/security/external_content_boundary.ts` — added
  `SOURCES_EXEMPT_FROM_APPROVAL_GATE` (`agent-session.list` only); skips
  `recordExternalContentTaint` for exempt sources, keeps the scan + fence.
- `apps/mcp_server/src/__tests__/agentSessions_tool.test.ts` — new #1302
  regression test asserting the result is still fenced but no taint call
  fires for `rhythm_list_sessions`.
- `docs/ai/project-state.md`, `docs/ai/decisions/2026-08-03-session-transcript-trust-classification.md`.

## Checks

- `apps/mcp_server`: `npx vitest run` → 110 passed, 2 skipped. `tsc --noEmit` clean.
- `apps/api_server`: targeted files (`opc_curated_mcp_ensure`,
  `issue_723_mcp_remove_reconcile`, `opc_m4_3_mcp_routes`) → same 3
  pre-existing failures on unmodified HEAD as with my changes applied
  (confirmed by stashing my edits and re-running) — a machine-local MCP
  sidecar file causes idempotency-check flakiness unrelated to this work.
- `ai-workflow checks --level pr` (full monorepo): flutter analyze/format/test
  green, api_server tsc/lint/build green, mcp_server tsc/vitest/build green.
  Full `npm test` in api_server: 4 failed test files / 6 failed tests,
  confirmed identical on unmodified baseline (sidecar flakiness +
  `tasks_permissions.test.ts` socket-timing flake) — pre-existing, not
  introduced by this run. `opencode fork typecheck`, `mobile static suite`,
  `mobile web e2e` failures are pre-existing environment/toolchain gaps
  unrelated to any file touched here (opencode_fork missing deps, no local
  `eslint`/`test` binaries for mobile).

## Notes

Live-reproduced the Bug 2 leak before fixing it: running
`issue_723_mcp_remove_reconcile.test.ts` alone added a real `foo` MCP entry
to `~/.config/opencode/opencode.json` (backed up the file first, restored
after). Root cause was not the ".tmp+rename" theory in the original
Config Doctor report — `OpencodeClientService` uses plain `writeFileSync`,
no atomic rename anywhere in this path — it was that the test's
`vi.mock('fs', ...)` only patches the static `import` graph, and the
service resolves its config paths via a runtime `require('fs')` +
`os.homedir()` call inside each method, which escapes the mock entirely.

Investigated Bug 3 (scheduled-run hang) via a forked sub-agent before
touching code: confirmed the gap described in the original report (stuck
`running` for 2.5+ hours, no error) does not exist in current code — a hard
~1hr ceiling independent of the inactivity timer already forces a
persisted `error` status. No fix needed; documented why in project-state.md
rather than writing speculative code.

Found the actual #1302 fix site only after discovering the installed
`@ajhochy/rhythm-mcp-server` npm package (referenced by the Config Doctor
report) is root-owned, dist-only, published, with no `repository` field —
initially assumed out-of-repo. AJ confirmed the source is `apps/mcp_server`
in this same monorepo (the installed global copy is just stale at 0.6.1 vs
this repo's 0.6.2).

Considered and rejected a full "transitive taint" design for #1302 (see the
decision doc) after AJ pushed back that it looked like overkill — correctly,
since the content scanner already runs and fences content at first
ingestion, so a second read via `rhythm_list_sessions` doesn't expose
anything new.

Accidental `git stash pop` mid-session popped an unrelated old stash
(`pexels-openmontage WIP`) due to a broken `cd` chain in a compound bash
command; recovered cleanly (`git checkout HEAD --` on the 3 affected files)
without touching or losing the stash entry (`git stash list` still shows it
present) or any of the actual work-in-progress edits.

## Next step

Same as `docs/ai/project-state.md`: full Rhythm quit + reopen, then live
verify (1) an Obsidian/Stripe/Mailchimp key survives a relaunch, (2) Memory
Consolidation captures > 0 unattended. Push this branch, confirm CI, leave
PR #1303 open for manual review/merge — do not merge.
