# Project State

## Current focus

Issue #1277 mobile↔desktop parity residual repair is implemented and verified
locally. The live parity gate improved from 11/14 matching feeds to 14/14.

## Active branch / PR

- Branch: `codex/fix-1277-parity-residuals`
- Base: `origin/codex/fix-session-isolation-runtime-performance`
- PR: none; local commit is the current branch HEAD
- Production: untouched

## In progress

- Final GitNexus change-scope review and local commit.
- No push, merge, release, TestFlight action, or worktree removal is authorized.

## Risks / known issues

- GitNexus reports CRITICAL upstream centrality for `endpointResponse`,
  `alignGatewayRedactions`, and `parityValue`, but the direct graph is bounded
  to four webhook response paths and one live parity loop. Focused regression
  coverage plus the real 14-feed sandbox gate passed.
- The mobile security redaction policy is unchanged. Provider-auth parity now
  pairs redacted arrays using non-secret display identity.
- The MCP phone and desktop wire shapes remain intentionally different:
  engine status map versus desktop-enriched array. Parity compares only their
  common live-engine status projection.

## Test status

- Acceptance contract: API 1/1; mobile 2/2.
- Webhook rotation regression: 1/1.
- API build/typecheck: pass.
- Full API suite: 3,779 passed / 119 skipped / 0 failed.
- Mobile static suite: pass.
- Mobile Jest: 4/4.
- Repo PR gate: all configured stages have passing evidence. Two aggregate
  wrapper runs each exposed a different unrelated, non-reproducible API
  shared-state flake; both files passed immediately in isolation (48/48 and
  42/42), and the wrapper's exact serial API command then passed 3,779/3,779.
- Isolated live parity: 14/14 feeds match (previously 11/14).
- Sandbox removed; no test-port listeners remain.

## Next step

Review the local commit, then push/open a draft PR only if explicitly requested.

## Recent coding-agent runs

### 2026-07-30 — issue #1279 All Sessions visibility follow-up

- Branch: `codex/fix-1279-unscoped-session-visibility`.
- Files modified: mobile ownership repository, #1279 acceptance/live tests,
  acceptance contract, and run log.
- Checks run: acceptance red 9 passed / 2 failed, green 11/11; related mobile
  security 52/52; api_server typecheck/build; issue gate 4/4; isolated live
  gateway 1/1. Full PR gate passed every stage through mobile fake-server
  self-test, then reproduced the known active `issue-1237-c5` E2E failure.
- Decision: keep exact owner matching and exact matching for non-empty project
  IDs; only `NULL`/empty project IDs are unrestricted.
- Deviations from spec: none.

### 2026-07-30 — issue #1279 mobile session claim fallback

- Files modified: webhook response/gateway origin wiring, MSP-006 parity
  normalization, three-criterion acceptance coverage, inventory, and run docs.
- Checks run: contract red→green, webhook regression, API build and full suite,
  mobile static/Jest, complete repo PR stages, isolated 14-feed live parity.
- Decisions made: callback URLs resolve to the primary API listener; MCP parity
  ignores desktop-only enrichment; provider-auth arrays sort by non-secret
  identity before placeholder alignment.
- Deviations from spec: none.
- Concerns: repo-wide issue checks retain a pre-existing unrelated
  `apps/mcp_server` TypeScript-runner failure; see
  `docs/ai/runs/2026-07-30-issue-1279-mobile-session-claim-gap.md`.

### 2026-07-30 — issue #1280 physical-device composer height regression

- Files modified: mobile composer, composer Jest coverage, #1280 native-boundary
  contract, acceptance contract, and run log.
- Checks run: red contract 0/2 then green 2/2; composer 4/4; full Jest 6/6;
  typecheck, lint, 19-command static suite, and 1,634-module iOS export pass.
- Decisions made: remove the fixed-height/event feedback loop and let the core
  native multiline input measure intrinsically within 24–132pt bounds.
- Deviations from spec: physical-device re-verification cannot be automated in
  this environment and remains required.
- Concerns: a human must repeat the signed physical-iPhone composer smoke
  before #1280 can be called done; see
  `docs/ai/runs/2026-07-30-issue-1280-composer-device-regression.md`.
