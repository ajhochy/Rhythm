---
date: 2026-08-01
repo: Rhythm
branch: codex/mobile-fixes-rollup
pr: 1284
issues: [1285, 1287]
status: fix-verified-on-device
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #1287 — native SSE transport was the real desktop→mobile root cause

## Root cause

Boundary tracing on the physical iPhone (temporary `[i1287]` Metro diagnostics
at every client boundary) proved the desktop-authored event never reached the
mobile subscription loop at all — not even `server.connected` or heartbeats
arrived in 90+ seconds while the raw engine and authenticated gateway were
verifiably emitting. React Native's XHR-backed `fetch` only resolves when a
response completes, so the generated SDK's SSE reader
(`response.body.pipeThrough(...)`) hangs forever on an infinite
`text/event-stream` with no data and no error. Web (Playwright) streams fine,
which is why every prior server-side and web E2E check passed while the
device failed — the prior c21 contract tested the wrong boundary (C2).

A second defect compounded it: the provider set `eventStreamStatus` to
`connected` immediately after creating the (lazy) SDK subscription, before any
byte arrived. That disabled the 5-second polling fallback, freezing every chat
on device — including mobile-authored assistant streaming, matching the user's
follow-up report.

## Fix (commit on PR #1284)

- New `apps/mobile/lib/opencode/global-event-stream.ts`: SSE consumer over
  `expo/fetch` (WinterCG streaming) with paired-gateway
  (`/mobile-gateway/events`, device-token via `PairedMacClient.fetchResponse`)
  and direct (`/global/event`) variants.
- `apps/mobile/lib/opencode/client.ts`: `buildGlobalEventStreamRequest()` for
  the direct-connection URL/basic-auth headers.
- `apps/mobile/providers/opencode-provider.tsx`: native platforms use the new
  consumer; web keeps the SDK path. `eventStreamStatus` becomes `connected`
  only after an envelope is actually received, so a silent stream can never
  stand down the polling safety net again.
- `apps/mobile/docs/architecture.md`: realtime section updated.
- Client-inclusive regression `apps/mobile/tests/global-event-stream.test.ts`
  (jest, 5 tests): gateway-shaped frame parsing incl. split chunks and
  pseudonymized projectless directory, no-body regression, non-2xx, abort,
  header/URL contract.

## Checks run

- `npm run typecheck` — PASS. `npm run lint` — 0 errors (pre-existing warnings).
- `npx jest` — 10 suites / 24 tests PASS (includes new regression).
- `npm run test:fake-server:self`, `test:format`, `test:contract` — PASS.
- `npm run test:e2e:web` — 71/71 PASS.
- GitNexus: `refreshMessages` upstream impact HIGH (17 direct callers, all in
  Providers module — additive change); `detect_changes` unstaged LOW
  (3 files, 7 symbols, 0 affected processes).
- Physical iPhone 13 mini (dev client + Metro): with the projectless
  "All Sessions" chat open, Metro diagnostics showed the full chain for a
  desktop-authored turn — gateway envelope received on device
  (`message.updated`/`message.part.updated`/deltas, pseudonymized directory
  matching `activeProjectPath`) → `scheduleSessionRefresh` fired →
  `refreshMessages` committed. User confirmed BOTH directions live, no
  refresh ("both worked!").

## Notes

- The catalog-scoped client 502 noise (`/session`, `/permission`, `/question`
  on the gateway origin) appears only while the React tree is crashed or the
  paired scope is lost; the polling loop surfaces it now that polling actually
  runs when the stream is unproven. Pre-existing path mismatch; tracked as a
  note on #1287, not a regression of this change.
- The earlier server-side directory canonicalization fix (`cdd0bb465`) was a
  real discrepancy and remains required; it was necessary but not sufficient.
