# Rhythm — Project State

## Current focus

Scheduled agent runs. Eight enabled schedules were failing in three classes
(dead `pco-services` MCP, an expired Anthropic account, and inactivity
timeouts). All three had different root causes but one shared defect: the
failure was recorded in a run-history row and a log line, and surfaced to
nobody. Draft [PR #1548](https://github.com/ajhochy/Rhythm/pull/1548) makes
each failure legible and notifies on the actionable ones.

Exact-session external opening in the source Electron client remains open in
parallel as draft [PR #1538](https://github.com/ajhochy/Rhythm/pull/1538);
Flutter remains the shipping client.

## Active branch / PR

- `fix/agent-schedule-infra-preflight` off `origin/main` (`648f8d58`).
  Draft [PR #1548](https://github.com/ajhochy/Rhythm/pull/1548), commit
  `dfcf32bc`. CI running at time of writing; no merge authorized.
  Evidence: [run record](runs/2026-09-21-scheduled-agent-task-failures.md),
  [decision](decisions/2026-09-21-inactivity-window-must-exceed-tool-timeout.md).
- `codex/electron-session-opening` — draft
  [PR #1538](https://github.com/ajhochy/Rhythm/pull/1538), commit `3f08c4d9`,
  awaiting review. Scoped to the opening change only; broad-gate failures
  unresolved. [run record](runs/2026-09-18-electron-session-opening.md).
- `fix/agent-server-health-flap` — [PR #1508](https://github.com/ajhochy/Rhythm/pull/1508),
  the ca373540 idle skill-usage scan fix. **Not on `main` and not in the
  running desktop bundle** (the live `dist` still has a synchronous
  `countSkillToolUses`).

## In progress

- **Blocked on a human OAuth flow:** the default Anthropic account `personal`
  expired 2026-09-18T11:11:54Z and is `needs_relogin`. Until it is
  re-authenticated, `ai-trend-research-daily` cannot run and
  `GET /agents/models` returns `[]` (`server.ts:764` pushes credentials into
  the engine only when `status === 'ok'`). PR #1548 makes the cause legible;
  it does not restore the credential.
- `agent-reach doctor --json` hangs with no timeout and stalled
  `theological-research-daily`. PR #1548 makes that bounded and diagnosable;
  the timeout itself belongs in the skill.
- Electron: broad `ai-workflow checks --level pr` exited 1 in three unchanged
  packages; #1538 is qualified only for its scoped opening change.

## Risks / known issues

- MCP servers spawned from paths outside the repo (`~/pco-mcp` → a symlink into
  `Documents/Claude Cowork/`) can die from edits made entirely outside Rhythm.
  A deleted `.venv` took five schedules down for three days. Rebuild needs
  python3.12+ — system python3.9 is too old for fastmcp.
- Nothing rebuilds the desktop bundle automatically: none of #1508, #1538 or
  #1548 reaches the running app until a release build. The live bundle is
  from Sep 19.
- Electron: replacing generated assets under a running shell needs one renderer
  Reload, which clears authentication; one Google sign-in is then required.
- Electron native sandbox uses a synthetic identity and mock Keychain — it does
  not qualify signed packaging, real Keychain, production OAuth, or Flutter.

## Test status

- api_server full `vitest run` on #1548: **6175 passed**, 250 skipped, 1 failed
  (`pty_proxy.test.ts`, WebSocket 404 during full-suite teardown — passes in
  isolation, unrelated area). `tsc --noEmit` clean.
- #1548 contract tests: 9/9 pass; 3 of 4 runner contracts fail against
  unmodified `main` (the fourth is a fail-open guard, correctly green on both).
- Live: `pco-song-usage-sync` `trigger-now` → `completed_no_op` in 339s,
  matching its healthy history; its prior run failed in 22ms.
- Electron #1538: issue static gate 4 checks exit 0; Electron unit suite 73
  tests exit 0; exact-session suite 13 tests exit 0. Full PR gate: 13 stages
  passed, 3 unrelated failures still uninvestigated.
  [Follow-up](issues/2026-09-18-unrelated-pr-gate-failures.md).

## Next step

Re-login the `personal` Anthropic account — it unblocks a schedule and the
model catalog, and no agent can do it. Then review draft #1548 and run manual
smoke. #1538 and #1508 remain separately open; #1508 in particular is still
unshipped despite the desktop disconnect symptom it fixes.
