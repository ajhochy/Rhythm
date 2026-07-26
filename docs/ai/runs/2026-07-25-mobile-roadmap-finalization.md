---
date: 2026-07-25
repo: Rhythm
branch: codex/mobile-1172-agents-activity
pr: 1165
issues: [1123, 1166, 1168, 1169, 1170, 1171, 1172, 1173, 1174, 1175, 1181, 1182]
status: automated-gates-complete
tags: [run, Rhythm, mobile, ios]
index: "[[Rhythm]]"
---

# Mobile roadmap finalization

## Files

- Recovered and reconciled the aggregate mobile/gateway branch with `main`.
- Added the #1175 creative install, artifact-recording, and external-discovery
  security actions to both MCP and API registries.
- Bound creative installs to engine-authored runtime session identity and exact
  per-session approval; removed the model-controlled local Gallery path
  override.
- Replaced the rejected process-environment bearer with an engine-held
  ephemeral Ed25519 key and exact signed tool/arguments/session/turn/call
  proofs. Public-key pinning now occurs only during API-owned engine lifecycle
  transitions; request-time key rotation fails closed.
- Replaced fixed-height native header/card action containers with
  content-measured layouts for maximum Dynamic Type.
- Added focused and live regressions plus native smoke postmortems.

## Checks

- `ai-workflow checks --level issue` passed Flutter analyze/format and API/MCP
  TypeScript.
- `ai-workflow checks --level pr` passed Flutter tests, API lint/full serial
  Vitest/build, MCP Vitest/build, fork typecheck/session tests, and the mobile
  static, contract, fake-server, and web-E2E suites.
- Focused maximum-Dynamic-Type contract: 2/2 passed.
- Focused creative security/API tests: 38/38 passed.
- Focused creative security/MCP tests: 5/5 passed.
- Anti-repin verifier regression plus focused route/config tests: 11/11 passed.
- Rebuilt #1175 live matrix on API `54175` / engine `55175`: trusted signed MCP
  proof 1/1, merged tool actions 1/1, creative HTTP 1/1, gateway 1/1,
  corrective ownership/security 1/1, pairing/tool authorization 1/1, and
  adversarial human approval 3/3.
- The signed-proof live test drove a deterministic real model stream through
  the fork, MCP child, and API. It observed the exact pending approval,
  rejected direct forged HTTP, rejected replay/tampering in focused tests, and
  found no deprecated credential marker in the API/engine process tree.
- Exact plan-port sandbox on API `4098` / engine `4097`: #1166 pairing 1/1,
  #1168 auth/project traversal and containment 1/1, and #1170 real SSE/PTY 2/2.
  Installed Rhythm listeners `4001` (PID 964) and `4096` (PID 1016) retained
  the same process identities before, during, and after the run.
- Current-head #1123 async delegation/parent-wake live test: 2/2 passed,
  including the corrected no-polling wake assertion.
- Current-head #1171 desktop-to-mobile-access live test: 1/1 passed on API
  `54171`, engine `55171`, and mobile gateway `49171`.
- Health probes returned `status: ok` for the API and `status: ready` for both
  OpenCode and the dedicated mobile gateway.
- GitNexus compare-to-main: CRITICAL aggregate scope (968 files, 7,072 symbols,
  21 flows), expected for the cumulative roadmap branch. Exact working scope:
  LOW (50 files, 74 symbols, zero affected flows).
- Native development client build succeeded on the non-sensitive simulator
  model label `Rhythm-1171-iPhone-SE`, iOS 18.3, dark appearance, maximum
  Dynamic Type.
- Native Activity/Agents heading corrective smoke passed.
- Native Webhooks card corrective smoke passed; accessibility exposed Copy
  URL, Rotate secret, and Delete as reachable buttons.
- Normal Dynamic Type screenshots were captured at
  `/private/tmp/rhythm-pr1165-agents-normal.png` (83,434 bytes) and
  `/private/tmp/rhythm-pr1165-webhooks-normal.png` (104,404 bytes); both
  surfaces rendered without a blank/crash state.

### Live command evidence

The security-boundary behavioral command was:

```bash
cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:54175 \
RHYTHM_LIVE_BASE_URL=http://127.0.0.1:54175 \
RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:55175 \
RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox-pr1165-1175/rhythm.db \
RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-pr1165-1175 \
npx vitest run \
  src/__tests__/issue_1175_trusted_mcp_proof_live.test.ts \
  src/__tests__/issue_1175_new_tool_actions_live.test.ts \
  src/__tests__/creative_platform.live.test.ts \
  --no-file-parallelism
```

Observed: 3 files and 3 tests passed. The remaining rebuilt #1175 live files
were run serially with the same sandbox attestation; 6 additional assertions
passed.

The exact-port issue command was:

```bash
cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox-pr1165-exact/rhythm.db \
RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-pr1165-exact \
RHYTHM_LIVE_HUMAN_CAPABILITY=<throwaway-sandbox-capability> \
npx vitest run \
  src/__tests__/issue_1166_pairing_live.test.ts \
  src/__tests__/issue_1168_mobile_gateway_live.test.ts \
  --no-file-parallelism
```

Observed: 2 files and 2 tests passed. The same rebuilt exact-port stack then
passed #1170 (2/2) and #1123 (2/2). The human-capability value and its test key
were throwaway sandbox material and are intentionally not recorded.

## Notes

- Repair-loop summary: the first native maximum-Dynamic-Type smoke exposed
  Activity header overlap and unreachable Webhooks actions, producing follow-up
  issues #1182 and #1181. Content-measured layouts plus a focused 2/2
  regression corrected both, and the native reruns passed. A first #1123 live
  invocation was correctly refused by the isolation guard because `DB_PATH`
  was omitted; the corrected isolated command passed without a source change.
  `npm run typecheck` was also an invalid API command because that package has
  no such script; the repository's actual `npx tsc --noEmit` gate passed. No
  further follow-up issue was required.
- Independent review found two Important creative-path defects before push.
  Both were corrected and re-tested against real HTTP surfaces. Final
  in-process review also removed attacker-triggered request-time key re-pinning.
- Desktop listeners `4001` and `4096` were not touched.
- #1168/#1175-c4 is now satisfied on the exact `4098/4097` sandbox.
- The final whole-branch independent reviewer could not produce an immutable
  report because its run was blocked by the review service's security filter.
  #1175-c2 therefore remains pending even though focused independent audits and
  the final in-process security review have no unresolved Critical/Important
  finding.
- Apple signing, device registration/trust/install, physical-iPhone validation,
  production build, and TestFlight remain human release gates.
- Final aggregate verification, source/evidence commit SHAs, PR head, and CI
  results are recorded below.

## Final source freeze and PR evidence

The immutable tested source is
`8701432480f585fe90119cbaee66382d062da879`. Every later repository change is
restricted by the #1175 contract to evidence, run logs, project state,
acceptance status, roadmap status, and smoke postmortems.

GitNexus command:

```bash
node .gitnexus/run.cjs detect_changes --repo Rhythm-1172 --scope compare --base-ref main --limit 8
```

Observed: 987 files, 7,076 symbols, 21 affected flows, CRITICAL aggregate
rating, and zero unexpected flows after mapping the results to the cumulative
mobile roadmap, vendored engine, and explicitly linked issue work.

Source-freeze CI command:

```bash
gh pr checks 1165
```

Observed on the tested source:

- Type-check and build: PASS, run
  `https://github.com/ajhochy/Rhythm/actions/runs/30182223114`
- Desktop CI: PASS, run
  `https://github.com/ajhochy/Rhythm/actions/runs/30182223148`
- OpenCode Fork CI: PASS, run
  `https://github.com/ajhochy/Rhythm/actions/runs/30182223161`
- Mobile CI: PASS, runs
  `https://github.com/ajhochy/Rhythm/actions/runs/30182221711` and
  `https://github.com/ajhochy/Rhythm/actions/runs/30182223124`
- Server CI: PASS, run
  `https://github.com/ajhochy/Rhythm/actions/runs/30182223139`

Focused source-freeze accessibility command:

```bash
cd apps/mobile && npm run test:dynamic-type
```

Observed: 2/2 passed.

Final exact-port launcher and live command:

```bash
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-pr1165-final-sandbox tools/dev/sandbox.sh up && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-pr1165-final-sandbox/rhythm.db RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-pr1165-final-sandbox RHYTHM_LIVE_HUMAN_CAPABILITY=<throwaway-sandbox-capability> npx vitest run src/__tests__/issue_1166_pairing_live.test.ts src/__tests__/issue_1168_mobile_gateway_live.test.ts --no-file-parallelism
```

Observed: #1166 and #1168 passed 2/2. A separate
`issue_1170_mobile_realtime_proxy_live.test.ts` invocation passed 2/2. Installed
listeners `4001` and `4096` retained PIDs `964` and `1016` before and after.
The first command-cell attempt was invalid because the automation host reaped
the background sandbox after the launcher returned; the corrected foreground
lifecycle passed without a source change. The failed/pass postmortems are
committed, and non-blocking follow-up #1186 tracks a foreground launcher mode.

The remaining commands are deliberately human-gated:

Human gate: independently review git diff main...8701432480f585fe90119cbaee66382d062da879 and commit an immutable report with no unresolved Critical or Important findings.

Human gate: run the signed physical-iPhone matrix in docs/testing/manual-smoke.md without recording a device UDID.

Human gate: run npm run eas:production:ios and npm run eas:submit:ios through secure Apple/EAS credential tooling, recording only build/submission IDs and artifact hashes.

Durable evidence is in `docs/ai/evidence/issue-1175-release.json`; its committed
logs record SHA-256 hashes. #1175 criteria c1, c3, c4, c7–c31 are automated and
green. Criteria c2 (immutable independent review), c5 (signed physical device),
and c6 (production/TestFlight) remain pending by design.

### CI repair loop

The PR repair loop corrected five branch integration defects before the source
freeze: a frozen Bun lock mismatch, stale generated scheduler SDK types, Node
24 EventEmitter typing, mobile contract drift, and cross-platform OpenAPI
ordering. The final Mobile CI failure then exposed a stale pinned pairing
fingerprint after contract canonicalization plus one ambiguous Playwright
locator. The fingerprint is now contract-tested against the generated
manifest, the Cookbook assertion targets the deleted list item, and all 17
affected E2E cases plus both complete Mobile CI runs pass.
