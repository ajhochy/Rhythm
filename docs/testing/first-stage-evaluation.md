# First-Stage Evaluation — Opencode Engine

## What was evaluated
- TypeScript compilation: `npx tsc --noEmit` ✅ clean
- Unit tests: `npx vitest run src/services/opencode_client_service.test.ts` ✅ 8/8 pass
- Flutter analyze: `flutter analyze --no-fatal-infos` ✅ clean (info-level warnings only)
- Full test suite: ⚠️ blocked — better-sqlite3 ABI mismatch on dev machine

## Known issues
- `better-sqlite3` ABI mismatch prevents running full test suite locally (pre-existing issue, affects CI too if Node version mismatches)
- `pty_runner.ts` is dead code but still referenced by `ws_gateway.ts` — removal deferred to follow-up
- Flutter agent session controller tests mock ptyRunner — need updating for SDK-based flow

## Next steps
1. Run full test suite on a machine with matching better-sqlite3 binary
2. Manual smoke testing per `docs/ai/testing-guide.md`
3. Remove `pty_runner.ts` and `node-pty` dependency
4. Drop old `agent_sessions` / `agent_session_messages` SQLite tables from migrations
