---
date: 2026-10-01
repo: Rhythm
branch: codex/opencode-memory-recovery
pr: 1598
issues: [1603, A1, C1, C2, C3, E1, W6, M1]
status: verified-scoped
tags: [run, Rhythm, recovery]
index: "[[Rhythm]]"
---

# Combined recovery checkpoint

## Files changed

This receipt consolidates the current scoped checks for the memory repair, attachments, manual schedule trigger/provider-error handling, approval queue, isolated session Start, and mobile continuation. The implementation and individual red/green histories remain in their dated run receipts. The recovery worktree is the candidate; it is not a frozen release source or an installed build.

## Checks run

- **Memory #1603:** real API, compiled fork, and synthetic provider regression passed 1/1. Eighteen changed files produced a bounded 995,234-byte patch with eight honest preview omissions; current combined engine RSS peaked at **434,896 KiB**, with 15 health samples, maximum combined health latency 18 ms, and one generation request. The earlier 505,680 KiB measurement remains in the historical [memory live recovery](2026-10-01-memory-live-recovery.md) receipt.
- **A1:** latest combined real API/engine attachment suite passed **10/10** in 4.11 seconds, including image bytes, workbook, replay, ownership/error cases, and mobile adapter path. The provider was a controlled synthetic transport, not a real account vision check. Isolated Postgres 17 owner GET/PIN test passed 1/1. Browser selected-byte and size-limit checks passed; XLSX allocation bounds were repaired. See [A1 owner and size](2026-10-01-attachment-a1-owner-and-size.md) and [A1 resume](2026-10-01-attachment-a1-resume.md). Earlier 9/9 and blocked checkpoints remain historical.
- **C1/C2/C3:** `npm exec vitest run regressions_manual_trigger_live.test.ts c1_gap_auth_live.test.ts` passed 10/10 against the real scheduler/API/engine: disabled recurrence, held-provider duplicate producing one request/run/root, durable assistant binding, and mobile owner authentication rejection. `npm exec vitest run c1_gap_provider_live.test.ts` passed 1/1 in 141.09 seconds: controlled non-retryable provider 401 persisted a failed run/root with an actionable error. Live Chromium reconnect/reload, `npm exec playwright test --config tests/c1-live-reconnect-playwright.config.ts`, passed 1/1 in 53.4 seconds. Focused C3 red/green and earlier C1 three-gap runs remain historical; the three explicit evidence-gap placeholders were removed only after replacement gates ran. The exact installed **Org Optimize → Run Now** click and request attribution are still unverified. See [C1 runtime](2026-10-01-c1-c2-integrated-runtime-verification.md), [C1 live gap](2026-10-01-c1-live-gap-evidence.md), and [C3 source repair](2026-10-01-c3-provider-error-source-repair.md).
- **E1:** real API-created synthetic pending rows reached the Chromium queue and session banner after mount, focus, reconnect, and reload; the corrected CORS preflight and empty-transcript banner passed a real browser check **1/1**. The intercepted rendered suite passed 17/17. No approval was signed or PATCHed. See [E1 browser recovery](2026-10-01-e1-empty-transcript-live-repair.md).
- **W6:** real API/engine isolated Start against a disposable dirty Git repository passed **1/1** in a combined three-file/four-test live run (33.57 seconds). It used a base branch checked out elsewhere, a name with spaces, and preserved the source branch, index, staged/unstaged/untracked bytes while creating and cleaning up the focused worktree/session. Focused real-Git and API source tests cover additional branch behavior. See [W6 focused repair](2026-10-01-w6-selected-base-focused-repair.md). Concurrent clicks, existing destination at the live boundary, and the packaged Start journey remain open.
- **Compatibility scope:** final web build and distribution smoke passed. Flutter checks passed 1,355 tests, Electron 451 passed/4 skipped, MCP 193 passed/2 skipped plus six D helper cases, and mobile Jest 318 passed; the latest mobile focused suite had 76 passed/1 skipped. The broad API run recorded **7,104 passed/313 skipped/1 failure** from a contract fingerprint drift; focused fingerprint checks passed 12/12 after synchronization, but the full API suite has **not** been rerun green. Broad fork and focused SDK results are in their individual receipts. The earlier [integrated web checkpoint](2026-10-01-integrated-web-checkpoint.md) contains failures in legacy slice fixtures; this receipt does not relabel the full web suite green. Independent mobile review found a selected-older removal case that may write a draft into the latest session; repair/retest is in progress before source freeze.

## Notes

This is a **scoped synthetic and source checkpoint**, not delivery acceptance. Remaining gates include literal installed component/request/build attribution and packaged Electron journeys, trusted native human approval decision and post-decision readback, physical-device/TestFlight validation, actual provider vision/model entitlement, full affected web compatibility, final same-source CI and signed distribution. Original approval rows were not queried or decided. No production data, credentials, or operational schedule was used for these checks.
