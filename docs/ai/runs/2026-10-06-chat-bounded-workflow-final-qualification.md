---
date: 2026-10-06
repo: Rhythm
branch: integration/2026-10-06-resume
pr: 1604
issues: [1605]
status: pass
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# C9 final qualification

## Files

C9 is exact source `54888e924c5b31cb7700b6eb1f5da7c4c450e930`, apps tree `47f1828030f1b14c2175975e47e72a5796b0cb47`. The four-file CSS cascade repair is scoped to one selector, production-order harness import, and the RED/GREEN run/postmortem records. No native wrapper lifecycle/ABI changes.

## Checks

Repository gates passed: issue 4/4 and PR 22/22 stages, with each exit code 0. Totals: Flutter 1,355; API 8,246 passed/292 skipped; MCP 220/2 skipped; fork 520/5 skipped/1 todo; mobile web E2E 77/1 skipped; Jest 525; mobile tools 12; desktop web unit 81; Electron 559/4 skipped. Flutter analyze exited 0 with 319 diagnostics; format checked 527 files, 0 changed. Full per-stage commands/output are retained in the external C9 gate receipt.

Browser checks passed chat 1/1 and Dayflow/Sol 16/16 in production CSS order. Native AppKit C1–C3 passed. Formal actual API/fork/MCP idle and stock-restart cases passed 2/2 with 111 registered MCP tools; idle was 19/19 qualification and 5/5 operational, restart 20/20 and 5/5. Both checked exact criteria, manager ordinals 1/2 and 65 seconds without a third job. The formal command was `PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_SOURCE_SHA=54888e924c5b31cb7700b6eb1f5da7c4c450e930 RHYTHM_CHAT_LIVE_TEST_OUT=/Users/ajhochhalter/Documents/Codex/2026-10-06/codex-dayflow-cascade-c9-build ./node_modules/.bin/vitest run src/__tests__/live_chat_bounded_workflow.test.ts --reporter=verbose` (from `apps/api_server`). Model transport and semantic ranking were synthetic; no provider-semantic or human-native P256 fixture proof.

Root independently reviewed exact C9 native inputs (749 immutable source files, 280 payload files); compile-only addon built, but package/sign/stable-copy/verifier/signed-smoke/origin checks then all passed. Stable manifest SHA-256: `6302833146ba3edff3ffc31ae88d9c7e91d03ab454eca54ddf65e47d096915e9`. The app is signed, not notarized.

Actual signed normal-profile CUA passed `issue-1605-c4`: at 1280×800 original Timeline rendered with no outer Rhythm header/footer; at 1280×560 two native scroll pages down reached Copy timeline, Settings and Review cards while global navigation stayed fixed; two pages up restored Today/Timeline/Daily. Tall target 3440×1300 yielded actual 3440×1296 due macOS zoom; full bottom content stayed visible and the outer document did not move under native scrolling. The app was left at 1280×800, Timeline top. Screenshot-only estimates are ~402px visible surface, ~576px content extent, ~174px movement; exact private NSRect/intrinsic geometry is unavailable. This is not physical-human proof. Existing two pending approvals were unchanged; no approval, onboarding, TCC or capture-setting actions were performed.

Fresh read-only TestFlight status: iOS 1.0.9 build 21 is valid, not expired, and in internal beta. C9 contains no mobile product changes; physical phone test is NOT RUN.

## Notes

C8's actual blank signed Dayflow app and C9 production-order RED/GREEN are retained as separate historical records; the C8 failure JSON is unchanged. Root records the distinct C9 PASS postmortem. Final-doc PR CI runs only after docs D is pushed; do not claim it green yet. Provider judgment, P256 human fixture, physical phone, full native 16-screen matrix, and owned cleanup remain pending.
