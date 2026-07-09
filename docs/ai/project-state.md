# Project State

## Current focus

Recovered a mislabeled git stash (`wip-929-inflight-stashed-for-949`) that
actually held the 2026-07-07 agent-profile **core-permissions** fix, not #929
work. Landed it on `fix/agent-profile-core-permissions` (verified, pushed);
stash preserved until merge. See
`docs/ai/runs/2026-07-09-stash-triage-agent-profile-core-permissions.md`.

Prior context still current: #912/#913 opencode continuity and the July-4 batch
(#894–#911) are on `main`; agent-system audit issues #914–#923 filed, HIGH ones
partially addressed (#914–#921 landed via PR #926).

## Active branch / PR

- `fix/agent-profile-core-permissions` (commit 27c2f54ab) — pushed, **no PR
  yet**. Adds per-profile `core_permissions_json` + `rhythm_*_agent_profile_
  permissions` MCP tools. Awaiting user confirmation the work is still wanted,
  then manual smoke before PR.
- PR #926 (`issue-batch-914-923`) — MERGED to `main`.
- PR #924 / #925 — MERGED to `main` (prior session).

## In progress

- `fix/agent-profile-core-permissions` open locally, pushed, unmerged. Needs
  manual smoke (Config Doctor permission-repair flow; Theological-Researcher
  gaining `defuddle` shell/read access) + user sign-off before PR.
- Stash `wip-929-inflight-stashed-for-949` still in `git stash list` — keep
  until the branch merges, then drop.

## Risks / known issues

- Both #912/#913 fixes live in the vendored `apps/opencode_fork` — keep diffs
  minimal/tagged so they survive upstream merges. Test against the BUILT fork
  binary (set `RHYTHM_OPENCODE_BIN`), never the stock PATH binary.
- `#913 repairToolPairing` is a defensive repair at the request chokepoint —
  the true producer of the dangling `tool_use` was never located.
- `#913 autoContinueExhausted` resets on any completed tool call (coarse by
  design) — the cap is a backstop, not a guarantee.
- Audit HIGH findings still open: delegation caller-identity spoofing (#914),
  60s delegation timeout causing duplicate runs (#915), scope fail-open /
  config-doctor full surface (#916), nonexistent tool/server names in
  allowlists (#917). Medium/low: #918–#923.

## Test status

- `fix/agent-profile-core-permissions` (27c2f54ab): api_server `tsc` clean +
  `vitest` 2458 passed / 1 skipped; api_server build OK; mcp_server `tsc` +
  `vitest` 82/82; mcp_server build OK. CI (MCP Server CI 28994722949) green.

## Next step

- Confirm the core-permissions work is still wanted; if so, manual smoke
  (Config Doctor repairing a profile's scope via REST PATCH+resync;
  Theological-Researcher using the `defuddle` skill's shell/read), then open a
  PR. After merge, drop stash `wip-929-inflight-stashed-for-949`.
- When ready, tackle remaining agent-system audit items on a dedicated branch.

## Recent coding-agent runs

### 2026-07-06 — issue-batch-917-918-919-921
- Files modified: `apps/api_server/src/database/migrations.ts` (profile data repair), `apps/api_server/src/services/agent_runner.ts` (fallback model), `apps/api_server/src/services/opencode_agent_writer.ts` (disabled projection gate), focused API tests, `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (trigger profile routing), docs run log.
- Checks run: `npx tsc --noEmit` pass; targeted Vitest pass (`6 files, 50 tests`); full `npm test` failed under sandbox bind restrictions (`listen EPERM`, `1971 passed / 423 failed / 58 skipped`); Flutter `dart format .` and `flutter analyze --no-fatal-infos` blocked by SDK cache write permission.
- Decisions made: #921 uses trigger-only routing to `secretary` instead of globally scoping `claude-code`/`codex`, preserving manual escape-hatch behavior.
- Deviations from spec: full Vitest and Flutter checks could not complete cleanly in this sandbox; local stale opencode agent files could not be removed from `~/.config`.
- Concerns: orchestrator should rerun full API/Flutter checks in an environment allowed to bind ports and write the Flutter SDK cache.
