---
date: 2026-10-01
repo: Rhythm
branch: codex/opencode-memory-recovery
pr: 1598
issues: [M1-bug2, M1-bug4, A1]
status: sandbox-browser-pass-native-unverified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# M1 paired mobile UI against the real sandbox

Index: [[Rhythm]]

## Files

- `apps/mobile/tests/e2e/m1-live-sandbox.spec.mjs` is an explicit-opt-in browser gate. It verifies the exact owned sandbox processes, uses an existing synthetic Device fixture, creates a unique disposable project/session/provider, and asserts real engine output through the paired Device relay, authoritative message GET, and visible mobile transcript. The prompt does not contain the expected reply marker.
- `apps/mobile/playwright.m1-live.config.mjs` builds a separate E2E web bundle with the sandbox-only bridge. `apps/mobile/lib/runtime/mobile-runtime.e2e.ts` accepts the injected Device fixture only with `EXPO_PUBLIC_E2E_LIVE_M1=1` and exact loopback gateway `127.0.0.1:4099`; ordinary E2E and production runtime paths remain unchanged.

## Checks

From `apps/mobile`, the passing command was:

```bash
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_M1_LIVE_BROWSER=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
RHYTHM_LIVE_GATEWAY_URL=http://127.0.0.1:4099 \
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-delivery-recovery-sandbox-20261001 \
RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-delivery-recovery-sandbox-20261001/rhythm.db \
RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-c1-gap-fixtures-recovery-20261001 \
HOME=/private/tmp/rhythm-m1-integration-home-20261001 \
PLAYWRIGHT_BROWSERS_PATH=/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/delivery-mobile-m1-continued-20261001/apps/mobile/.m1-test-home/Library/Caches/ms-playwright \
NODE_OPTIONS=--max-old-space-size=4096 \
npx playwright test --config playwright.m1-live.config.mjs
```

Result: **1 passed**. One synthetic provider request produced a completed assistant message. The session-scoped relay emitted `message.part.delta` and `session.idle`; the paired mobile browser made a terminal assistant GET and showed the unique reply exactly once after that GET. The authoritative Device GET contained the completed assistant metadata and text part.

The final run's synthetic timestamps were: prompt submitted `1790887775791`, provider request `1790887775864`, relay idle `1790887775882`, browser terminal GET `1790887775898`, first visible reply `1790887775950`, and post-GET visible assertion `1790887775966` (milliseconds since epoch). The interval records a successful terminal GET followed by a visible UI assertion; the cache commit itself is not independently instrumented, and an SSE update may publish it earlier; the engine's `time.created` is **not** treated as a storage-commit timestamp.

Cleanup was checked: session DELETE `200` then engine GET `404`; project DELETE `204` then API GET `404`. The sandbox global config file matched its exact original bytes, and `/config/reload` removed the unique synthetic provider from runtime readback. No API or engine process was restarted.

The default `playwright.config.mjs` run of only this spec exited 0 with **1 skipped** without live flags. Final mobile `npm run typecheck`, targeted ESLint, and `git diff --check` exited 0. The private final log is `rhythm-orchestration-evidence/2026-10-01-memory-recovery/mobile-checkpoint/m1-live-browser-final.log`.

## Notes

Earlier red attempts were fixture/test harness setup: Expo's Node export evaluated the bridge before browser injection; cold direct-route loading preceded paired project catalog hydration; sandbox policy disabled project-local model config; direct file restore left an infinity-TTL global config cache; and the separate SSE watcher initially read the wrapper instead of `payload`. Opening through hydrated Chats, using the sandbox-only global provider, `/config/reload`, and decoding the event payload resolved those harness issues. These attempts did not establish a product regression.

This is a real backend and browser UI proof, not native iPhone/TestFlight qualification. Physical-device completion, keyboard/safe-area, reconnect, and full viewport matrix remain for the release gate.
