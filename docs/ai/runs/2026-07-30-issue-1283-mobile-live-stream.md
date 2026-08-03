---
date: 2026-07-30
repo: Rhythm
branch: codex/fix-1283-mobile-live-stream
pr: null
issues: [1283]
status: verified
tags: [run, Rhythm]
---

# Issue #1283 — desktop-to-mobile live transcript stream

## Files

- `apps/api_server/src/__tests__/issue_1283_mobile_desktop_live_stream.test.ts`
  — env-gated real API + fork contract. It connects mobile SSE first, creates
  a desktop session afterward, removes its explicit claim to model the #1279
  fallback state, proves pull-refresh visibility, sends a real no-reply
  desktop transcript part, and requires that marker on the already-open stream.
- `docs/ai/contracts/issue-1283.json` — one passing live-delivery criterion.
- `docs/ai/project-state.md` — coding-agent run summary.

## Checks

- Corrective-security baseline:
  `npx vitest run src/contract/issue_1175_corrective_security.test.ts --no-file-parallelism`
  — PASS, 3/3 after rerunning with localhost-bind permission. The restricted
  attempt failed only with `listen EPERM`.
- Fresh fork build: `bun run build --single` — PASS; binary smoke reported the
  branch build version.
- API build: `npm run build` — PASS before live execution and again at the
  final gate.
- Initial untouched-base live reproduction — PASS, 1/1. This established that
  #1279 already repaired #1283 on the requested base.
- Controlled red falsification: temporarily changed only the SSE event owner
  gate to require an explicit claim, rebuilt both services, and ran the live
  contract — expected FAIL, 1/1, after a 15-second transcript-marker timeout.
  Pull-refresh had already passed in that same test, isolating realtime push.
  The temporary source change was then fully restored.
- Final restored live contract:
  `RHYTHM_LIVE_E2E=1 ... npx vitest run src/__tests__/issue_1283_mobile_desktop_live_stream.test.ts --no-file-parallelism`
  — PASS, 1/1; the `message.part.updated` marker arrived in 3.70 seconds.
- #1279 live owner/project guard:
  `RHYTHM_LIVE_E2E=1 ... npx vitest run src/__tests__/issue_1279_mobile_gateway_live.test.ts --no-file-parallelism`
  — PASS, 1/1.
- Focused security/ownership/realtime set — PASS, 20 passed / 1 env-gated
  test skipped across four files.
- `npx tsc -p tsconfig.json --noEmit` — PASS.
- `ai-workflow checks --level issue` — PARTIAL: Flutter analyze, Flutter
  format, and api_server TypeScript passed; the unrelated `apps/mcp_server`
  step failed because that package has no local TypeScript compiler and
  `npx tsc` resolves the placeholder package (same pre-existing gate failure
  recorded by #1279).
- Scoped sandbox used API `:4283`, engine `:4383`, and mobile gateway `:4483`;
  final cleanup removed `/private/tmp/rhythm-dev-sandbox-1283`.

## Notes

- Root cause on the pre-#1279 behavior was the live filter's effective
  claim-table-only ownership. Commit `4a6988c3b` made
  `resourceOwnedByCaller` fall back to exact `agent_sessions.owner_user_id` +
  `project_id`, and `mobileSseEventBelongsToOwner` already calls that same
  resolver. The #1279 change therefore repaired both reads and SSE delivery.
- GitNexus confirmed
  `MobileSseProxy.consume` → `mobileSseEventBelongsToOwner` →
  `resourceOwnedByCaller`. Upstream impact was LOW: 23 impacts / 4 direct for
  the resolver and 6 impacts / 1 direct for the SSE gate.
- `/global/event` remained connected while a desktop session was created and
  delivered its later transcript event, disproving the frozen-subscription
  hypothesis.
- No production source change was needed or retained. No production port,
  production database, push, PR, or merge was used.
