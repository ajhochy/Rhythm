---
date: 2026-07-25
repo: Rhythm
branch: codex/mobile-1170-streaming
pr: null
issues: [1170]
status: verified-pending-independent-review
tags: [run, Rhythm, mobile, realtime, sse, websocket]
index: "[[Rhythm]]"
---

# Issue #1170 — mobile realtime proxy corrective verification

## Files

- `apps/api_server/src/services/mobile_sse_proxy.ts`
  - Treats frame, retained-buffer, and downstream-backpressure limits as fatal
    stream conditions.
  - Emits a bounded `gateway.error` frame when the downstream response can
    still accept it, then aborts upstream and releases retained state without
    reconnecting.
  - Converts a downstream drain deadline into fatal `STREAM_BACKPRESSURE`
    unless the response is already closed or the stream already aborted.
  - Recognizes the engine's real `session.*` event identity shape at
    `properties.info.id`.
- `apps/api_server/src/services/ws_gateway.ts`
  - Restricts legacy `/ws/agents` and `/ws/pty/:id` upgrades to actual
    loopback socket peers; `Host` and `X-Forwarded-For` are not trusted.
- `apps/api_server/src/__tests__/issue_1170_mobile_realtime_proxy.test.ts`
  - Adds fail-first contracts for both SSE frame and buffer overflow,
    stalled downstream drainage, one-attempt cleanup, bounded downstream
    diagnostics, real loopback versus non-loopback upgrade behavior, and the
    real session event shape.
- `apps/api_server/src/__tests__/issue_1170_mobile_realtime_proxy_live.test.ts`
  - Adds real session-scoped `session.updated` observation and engine-to-client
    PTY close propagation to the existing global SSE, text/binary PTY, and
    revoked-device checks.
- `docs/ai/contracts/issue-1170.json`
  - Records strengthened c3/c4 evidence; c6 remains pending independent review.
- `.agent-stack/postmortems/2026-07-25-issue-1170.json` and
  `.agent-stack/failure-patterns.md`
  - Record the passing smoke and two non-product sandbox process issues.

## Checks

### Red regressions

- `npx vitest run src/__tests__/issue_1170_mobile_realtime_proxy.test.ts --reporter=verbose`
  - Initial corrective run: 2 failed, 6 passed.
  - Fatal SSE overflow timed out because the proxy reconnected instead of
    terminating; a real non-loopback legacy WebSocket opened without auth.
- `npx vitest run src/__tests__/issue_1170_mobile_realtime_proxy.test.ts -t 'session-scoped SSE accepts' --reporter=verbose`
  - 1 failed, 8 skipped.
  - The synthetic filter did not recognize real `session.updated`
    `properties.info.id`.
- `npx vitest run src/__tests__/issue_1170_mobile_realtime_proxy.test.ts -t 'stalled downstream drain' --reporter=verbose`
  - 1 failed, 9 skipped.
  - After `response.write()` returned false and no drain arrived, the proxy
    waited five seconds and made a second upstream request instead of
    terminating with `STREAM_BACKPRESSURE`.

### Focused and build

- `npx vitest run src/__tests__/issue_1170_mobile_realtime_proxy.test.ts --reporter=verbose`
  - PASS: 1 file, 10 tests.
  - Covers both `UPSTREAM_STREAM_TOO_LARGE` and
    `UPSTREAM_EVENT_TOO_LARGE`; each makes one upstream request, aborts it,
    emits the safe error code, ends the response, and removes listeners.
  - Also covers a five-second stalled drain with fake time: one fetch, bounded
    completion, exactly one bounded `gateway.error`, `STREAM_BACKPRESSURE`,
    upstream abort, one response end, and zero close/drain listeners or timers.
- `npm run build`
  - PASS: TypeScript build and postbuild advisory copy.

### Real isolated sandbox

- First `tools/dev/sandbox.sh up` attempt on `/tmp/rhythm-dev-sandbox-issue-1170-corrective`,
  API `:5298`, engine `:5297`
  - Setup failure: `preload not found "@opentui/solid/preload"` because this
    worktree had no ignored fork dependencies.
- `cd apps/opencode_fork && bun install --no-save`
  - PASS; populated ignored dependencies. The one generated lockfile line was
    restored before commit.
- Repeated `tools/dev/sandbox.sh up` with the same isolated directory/ports
  under a retained guardian PTY
  - PASS: rebuilt fork binary
    `0.0.0-codex/mobile-1170-streaming-202607250929`, rebuilt API, `/health`
    healthy, `/opencode/health` ready.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:5298 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:5297 RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox-issue-1170-corrective/rhythm.db RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-issue-1170-corrective npx vitest run src/__tests__/issue_1170_mobile_realtime_proxy_live.test.ts --reporter=verbose`
  - PASS: 1 file, 2 tests in 1.90 seconds.
  - Observed real global `session.created`, session-scoped `session.updated`
    with the exact updated title, PTY text and binary echoes, engine deletion
    closing the mobile WebSocket cleanly, and revoked-device 401 denial.
- `tools/dev/sandbox.sh down` with the same isolation variables
  - PASS: API/engine stopped and sandbox directory removed.

### Full API suite

- `npm test -- --maxWorkers=1`
  - Baseline failure: 1 failed, 3,248 passed, 65 skipped.
  - Only failure:
    `issue_723_mcp_remove_reconcile.test.ts` c3,
    `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` inside Vitest's VM.
  - The failing source and test are unchanged by #1170; the same defect was
    reproduced during review on the reviewed base and in isolation.
- `npx vitest run --maxWorkers=1 --exclude src/__tests__/issue_723_mcp_remove_reconcile.test.ts`
  - PASS: 373 files, 3,247 tests; 43 files and 65 tests skipped.
- Post-review repair rerun of the same clean-remainder command:
  - First aggregate run: 1 unrelated `agent_skills_routes` authorization-order
    failure, 3,247 passed, 65 skipped.
  - Isolated failing test immediately passed with the expected 201.
  - Full serialized rerun PASS: 373 files, 3,248 tests; 43 files and 65 tests
    skipped.

## GitNexus

- Pre-edit impact:
  - `MobileSseProxy.stream`: LOW, 3 upstream symbols, 0 processes.
  - `MobileSseProxy.consume`: LOW, 3 upstream symbols, 0 processes.
  - `attachWsGateway`: LOW, 0 upstream symbols/processes.
  - `MobilePtyProxy.handleUpgrade`: LOW, 0 upstream symbols/processes.
  - `collectSessionIds`: LOW, 3 upstream symbols, 0 processes.
  - `matchesSession`: LOW, 3 upstream symbols, 0 processes.
  - Post-review `MobileSseProxy.consume`: LOW, 3 upstream symbols,
    0 processes.
- `detect-changes --scope unstaged` and
  `detect-changes --scope compare --base-ref bfd4b95c4271500967a2dab665494a41bc2ed561`
  - LOW: 9 files, 19 mapped symbols, 0 affected processes.
- `detect-changes --scope compare --base-ref main`
  - CRITICAL: 457 files, 2,376 mapped symbols, 16 affected processes.
  - This is the inherited cumulative mobile/coordinator delta already present
    on the reviewed #1169 base, not the corrective #1170 slice.
- Post-review repair `detect-changes` after refreshing the stale worktree index:
  - LOW: 5 files, 12 graph-mapped symbols, 0 affected processes.
  - Compare-main remains inherited CRITICAL: 460 files, 2,392 symbols,
    16 affected processes.

## Notes

- No installed-app or concurrent-run server/database was used. The foreign
  `:4098/:4097` sandbox and installed `:4001/:4096` stack were untouched.
- The stalled-drain repair did not start or contact a live API/engine because
  #1172 owned the active sandbox ports; the dispatch explicitly limited this
  round to branch-local contracts, build, and the clean API remainder.
- The direct legacy WebSocket boundary is pinned to `socket.remoteAddress`.
  A Tailscale Serve reverse proxy may itself be the loopback peer, so #1171
  must restrict the published path surface; headers cannot safely recover the
  original trust boundary.
- c6 intentionally remains pending until an independent agent reviews this
  corrective diff and the final GitNexus detect-changes output.
