---
date: 2026-08-19
repo: Rhythm
branch: codex/mega-c-relay-mobile
pr: null
issues: [1380, 1446, 1379]
status: ready_for_verification
tags: [run, Rhythm]
---

## Contract

- Contract: `docs/ai/contracts/issue-1380-1446-1379.json`.
- Failing run before implementation: `npm run test:app-config; npx jest --runInBand tests/relay-offline-contract.test.ts tests/session-refresh-pinning.test.ts` failed with missing `usesNonExemptEncryption` and missing `PairedMacClient.prewarm` (2 failed, 8 passed).
- Additional failing proof: `node --test tests/contract/msp-004-atomic-open-session.test.mjs` failed `15000 !== 40000` (11 passed, 1 failed).
- Relay 504 contract initially could not start because this fresh worktree lacked api_server dependencies; after `npm install`, it passed against the implementation.

## Files

- `apps/mobile/app.config.ts`, `apps/mobile/README.md`: export-compliance declaration and release note.
- `apps/mobile/lib/transport/paired-mac-client.ts`: calm, retry-aware health prewarm.
- `apps/mobile/providers/opencode-provider.tsx`: launch prewarm, guarded background reads, and immediate SSE consumption.
- `apps/mobile/providers/open-project-session.ts`: 40-second first-open budget.
- `apps/api_server/src/services/relay_uplink_client.ts`: transient dispatch classification changed from 502 to 504.
- Focused mobile/API contract tests and this contract/run evidence.

## Checks

- `npm install` in `apps/mobile` and `apps/api_server`: completed; lockfiles unchanged.
- Acceptance command components: app config passed; focused Jest 10/10 passed; atomic-open 12/12 passed; relay uplink Vitest 9/9 passed.
- Production Expo introspection printed `ITSAppUsesNonExemptEncryption=false`.
- `npx tsc --noEmit` in both mobile and api_server: exit 0.
- `npm run lint`: exit 0 with 3 pre-existing warnings and 0 errors.
- `npm test -- --runInBand`: final 26 suites, 95/95 tests passed. Project-state baseline recorded 61/61 before this branch's later test additions.
- `npm run test:ci:static`: exit 0; all 19 chained stages passed. Baseline in project-state was also exit 0.
- `npx vitest run src/__tests__/relay_uplink_client_contract.test.ts`: 9/9 passed.
- `git diff --check`: passed.
- GitNexus pre-edit impact lookup could not resolve the recently added mobile/relay symbols (stale index); final `detect_changes(scope=all)` reported LOW risk, 11 changed files, no affected indexed processes.
- Device/TestFlight criteria were not run; the dispatch forbade the singleton sandbox and no physical release artifact was available.

## Notes

- Encryption review: production traffic is standard HTTPS/TLS; Google auth uses library-provided PKCE plus `expo-crypto` random UUID nonces; message IDs use random bytes; credentials use OS SecureStore. No custom cipher, encryption/decryption implementation, or proprietary algorithm was found, so the exemption is accurate.
- `MacOfflineError` producers: (1) `executeRequest` normalizes 503 `mac_offline*` responses for direct `PairedMacClient.request`; (2) `createMobileGatewayFetch` normalizes the same responses for generated SDK reads. Explicit mobile-gateway create/profile writes remain wrapped by `trackMacOffline` and are awaited by UI code with catches. Health/presence polling catches failures. Post-prompt polling, event-triggered reads, initial stream hydration, coalesced refreshes, and safety polling now all route through `settleBackgroundRead`, which updates offline presence and consumes the rejection.
- Latency diagnosis: `streamPairedGlobalEvents` is an async generator, so constructing it does not issue the fetch. The subscriber awaited five relay reads before the first `for await`, delaying the SSE connection and therefore the phone's own echo. The reads now run guarded in the background while iteration starts immediately. This is a clear low-risk in-scope fix; device timing remains required.
- Session pinning proof: the contract records every prewarm URL and asserts the sole call is `/mobile-gateway/health`, with no `/session` request. Existing exact-session pinning tests and the full 95-test Jest suite pass.
- Device smoke required: install a fresh production build on a physical iPhone; cold-launch off Tailscale through `api.vcrcapps.com`; record launch-to-first-transcript timing and confirm one visible open within 40 seconds; send a prompt and record desktop/phone echo plus first-token times; briefly interrupt/recover the Mac uplink and confirm no uncaught `MacOfflineError`; verify the exact requested session remains selected. Then upload the same build to TestFlight, inspect its archive Info.plist, and confirm App Store Connect reaches **Ready to Test** without the encryption prompt.

## Bucket C final-verification repair attempt 1 (2026-08-20)

- Failing acceptance proof before repair: `npm run test:transport-clients` failed with `ERR_UNSUPPORTED_RESOLVE_REQUEST` for the aliased `@/lib/opencode/cold-start-retry` import.
- Repair A: changed only that import to the transport directory's relative `../opencode/cold-start-retry` convention; the harness matcher was not broadened and the helper was not inlined.
- Repair B: `PairedMacClient.healthResponse()` now owns the retry-aware health fetch, `prewarm()` remains a calm boolean wrapper, and the coalesced `requestRelayPresence()` consumes the final response. The separate prewarm effect was removed, so the immediate presence read is the sole warmup. Existing provider test doubles were updated only to expose the same response boundary.
- `node .gitnexus/run.cjs analyze` was unavailable because this worktree has no `.gitnexus/run.cjs`; documented fallback `npx gitnexus analyze` indexed HEAD. Compatible CLI impacts: `PairedMacClient` HIGH (15 direct/72 total, one pairing flow), `prewarm` LOW (1 direct), `OpencodeProvider` MEDIUM (5 direct/6 total), `requestRelayPresence` LOW (3 direct/10 total). Runtime was treated as MEDIUM.
- Final checks in `apps/mobile`: `npm run test:transport-clients` passed 30/30; focused Jest passed 10/10; automatic-reconnect Playwright passed 1/1 after confirming ports 44196/19106 free; an evidence-only rerun observed exactly 3 recovery health probes and its temporary log line was removed; `npm run verify:foundation` passed including Playwright 71/71; `npm run test:ci:static` passed; full Jest passed 95/95; `npx tsc --noEmit` passed; `npm run lint` passed with 0 errors and the same 3 warnings.
- The automatic-reconnect `toBeLessThanOrEqual(3)` assertion is unchanged. Prewarm remains health-only and contacts no session route. Verification-generated `.proof` screenshots and GitNexus count-block drift were restored.
- Contract wording remains current; `docs/ai/contracts/issue-1380-1446-1379.json` was not changed.
