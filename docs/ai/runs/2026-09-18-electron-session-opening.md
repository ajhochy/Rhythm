---
date: 2026-09-18
repo: Rhythm
branch: codex/electron-session-opening
pr: null
issues: []
status: partial
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Exact-session opening in source Electron

## Files changed

- `apps/web/src/agentSessionLink.ts` validates one local session ID on `/agents`.
- `apps/web/src/store.tsx` consumes that link after hydration and on hash changes,
  fetches the exact detail outside the first page, sets the matching scope, and
  prevents stale detail/reconciliation failures from clearing a newer selection.
- `apps/web/public/desktop-capabilities.json` advertises the built renderer
  contract to explicitly configured external launchers.
- Dedicated parser/rendered tests, package test routing, and an opt-in native
  Electron/real-sandbox test document and enforce the opening contract.
- Acceptance contract: `docs/ai/contracts/session-opening.json`.

## Checks run

Working base: `2350a500fe87f4acdc429be4c181997f251ce4e3` (`origin/main`).
All product edits are confined to a separate `codex/` worktree. The original
checkout's existing screenshot/source edits were preserved.

- `ai-workflow checks --level issue`: exit 0, four static checks.
- `cd apps/electron && npm test`: exit 0, 73 tests.
- `cd apps/web && npm run test:session-opening`: 13 tests, including rendered
  exact heading/transcript, a known-working rail-click control, local-vs-SDK ID,
  delayed hydration, hash-only updates, stale errors, invalid/missing targets,
  scheduled scope, archived-without-unarchive, and capability metadata.
- Falsification: restoring the original store made c1 show Session A instead of
  requested B. Added c9 reproduced a late background B 404 clearing selected C;
  its exact heading assertion failed before the current-ID guard and passed after.
- `RHYTHM_LIVE_E2E=1 RHYTHM_SANDBOX_DIR=<owned-sandbox> node apps/electron/test/session-opening/live.mjs`:
  exit 0 against the rebuilt real API/engine through `tools/dev/sandbox.sh`.
  Cold startup selected the requested local ID; a second process with the same
  profile selected the other local ID and exited 0, retaining one window and the
  original main PID. Both local IDs differed from their SDK IDs. Opening sent
  zero HTTP mutations; both transcripts remained empty. Sandbox API/engine PIDs
  were unchanged and `/opencode/health` stayed `ready`.
- Native screenshots: [cold launch](evidence/session-opening-exact-session-initial.png)
  and [second instance](evidence/session-opening-exact-session-second-instance.png).
  Inspected: exact requested heading and full Agents surface visible, no blank
  or crashed renderer. Capture occurred before the environment badge settled;
  real service readiness was asserted before and after. Hosted notification
  requests are deliberately blocked in this synthetic sandbox.
- Final neutral `VITE_RHYTHM_GATEWAY_MODE=live npm run build` after unsetting all
  token/base/expected-base overrides: exit 0. Bundle scan found neither public
  synthetic credential. JS `index-DzUB1inb.js` SHA256
  `9c40c70a3ecfc0c5504df9ff64ff8c6c08d18b7c81fa664dd9b47b77cc0706c6`;
  capability SHA256 `656c223b8a5ca1cec4d6d0c428ded26ecba13e0388a16fbda9c3c69888dda613`.
- GitNexus upstream impact: LOW for FixtureProvider, selectLiveSession, and
  reconcileMembership. Change detection: LOW, zero affected execution flows.
- Full `ai-workflow checks --level pr`: exit 1. Thirteen stages passed; three
  failed in unchanged packages. API `prod_trigger_parity_contract.test.ts` AC1b
  expected `mockDbRun` once but observed twice (line122). Fork session tests:
  395 pass, 5 skip, 1 todo, 1 failure in interrupted bash-output finalization.
  Mobile web: 70 pass, 1 failure at `issue-1174-parity.spec.mjs:116`, missing the
  edited conversation title. Static/Flutter, lint/builds, MCP, fork typecheck,
  and mobile static/contract/fake-server stages passed. See the narrowly scoped
  [follow-up record](../issues/2026-09-18-unrelated-pr-gate-failures.md).
  No broad repository/release pass is claimed. No source changes exist in these
  packages; root causes and baseline reproducibility remain uninvestigated.
  The coordinating agent explicitly directed documenting these separate failures
  and publishing this scoped draft without repairs or another monorepo run.

## Notes

The user explicitly approved this narrow Rhythm companion change after an
initial Bot Crossing-only scope. No Electron main/preload, authentication,
session lifecycle, API, engine, or Flutter source changes were made. The current
source shell's main/preload and renderer base matched this branch's base, so no
main-process upgrade is needed.

The actual live-shell handoff revealed a warm-document boundary: replacing
generated assets does not replace JavaScript in a document navigated only by
hash. One ordinary renderer Reload is needed to load the new asset. Existing
`main.mjs` security policy invalidates authentication on full main-frame
navigation, including Reload, so the supported Google sign-in flow is then
required. Credentials must not be injected to bypass that policy. This behavior
is unchanged by the patch. Normal subsequent exact-session links preserve the
document/authentication.

The coordinating agent performed the actual warm-profile Bot Crossing opening
check after that Reload and the user's normal Google sign-in. The exact requested
local session matched the visible heading; Electron main PID97378, API85416, and
engine85518 survived unchanged and the live environment showed both services
healthy. Private session inventory and its screenshot remain outside this repo.
The subsequent real Bot opening switched to a second exact local ID with a
matching visible title and returned to the first, with no additional Reload or
sign-in. All three process identities remained unchanged.

The native sandbox uses Chromium's `--use-mock-keychain` flag and a disposable
fixture token solely to test this opening route; it does not qualify real
Keychain, production OAuth, signed artifacts, dual architecture, or Flutter.
Those release gates remain outside this approved source-shell repair.

Initial harness failures were diagnosed before accepting evidence: installed
Chrome replaced an absent bundled test browser; the mocked browser suite needs
a documented CSP bypass for sandbox ports; real source Electron needed its
test-only mock Keychain flag; capability discovery reads the built file rather
than attempting a CSP-disallowed native fetch. Assertions were not weakened.
No follow-up issue is needed for these repaired harness setup problems.

Companion caller integration: [Bot Crossing draft #4](https://github.com/ajhochy/bot-crossing/pull/4).
The owned sandbox was torn down after evidence capture. Live API/engine PIDs
remained unchanged; sanitized diagnostics were preserved outside the repo.
