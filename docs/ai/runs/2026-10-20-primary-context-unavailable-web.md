---
date: 2026-10-20
repo: rhythm
branch: codex/rhythm-feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, rhythm, web, coordinator, coverage]
---

# Primary context unavailable after Ready

## Files

- `apps/web/src/components/AgentsWorkspace.tsx`, `Composer.tsx`, and `use-coordinator-conversation.ts`: withdraw new-message admission after an unavailable status, keep the exact pending-command retry path, and reconcile the primary entry notice after a successful refresh.
- `apps/web/tests/rhythm-primary-entry.spec.ts` and `coordinator-conversation-controller.test.mjs`: cover rendered failure/recovery and direct controller admission, including oversized input.

## Checks

- Source-only Vite fixture observation: `/private/tmp/rhythm-primary-entry-context-recon-20261020.json` and `/private/tmp/rhythm-primary-entry-context-recovery-recon-20261020.json` (private, mode 0600). Typed `503 {"kind":"context_unavailable"}` after prior Ready left the composer enabled; subsequent Refresh restored Ready while the old failure notice remained. The first rendered regression failed at the enabled composer.
- Direct controller RED: `npm run build:guard -- node --experimental-vm-modules --test --test-name-pattern='unavailable status rejects oversized' apps/web/tests/coordinator-conversation-controller.test.mjs` — 0/1; an oversized message changed phase from `unavailable` to `review` without reaching the message endpoint.
- Controller/composer GREEN: `npm run build:guard -- node --experimental-vm-modules --test apps/web/tests/coordinator-conversation-controller.test.mjs apps/web/tests/coordinator-composer-draft.test.mjs` — 25/25.
- Rendered GREEN: guarded Playwright against a standalone guarded Vite fixture on port 4194 using `/private/tmp/rhythm-primary-entry-existing-vite-20261020.config.mjs` (no build or API server) — 8/8 for `apps/web/tests/rhythm-primary-entry.spec.ts`. The new case also passed alone via `npm run build:guard -- ./apps/web/node_modules/.bin/playwright test --config /private/tmp/rhythm-primary-entry-existing-vite-20261020.config.mjs --grep 'previously ready primary fails closed'` — 1/1.
- `npm run build:guard -- ./apps/web/node_modules/.bin/tsc -p apps/web/tsconfig.app.json --noEmit` and `git diff --check` — pass.
- `gitnexus detect_changes --scope unstaged --repo Rhythm` reported LOW and zero indexed processes, with an index 308 commits behind this checkout. The shared composer/controller blast remains manually HIGH.

## Notes

These are web source and rendered-fixture results. A new exact signed package and native private-fixture confirmation remain outstanding. No API, engine, model, or operator data was used by these checks.
