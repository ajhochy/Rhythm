# Rhythm — Project State

## Focus

Complete the remaining Rhythm issue scope in draft mega PR #1544, including Colony inside Rhythm, shared memory, shared canonical agents/settings, native Hermes execution, and two-way delegation. AJ explicitly chose Hermes itself as the execution engine for shared agents launched there. One final combined smoke; no merge, deployment or release publication.

## Branch and included changes

`mega/2026-09-18-mobile-electron-hermes`, `.mega-wt/integration`, [PR #1544](https://github.com/ajhochy/Rhythm/pull/1544). Earlier timestamp, existing-session prompt, webhook and transcript slices remain. Resumed additions: Engraph ownership `efe77109`, workflow ordering #1500 `b9c6150b`, real-API timestamp harness `13cbacf3`, native-agent plan/coverage `0c186d89`, credential reader foundation `20f9c8da`, and vault conflict safety `5416d49e`.

## Verification

The resumed 16-stage gate completed with 15 stages passing and one engine cancellation timeout. Exact failed-stage replay passed 396 tests (5 skipped, 1 todo), without a source change; cause remains unproven. This is not an all-green aggregate gate claim. New reader: Electron 180/180, portable reader 12/12, source check 1/1, typecheck pass. New vault slice: 36 files / 314 tests and API build pass; independent review replay 29/29. No configured ESLint implementation exists in API (lint script is a placeholder). Timestamp real-API browser 2/2; Engraph 59 focused plus 2 synthetic real-process tests; workflow ordering 66/66.

## In progress

- Hermes S3 clean child environment/callback candidate: `/private/tmp/hermes-1569-s3`; 19 focused tests reported passed, parent review/typecheck pending. S1/S5 are included foundations; credential grants/IPC/UI and live combined sharing remain unfinished.
- Native session policy: `/private/tmp/hermes-shared-agent-policy`; generic mandatory enforcement and session propagation in progress. HIGH security impact; helper tests alone do not establish native execution parity.
- Colony upstream builder: `/private/tmp/bot-crossing-colony-artifact`; parent replay 4/4 builder and 185/185 existing tests. Dirty/unpinned candidate; current HTTP host must become private IPC under COL-02. Resolver implementation: `/private/tmp/rhythm-colony-private-bridge`. No functional Rhythm tab yet.
- #1572 direct-provider usability, #1573 semantic memory search, and remaining backlog retain open acceptance. See [91-issue coverage](runs/2026-09-24-open-issue-coverage.md) and [native-agent plan](plans/2026-09-24-native-hermes-shared-agents.md).

## Remaining acceptance and safety

No real credential store or vault was modified. New memory checks are synthetic; live API/Hermes qualification remains. External edits after the final digest check remain a documented race. Native Facilities rendering, physical audio/iOS, provider/account behavior, both architectures and signing/notarization remain separate open gates. The unexplained engine test timeout remains recorded. Preserve unrelated dirty September 21 documents.

## Evidence

Individual September 24 run notes contain commands and limits. Durable evidence: `/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-repair4/`. Continue candidate review/integration and new-head CI; prepare the final combined smoke after the feature work is implemented.
