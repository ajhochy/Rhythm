---
date: 2026-09-26
repo: Rhythm + Bot Crossing
branch: mega / codex/colony-embedded-artifact
pr: null
issues: [bot-crossing-persistence-auto-archive]
status: automated-pass-manual-smoke-pending
tags: [run, Rhythm, bot-crossing]
---

# Bot Crossing persistence and auto-archive

## Files

- Acceptance contract: `docs/ai/contracts/task-bot-crossing-persistence-auto-archive.json`
- Bot Crossing: `src/game/auto-archive.js`, `src/main.js`, `src/ui/hud.js`, `src/game/projects.js`, `src/game/merge-state.js`, `server/state-model.mjs`, and three focused test files. Numstat: 9 files, +305/-16.
- Rhythm: `apps/electron/src/colony-view.mjs`, its native-view contract, `apps/web/src/pages/colony/index.tsx`, its Playwright contract, contract/run documents, and two screenshots. Text numstat: 6 files, +276/-15; two binary PNGs.

WAIVED: docs/evidence-only update; verification is: JSON parsing, Markdown formatting inspection, and scoped git diff --check.

## Integration evidence

- Bot Crossing is committed locally at `4e6ed18409a4d6507bf9cec4808b1952ce426eaf` on `codex/colony-embedded-artifact`; the branch is ahead by one commit and has not been pushed.
- The clean sealed Colony artifact records the exact source commit `4e6ed18409a4d6507bf9cec4808b1952ce426eaf`, `dirty=false`, Electron 40, and Node 22.23.
- Rhythm's Colony pin, configuration contract, and plan now reference `4e6ed18`. Artifact validation accepted both Hermes `d747cbd9` and Colony `4e6ed18`.
- `dist/Rhythm.app` contains Colony `4e6ed18` and all current desktop changes. Developer ID signing passed, the app satisfies its designated requirement, and it is not notarized.

## Checks

### Phase 0 failing acceptance run

- `node --test test/auto-archive.test.mjs test/shared-state-parity.test.mjs test/thread-card.test.mjs` (Bot Crossing): **FAIL**, 14 pass / 6 fail. Expected failures: missing `auto-archive.js` exports, absent `unarchivedAt`, and HUD still labels the action Archive.
- `env -u RHYTHM_RELAY_URL -u RHYTHM_RELAY_TOKEN -u RHYTHM_MOBILE_GATEWAY_PORT -u RHYTHM_OPENCODE_ENGINE_PORT node --test --test-concurrency=1 test/colony-native-view-contract.test.mjs` (Rhythm Electron): **FAIL**, 6 pass / 1 fail. Hash departure retained nonzero bounds instead of suspending the scene.
- `env -u RHYTHM_RELAY_URL -u RHYTHM_RELAY_TOKEN -u RHYTHM_MOBILE_GATEWAY_PORT -u RHYTHM_OPENCODE_ENGINE_PORT npx playwright test tests/pages/colony.spec.ts --grep task-bot-crossing-c9` (Rhythm web): **PASS**, 1 test. Renderer bridge mock already exercises away/back remount; main-process lifecycle contract remains red.
- UI-review blocker RED: `node --test test/auto-archive.test.mjs test/thread-card.test.mjs`: **FAIL**, 6 pass / 3 fail. Exactly-48h was archived, `autoArchiveBatch` was absent, and help remained archive-only.
- UI-review blocker RED: clean-env `node --test --test-concurrency=1 test/colony-native-view-contract.test.mjs`: **FAIL**, 7 pass / 3 fail. Suspend did not focus the host, pre-ready visibility was lost, and evidence still overclaimed native continuity.

### Passing verification

- `node --test test/auto-archive.test.mjs test/shared-state-parity.test.mjs test/thread-card.test.mjs`: **PASS**, 23/23.
- `npm test` (Bot Crossing): **PASS**, 292/292.
- `npm run build` plus `node --check` for each changed Bot Crossing JS/MJS module: **PASS**. This was the ordinary Vite source build, not a sealed Rhythm artifact.
- `node --test --test-concurrency=1 test/colony-native-view-contract.test.mjs` with relay/gateway/engine overrides removed: **PASS**, 10/10.
- `npm test` (Rhythm Electron) with `RHYTHM_RELAY_URL`, `RHYTHM_RELAY_URLS`, `RHYTHM_RELAY_TOKEN`, `RHYTHM_RELAY_BEARER`, gateway, and engine overrides removed: **PASS**, 431 pass / 3 skip / 0 fail (434 tests).
- The first Electron aggregate omitted the plural relay variables and failed the unrelated relay-restoration assertion 1/434; the corrected fully-clean command above passed.
- `npm run typecheck` (Rhythm Electron): **PASS**.
- `npx playwright test tests/pages/colony.spec.ts --grep task-bot-crossing-c9`: **PASS**, 1/1; regenerated both deterministic screenshots.
- `npm run typecheck && npm run test:dist-smoke` (Rhythm web): **PASS**.
- Bot Crossing and owned Rhythm `git diff --check`: **PASS**. Contract JSON parse: **PASS**.
- GitNexus impact and `detect_changes(scope=all)` were attempted. Both returned **UNKNOWN/unavailable** because the worktree LadybugDB is storage version 42 while the connected client is version 41; no high/critical result was suppressed.
- Post-commit Bot Crossing `npm test`: **PASS**, 292/292.
- Focused Colony artifact/native/package contracts: **PASS**, 26/26.
- Post-integration full Rhythm Electron: **PASS**, 431 pass / 3 skip / 0 fail.
- Post-integration Colony Playwright: **PASS**, 1/1. Web typecheck and dist smoke: **PASS**.
- Packaging initially stopped because two test-only OpenCode fork changes made the vendored subtree dirty. Only those two test paths were stashed; `package:mac` then passed; their exact hashes and diffs were restored; the temporary stash was dropped.

## Root cause and result

- The scene cap ranked stale error rows ahead of current work, and no Colony-owned 48-hour archive pass existed. A pure one-update pass now archives only rows inactive for strictly over 48 hours, emits one batch recovery notice, preserves uncertain/source-archived rows, and ranks stale evidence behind current rows without changing adapter dedupe.
- `colony:view:detach` and same-document hash departure previously called terminal disposal, stopping the worker and clearing the partition. They now suspend with zero bounds, focus the Rhythm host, gate hidden shortcut intents, and queue the latest validated visibility until port transfer; reattach reuses the same view, worker, document, partition, and attachment. Full-document and terminal lifecycle paths still dispose.
- `unarchivedAt` is durable, alias-migrated, newest-wins under conflicts, and gives restored tasks 48 hours before automatic eligibility. Manual re-archive clears it.
- The original Bot Crossing HUD remains the only scene chrome; its existing harness label was retained and only the Archive/Restore action was made truthful.

## Visual evidence

- `docs/ai/artifacts/bot-crossing-colony-before.png`
- `docs/ai/artifacts/bot-crossing-colony-after.png`
- These are synthetic bridge lifecycle fixtures only. They verify deterministic web-host remount state in the bridge mock; they do not prove native camera/HUD continuity.
- **Packaged verification blocker:** actual native before/after screenshots remain pending even though the clean commit, sealed artifact, repin, and package now exist. The packaged native smoke must wait for the installed-app swap described below.

## Manual packaged verification pending

- Actual packaged `--colony-smoke` cannot safely run while the installed live app with the same bundle ID, `com.rhythm.desktop`, is active. The first launch reached the existing instance. A second launch with isolated user data hit MachPort rendezvous/parent exit and timed out. No process or listener remains.
- Triage classifies both attempts as an environment/concurrent same-bundle collision, not a product defect. Do not retry until the packaged app is swapped into the installed-app position and the prior instance is no longer active.
- After the swap: confirm the original Bot Crossing HUD is visible; select a Rhythm row and a camera landmark; switch from `#/colony` to another tab and back; assert the same selection and camera remain with no reload; observe the over-48-hour archive notice; choose Archived and restore a task.
- The safe default-browser link, custom provider, and attachment-drop behaviors may be smoked separately from the Colony continuity path.

## Notes

- Earlier source validation left sandbox ports 7398/7397/7399 and live data untouched. The later packaged smoke attempts are recorded above; no test process or listener remains.
- No push, notarization, or live-data mutation occurred. This docs-only update did not edit product/test code, commit, push, package, or rerun the blocked smoke.
- `docs/ai/runs/evidence/electron-m1-shell.png` was regenerated by packaging and must be restored by the manager after this docs update. It was not touched here.
