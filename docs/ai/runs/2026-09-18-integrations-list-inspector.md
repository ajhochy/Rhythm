---
date: 2026-09-18
repo: Rhythm
branch: mega/ws-1519-integrations
pr: null
issues: [1519]
status: partial
tags: [run, rhythm]
---

# Integrations list and inspector adoption

## Files

- `apps/web/src/pages/integrations/index.tsx` adopts the shared `ListInspector` and URL-backed `integrationId` selection while retaining provider settings and actions in the inspector.
- `apps/web/src/pages/integrations/styles.css` adds scoped integration-inspector layout adjustments.
- `apps/web/tests/pages/integrations-list-inspector.spec.ts` covers selection, actions, inert selection, states, accessibility, narrow/zoom layouts, refresh, and missing IDs.
- `apps/web/tests/pages/integrations.spec.ts` and `apps/web/tests/contract/issue-2009-integrations.spec.ts` use shared row helpers instead of removed page-specific selection buttons.
- `docs/ai/contracts/issue-1519.json` maps all seven issue criteria to the rendered spec.

## Checks

- `cd apps/web && npm run typecheck` — pass, exit 0 (`tsc -b`).
- `cd apps/web && npm run build` — pass, exit 0; 1,682 modules transformed and Vite built in 27.46s. The existing large-chunk warning remains.
- `git diff --check` — pass, no output.
- `jq empty docs/ai/contracts/issue-1519.json` — pass.
- `gitnexus impact` — unavailable for the edited symbols because the exposed index is stale and does not contain the worktree symbols.
- `gitnexus detect-changes --repo /Users/ajhochhalter/Documents/Rhythm/.mega-wt/ws-1519-integrations ...` — unavailable because this worktree is not registered. The main-checkout index is not valid evidence for this worktree.
- Playwright/axe/screenshot checks — not run; this worker brief prohibits socket binding, Playwright, Vite dev, and Electron launch.
- `node /Users/ajhochhalter/Documents/dev-dashboard/publish-to-rhythm.mjs run ...` — failed; restricted DNS could not resolve `api.vcrcapps.com` (`ENOTFOUND`).

## Notes

- The existing domain surface has no disconnect/revoke action or gateway method; the migration preserves that security boundary rather than inventing one.
- Selection only updates `integrationId`; OAuth, sync, saves, and import remain explicit inspector actions.
- Rendered fixture coverage must be executed by the orchestrator before merge.
