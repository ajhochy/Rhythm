# Rhythm — Project State

## Current focus

Electron replacement handoff: **integrated automated verification passed; manual smoke is active and not yet passed**. The current candidate covers collapsible project headings, the live fixture-demo leakage fix, Planner/Tasks/signed-in Dashboard redesigns, Electron interactive-smoke mode, sandbox `rhythm://app` CORS, and package build/smoke. Phase6 pilot/cutover/30-day fallback has not started; Flutter remains the shipping client.

## Active branch / PR

- Current worktree: `Rhythm-electron-flutter-retirement`, branch `feature/electron-flutter-retirement`, HEAD `82d6b981` plus verified uncommitted changes. No push, draft PR, or merge is authorized. [Integrated automated pass](runs/2026-09-14-electron-integrated-automated-pass.md).
- Prior six-stream handoffs (status not rechecked in this documentation update):
- `fix/session-list-and-task-board` → draft PR #1486; fixes #1466, #1476, #1477, and #1475.
- `fix/bridge-stream-reliability-repair` → draft PR #1487; fixes #1457, #1458, #1455, #1456, and #1325.
- `fix/optimizer-scope-lane` → draft PR #1488; fixes #1479 and #1482.
- `fix/optimizer-generator-lanes` → draft PR #1489; fixes #1480, #1481, #1483, and #1484.
- `plan/recipes-1485` → docs-only draft PR #1490 for #1485 plan/review/state.

## In progress

- AJ's final manual smoke is active against non-owning candidate PID `8699`, using the AJ-authorized live API `4001` and engine `4096`. Do not restart, signal, or claim this candidate passed.
- Manual checks remain for Planner native zoom, themes, forced colors, reduced motion, keyboard, backlog, drag, sticky action, and density; Dashboard ordering, dates, collisions, legacy-fixture diagnostic disposition, themes, zoom, forced colors, VoiceOver, and narrow artifacts; installed Tasks visuals and VoiceOver; real provider/session behavior; signed dual-architecture packaging; and broader retirement gates.
- Phase6 and separate Flutter-retirement approval remain outstanding.
- AJ-owned review, manual smoke, and merge decisions for draft PRs #1486–#1489.
- #1485 implementation has not started. S0, S1a, S1b, and S2 may begin in parallel where file ownership permits; S3a waits for S0's mode and S1b, with dispatch wiring waiting for S2; S3b follows S3a; S4 follows S3b; S5 needs S1b plus the stable S3 DTO and does not wait for S4. No AJ decision blocks dispatch.
- Verification workflow corrections are recorded in Rhythm-owned `verification-gate` and `workflow-orchestrator` skills: pre-run `UNVERIFIED` triggers execution, and exact worktree, fixture variables, launch ownership, and readiness are mandatory.

## Risks / known issues

- Automated PASS does not qualify manual smoke, signed dual-architecture packaging, provider/session behavior, assistive technology, native migration/rollback, or broader retirement readiness.
- Stale verifier sandbox listeners `5898/5897/5899` (PIDs `65058/65094`) are intentionally retained by AJ choice; do not touch them.
- Generated screenshot churn/deletions and blocked/no-op notes are not intended commit scope.
- Prior six-stream GitNexus client/index mismatch was unresolved there; the Electron compare receipt below is current for this handoff, not retrospective qualification of those PRs.
- PR #1486 still needs subjective Electron/web versus Flutter child-session visual-parity smoke. Deferred tasks are excluded from Open after Done.
- Optimizer diagnosis still selects the global MRU profile rather than a named dedicated profile; this is documented in PR #1489 and intentionally not expanded there.
- Optional validator cleanup remains for a missing `find` MCP grant and a coding-agent contract-path variant.
- S4 requires private `ajhochy/rhythm-workflow-e2e` on `main`, a required `workflow-e2e` check, and observable OpenAI plus Anthropic provider metadata before it can run.

## Test status

- Final verifier `4253` reported integrated automated **PASS**, retaining the prior integrated evidence and focused repair receipts. This is not manual-smoke evidence or merge readiness.
- Built package candidate: `apps/electron/dist/Rhythm.app`; package build/smoke passed automated verification.
- GitNexus compare-main: 371 symbols / 254 files, zero affected indexed processes, LOW aggregate; individual HIGH/CRITICAL changes were disclosed and authorized. Aggregate LOW does not remove manual qualification gates.
- Initial triage: 60 open issues and 0 PRs. Twenty-three applicable D1–D4/C2-D issues in #1426–#1451, including tracker #1448, were verified on `main` and closed with evidence; backlog was 35 afterward.
- PR #1486: automated API, web, Flutter, and live gates pass; only subjective visual-parity smoke remains.
- PR #1487: 33/33 criteria; full API suite 5,999 passing; all live gates pass.
- PR #1488: 8/8 criteria and live 10/10. Read-only diagnosis found 16 phantom Obsidian grants across four profiles; no live rows changed.
- PR #1489: 24/24 criteria, 165 focused tests, live 2/2, and cleanup/integrity checks pass.
- #1485: OpenAI-authored plan completed Anthropic Opus 5 contrarian review and second-pass Fable review; the remaining approval-guard and completion-binding specification repairs are incorporated. This branch is docs-only.
- Synthetic fixture v2 uses DELETE journaling, is read-only, and contains no secrets. The intentionally retained verifier sandbox and current non-owning live candidate are described above.

## Next step

1. Complete and record AJ's final manual smoke on candidate PID `8699`. Do not infer PASS, authorize a draft PR, start Phase6, or retire Flutter from automated verification alone.
2. Retain prior handoffs: AJ smoke/review for #1486–#1489; #1485 implementation scheduling, prior GitNexus mismatch and optional validator cleanup remain separate follow-ups.
