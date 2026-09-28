# First-Stage Evaluation — Opencode Engine

## What was evaluated
- TypeScript compilation: `npx tsc --noEmit` ✅ clean
- Unit tests: `npx vitest run src/services/opencode_client_service.test.ts` ✅ 8/8 pass
- Flutter analyze: `flutter analyze --no-fatal-infos` ✅ clean (info-level warnings only)
- Full test suite: ⚠️ blocked at the time — the then-current better-sqlite3
  release had a Node ABI mismatch on the dev machine

## Known issues
- Historical: the pre-13 `better-sqlite3` release prevented this evaluation from
  running the full suite locally. Version 13 uses N-API prebuilds instead.
- `pty_runner.ts` is dead code but still referenced by `ws_gateway.ts` — removal deferred to follow-up
- Flutter agent session controller tests mock ptyRunner — need updating for SDK-based flow

## Next steps
1. Re-run the full test suite with the current better-sqlite3 package
2. Manual smoke testing per `docs/ai/testing-guide.md`
3. Remove `pty_runner.ts` and `node-pty` dependency
4. Drop old `agent_sessions` / `agent_session_messages` SQLite tables from migrations
