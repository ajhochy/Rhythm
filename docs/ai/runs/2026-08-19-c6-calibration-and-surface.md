---
date: 2026-08-20
repo: Rhythm
branch: agent-stack/si-causal-runtime-v2-codex
pr: none
issues: [1448]
status: verified
tags: [run, Rhythm, C6]
---

# C6 — Versioned calibration and operator/release surface

## Delivered

- Owner-scoped, immutable calibration observations in SQLite and Postgres,
  with deterministic decision/regression event identities and additive legacy
  backfill.
- Production observation recording after terminal experiment decisions and
  post-deploy regressions.
- Homogeneous versioned snapshots that stay explicitly uncalibrated below the
  evidence floor.
- Owner-scoped calibration summary used only for stable human review ranking;
  no mutation, risk, promotion, CAS, or authorization authority.
- Load-bearing treatment-v2 flag at reservation, resolution, preparation,
  dispatch receipt, outcome association, AgentRunner, and WS boundaries.
- API/Flutter experiment summaries with separate deployment/causal status,
  progress/counts/integrity/guardrails/reason, and validated short SHA-256
  tested hashes. No raw content bytes.
- Revert/report-card UI commits `5447a7b2` and `dbef0413` confirmed as branch
  ancestors.
- Vitest inherited-environment isolation and fail-closed sandbox fixture
  preflight. The sandbox now requires explicit read-only fixture DB/config,
  rejects prohibited paths, validates shadow mode from the Rhythm environment,
  and makes only its disposable config copy writable.

## Checks

- Node 22 TypeScript and API build: pass.
- Full API suite: **592 files / 5,530 tests passed**, 107 files / 180 tests
  skipped, zero failures.
- Focused production calibration/ranking suite: **163/163**.
- Former inherited-environment failures: **43/43**.
- Repaired C5/schema/load suites: **104/104** serial.
- Disposable Postgres 16 bootstrap/parity/immutability: **9/9**.
- Flutter format/analyze: pass; 315 pre-existing infos, zero warnings/errors.
- Full Flutter suite: **1,234/1,234**.
- macOS release build: `Rhythm.app`, 73 MB; executable SHA-256
  `e01d8c4a51046772ed34ad5e506df5ef301613e8abd7f27503af2ee39bafcc86`.
- Sandbox guard: **14/14**.
- Real isolated WS baseline/candidate treatment gate: **1/1**; distinct
  effective prompt/receipt hashes and unchanged durable target bytes.
- Synthetic-fixture shadow zero-mutation gate: **1/1** after the real 90-second
  cold-start window. Source fixture DB and OpenCode config hashes were unchanged.
- `git diff --check`: clean.

## Waivers / substitutions

- AJ approved a synthetic sanitized fixture instead of literal copied-real-data.
  This verifies isolation, MCP/config wiring, target zero-mutation, and source
  immutability; it is not represented as production-data coverage.
- AJ explicitly waived packaged screenshot smoke because the normal shipping
  client occupied hardcoded ports 4001/4096/4002 and stopping it was not
  authorized. Full Flutter/widget tests and a release build passed.

## Safety incident and repair

An earlier sandbox launch inherited the default live DB source before being
stopped; no production writes were observed. `sandbox.sh up` now has no copied-
data default and fails before process launch unless all explicit canonical,
read-only fixture and shadow-mode checks pass.

## Risk

GitNexus remains **UNKNOWN** because this worktree's index is stale/version-
mismatched. No low-risk claim is made. Manual call-site tracing plus focused,
full, dual-engine, UI, and live tests provide the verification evidence.
