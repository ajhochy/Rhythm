---
date: 2026-07-25
repo: Rhythm
branch: codex/1173-mobile-tools-corrective
pr: null
issues: [1172, 1173]
status: complete
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

## Files changed

- `apps/mobile/app/tools/[tool].tsx`: completed Brain, Scheduled Jobs,
  Profiles, Cookbook, Skills, Playbooks, Webhooks, MCP, and provider lifecycle
  UI, including truthful error/status feedback and selected-record display.
- `apps/mobile/providers/` and `apps/mobile/components/agents/`: added
  account-isolated tool caches, webhook rotation, and supported Activity tool
  deep links.
- `apps/api_server/src/{routes,controllers,repositories}/`: added owner-scoped
  webhook-secret rotation with absolute receive URLs and honest queued schedule
  status.
- `apps/mobile/tests/` and `apps/api_server/src/__tests__/`: added corrective
  cache, browser, gateway, schedule, webhook, and guarded live contracts.
- `docs/ai/contracts/issue-1172.json` and
  `docs/ai/contracts/issue-1173.json`: added and completed corrective criteria.

## Checks run

- `ai-workflow checks --level pr` passed the complete Flutter, API, MCP,
  OpenCode fork, mobile static/contract, fake-server, and 46-test browser
  matrix on the corrected source state.
- `dart format . --set-exit-if-changed` changed zero Flutter files.
- `flutter analyze --no-fatal-infos` exited 0 with 272 pre-existing infos.
- Mobile lint, TypeScript, contracts, fake-server self-test, and browser suites
  passed. The final warning corrective rerun passed:
  - `node --test --experimental-strip-types tests/issue-1173-corrective.test.mjs`
    — 2/2.
  - `npm run typecheck` — pass.
  - `PLAYWRIGHT_FAKE_PORT=44373 PLAYWRIGHT_WEB_PORT=19373 npx playwright test tests/e2e/issue-1172-tool-deep-links.spec.mjs tests/e2e/issue-1173-corrective.spec.mjs`
    — 8/8 on a freshly rebuilt web bundle.
- API build passed; the focused gateway/webhook/schedule slice passed 9/9.
- GitNexus `detect_changes --scope all` classified the corrective delta LOW
  risk: 20 indexed files, 51 symbols, and zero affected execution flows.
  The required compare-to-`main` view is CRITICAL (654 files, 3,601 symbols,
  24 flows) because the worktree intentionally starts from the cumulative
  mobile integration base; that aggregate risk remains explicitly tracked in
  `docs/ai/project-state.md`.
- The guarded live test passed 1/1 against unique sandbox ports 54773/54774:

  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:54773 RHYTHM_LIVE_DB_PATH=/tmp/rhythm-1173-mobile-tools-live.PhpvyR/rhythm.db RHYTHM_SANDBOX_DIR=/tmp/rhythm-1173-mobile-tools-live.PhpvyR DB_PATH=/tmp/rhythm-1173-mobile-tools-live.PhpvyR/rhythm.db npx vitest run src/__tests__/live_e2e_1173_mobile_tools_corrective.test.ts --no-file-parallelism`

  It proved cross-owner rotation returns 404, owner rotation returns a new
  one-time secret, the old HMAC returns 401, the new HMAC is accepted, detail
  responses remain redacted, and cleanup leaves zero temporary users or
  webhook rows.
- `npm run verify:production-bundle` stopped before export because release-only
  Google mobile OAuth environment values are not present. Production
  signing/notarization/distribution is explicitly deferred from this prototype
  corrective; no placeholder credentials were substituted.

## Notes

- Failure triage repaired missing worktree-native dependencies, an
  order-dependent notification test flake, duplicate modal notices caused by
  React Native Paper exit animation, and the sandbox launcher being reaped by
  the execution harness.
- A native dev-client check then exposed
  `Invalid prop 'index' supplied to React.Fragment` on Webhooks. The `Card`
  now receives `Divider` and `Card.Actions` as direct children instead of a
  Fragment; the focused source regression and rebuilt 8/8 browser lifecycle
  suite pass.
- The in-app browser connector reported no available browser instance after
  required troubleshooting. No connector-manual result is claimed; the
  user-equivalent Playwright lifecycle suite and separate native dev-client
  observation are recorded instead.
- Test-value falsification:
  - Replacing the cache scope with a constant fails the distinct account-key
    assertions.
  - Removing save/toggle/delete/OAuth/selected-target wiring fails exact
    visible-state browser assertions.
  - Relaxing owner scope, secret replacement, old-HMAC invalidation, or
    redaction fails the guarded live HTTP test.
  - Reintroducing the conditional Fragment under `Card` fails the focused
    native-warning render-shape contract.
- No follow-up issue was filed; all product and harness failures were corrected
  in this run. Release credential/signing work remains with the aggregate
  distribution workflow.
