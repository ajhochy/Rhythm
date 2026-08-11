---
date: 2026-08-08
repo: Rhythm
branch: feat/task-search-tier12
pr: null
issues: [task-search-tier12]
status: PASS
smoke_result: not_applicable
verification_claimed: true
divergence: false
overall_score: pass
tags: [retro, adherence, Rhythm, task-search, verification]
---

# Task-search Tier 1+2 final verification retrospective

## Result

Final verification is **PASS** after the surgical FTS backfill repair and complete post-repair rerun. Product, runtime, security, and performance gates passed with no waiver: S1 21/21; S2 7/7; delegated replay regression 7/7; S3 50/50; S4 13/13; full API 4,055 pass / 131 skip; full MCP 161 pass / 2 live skip; API/MCP typecheck and build; and all 75 contract criteria passed or were reasoned `not_tested`, with no unresolved statuses.

Migration convergence is now evidenced by before/after counts of 74/74, `secondMigrationDelta` 0, one backfill marker, and two indexed matches. The retained surgical prevention is a data-touching migration assertion that the settled second run performs **zero writes**. Live sandbox API and engine readiness passed, task-search live E2E passed 3/3, and ephemeral Postgres passed 16 checks including generated weighted TSVECTOR title A / notes B, stemming, title rank 0.6079271 > notes 0.24317084, and a forced Bitmap Index Scan on `idx_tasks_search` (`postgres_gin_execution=pass`). Repeated performance evidence (3x) held at 397 tasks, 20,059 output characters versus a 234,425-character baseline (91.4% reduction, <=24,000). Security, API shape, secret, diff, and dependency checks passed; the sandbox and Postgres container were removed and ports were clear.

## Per-criterion comparison

| Criterion | Contract status | Observed status | Category |
| --- | --- | --- | --- |
| S2 c1–c3, c5–c6, c9 | pass | Passed focused/live evidence | — |
| S2 c4 (SQLite replay is idempotent) | pass | **Failed under the existing full-suite convergence contract**: replay rewrote all FTS rows | C2 wrong contract |
| S2 c7–c8 | `UNVERIFIED`, also listed in `not_tested` | Not tested; status vocabulary was inconsistent with the aggregate contract's `not_tested` | W adherence |
| S3 c8 (isolated Postgres runtime) | not_tested | Not tested; deterministic SQL coverage retained | — |
| S5 c1–c3 | pass | Passed live SQLite/API/MCP behavior | — |

## Chain

- **Expected chain:** slice contract → focused slice verification → aggregate contract with canonical statuses → full-suite convergence gate → final verification result.
- **Observed chain:** S2 contract and focused replay guard passed; S2 documented an every-boot rebuild as idempotent; live SQLite/MCP and isolated Postgres behavior passed; the full-suite convergence gate then failed. Aggregate/slice contract statuses also retained noncanonical `UNVERIFIED` values.
- **Skipped skills:** none established from the supplied evidence. The missing step was not a skill invocation but a slice-local assertion of the full-suite convergence invariant.

## Issues

1. **C2 wrong contract — S2 schema verification:** the local replay test checked task content and duplicate objects, but not whether a replay performs avoidable index writes. FTS5 `rebuild` is structurally repeatable yet not convergent; the existing delegated-session contract measured the latter.
2. **W adherence — contract status hygiene:** S2 marked c7/c8 `UNVERIFIED` while simultaneously declaring them `not_tested`. The status is not part of the aggregate contract's canonical vocabulary, so incomplete evidence was harder to reconcile before the final gate.

## Why the local test missed it

The slice equated idempotence with unchanged source-task content and no duplicate FTS objects. It did not treat migrations as a convergence boundary with a zero-unrelated-write expectation after first application. The existing global test happened to observe database change counts across repeated `runMigrations()` calls, but that invariant was neither imported nor mirrored in S2's focused contract. The S2 run note also explicitly characterized the rebuild as "every-boot," normalizing the non-convergent behavior rather than challenging it.

## One surgical prevention recommendation

Add one focused S2 assertion: seed indexed tasks, run migrations once, then run them again and assert the second invocation causes **zero SQLite data changes** (including FTS rows). This captures the global convergence invariant at the migration change site without expanding dispatch policy or duplicating the full suite.

## Status hygiene follow-up

Use only the aggregate contract's canonical `pass` / `fail` / `not_tested` values; an item listed in `not_tested` must have criterion status `not_tested`. Do not update the contracts in this retrospective-only run.

## Checks

- PASS: `git diff --check -- docs/ai/runs/2026-08-08-task-search-tier12-verification-retrospective.md`
