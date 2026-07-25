---
date: 2026-07-25
repo: Rhythm
branch: codex/mobile-1172-agents-activity
pr: 1165
issues: [1076, 1096, 1123, 1132, 1134, 1135, 1137, 1157, 1161, 1162, 1164, 1166, 1167, 1168, 1169, 1170, 1171, 1172, 1173, 1174, 1175]
status: pushed-draft
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Mobile PR recovery push

## Files changed

- Recovered and committed eight guarded API live-test updates that align the
  aggregate mobile gates with host-bound pairing and
  `X-Rhythm-Human-Approval`.
- Updated the MCP CI workflow and package runtime contract from the stale
  Node 18/20 declaration to Node 22.19.0+, matching direct dependency
  `undici@8.7.0`.
- Refreshed `docs/ai/project-state.md` and the existing draft PR description.

## Checks run

- Focused #1172/#1173/#1175 mobile tests: 9/9 passed.
- Eight guarded live-test files: compiled; 9 tests skipped normally with live
  flags unset.
- `npm test` in `apps/mcp_server`: 22/22 files and 99/99 tests passed.
- MCP `npm run typecheck` and `npm run build`: passed.
- `npx -y node@22.19.0 -e "require('./node_modules/undici')"`: passed.
- `ai-workflow checks --level issue`: passed.
- `ai-workflow checks --level pr`: passed, including Flutter tests, API tests
  and build, MCP tests and build, full fork session tests, and mobile web E2E.
- Rebuilt-fork sandbox on dedicated loopback ports: `/health`,
  `/opencode/health`, `/agents/capabilities`, and `/opencode/auth/` responded;
  sandbox teardown left both ports free.
- GitHub Mobile CI run `30171896297`: passed at `39f18a22a`.
- GitHub MCP Server CI run `30172152653`: passed at `6aee45226`.
- GitNexus staged/unstaged checks reported no indexed symbol changes for the
  test and metadata-only recovery commits. Compare-to-main remains
  HIGH/CRITICAL as expected for this cumulative branch.

## Notes

- Failure triage: the first MCP CI run failed all Undici-loading suites under
  Node 20 with `webidl.util.markAsUncloneable is not a function`.
  `undici@8.7.0` requires Node 22.19.0+, while the workflow used Node 20 and the
  package advertised Node 18+. Aligning both declarations resolved the failure;
  no follow-up issue was filed.
- The first isolated smoke launcher was allowed to exit its command-owning
  shell and its background process was reaped. Re-running the same supported
  sandbox launcher from a persistent shell produced healthy API and engine
  listeners; no product change was needed.
- Recovered work and the CI repair were fast-forward pushed to
  `feat/rhythm-agent-ios-roadmap`. PR #1165 remains draft and must not be merged
  before the Task 18 signed-device, distribution, and human review gates.
