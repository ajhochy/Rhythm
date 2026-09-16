---
date: 2026-09-14
repo: Rhythm
branch: feature/ios-end-to-end
pr: null
issues: [ios-secure-bootstrap-b1, ios-account-connect-A1, ios-mobile-ui]
status: ready_for_verification
tags: [run, Rhythm]
---

# iOS Cloudflare bootstrap origin repair

## Files

- Relay bootstrap grants now use validated server-controlled
  `RHYTHM_RELAY_PUBLIC_URL`, never `Host`, `X-Forwarded-*`, or request fields.
  Production accepts HTTPS only; the managed synthetic sandbox explicitly
  permits only HTTP loopback.
- Mobile treats every terminal signed-in bootstrap failure as recoverable with
  an explicit retry in Chats and Settings. It preserves transport-sanitized
  error detail and no longer falls through to manual pairing or false empty.
- Updated the live test to consume the canonical relay base through the real
  `/mobile-gateway/*` path shape. No schema, production, auth, owner, enrollment,
  Simulator, desktop, deployment, or `/Applications` changes were made.

## Checks

- Reproduction: authenticated Simulator evidence reported “invalid computer
  connection response”; source trace showed the relay built an HTTP request
  origin and `/relay/mobile-gateway` base that the shipping parser rejects.
- GitNexus pre-edit: `createRelayGatewayRouter` LOW (1 direct caller);
  `PairedHostStore` MEDIUM (9 direct, 41 total); `ChatList`, `PairedMacSection`,
  and `SettingsScreen` LOW. No HIGH/CRITICAL result.
- Exact focused API command: `npx vitest run src/contract/ios_secure_bootstrap.test.ts src/__tests__/ios_secure_bootstrap_live_e2e.test.ts src/__tests__/issue_1175_mobile_gateway_security.test.ts src/__tests__/relay_uplink_server_contract.test.ts src/__tests__/relay_mirror_reads_contract.test.ts src/__tests__/relay_artifacts_contract.test.ts src/services/__tests__/mobile_cloud_identity_service.test.ts src/__tests__/mobile_gateway_postgres_schema.test.ts` — 51 passed, 1 env-gated skip across 8 files; API build passed.
- Mobile targeted: account store 8/8; parser/UI Jest 33/33. Full static gate
  passed with 3 unchanged warnings and 0 errors; full Jest passed 31 suites,
  120 tests.
- Sandbox contracts: guard 18/18; dual-role 5/5; shell syntax passed.
- Managed live synthetic gate: after free-port preflight, `sandbox.sh` alone
  started engine `48971`, API `48972`, gateway `48973`, and relay `48974`.
  `ios_secure_bootstrap_live_e2e.test.ts` passed 1/1 with the bearer retained in
  shell memory. Scoped down removed the sandbox, released all ports, and the
  read-only source fixture hash remained unchanged.
- Environment repairs only: rebuilt local `better-sqlite3` for Node ABI 127;
  restored lock-declared fork dependencies after the first sandbox build failed
  before launch; restored sandbox-generated `apps/opencode_fork/bun.lock` drift.

## Notes

- Deployment prerequisite: set the NAS relay process
  `RHYTHM_RELAY_PUBLIC_URL=https://api.vcrcapps.com/relay` before deploying this
  code. The mobile production relay base must match exactly.
- Final Cloudflare and authenticated Simulator verification remains
  manager-owned; this run did not touch either.
