# Rhythm — Project State

## Current focus

Open-issue swarm resume on the mega branch: every preserved candidate worktree was
re-inspected by an independent Codex ledger, each diff was reviewed by the orchestrator, and
only slices that passed their contract plus fresh verification were integrated, one squashed
commit per slice. Flutter remains the shipping client; nothing here changes the Electron
replacement, signed-package, or release gates.

## Active branch / PR

- `mega/2026-09-18-mobile-electron-hermes` in `.mega-wt/integration`, draft
  [PR #1544](https://github.com/ajhochy/Rhythm/pull/1544); no merge authorized.
- Integrated this run (after `e93eac6e` #1547): `9d225f41` #1568 OpenAI usage,
  `d1662eee` #1552 child-chip CSS, `bcf29c84` #1576 B1 provenance ledger, `ac3faa39` #1581
  More menu, `810e0b91` #1559 Agent Settings isolation, `0ce3db89` #1575 isolated delegation
  worktrees, `adfd5c41` 1581 evidence-capture gate. None closes its issue outright.
- Ledger, evidence and every deferral reason:
  [run record](runs/2026-09-24-open-issue-swarm-resume.md).

## In progress

- Deferred candidates are preserved as WIP commits on their own branches (not integrated):
  #1558 (`37d1bef8`), #1577/PR #1578 (`5e0e93ae`, profile-scope bypass in `prompt()`),
  #1574/#1573 (`61718027`), #1565 (`18f39c11`), #1491 (`957c73c7`), #1579 (`61d4c171`),
  #1582 (`f28f2f1b`/`bbf5c65e`), #1572 (`858f7fc2`), #1468 (`932f87cc`), #1569 S0
  (`08bd238f`, Astra re-review FAIL on five coverage items). Each has its repair cap reached;
  AJ must revalidate product intent before another repair.
- #1569 S1/S3/S5 were not branched because S0 is not frozen.
- Bot Crossing auto-archive candidate untouched (`/private/tmp/bot-crossing-auto-archive`).

## Risks / known issues

- Manual gates remain for every integrated slice: #1568 G1/G2, #1552 c6 and #1581 c7
  (packaged Electron renderer), #1575 c4 (child-reported cwd needs a provider credential),
  #1547 real Google consent + exact PostgreSQL 16.
- `agent_sessions.upsertResolvedChildSession` now COALESCEs worktree metadata; GitNexus rates
  the method HIGH impact (resume/fork/create). Repository suite is green; watch child-session
  resume/fork behaviour in manual smoke.
- `agent_turn_dispatches` (#1576) is SQLite-only with an FK cascade; no Postgres DDL.
- Pre-existing failures unrelated to this run: web `splitter.spec.ts:71` (Hermes separator
  persistence) and four bucket-a rendered cases fail on base too.
- Environment: never run `npm ci`/`npm install` inside a Rhythm worktree whose `node_modules`
  are symlinks into the main checkout — it empties the main checkout's tree. Mega now owns a
  real install; other app dirs in mega still symlink to main.

## Test status

- Integrated gate on mega `adfd5c41` (`ai-workflow checks --level pr`, 16 stages): 15 ✓ —
  flutter analyze, dart format, api/mcp tsc, flutter test, api lint, api build, mcp vitest, mcp
  build, fork typecheck, fork session tests, mobile static/contract/fake-server/web e2e. 1 ✗:
  api_server serial vitest (6267 passed / 1 failed / 258 skipped) fails only `context_scanner.test.ts › repo self-check` on the untracked,
  preserved `docs/ai/current-plan-1569.md` (19/19 without it; local-only, CI unaffected) — triaged
  OUT OF SCOPE, [issue](issues/2026-09-24-context-scanner-self-check-untracked-plan.md).
- Web on mega: build ✓; default Playwright 486 passed / 1 failed (pre-existing
  `splitter.spec.ts:71`, fails on base too) / 86 skipped; bucket-a 11/15 (same 4 fail on base);
  Electron renderer slices 25 passed / 1 skipped; 1581 contract 15/15; 1559 contract 37/37.
- Live (sandbox from mega, synthetic fixture): #1568 credential-envelope test ✓ on a dedicated
  :6098 sandbox; #1575 non-git rejection ✓, child-reports-cwd timed out (no provider credential),
  server-side worktree creation visible in the sandbox log. `/health` ok, `/opencode/health`
  ready + bridgeLive.
- Focused suites: 1568 32/32, 1576 13/13, 1575 7/7 + repository 28/28, mcp 1/1, 1582 reducer 33/33
  and 1565 10/10 (both deferred anyway).

## Next step

Manual smoke of the draft PR candidate (checklist in the PR body and
`docs/testing/manual-smoke.md`), then AJ decides which deferred candidates get a revalidated
repair. Merge is manual only.
