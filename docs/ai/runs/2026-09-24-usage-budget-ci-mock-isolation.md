---
date: 2026-09-24
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [907, 1568]
status: partial
tags: [run, rhythm]
---

# Usage-budget CI diagnosis and test-only repair

## Root cause and evidence

CI run 36068495046 at 60c30bf9 fails only usage_budget_service.test.ts #907 at line393: expected two Anthropic entries, received one. This is not the later local broad startup/hook-timeout reproduction.

The preceding Codex describe.afterEach queues vi.doUnmock('./anthropic_accounts_service') and resets module cache. #907 immediately queues vi.doMock for that same ID then imports usage_budget_service. Vitest4.1.1 resolves pending mocks with Promise.all (installed startVitestModuleRunner.C3FXk5Gv.js lines103–110); unmockPath deletes the registry entry (144–147). Completion order, not registration order, decides the final registry when those resolves race. If unmock resolves after mock, the two-account fixture disappears. Production fetchAnthropic then sees the fallback empty account store and emits one Anthropic entry (usage_budget_service.ts238–272).

Actual installed BareModuleMocker probe `/private/tmp/rhythm-repair4/usage-mock-queue-race.mjs` proves normal order retains replacement and delayed first unmock removes it. Log usage-mock-queue-race.log.

Stronger exact reproduction: external diagnostic setup `/private/tmp/rhythm-repair4/usage-scheduler-setup.mjs` delays only the preceding unmock in the #907 test by30ms; original test/product files untouched. Command from integration/apps/api_server: `node node_modules/vitest/vitest.mjs run --config /private/tmp/rhythm-repair4/usage-scheduler.config.mjs`. Result21pass/1fail, same line393 expected2 got1. Log usage-targeted-forced-red.log. Diagnostic config reuses the normal isolated setup and blocks ambient fetch.

A guarded ordinary targeted replay also logged UNEXPECTED_AMBIENT_FETCH_BLOCKED: the Codex tests leave fs mocks containing valid synthetic OpenAI auth, while nested afterEach unstubs fetch. #907 inherits that auth and can otherwise reach real fetch. No actual credential values were read; the diagnostic guard prevents outgoing requests. First preload-only scheduling attempt did not affect the actual runner mocker; it is not claimed as the exact failure reproduction.

Both CI saved log and local installed package report Vitest4.1.1. CI workflow config pins Node22.19.0/ubuntu-latest and uses npm install --workspaces=false; local Node is22.23.0/macOS. Saved test-step log does not establish exact CI npm version. These version differences are unnecessary to explain the reproduced ordering race. Test additions that introduced adjacent mock churn came from9d225f41 (#1568), before original #907 block from0bf38c21.

## Minimal authorized repair

Fresh worktree `/private/tmp/rhythm-usage-budget-mock-isolation`, branch codex/usage-budget-mock-isolation, basea4e7b506. Only `apps/api_server/src/services/usage_budget_service.test.ts` changed:

- One vi.hoisted service mock for the entire file, mutable per-test list/getAccount functions; remove queued doMock/doUnmock swaps.
- Global beforeEach resets account data, fs existence/read mocks and installs a rejecting default fetch guard.
- Global afterEach asserts that guard was never used and always restores timers/spies/globals/module cache in finally.
- Preserve all original22 tests, two-account IDs/labels/re-login assertions, and Codex behavior assertions. No product edits.

## Verification

- Stable file normal:22/22 pass, usage-stable-focused.log.
- Same scheduling-instrumented config on repaired file:22/22 pass, no ambient-fetch guard hit, usage-stable-scheduled.log.
- Final bounded command: `node node_modules/vitest/vitest.mjs run src/services/usage_budget_service.test.ts src/__tests__/issue_844_contract.test.ts --maxWorkers=1`:32/32 pass, usage-final-focused.log.
- `node node_modules/typescript/bin/tsc --noEmit`:exit0, usage-typecheck.log. Initial missing workspace-root dependency symlink caused resolution failures; linked cached integration root+API node_modules, then reran successfully.
- GitNexus precise snapshot helper lookup UNKNOWN (index205commits behind); detect-changes sees1file/1symbol,0processes,LOW. Stale indexed symbol attribution says readClaudeCreds, while actual diff is only fixture/mock lifecycle. usage-detect-changes.log.
- git diff --check clean. No full suite, servers, commits or pushes. Frozen UI candidate untouched.

## Parent receipt

Parent reviewed the one test-only diff; all original22 assertions/tests retained. Integrated focused file22/22pass. No product source changed; live backend gate is inapplicable to fixture-only repair. Remote CI on new head remains the aggregate gate.
