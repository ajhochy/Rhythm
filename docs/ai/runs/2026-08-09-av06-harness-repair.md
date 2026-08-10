---
date: 2026-08-09
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-06]
status: BLOCKED
tags: [run, Rhythm, live-artifacts, harness]
---

# AV06 harness repair

## Files
- AV06 runtime contract, AV04 fixture callers, native command documentation, and AV06 contract status only. No product source changed.

## Contract
Before repair: `flutter test test/features/live_artifacts/av06_runtime_contract_test.dart` failed with `RangeError (length): Invalid value: Only valid value is 0: -1` from `_ViewerHttpFixture.send` on the second GET.

After repair: `flutter test test/features/live_artifacts/` — **39 passed**. C3 covers 403/404 unavailable, 410 remove, 409 refresh `[409,200]` with two GETs/one render/no conflict panel, 500 retry `[500,200]`, first-load 200 toolbar/render, and exhausted-status reuse.

## Checks
- `dart format . --set-exit-if-changed` — pass, 0 changed.
- `flutter analyze --no-fatal-infos` — pass; 282 pre-existing info diagnostics.
- `flutter test` — **1088 passed**.
- API `npm run build`, `node_modules/.bin/tsc --noEmit`, `npx vitest run src/__tests__/live_artifacts.test.ts` — pass; **26 passed**.
- Fork `bun run build --single` — pass.

## Native evidence
The smoke requires `AV06_PCO_COUNTER_URL=http://127.0.0.1:4199/_av06/counters`; the fixture endpoint returns its count without incrementing it. The C4 assertions are present: six explicit `host.blocked`, eight bridge notifications including malformed/unknown input, unchanged host-request and PCO counts.

Native run was attempted with the real HOME, foreground isolated sandbox, fixture, and counter define. It did not reach C4: the foreground sandbox process was reaped by the 300-second automation timeout while the macOS app built; the test then failed its initial artifact create with `ClientException: Connection refused` to `127.0.0.1:4098`. Sandbox cleanup completed. No screenshots were written or changed.
