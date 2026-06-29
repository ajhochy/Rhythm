# Project State

## Current focus

Issue #798, the final guard issue for skill-unify2 epic #791, is implemented on
`feature/skill-unify2` at the working tree based on `b9b9838a9`.

## Active branch / PR

- Branch: `feature/skill-unify2` (local ref displays as `Feature/skill-unify2`
  because this case-insensitive checkout contains historical case-colliding refs).
- Remote tip before this run: `origin/feature/skill-unify2` at `b9b9838a9`.
- No implementation PR is open for this branch. PR #799 is plan-only and is not
  the landing PR; the combined #792–#798 implementation branch should target
  `main`.

## In progress

- #798 adds built-fork apply/keep/revert/external safety smoke, metadata-name
  alignment coverage, explicit schema-parity CI execution, and an executable
  acceptance contract.
- The guard exposed and corrected managed rollback re-rendering: exact prior
  SKILL.md bytes now restore through a managed-dir-confined raw-byte helper.

## Risks / known issues

- Release smoke requires the built fork binary; local verification uses the
  existing arm64 build. Release CI rebuilds the fork before running the guard.
- No signed release is required for these automated guards.

## Test status

- Contract tests: 25/25 pass across apply/measure, measurement, name alignment,
  and schema parity.
- api_server TypeScript build: pass.
- Built-fork `smoke_skill_alignment.sh`: pass.
- `ai-workflow checks --level issue`: pass.
- `ai-workflow checks --level pr`: pass.
- api_server build + spawn/health/session smoke: pass.
- Acceptance contract: 7/7 pass, no manual criteria.
- GitNexus change detection: LOW risk, 0 affected processes.

## Next step

Commit/push #798 onto `feature/skill-unify2`, then open the combined #792–#798
implementation PR against `main` if requested.
