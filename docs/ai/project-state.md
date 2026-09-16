# Rhythm — Project State

## Current focus

iOS end-to-end candidate: Rhythm Agents mobile app (hosted Google sign-in
without manual pairing, redesigned core journey, reliable chats, recoverable
bootstrap failures, mobile CI E2E restored). On draft PR #1493, gated on a
mandatory live acceptance test in the iOS Simulator against the real hosted
server — currently **BLOCKED** on deployment.

## Active branch / PR

- Branch: `feature/ios-end-to-end`
- Head: `f25abeed1b5da18570b96bd6bbe950842defd6f5`
- PR: https://github.com/ajhochy/Rhythm/pull/1493 (draft, open, not merged)
- Run doc: `docs/ai/runs/2026-09-15-ios-mobile-finish.md`

## In progress (AJ-owned; deployment is out of scope for this workflow)

1. Run "API Image Publish (GHCR)" workflow on `feature/ios-end-to-end`.
2. On the NAS: `docker compose pull` + `up -d rhythm-relay` for
   `docker-compose.synology.yml` (Watchtower alone won't pick up the new
   `RHYTHM_RELAY_PUBLIC_URL` — it recreates with the old env; `compose` with
   `.env.production`/`.env.relay` is required).
3. Verify `https://api.vcrcapps.com/health` commit == `f25abeed…` and
   `/relay/health`.
4. Relaunch `/Applications/Rhythm.app` so `127.0.0.1:4001` and the Mac relay
   uplink (`macOnline`) come back up.
5. Re-run the live acceptance gate (screenshot dir
   `/private/tmp/rhythm-ios-acceptance/`).

## Risks / known issues

- Desktop Rhythm API on `127.0.0.1:4001` is down (OOM), tracked separately in
  PR #1494 — blocks the Mac relay uplink and the acceptance gate.
- Relay env fix (`RHYTHM_RELAY_PUBLIC_URL`) is saved on the NAS but not live:
  only applies via `docker compose up`, not via Watchtower recreate.
- Publishing an image built from a feature branch is auto-deployed by
  Watchtower once pushed to GHCR — do not publish `:main` casually.
- Pre-existing flaky test on `main` (not this branch's regression):
  `apps/api_server/src/__tests__/workflow_failure_signal_extractor.test.ts:764`
  — same-tick `createdAt` collision in `detectStaleRedoSignals`; needs a
  60s backdate matching its sibling test. Worth its own issue.
- `bootstrapState === 'environmentSelection'` (multi-computer accounts) has no
  UI yet — not a failure state, out of scope for this slice.

## Test status

- Mobile CI `foundation` job: was red on every push since 2026-09-13 (E2E
  label drift from the `Agents`→`Chats` rename in 9c027b52); fixed by
  `f25abeed` and confirmed green.
- PR #1493 rollup at `f25abeed`: Mobile CI success (run 35038680725), Server CI
  success (run 35038680724, one flake-path rerun of a pre-existing timing
  flake unrelated to this branch).
- Targeted Jest/contract/E2E suites all green (see run doc for full list);
  `CI=1 npm run test:e2e:web` (foundation-equivalent) exits 0.
- Live acceptance gate: **BLOCKED**. All three readiness checks fail — hosted
  API still serves `9c027b52` (pre-relay-fix), relay `macOnline:false`, local
  4001 connection refused. No simulator/build/install steps were run.

## Next step

1. AJ completes the deployment handoff above (image publish, NAS relay
   recreate, desktop relaunch).
2. Re-run Step 1 readiness checks; on pass, proceed to Step 2 simulator
   build/install/launch and criteria 1–6 verification (criterion 7,
   AJ-only designated-conversation send, stays AJ's).
3. File the `workflow_failure_signal_extractor.test.ts:764` flake as its own
   issue (backdate fix, matches sibling test in the same block).

Note: the six-stream/optimizer workflow state (PRs #1486–#1490, #1485 plan)
lives on other branches (`fix/session-list-and-task-board`,
`fix/bridge-stream-reliability-repair`, `fix/optimizer-scope-lane`,
`fix/optimizer-generator-lanes`, `plan/recipes-1485`), not here.
