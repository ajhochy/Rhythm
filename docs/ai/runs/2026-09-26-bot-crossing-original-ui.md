---
date: 2026-09-26
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [product-direction]
status: pass
tags: [run, Rhythm]
---

# Bot Crossing original UI restore

## Phase 0 acceptance contract

- `cd apps/electron && node --test test/colony-scene-routing-contract.test.mjs test/colony-native-view-contract.test.mjs` — RED as required: 8 passed, 2 failed. Missing `action.run` dispatch and missing HUD skin injection failed their observable assertions.
- `cd apps/web && npm exec -- playwright test tests/pages/colony.spec.ts` — RED as required: 6 passed, 1 failed. The normal state still rendered `.colony-toolbar`.
- Contract: `docs/ai/contracts/task-bot-crossing-original-ui.json`.

## Files

- Electron accepts sealed `action.run` requests for `open`, `reveal`, and `copyPath`, dispatches through the existing main-process action policy, and forwards successful Rhythm-session navigation to the renderer.
- Electron injects `apps/electron/src/colony-skin.css` after every Colony document load. The stylesheet scopes Rhythm tokens to HUD panels and controls only.
- The normal web tab now contains only a full-size scene host. The prior rail, inspector, toolbar, menus, notices, and Disable control remain only in list fallback; Settings retains Disable.
- The sealed Bot Crossing source pin and qualification plan now use `52893a5f83e2bd9e1c581a106a4847b39356c852` and Node `22.23.0`.

## Checks

- `COLONY_NATIVE_ARTIFACT=/private/tmp/bot-crossing-colony-artifact/build/rhythm-embedded node --test test/colony-scene-routing-contract.test.mjs test/colony-native-view-contract.test.mjs test/colony-protocol-parity.test.mjs test/colony-desktop-config.test.mjs test/colony-main-wiring-contract.test.mjs` — 17 passed.
- Initial `npm test` inherited live `RHYTHM_RELAY_*` variables and produced one unrelated relay fixture mismatch; clean rerun with those variables and `RHYTHM_API_BASE` unset — 428 passed, 3 skipped, 0 failed.
- `cd apps/electron && npm run typecheck` — passed.
- `cd apps/web && npm run typecheck` — passed.
- Colony Playwright files (`colony.spec.ts`, `colony-fallback.spec.ts`, `colony-settings.spec.ts`, `colony-actions.spec.ts`, `colony-rail.spec.ts`) — 29 passed.
- Final pin/protocol check against the rebuilt companion artifact — 5 passed.
- Visual capture fixture — 1 passed. Reviewed `/tmp/bc-original-ui/standalone-original.png`, `/tmp/bc-original-ui/embedded-skinned.png`, `/tmp/bc-original-ui/embedded-skinned-settings.png`, and `/tmp/bc-original-ui/rhythm-full-bleed.png`.
- `gitnexus_detect_changes(scope=all, worktree=.mega-wt/integration)` — LOW, no affected indexed processes; the stale index recognized only documentation symbols, so manual flow tracing and focused contracts are the code-impact evidence.

## Notes

GitNexus returned UNKNOWN because its index predates these Colony symbols; manual tracing limited the change to the Colony channel/view and `/colony` composition. Unrelated pre-existing docs changes remain untouched and will not be staged.
No unsupported embedded control remains active. New conversation is disabled upstream because Rhythm has no equivalent; camera, orbit, planet, time, help, settings, filters, archive/viewed, and client screenshot remain scene-owned.
