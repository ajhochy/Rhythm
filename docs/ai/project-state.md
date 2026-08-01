# Project State

## Current focus

Issue #1285's projectless desktop-chat opener reached `ready` on a physical
iPhone, then fell back to `Opening chat` because an older provider bootstrap
restored a remembered project-scoped session. The corrective delta now keeps the
explicit owner-opened session authoritative across scoped refreshes and rejects a
stale bootstrap commit after another session becomes current.

## Active branch / PR

- Branch: `codex/mobile-fixes-rollup`
- Base: `origin/codex/fix-session-isolation-runtime-performance`
- PR: [#1284](https://github.com/ajhochy/Rhythm/pull/1284) (draft)
- Current pushed commit before this corrective delta: `bbff0c97061c0fb024878d9929bd7c87fcf79d72`.
- Merge remains a manual human action after review and physical-device smoke.

## In progress

- Commit and push the c15 provider-selection correction.
- Wait for GitHub Actions before the next device handoff.
- Reload only `Rhythm Agents Dev`, then re-smoke the same desktop/projectless chat
  for stable transcript display and message input.

## Risks / known issues

- The complete local PR matrix is nondeterministic in untouched suites: two runs
  produced different API shared-state failures, and the second also hit one
  OpenCode cancellation timeout. Each failed test passed alone.
- GitNexus rates the c15 corrective delta LOW (5 tracked files, 16 indexed
  symbols, zero affected processes). The full rollup comparison to `main` remains
  CRITICAL because it intentionally contains the broader #1284 integration stack.
- Issue #1280 still needs its physical-iPhone multiline composer smoke.
- User-owned `.proof/` image modifications remain excluded from commits.

## Test status

- c15 contract: RED for each missing guard, then PASS.
- Focused mobile Jest: PASS, 2 suites / 3 tests.
- Mobile TypeScript typecheck: PASS.
- Physical iPhone + real projectless desktop deep link: PASS for a 30-second
  background-refresh observation after the fix; no remembered-session displacement.
- `ai-workflow checks --level issue`: PASS.
- `ai-workflow checks --level pr`: all Flutter, mobile, MCP, build, typecheck,
  fake-server, and web-E2E stages pass; full gate remains red on unrelated flaky
  API/engine tests. All three reported failures pass in isolation.
- Live API, engine, capabilities, and mobile-gateway health probes: PASS.
- GitNexus working change detection: LOW, zero affected processes.

## Next step

Push the corrective commit, wait for GitHub Actions, reload only the Dev mobile
bundle, and have the user verify that the same desktop chat remains open and can
accept a new mobile message.
