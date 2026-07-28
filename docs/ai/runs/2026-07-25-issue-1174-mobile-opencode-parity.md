---
date: 2026-07-25
repo: Rhythm
branch: codex/mobile-1174-parity
pr: null
issues: [1174]
status: complete
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #1174 — mobile OpenCode API parity

## Files changed

- Added a complete 133-operation OpenCode 1.14.49 classification and generated
  mobile gateway allowlist, with contract drift checks.
- Added mobile workspace, session-maintenance, PTY, runtime-inspection, and MCP
  authorization-removal surfaces plus fake-engine and Playwright coverage.
- Added bounded/redacted custom-route errors and adversarial config redaction.
- Restricted message and part mutation to genuine non-synthetic user text at
  both the chat selector and provider boundary.
- Added OpenCode-format ascending message IDs for session initialization.
- Expanded
  `apps/api_server/src/__tests__/issue_1174_mobile_opencode_parity_live.test.ts`
  into the final real API/engine behavioral gate.

## Checks run

- `npm run test:ci:static` — PASS, including #1174 security 5/5.
- `npm run test:fake-server:self` — PASS.
- `npm run contract:check` — PASS.
- `npm run test:contract` — PASS.
- `node ./tests/issue-1174-opencode-parity-contract.test.mjs` — PASS, 3/3.
- `npm run build` in `apps/api_server` — PASS.
- `npx vitest run src/__tests__/issue_1169_mobile_opencode_proxy.test.ts` —
  PASS, 9/9.
- `RHYTHM_MOBILE_E2E_WEB_PORT=19174
  RHYTHM_MOBILE_E2E_FAKE_PORT=44174 RHYTHM_CAPTURE_SCREENSHOTS=1
  npx playwright test` — PASS, 28/28.
- `npx expo export --platform ios --output-dir dist-ios-1174 --clear` — PASS;
  iOS Hermes bundle produced.
- `cd apps/opencode_fork/packages/opencode && bun run build --single` — PASS;
  final binary version
  `0.0.0-codex/mobile-1174-parity-202607251220`.
- Final live command:
  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1
  RHYTHM_LIVE_URL=http://127.0.0.1:54174
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:55174
  RHYTHM_SANDBOX_DIR=<throwaway>
  DB_PATH=<throwaway>/rhythm.db
  RHYTHM_LIVE_DB_PATH=<throwaway>/rhythm.db
  npx vitest run
  src/__tests__/issue_1174_mobile_opencode_parity_live.test.ts` — PASS, 1/1
  in 5.58s.
- API `/health` and engine `/global/health` — PASS before the final live run.
- Post-run listeners on `54174`, `55174`, and `56174` — none; sandbox deleted.
- `ai-workflow checks --level issue` — PASS.
- `ai-workflow checks --level pr` — all #1174-relevant gates PASS; the serial
  API suite reproduced only unrelated base issue #723's missing Vitest dynamic
  import callback. The coordinator already includes its intended test seam.
- `npx gitnexus detect_changes --scope all --repo Rhythm-1174` — LOW, 8 files,
  12 symbols, no affected processes.
- Independent security re-review through `5e848c7ea` — PASS, no actionable
  findings.

## Notes

- Exact contract split: 75 surfaced, 10 internal, 7 alternate, 41 omitted;
  gateway 83 allowed and 50 denied. Newly denied alternate-only operations are
  `config.providers`, `mcp.auth.authenticate`, `permission.respond`,
  `session.get`, `session.message`, and `session.prompt`.
- Six screenshots were captured and visually inspected: workspace, chat
  maintenance, terminal, skills, models/config, and MCP authorization removal.
- The live gate uses a local Anthropic-compatible fixture, not production
  provider credentials. It proves two model calls: a genuine `prompt_async`
  turn and a fresh-ID `session.init` turn.
- Recovery summary: the strengthened browser test exposed its old dependence on
  synthetic shell fallback; the live test corrected non-Git project and macOS
  canonical-path assumptions; and the fixture exposed the real stale init-ID
  defect. No follow-up issue was required.
- Commits before this log: `6c0fe99ac` (contract), `991cd4eb6`
  (implementation), `e1469ddbd` (security/live hardening), and `5e848c7ea`
  (synthetic boundary + genuine live coverage + init ID fix).
