---
date: 2026-10-08
repo: Rhythm
branch: mega/2026-09-29-consolidation
pr: 1598
issues: [1387]
status: locally-tested-ci-pending
tags: [run, rhythm]
index: "[[Rhythm]]"
---

## Files changed

- Mobile provider: remove the effect that converts busy statuses to idle on SSE loss. Preserve server status and existing polling fallback.
- Relay recovery contract test: retain the original pending-notification assertion; additionally assert no premature completion and exactly one completion after recovery.
- Sol C4 callback harness: provide the actual background-read state setter and error formatter; assert rejection reporting and successful error clearing.
- Mobile state documentation: describe notification/status continuity during SSE loss.

## Checks run

Baseline `8c003765241e25c0b18b15888363fd612d1c6fce` reproduced both CI failures: 2 failed, 9 passed. Initial explicit-idle guard did not fix the relay failure and was removed. Stack trace identified the synthetic-idle effect as the completion trigger. The real engine removes idle sessions from the status map, so an explicit-idle-only guard would be incorrect.

Final candidate:
- `node node_modules/jest/bin/jest.js --runInBand tests/sol-mobile-c4-read-guard.test.ts tests/contract/issue-1387-false-offline-after-send.test.tsx`: 11 passed, 2 suites.
- `npm run test:jest:ci -- --runInBand`: 535 passed, 68 suites; existing CI exclusions unchanged.
- `npm run test:tools-service:1173`: 12 passed.
- `npm run lint` and `npm run typecheck`: exit 0.
- `npm run test:ci:static`: exit 0.
- `npm run verify:foundation` against final source: exit 0; contract, app config, lint, typecheck, transport/security/persistence/fake-server checks, real Expo web export and Playwright passed. Browser result: 79 passed, 2 environment-gated skipped (relay kill-switch and live M1 sandbox). Existing CI Jest exclusions and live opt-ins unchanged.
- GitNexus exact-head impact: OpencodeProvider LOW, 1 direct caller; completion callback LOW, 1 direct caller. Test callback is not indexed; manual scope inspection confined it to the harness.

## Notes

AJ explicitly authorized fixing the two remaining mobile failures. No installation, app restart, main merge, Coordinator architecture work, or e2e/fake-server test edits. Shared dirty checkout untouched. Earlier scoped Dayflow/approval commits remain included; excluded PR1610 architecture/handoff patches remain recoverable.

Validation uses Mobile CI's exact package gates. Repo-wide issue/PR wrappers also run unrelated Flutter/API/web checks and normal-client smoke; they are not claimed here. No physical-device qualification is claimed. External command receipts are in the dated Codex mobile-ci-fixes folder. Remote head and terminal CI will be captured after push in the external receipt. GitNexus staged detection reported 5 files, 4 symbols, no affected execution flows, low risk; anonymous effect deletion was inspected manually. Generated tracked screenshots were restored, not committed.
