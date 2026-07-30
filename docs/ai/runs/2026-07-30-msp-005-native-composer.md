---
date: 2026-07-30
repo: Rhythm
branch: codex/msp-005-native-composer
pr:
issues: [MSP-005]
status: pending-native-verification
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# MSP-005 native expanding composer

## Files changed

- `apps/mobile/components/chat/chat-composer.tsx` — keep iOS native scrolling
  active before the height cap and reset empty controlled drafts.
- `apps/mobile/tests/chat/chat-composer.test.tsx` — RNTL height
  growth/cap/shrink coverage through the real Paper input.
- `apps/mobile/jest.config.js`, `apps/mobile/jest.setup.js`,
  `apps/mobile/package.json`, `apps/mobile/package-lock.json` — focused Expo
  Jest/RNTL harness and dependencies.
- `apps/mobile/tests/contract/issue-1238-keyboard-safe-composer.test.mjs` —
  retain the prior source check as supplementary coverage.
- `docs/ai/contracts/msp-005-native-composer.json` — automated/manual
  acceptance mapping.
- `docs/testing/msp-005-native-composer-smoke.md` — source-level seam analysis,
  minimal native reproduction, and signed physical-iPhone checklist.

## Checks run

- Red contract:
  `cd apps/mobile && npm test -- --runInBand tests/chat/chat-composer.test.tsx`
  → 1 passed, 2 failed on pre-fix scroll-enable and empty-draft shrink
  assertions.
- Green contract:
  `cd apps/mobile && npm test -- --runInBand tests/chat/chat-composer.test.tsx`
  → 4 passed, 0 failed.
- `cd apps/mobile && node --test
  tests/contract/issue-1238-keyboard-safe-composer.test.mjs` → 3 passed.
- `cd apps/mobile && npx tsc --noEmit` → exit 0.
- `cd apps/mobile && npm run lint` → exit 0 after declaring the Jest setup
  environment.
- `EXPO_APP_VARIANT=development NODE_ENV=development npx expo export --clear
  --platform ios --output-dir /private/tmp/msp005-ios-export.kIw6ee/bundle`
  → iOS bundle exported successfully (1,632 modules).
- GitNexus impact: `ChatComposer` LOW risk, one direct caller, three upstream
  symbols total.
- GitNexus `detect_changes`: LOW risk, five indexed changed symbols, zero
  affected execution processes.
- `jq` contract/manual mapping validation and `git diff --check` → exit 0.

## Notes

- Failure triage: the first lint run failed only because the new
  `jest.setup.js` did not declare the Jest global; the focused correction and
  full rerun are green.
- Paper `TextInput` remains. Its flat wrapper forwards native content-size and
  scroll props and the component test proves the native event reaches composer
  state.
- No API server, engine, sandbox, simulator, app installation, or production
  system was started or touched.
- Signed physical-iPhone evidence is still required. This run cannot produce
  it and does not claim native verification.
