---
date: 2026-09-27
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [task-bot-crossing-open-rhythm-session]
status: automated-pass-manual-smoke-pending
tags: [run, Rhythm]
---

# Bot Crossing Open → Rhythm session

## Files

- `apps/electron/src/preload.cjs` — admits only exact attached `scene.action` Rhythm-session results; bridge keys/version unchanged.
- `apps/electron/test/colony-main-wiring-contract.test.mjs` — real preload VM allow/deny matrix and deep-clone proof.
- `apps/electron/test/colony-scene-routing-contract.test.mjs` — native scene → main action policy → real preload → exact hash integration.
- `apps/web/tests/pages/colony-actions.spec.ts` — list-mode evidence for one action, one exact hashchange, and no duplicate success UI.
- `docs/ai/contracts/task-bot-crossing-open-rhythm-session.json` — executable acceptance contract.
- This run note.

Bot Crossing source/pin and web production source were not changed. The scoped production diff changes only preload method behavior, with no UI, CSS, or DOM layout change. The generated `electron-m1` screenshot is unchanged and was restored by the manager.

WAIVED: documentation and contract evidence update only with no behavior change; verification is JSON parsing and scoped diff validation.

## Evidence-only repair baseline

At the task base/current worktree, this exact command exited 0 with no output:

```sh
git diff --quiet HEAD -- apps/web/src apps/web/tests/pages/colony.spec.ts apps/web/tests/pages/colony-playwright.config.ts
```

Therefore the previously observed 29/30 full-suite failure in `Bot Crossing normal state is only a full-bleed native scene host` is task-invariant and order-dependent, not caused by this task's production or Colony fixture/config changes. Its full-suite measurement differed by 80 px; the same test passed when run in isolation. No worktree was created.

## Acceptance RED

Command:

```sh
cd apps/electron
node --experimental-vm-modules --test --test-concurrency=1 test/colony-main-wiring-contract.test.mjs
```

Observed before implementation: 2 passed, 1 failed. The real preload callback received `scene.select` and `scene.status` but omitted the expected exact `scene.action` `{ok:true,kind:"rhythm-session",sessionId:"local-session-42"}`.

## Checks

Evidence-only repair checks (clean environment):

- Focused list-mode Open contract:
  `npm exec -- playwright test --config tests/pages/colony-playwright.config.ts colony-actions.spec.ts`
  — **7 passed**. The Open case observed exactly one `runAction('open', 'rhythm:parent')`, exactly one hashchange to `#/agents?sessionId=local-session-42`, no `.colony-action-status[role="status"]`, and no `.colony-action-toast`.
- Session opening/link parser:
  `npm exec -- playwright test --config tests/gateway/session-opening-playwright.config.ts`
  — **13 passed**.
- Focused Electron scene/preload/security:
  `node --experimental-vm-modules --test --test-concurrency=1 test/colony-main-wiring-contract.test.mjs test/colony-scene-routing-contract.test.mjs test/security-smoke-receipt.test.mjs`
  — **15 passed**.
- Web static/build/dist:
  `npm run typecheck && npm run build && npm run test:dist-smoke`
  — **passed**; dist smoke verified index plus 2 relative assets. Existing large-chunk warning only.
- Full Colony was not rerun for this evidence-only repair. Its known 29/30 geometry order failure is task-invariant by the clean baseline above, and the failing test passes in isolation.
- Scoped production/fixture invariant was reconfirmed after the repair with
  `git diff --quiet HEAD -- apps/web/src apps/web/tests/pages/colony.spec.ts apps/web/tests/pages/colony-playwright.config.ts`
  — **passed with no output**.
- Scoped `git diff --check` for the list-mode test, contract, and run note — **passed**.
- GitNexus final `detect_changes(scope=all, worktree=...)` — **low risk**, 0 affected processes; its stale index again reported unrelated pre-existing project-state symbols rather than these test/docs edits.

## Packaged candidate evidence

- `package:mac` passed using Hermes `d747cbd9` and Colony `4e6ed18`; candidate: `dist/Rhythm.app`.
- Source `apps/electron/src/preload.cjs` and packaged `dist/Rhythm.app/Contents/Resources/app/src/preload.cjs` both have SHA-256 `bfacfa2df9a73389fcb4b3ac8b23b1c1405f4415eafc2478626dbb5ff58b370a` and are byte-identical.
- The isolated unsigned-package security smoke `slice-7-c5` passed **1/1**, safely separate from the live installed application.
- Developer ID signing passed and satisfies the Designated Requirement. The candidate is unnotarized.
- The manager restored the generated `electron-m1` screenshot; it is unchanged.

Evidence update validation:

- `node -e "const c=require('./docs/ai/contracts/task-bot-crossing-open-rhythm-session.json');const m=Object.fromEntries(c.criteria.map(x=>[x.criterion_id,x]));if(m['task-bot-crossing-open-c7'].status!=='pass'||m['task-bot-crossing-open-c8'].status!=='UNVERIFIED'||c.not_tested.join()!=='task-bot-crossing-open-c8')process.exit(1)"` — **passed**.
- `git diff --no-index --check /dev/null docs/ai/contracts/task-bot-crossing-open-rhythm-session.json` and the equivalent run-note command — **passed with only the expected untracked-file difference exit**.

- Focused Electron scene/preload/security:
  `node --experimental-vm-modules --test --test-concurrency=1 test/colony-main-wiring-contract.test.mjs test/colony-scene-routing-contract.test.mjs test/security-smoke-receipt.test.mjs`
  — **15 passed**.
- Full Electron clean environment:
  `env -i HOME=/private/tmp/rhythm-bot-open-sandbox/home TMPDIR=/private/tmp/rhythm-bot-open-sandbox/tmp PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -f -c 'npm test && npm run typecheck'`
  — **433 passed, 3 skipped, 0 failed; typecheck passed**.
- Full Colony Playwright clean environment:
  `env -i HOME=/private/tmp/rhythm-bot-open-sandbox/home TMPDIR=/private/tmp/rhythm-bot-open-sandbox/tmp PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin PLAYWRIGHT_BROWSERS_PATH=/Users/ajhochhalter/Library/Caches/ms-playwright /bin/zsh -f -c 'npm exec -- playwright test --config tests/pages/colony-playwright.config.ts'`
  — first run had one transient pre-existing full-bleed geometry failure (29 passed); isolated retry passed, then the full confirmation run **passed 30/30**.
- Session-link routing:
  `npm exec -- playwright test --config tests/gateway/session-opening-playwright.config.ts`
  in the same clean environment — **13 passed**, including `agentSessionLinkFromHash` selecting the exact local ID.
- Web static/build/dist:
  `npm run typecheck && npm run build && npm run test:dist-smoke`
  in the same clean environment — **passed**; dist smoke verified index plus 2 relative assets. Existing large-chunk warning only.
- `git diff --check` — **passed**.
- GitNexus pre-edit impact for `onEvent` and `apps/electron/src/preload.cjs` — **UNKNOWN/unindexed**, 0 direct callers and 0 affected processes; no HIGH/CRITICAL result.
- GitNexus `detect_changes(scope=all, worktree=...)` — **low risk**, 0 affected processes; stale index reported unrelated pre-existing project-state symbols and did not map the preload/test edits.

This evidence-only update did not run package commands or launch the live app. The supplied sandbox and live ports `4001/4002/4096` were not touched.

## Manual smoke pending

After swapping to the packaged candidate, click **Open** on a Rhythm bot in Bot Crossing; the Agents tab must open the exact corresponding local session exactly once.

## Notes

The preload remains fail-closed: matching attachment; exact three-key action payload; `ok === true`; exact `rhythm-session` kind; local ID regex `[A-Za-z0-9_-]{1,128}`; arrays, extra keys, malformed IDs, foreign attachments, and arbitrary events are dropped. Existing select/status behavior and the exact frozen bridge receipt remain unchanged.
