---
date: 2026-09-18
repo: Rhythm
branch: mega/ws-1373-relay
pr: null
issues: [1373]
status: partial
tags: [run, Rhythm]
---

## Files

- `apps/mobile/lib/pairing/paired-host-store.ts`: build-time `EXPO_PUBLIC_RHYTHM_RELAY_DISABLED=1` selects the saved direct gateway, suppresses relay discovery/adoption and provider mirror mode, and preserves credentials/metadata. Relay-only grants fail closed with recovery guidance.
- `apps/mobile/tests/paired-host.test.mjs`: fallback, preserved storage, blocked discovery, legacy adoption suppression, relay-only denial, and re-enable regression.
- `apps/mobile/tests/e2e/issue-1373-relay-kill-switch.spec.mjs`: rendered Settings/direct-transport contract, written but not run.
- `apps/mobile/README.md`: build-time switch and validation commands. Full acceptance matrix and threat-review findings: `REPORT.md`.

## Checks

- Base: `648f8d5885b1767bcb53a95c7e8aa7eadce2c5f2`; branch and write probe matched the brief. No commits.
- In `apps/mobile`, before implementation: `node --test tests/paired-host.test.mjs` — expected FAIL, 1 passed/1 failed; disabled snapshot still exposed `https://api.vcrcapps.com/relay` instead of null.
- In `apps/mobile`, final: `npm run typecheck && npm run lint && node --test tests/paired-host.test.mjs tests/contract/ios-account-connect.test.mjs && node --check tests/e2e/issue-1373-relay-kill-switch.spec.mjs` — exit 0; 10 passed/0 failed; lint 0 errors/3 warnings in unchanged files.
- In `apps/mobile`: `npx --no-install jest --runInBand tests/relay-transport-contract.test.ts tests/relay-offline-contract.test.ts && node --test tests/transport-clients.test.mjs` — exit 0; Jest 2 suites/15 tests passed; all 30 transport assertions passed.
- `git diff --check` — exit 0. Pre-edit GitNexus impacts: class/snapshot MEDIUM, other edited methods/functions LOW; `gitnexus detect-changes --scope unstaged --repo Rhythm --limit 15` — exit 0, MEDIUM, pairing flow. Indexed line mappings are older than this checkout; direct diff confirms scope. Untracked spec checked separately with `node --check`.

## Notes

- No socket listeners, sandbox, app launches, production calls, deploy config, secrets, dependency installs, commits, or other-worktree edits. Worker restrictions override launch/commit/tracker defaults; the orchestrator owns dashboard publication and broader project-state integration.
- Existing strict `safeRelayUrl` and cloud bootstrap already provide a first-class relay alternative; do not broaden `safeGatewayUrl` to arbitrary HTTPS hosts.
- Existing second-user/project denial is in `apps/api_server/src/contract/ios_secure_bootstrap.test.ts:413` and distinct-principal proof at `:436`; these socket-binding API suites were not rerun.
- Source threat review: Device auth and explicit owner/project/session checks remain; bootstrap/uplink legitimately use operator cloud bearers. Unresolved lifecycle risks: best-effort revocation snapshot replication and upgrade-only bearer validation. Raw relay exception logging can expose filesystem paths. These are code follow-ups, not deployment tasks.
- #1373 remains partial: relay PTY intentionally returns 501, observability and credential freshness need work, and exact-device LTE/drop/recovery/fallback acceptance remains outstanding. The new switch requires a rebuilt mobile bundle; it is not an instant remote operational switch.
