# Project State

## Current focus

Post-merge steady state: PR #1284 (mobile reliability/parity/profile rollup,
#1277–#1287) and PR #1303 (Config Doctor remediation) are both MERGED to main
(ba00cc27, bf235979) after user-confirmed physical-device smoke. Zero open PRs.

## Active branch / PR

- Branch: `codex/mobile-fixes-rollup`
- Base: `main`
- PR: [#1284](https://github.com/ajhochy/Rhythm/pull/1284) (draft)
- Latest work: native SSE consumer over `expo/fetch`
  (`apps/mobile/lib/opencode/global-event-stream.ts`) + data-driven
  connected-status in `opencode-provider.tsx`.
- Merge remains a manual human action after review.

## In progress

- None.

## Risks / known issues

- Catalog-scoped client calls (`/session`, `/permission`, `/question` without
  the gateway prefix) 502 against the paired gateway origin whenever polling
  runs in a degraded state — pre-existing path mismatch newly visible now that
  polling correctly runs while the stream is unproven. Note on #1287.
- Exact-owner projectless server-side filter from `cdd0bb465` remains in place
  and required; unchanged by this fix.
- User-owned `.proof/` image modifications remain excluded from commits.

## Test status

- Mobile: typecheck PASS, lint 0 errors, jest 24/24 PASS (incl. new
  `global-event-stream` regression), fake-server self-test PASS, contract
  PASS, Playwright web E2E 71/71 PASS.
- GitNexus unstaged detect_changes: LOW (3 files / 7 symbols / 0 processes).
- Physical iPhone: desktop→mobile and mobile→desktop both live without
  refresh, full boundary diagnostics captured (see run log
  2026-08-01-issue-1287-native-sse-stream.md).

## Next step

Follow-ups tracked on issue #1287: desktop persisting profile bindings onto
agent_sessions rows; decision on cleaning pre-fix corrupted profile rows;
cold-start first-open latency budget; device-tier test gap for scope-flip
cache lifecycles.
