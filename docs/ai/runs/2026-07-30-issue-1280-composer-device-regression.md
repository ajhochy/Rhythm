---
date: 2026-07-30
repo: Rhythm
branch: codex/fix-composer-device-regression
pr: null
issues: [1280]
status: automated-pass-manual-pending
tags: [run, Rhythm]
---

# Issue #1280 — physical-device composer height regression

## Root cause

The production development app enables React Native New Architecture in
`apps/mobile/app.config.ts`. In React Native 0.81.5, iOS Fabric checks and emits
`onContentSizeChange` from `RCTTextInputComponentView.updateLayoutMetrics`.
The prior composer set an explicit `height: 24` and waited for that event to
change the height. On physical iOS, typing changed UIKit's content size without
changing Fabric's fixed layout metrics, so the event/resize path deadlocked.
React Native Testing Library's synthetic `contentSizeChange` bypassed that
native timing and produced a false green.

## Files

- `apps/mobile/components/chat/chat-composer.tsx` — use the core native
  multiline input with intrinsic 24–132pt layout bounds and scrolling enabled.
- `apps/mobile/tests/chat/chat-composer.test.tsx` — preserve the existing
  growth/cap/shrink coverage while removing the synthetic-event assumption.
- `apps/mobile/tests/contract/issue-1280-composer-device-regression.test.tsx` —
  red-first regression contract that types multiline drafts without firing a
  content-size event.
- `docs/ai/contracts/issue-1280.json` — two automated criteria and one
  physical-device criterion.

## Checks

- `npx jest --runInBand tests/contract/issue-1280-composer-device-regression.test.tsx`
  - before implementation: 0 passed / 2 failed; both received fixed
    `height: 24`.
  - after implementation: 2 passed / 0 failed.
- `npm run test:composer -- --runInBand` — 4 passed / 0 failed.
- `npm test -- --runInBand` — 6 passed / 0 failed across 2 suites.
- `npm run typecheck` — pass.
- `npm run lint` — pass.
- `npm run test:ci:static` — all 19 chained static/test commands passed;
  85 explicitly enumerated assertions/scenarios passed plus the utility suites.
- `EXPO_APP_VARIANT=development NODE_ENV=development npx expo export --clear --platform ios --output-dir /private/tmp/rhythm-issue-1280-ios-export`
  — pass; 1,634 modules bundled.

## Notes

- No API/backend surface changed; a backend live test is not applicable.
- `apps/api_server/src/services/mobile_opencode_security.ts` and
  `apps/api_server/src/repositories/mobile_opencode_ownership_repository.ts`
  were not modified.
- Automated evidence proves the fixed-height/event feedback loop is absent,
  but it cannot prove UIKit behavior on real hardware.
- **Required manual gate:** a human must install the signed development build
  on a physical iPhone and repeat the multiline typing/paste, deletion, and
  over-132pt internal-scroll checks in
  `docs/testing/msp-005-native-composer-smoke.md` before calling #1280 done.
