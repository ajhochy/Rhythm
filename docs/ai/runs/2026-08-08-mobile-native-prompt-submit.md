---
date: 2026-08-08
repo: Rhythm
branch: ui/desktop-mobile-session-polish
pr: 1337
issues: [mobile-native-prompt-submit]
status: pass
tags: [run, mobile]
---

## Files

- `apps/mobile/tests/contract/mobile-native-prompt-submit.test.mjs`
- `apps/mobile/providers/opencode-provider.tsx`
- `docs/ai/contracts/mobile-native-prompt-submit.json`
- `docs/ai/runs/2026-08-08-mobile-native-prompt-submit.md`

## Checks

- FAIL (before implementation): `cd apps/mobile && node --test tests/contract/mobile-native-prompt-submit.test.mjs` — 0 pass, 3 fail. The request passed `agent`, `model`, and `system` directly as `executionPlan` fields, which are undefined for an unbound session.
- PASS: `cd apps/mobile && node --test tests/contract/mobile-native-prompt-submit.test.mjs` — 3 pass.
- PASS: `cd apps/mobile && npx jest --runInBand tests/prompt-execution-plan.test.ts` — 5 pass.
- PASS: `cd apps/mobile && npm run lint` — 0 errors; 3 pre-existing warnings in `.expo/types/router.d.ts`, `providers/services/agent-chat-service.ts`, and `tests/global-event-stream.test.ts`.
- PASS: `cd apps/mobile && npm run typecheck`.
- PASS: `cd apps/mobile && npm test -- --runInBand` — 15 suites, 53 tests pass.
- PASS: `RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-triage RHYTHM_SANDBOX_API_PORT=4198 RHYTHM_SANDBOX_ENGINE_PORT=4197 tools/dev/sandbox.sh status` — API :4198 and engine :4197 remain healthy.
- PASS live simulator smoke (AJ manual): AJ completed the iPhone 16 Pro interaction and reported the mobile prompt flow working correctly with no `Action failed` recurrence. After the smoke, the workflow manager queried `GET http://127.0.0.1:4396/__control/mobile`; the fake gateway recorded successful POSTs to `/mobile-gateway/opencode/session/session-2/prompt_async` and `/mobile-gateway/opencode/session/session-3/prompt_async`, each followed by GET message/todo/status/diff refresh traffic. This proves both submissions crossed the former client-side crash boundary and triggered observable response refresh.

## Notes

- Diagnosis: `sendPrompt` constructed the SDK body with explicitly present `agent`, `model`, and `system` keys. For an unbound execution plan all three values are `undefined`; generated SDK structured-body construction crashes in native Hermes before transport. Conditional spreads omit only absent overrides and preserve the exact bound values.
- Scope is limited to native mobile prompt request shaping. Do not restart or touch live desktop services on ports 4001/4096.
- The worktree was clean at session start. Before final diff review, unrelated concurrent modifications appeared in `apps/desktop_flutter/lib/app/core/layout/navigation_sidebar.dart`, `apps/desktop_flutter/test/app/core/layout/global_navigation_contract_test.dart`, and `docs/ai/contracts/ui-desktop-global-navigation.json`; they were not read or changed by this run.

## Final visual evidence

- [PR #1337 UI smoke evidence](../evidence/2026-08-08-pr-1337-ui-smoke.md) records AJ's successful mobile prompt smoke and the fake-gateway `prompt_async` evidence.
