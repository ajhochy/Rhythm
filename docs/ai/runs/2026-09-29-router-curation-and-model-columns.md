---
date: 2026-09-29
repo: Rhythm
branch: fix/router-curation-and-model-columns
pr: pending
issues: []
status: pending-manual-smoke
tags: [run, rhythm]
---
# Router reads the panel's curation; Model routing column browser

## Files
- `apps/api_server/src/services/decision/model_catalog.ts` — live catalog's enabled set now comes from
  `listAgentModelCatalog({ includeHidden: true })` (the Models panel's checkboxes) instead of explicit
  `agent_model_visibility` visible=1 rows. Root cause: default-on families (Anthropic etc.) are checked
  in the panel with no row, so the router called them "not enabled in curation".
- `apps/web/src/components/tools/ModelRouting.tsx` (new) — Agent Settings → Model routing:
  sections → groups (backend, thresholds, all/routable, by tier, by provider, excluded, not enabled)
  → models (search; sort name/price↑↓/newest/provider/tier) → inspector (curation switch, exclude,
  tier + reset, facts). Model edits save immediately (partial PUT).
- `RouterSettingsPanel.tsx` is backend + features only; `RouterCatalogSection.tsx` removed.

## Checks
- api tsc 0; vitest decision + agents_models_routes 205/205 (2 regression tests fail on old code).
- web build 0; contracts router-auto-model 16/16, issue-1559 40/40, issue-1580 29/29, settings-columns 7/7, list-inspector 8.
- Live pre-fix probe on :4001: 13 models `visible` in /agents/models/catalog/full but `enabled:false` in /agent-decisions/config.

## Notes
- Post-fix live check needs the desktop agent server relaunched on this branch (manual smoke).
- Mobile `router-catalog-section.tsx` still uses the flat layout; server fix applies to it too.
