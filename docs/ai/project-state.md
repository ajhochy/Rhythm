# Rhythm — Project State

## Focus

Causal-runtime-v2 C6 (#1448): versioned calibration and operator/release
surface on top of accepted C0-C5.

## Branch / PR

- Branch: `agent-stack/si-causal-runtime-v2-codex`
- Base head before C6: `89c300d8`
- C6 changes are uncommitted pending final staged scan/commit.
- Integration branch / draft PR: `self-improvement-engine-foundation`, PR #1398.

## State

- C0-C5 accepted.
- C6 all seven parent criteria pass, including treatment flag enforcement,
  owner-scoped production calibration, review-only ranking, API/UI summaries,
  reviewed UI ancestry, full static/dual-engine/live gates, and exact docs.
- Literal copied-real-data was replaced by an AJ-approved synthetic sanitized
  fixture. Packaged visual screenshot smoke was explicitly waived by AJ because
  the live shipping client owned hardcoded ports; full UI tests/release build
  passed.

## Verification

- API: 5,530/5,530 pass; 180 skipped; zero failures.
- Production calibration/ranking: 163/163.
- Postgres: 9/9.
- Flutter: 1,234/1,234; analyze/build pass; release app 73 MB.
- WS baseline/candidate: 1/1.
- Synthetic shadow zero-mutation: 1/1; source DB/config hashes unchanged.
- Sandbox guard: 14/14.
- GitNexus: UNKNOWN due stale/version-mismatched index.

## Next

Stage and commit C6 to an immutable head, merge it into the foundation branch,
then run a fresh independent adversarial review against the immutable integrated
SHA before unblocking D1/D3/D4.
