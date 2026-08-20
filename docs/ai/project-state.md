# Rhythm — Project State (worktree: d2-post-apply-lifecycle)

## Current focus

D2 series of the self-improvement-engine campaign: the post-apply
monitor→repair→revert lifecycle, contracted incrementally under GitHub issue
#1433 (D2.3) and siblings #1431/#1432/#1434/#1435. This worktree branched off
`agent-stack/si-causal-runtime-v2-codex` after that campaign's C4 phase
landed (merge commit `0b5e7237`) — the causal-runtime-v2 C0–C4 work is
already merged into this branch's history; do not re-verify it here.

## Active branch / PR

- Branch: `agent-stack/si-d2-post-apply-lifecycle` (this worktree), up to
  date with `origin/agent-stack/si-d2-post-apply-lifecycle`.
- Head commit: `a8f0607d` — `feat(optimizer): auto-repair service for
  post-apply guardrail breaches (#1433)`.
- **Draft PR #1454 open**: https://github.com/ajhochy/Rhythm/pull/1454 — NOT
  merged, awaiting AJ's manual review/smoke per repo policy.

## In progress

D2 series, each phase parent-verified (focused tests + tsc + build; D2.3 also
got a full-suite + Flutter + GitNexus final pass before the draft PR):

- **D2.1** (#1431) `c78fc725` — `PostApplyEvent` model + repository.
- **D2.2** (#1432) `baca680a` — post-apply guardrail monitor.
- **D2.3** (#1433) `a8f0607d` — bounded 3-strike auto-repair service
  (`apps/api_server/src/services/auto_repair_service.ts`). Replaced a
  placeholder `runCallCount` test-order hack with real logic: per-attempt
  `diagnose` → re-resolved `refine-config` proposal → CAS-applied via the
  same primitive the human-approval path uses → re-checked against a
  strictly-increasing per-attempt time floor so an earlier attempt's breach
  is never re-blamed on a later attempt's fix. Also fixed a genuine test-data
  bug (two success-path cases seeded byte-identical breach data expecting
  different attempt counts) and a real `TS2307` bad-relative-import bug in
  the placeholder. Details: `docs/ai/runs/2026-08-19-d2-3-auto-repair-service.md`,
  `docs/ai/contracts/issue-1433.json` (6/6 pass).

Implemented, under verification:

- **D2.4** (#1434) — auto-revert with a redacted full-trail alert after all
  repair attempts fail. Restoration routes through `revertProposal`; the
  verification repairs add deterministic proposal-CAS race coverage,
  malformed refine-config fail-closed coverage, exact full-trail assertions,
  and safe failure logging. Draft PR #1454 remains open.

Not started:

- **D2.5** (#1435) — full lifecycle wiring. `runAutoRepairAsync` currently
  has **zero real call sites** — `post_apply_monitor.ts`'s
  `registerAutoRepairTrigger` seam is still a log-only stub. Wiring monitor
  trip → auto-repair → auto-revert end-to-end is explicitly D2.5's scope.

## Risks / known issues

- Auto-repair bypasses `org_proposal_apply_service.ts`'s pluggable
  per-kind applier registry, applying directly via
  `AgentConfigsRepository.update` + `claimAppliedWithSnapshotAsync` instead.
  Deliberate scope choice (auto-repair only ever emits `refine-config`
  fixes) — revisit if a future D2.x needs other proposal kinds here.
- `model`-field config patches are stored verbatim on `modelId` (no
  provider/model split like the human-approved applier does) — matches this
  slice's test contract, flagged in code with a `ponytail:` comment.
- No live sandbox/behavioral E2E for D2.3 — it's pure internal DB/service
  logic with no new HTTP/WS entry point exercised deterministically by the
  contract test; nothing user-facing to smoke-test yet. D2.5 (real wiring)
  will need one.
- D2.4 verification attempted the required sandbox lifecycle, but startup is
  blocked before services launch by missing `@opentui/solid/preload`; cleanup
  passed. Do not mutate dependencies or hand-start api_server. D2.5 owns the
  first live route/wiring.

## Test status

- D2.1–D2.3: each parent-verified, focused tests + `tsc --noEmit` + build
  clean.
- D2.3 additionally got a full-suite pass before the draft PR: full
  `apps/api_server` suite 5478 passed / 7 failed, all 7 confirmed
  pre-existing and unrelated (grep-verified no import path touches this
  diff's files); Flutter `dart format` + `flutter analyze` clean; GitNexus
  `detect_changes()` — 4 files, 0 changed symbols (new files), risk low.
- No full-suite run has happened since `1a35f352` other than the D2.3 pass
  above until the D2.4 verification-repair run.
- D2.4 verification repair: focused suites 116/116 and the 9-file regression
  set 359/359; `tsc --noEmit` and build pass. Full api_server suite: 694 files
  / 5675 tests — 5488 passed, 7 failed, 180 skipped. The 7 failures are the
  unchanged documented baseline across issue_1219_memory_provenance,
  delegation_caller_identity, issue_1135_audit_lock_contract,
  memory_index_rebuild, and memory_injection.

## Next step

D2.4 (#1434, auto-revert-with-alert) is implemented and under verification;
D2.5 (#1435, real lifecycle wiring — the first point `runAutoRepairAsync`
gets a live call site) remains next and not started.
PR #1454 stays draft until AJ manually smokes it; do not merge. Once D2's
whole lifecycle (D2.1–D2.5) is accepted, fold this branch back per this
campaign's established merge pattern (see prior `merge: causal-runtime-v2 …`
commits on this branch for precedent) before continuing past D2.
