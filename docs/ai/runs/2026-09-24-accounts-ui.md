---
date: 2026-09-24
repo: Rhythm
branch: codex/1569-accounts-wiring
pr: 1544
issues: [1569]
status: pending
tags: [run, rhythm]
---

## Files

S1 `hermes-accounts.mjs` additive per-provider eligibility/source enums and matching static-key control-character rejection; main helper projection; `ai-accounts.d.ts`; actual Accounts inspector composition in both live/fixture settings, new HermesAccountsSettings and metadata-only aiAccountsBridge; incumbent CSS; metadata/rendered/parser contracts and Electron registration. Prior actual-main/view/preload products unchanged during this UI slice.

## Checks

- RED: `node --test apps/electron/test/hermes-accounts-eligibility-contract.test.mjs`: 13 expected failures at missing enum fields. `/private/tmp/rhythm-accounts-eligibility-red.log`.
- RED: `cd apps/web && npx playwright test --config tests/agent-settings-hermes-accounts.config.ts`: 8 expected failures at missing sharing region/actions, with actual Accounts row rendering as prerequisite. `/private/tmp/rhythm-accounts-ui-red.log`. Initial harness JSX issue was corrected to automatic runtime before accepted RED.
- `cd apps/electron && node --test test/hermes-accounts-eligibility-contract.test.mjs test/hermes-accounts.test.mjs test/hermes-credential-broker.test.mjs test/hermes-accounts-main-contract.test.mjs test/hermes-accounts-auth-contract.test.mjs`: 61/61 pass. `/private/tmp/rhythm-accounts-ui-metadata-focused.log`.
- `cd apps/electron && node --experimental-vm-modules --test test/hermes-accounts-wiring-contract.test.mjs`: 10/10 pass. `/private/tmp/rhythm-accounts-ui-wiring-regression.log`.
- Final rendered command above: 8 pass, 1 visual case intentionally gated. `/private/tmp/rhythm-accounts-ui-final.log`.
- `cd apps/web && RHYTHM_ACCOUNTS_VISUAL=1 npx playwright test --config tests/agent-settings-hermes-accounts.config.ts --grep S4-U9`: 1/1 pass with real CSS, inert selection keyboard behavior, focusable action, desktop + 390px narrow, no horizontal overflow, axe zero violations in new region. `/private/tmp/rhythm-accounts-ui-visual.log`.
- Screenshots inspected once: `/private/tmp/rhythm-accounts-ui-desktop.png`, `/private/tmp/rhythm-accounts-ui-narrow.png`. Incumbent layout preserved; no visual repair round needed.
- `cd apps/web && RHYTHM_LIVE_E2E=1 npx playwright test --config tests/agent-settings-accounts-playwright.config.ts --grep 'authorizes an account|re-authorizes an expired|connects OpenAI'`: 3/3 existing account persistence/provider regressions pass. `/private/tmp/rhythm-accounts-existing-regressions.log`. This uses a disposable Vite listener and intercepted local API transport, not real engine/API/provider.
- `node --test apps/web/tests/ai-accounts-bridge.test.mjs`: parser regression RED then GREEN; drops arbitrary secret fields and rejects coerced enum arrays. `/private/tmp/rhythm-accounts-parser-red.log`, `/private/tmp/rhythm-accounts-parser-green.log`.
- `cd apps/web && npm run typecheck` and `cd apps/electron && npm run typecheck`: exit 0. Final logs `/private/tmp/rhythm-accounts-ui-typecheck-final.log`, `/private/tmp/rhythm-accounts-ui-electron-typecheck-final.log`.
- Impeccable detector over component/CSS: `[]`; `/private/tmp/rhythm-accounts-design-detector.json`. `git diff --check`: clean.

## Notes

Original 28 criteria unchanged. Eligibility preserves unknown and distinguishes native presence from token validity. Native-only env no longer looks like a shareable Rhythm key; OAuth/key contents are never rendered. Controls submit exact grant references to main native confirmation. Accepted mutations refresh metadata instead of inventing applied. Existing OpenCode account inputs are outside the new sharing region and preserved.

GitNexus index remains 200 commits behind. S1/main helpers not found (UNKNOWN); old LiveSettingsTool entry reports LOW, 3 impacted/1 direct. New UI/parser symbols absent on subsequent lookup. Existing symbol impact preceded edits; new component/parser lookup was performed during verification and returned UNKNOWN. Impeccable Operate/incumbent guidance applied; no redesign or new interview needed.

No real credentials/providers/native account writes, API/engine servers, commits or pushes. Combined native/installed/packaged qualification and full shared-agent feature remain parent-owned. Current candidate is ready for parent diff review, not release qualification.

## Parent integration review

Parent reviewed all eight product files and both styled screenshots. Integrated focused metadata, actual wiring and parser checks: **24/24 pass**. Actual live/fixture rendered Accounts contracts: **8 pass, 1 intentionally gated visual case**; the separate candidate styled visual case passed and screenshots were inspected. Web typecheck passed. Durable parent receipts are `accounts-ui-parent.log`, `accounts-ui-parent-rendered.log`, and `accounts-ui-parent-types.log` under `/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-repair4/`. No actual native consumption or packaged qualification is claimed.

GitNexus detect-changes against the integration worktree staged diff reports15files,2indexed symbols,0affected processes,lowrisk. Its stale index omits the new helpers; direct review covered all15staged files. The root-checkout invocation reported no changes and is not used as scope evidence.
