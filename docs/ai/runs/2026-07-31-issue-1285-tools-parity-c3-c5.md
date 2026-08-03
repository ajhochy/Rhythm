---
date: 2026-07-31
repo: Rhythm
branch: codex/mobile-fixes-rollup
pr: 1284
issues: [1285]
status: passed
tags: [run, Rhythm]
---

# Issue #1285 Tools parity — c3, c4, c5

## Files

- `apps/mobile/providers/services/rhythm-tools-service.ts` — production Review
  Queue vocabulary, paired Gallery transport, deterministic catalog sorting,
  and configured-provider shaping.
- `apps/mobile/providers/services/tool-catalog-organizer.ts` — shared catalog
  search, grouping, and label/id sorting.
- `apps/mobile/app/tools/[tool].tsx` — compact catalog controls, provider/model
  explanation, safe model metadata, and credential-action gating.
- `apps/api_server/src/routes/mobile_tools_routes.ts` — Device-authenticated,
  project-validated, Mac-global-admin Gallery list/detail allowlist.
- `apps/api_server/src/__tests__/live_e2e_1285_mobile_gallery.test.ts` — live
  paired Gallery behavior and authorization regression.

## Checks

- PASS — `cd apps/mobile && node --test ./tests/contract/issue-1285-device-parity.test.mjs` (6/6 aggregate; c3–c5 owned here).
- PASS — `cd apps/mobile && node --test ./tests/issue-1285-tools-parity.test.mjs` (4/4).
- PASS — `cd apps/api_server && npx vitest run src/__tests__/issue_1285_mobile_gallery_parity.test.ts` (1/1).
- PASS — `cd apps/api_server && npx vitest run src/__tests__/issue_1173_mobile_tools_gateway.test.ts src/__tests__/issue_1285_mobile_gallery_parity.test.ts` (2 files / 7 tests).
- PASS — `cd apps/mobile && npx playwright test tests/e2e/issue-1285-tools-parity.spec.mjs` (2/2).
- PASS — focused existing Tools Playwright regressions (6/6).
- PASS — `cd apps/mobile && npm run test:fake-server:self`.
- PASS — `cd apps/mobile && node --test ./tests/msp-006-project-scoped-tools.test.mjs` (8/8).
- PASS — `cd apps/mobile && npm run lint` (0 errors; 3 pre-existing warnings).
- PASS — `cd apps/mobile && npm run typecheck`.
- PASS — `cd apps/api_server && npm run build`.
- PASS — `cd apps/opencode_fork/packages/opencode && bun run build --single`;
  generated binary smoke test returned the branch preview version.
- PASS — isolated sandbox live behavior (dedicated API `:4298`, engine `:4297`,
  mobile gateway `:4289`):

  ```bash
  RHYTHM_LIVE_E2E=1 \
  RHYTHM_LIVE_E2E_ISOLATED=1 \
  RHYTHM_LIVE_URL=http://127.0.0.1:4298 \
  RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-dev-sandbox-1285-gallery/rhythm.db \
  RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-dev-sandbox-1285-gallery \
  RHYTHM_LIVE_HUMAN_CAPABILITY=<fresh-throwaway-test-capability> \
  npx vitest run src/__tests__/live_e2e_1285_mobile_gallery.test.ts \
    --no-file-parallelism
  ```

  Result: 1 file / 1 behavior passed. The observable paired route required
  Device auth, rejected an unregistered project, returned desktop Gallery list
  and detail metadata, omitted `filePath`, and kept artifact streaming blocked.

## Notes

- Gallery metadata follows the local-Mac source-of-truth decision. Artifact
  byte streaming remains outside this slice and the allowlist rejects it.
- The sandbox was removed after the run; `:4298`, `:4297`, and `:4289` had no
  remaining listeners.
