# Project State

## Current focus

2026-07-31: a third physical-iPhone Agents smoke reached and rendered a
desktop/projectless transcript, then continually flashed between the transcript
and `Opening chat`. Live desktop logs showed matching aborted upstream requests.
The route lifecycle race is corrected and verified locally: a matching opener
`ready` state is now authoritative while React finishes committing provider
selection state. See
[runs/2026-07-31-issue-1285-native-ready-loop.md](runs/2026-07-31-issue-1285-native-ready-loop.md).

## Active branch / PR

- Branch: `codex/mobile-fixes-rollup`
- Base: `origin/codex/fix-session-isolation-runtime-performance`
- PR: [#1284](https://github.com/ajhochy/Rhythm/pull/1284) (draft)
- Current pushed commit before this corrective delta: `6a8a2beb85c1578ee55a9a406f68dd200bcaf70e`.
- Merge remains a manual human action after review and physical-device smoke.

## In progress

- Commit and push the verified c14 lifecycle correction.
- Reinstall the exact corrected commit on the connected iPhone without replacing
  the already healthy exact-PR desktop/backend processes.
- Re-smoke a desktop/projectless chat for stable transcript display and input.

## Risks / known issues

- The c14 regression is deterministic and green, but the corrected native build
  has not yet been driven on the physical iPhone.
- GitNexus rates this corrective delta LOW: one changed runtime symbol and zero
  affected execution flows. The branch remains a large intentional integration
  stack, so comparisons to `main` are noisy and high-risk in aggregate.
- Issue #1280 still needs its physical-iPhone multiline composer smoke.
- User-owned `.proof/` image modifications remain excluded from commits.

## Test status

- New c14 native contract — RED first (two cancellations and one reopen), then
  PASS (renderer cleanup only; zero reopen).
- Atomic opener contract — PASS 12/12.
- Mobile TypeScript typecheck — PASS.
- `ai-workflow checks --level issue` — PASS.
- `ai-workflow checks --level pr` — PASS across all 15 desktop, API, MCP,
  OpenCode fork, and mobile stages.
- GitNexus working change detection — LOW, 4 files / 1 indexed symbol / 0
  affected processes.
- Failed physical smoke recorded in
  `.agent-stack/postmortems/2026-07-31-issue-1285-native-ready-loop.json`; existing
  follow-up issue #1287 updated.

## Next step

Commit/push the lifecycle correction, reinstall the exact commit on the iPhone,
then have the user verify the desktop transcript remains stable and accepts a
new mobile message.
