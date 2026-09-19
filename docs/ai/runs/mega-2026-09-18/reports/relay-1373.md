## Summary

Implemented the small #1373 kill-switch gap. `EXPO_PUBLIC_RHYTHM_RELAY_DISABLED=1` in a mobile build selects the saved direct pairing, blocks relay discovery/adoption, and preserves credentials and metadata. Relay-only grants fail closed with recovery guidance. #1373 remains partial. Changes are uncommitted on `mega/ws-1373-relay`, base `648f8d5885b1767bcb53a95c7e8aa7eadce2c5f2`.

## Files changed

- `apps/mobile/lib/pairing/paired-host-store.ts` — relay switch, direct fallback, safe failure, preserved pairing.
- `apps/mobile/tests/paired-host.test.mjs` — regression proving fallback, storage preservation, blocked discovery, and re-enable.
- `apps/mobile/tests/e2e/issue-1373-relay-kill-switch.spec.mjs` — rendered Settings/direct-transport test for the orchestrator.
- `apps/mobile/README.md` — flag semantics and rendered-test command.
- `docs/ai/runs/2026-09-18-issue-1373-relay-triage.md` — evidence and source threat review.
- `REPORT.md` — acceptance matrix and handoff.

## Checks run

Mobile commands ran in `apps/mobile`; Git commands ran at the worktree root.

| Exact command | Result / output tail |
| --- | --- |
| `node --test tests/paired-host.test.mjs` before implementation | Expected FAIL: `pass 1`, `fail 1`; disabled snapshot still exposed the relay. |
| `npm run typecheck && npm run lint && node --test tests/paired-host.test.mjs tests/contract/ios-account-connect.test.mjs && node --check tests/e2e/issue-1373-relay-kill-switch.spec.mjs` | PASS, exit 0: `tsc --noEmit`; lint `0 errors, 3 warnings` in unchanged files; `pass 10`, `fail 0`; spec syntax valid. |
| `npx --no-install jest --runInBand tests/relay-transport-contract.test.ts tests/relay-offline-contract.test.ts && node --test tests/transport-clients.test.mjs` | PASS, exit 0: `2 passed` suites, `15 passed` tests; `All transport-clients tests passed` (30 assertions). |
| `git diff --check` | PASS, exit 0, no output. |
| `gitnexus detect-changes --scope unstaged --repo Rhythm --limit 15` | PASS, exit 0: `Risk level: medium`; pairing flow only. Older indexed line mappings checked against the actual diff. |

Pre-edit upstream impacts: `PairedHostStore`/`snapshot` MEDIUM; remaining edited methods/functions LOW. No HIGH/CRITICAL result. Playwright and socket-binding API/live tests were not run, as instructed.

## Acceptance criteria

Classification records triage; status records this handoff. DONE means source/test coverage exists, not current production qualification. Unchanged server tests below were inspected, not rerun. Server paths are relative to `apps/api_server/src`; mobile paths to `apps/mobile`.

| Criterion | Triage class | Status and evidence |
| --- | --- | --- |
| Tailscale-free relay; unchanged SSE/PTY/prompt contract | CODE MISSING | **partial** — relay HTTP/SSE already exists (`lib/pairing/paired-host-store.ts:173`, `tests/relay-transport-contract.test.ts`). PTY still returns 501 (`routes/relay_gateway_routes.ts:419`) and uses direct `.ts.net`; the existing transport test explicitly pins this. Full relay PTY exceeds this slice. |
| Device/cloud auth boundary; invalid/expired/revoked fail closed | CODE MISSING | **partial** — Device/Bearer separation passes mobile contracts; server rejection coverage is `contract/ios_secure_bootstrap.test.ts:397`. Revocation replicates best-effort (`services/mobile_pairing_service.ts:15`); bearer validation occurs on upgrade (`services/relay_uplink_server.ts:349`). Offline verifier freshness and established-uplink expiry/revocation need policy and tests. |
| Authenticated owner/project scope and opaque IDs | DONE | **done, source coverage** — bound owner/host checks in `services/relay_uplink_server.ts:387`; artifact owner/project/session checks in `routes/relay_gateway_routes.ts:598`; positive owner and second-user/project denial in `contract/ios_secure_bootstrap.test.ts:413`. Public health and one-time-code pairing remain intentional bootstrap surfaces. |
| Idempotent disconnect recovery to the same session | DEPLOY/DEVICE | **partial** — outbox replay/idempotency tests at `__tests__/relay_repl_contract.test.ts:472,529`; resync closes SSE for refresh (`routes/relay_gateway_routes.ts:239`). Physical LTE relay-drop/same-session proof remains required. |
| Explicit switch and paired fallback without data loss | CODE MISSING | **done, socket-free coverage** — new flag at `lib/pairing/paired-host-store.ts:166`; regression at `tests/paired-host.test.mjs:1146` proves direct routing and unchanged token/metadata. Requires a rebuilt app; no direct address means actionable failure, not fabricated fallback. Rendered spec remains unrun. |
| Operator/session/relay observability with sanitized failures | CODE MISSING | **not done** — health has relay presence, but raw exception logging remains at `services/relay_uplink_client.ts:190,264` and `services/relay_uplink_server.ts:501`; filesystem errors can contain host paths. Correlated sanitized diagnostics need implementation/tests. |
| Threat review and second-user/project denial test | DONE | **done, source review** — reviewed credential separation, enrollment, ownership, offline reads, revocation, and logs; findings are above. Existing negative test `contract/ios_secure_bootstrap.test.ts:413` denies both a foreign device and foreign project; `:436` proves distinct users. No duplicate test added. |

## Decisions

- Kept `.ts.net` direct validation plus the existing exact relay allowlist; rejected broad HTTPS acceptance.
- Added an explicit build-time mobile switch; rejected pretending an uplink/server flag also changes a saved phone route.
- Preserved relay-only grants with an actionable failure; rejected erasing credentials or inventing a direct endpoint.
- Kept production code/test changes to 141 added/removed lines; deferred PTY, credential-freshness, and observability work requiring broader coverage.

## Follow-ups

- Orchestrator: run `EXPO_PUBLIC_RHYTHM_RELAY_DISABLED=1 npx playwright test tests/e2e/issue-1373-relay-kill-switch.spec.mjs` from `apps/mobile`, then the existing default-mode pairing suite and API relay/security/live suites in the authorized sandbox.
- Code: relay PTY, bounded revocation/expiry freshness, and sanitized operator/session diagnostics. Keep #1373 open.
- Orchestrator owns aggregate project-state and Dev Dashboard publication; this worker did not leave its worktree or post externally.

## Needs a human

- Verify the deployed NAS/API/relay revision and canonical relay URL; deploy matching artifacts if needed.
- Sign/install mobile builds and test on a physical iPhone: LTE with Tailscale off, existing-session prompt/SSE, relay drop/recovery without duplicates, then relay-disabled direct fallback with Tailscale enabled.
