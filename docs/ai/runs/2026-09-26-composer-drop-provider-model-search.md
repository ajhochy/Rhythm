---
date: 2026-09-26
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [1580]
status: pass
tags: [run, Rhythm]
---

# Composer drop and provider model search

## Files

- `apps/web/src/components/Composer.tsx`
- `apps/web/src/styles.css`
- `apps/web/tests/electron-e16-agents-safety.spec.ts`
- `apps/web/src/components/tools/ModelCurationPanel.tsx`
- `apps/web/src/components/tools/AgentSettingsTool.css`
- `apps/web/tests/contract/issue-1580-model-curation.spec.ts`
- `docs/ai/contracts/task-composer-drop-provider-search.json`
- `docs/ai/runs/artifacts/composer-drop-provider-model-search/composer-drag-active.png`
- `docs/ai/runs/artifacts/composer-drop-provider-model-search/composer-dropped-screenshot.png`
- `docs/ai/runs/artifacts/composer-drop-provider-model-search/provider-search-no-results.png`

## Contract-first evidence

- Composer RED: `cd apps/web && npx playwright test -c tests/electron-e16-playwright.config.ts --grep 'composer-drop-c'` — 2 failed. No `Drop files to attach` status existed, and disabled drop did not prevent the browser default.
- Provider search RED: `cd apps/web && RHYTHM_ISSUE_1580_CONTRACT=1 npx playwright test -c tests/contract/issue-1580-playwright.config.ts --grep 'provider-search-c'` — provider-local search controls were absent; the run reached 4 explicit failures before the outer 120-second command timeout during the fifth missing-control wait.
- Contract: `docs/ai/contracts/task-composer-drop-provider-search.json` (14 UI criteria, all automated and passing).

## Implementation

- Root cause: the live composer exposed only a hidden file input. Its form had no file drag event handling, so browser `File` drops never entered `liveFiles` and the browser's default drop navigation was not cancelled.
- Added form-level file drag handling that reuses `liveFiles`, the existing pending list, and the unchanged send-time `resolveLiveAttachment` path. Disabled drops are cancelled and reuse the existing composer feedback/notification reason.
- Added per-provider search state outside each provider toggle. Filtering, tri-state, and bulk updates share the same displayed-row set; global search behavior remains intact.
- GitNexus pre-edit impact: `Composer` LOW, 1 direct caller (`AgentsWorkspace`), 5 total dependents, no affected process. `ModelCurationPanel` remained unindexed/UNKNOWN; edits stayed within its existing component, stylesheet, and contract test.
- GitNexus post-edit detection: LOW, no affected processes.
- Fresh manager GitNexus evidence: `detect_changes` unstaged, LOW risk, 10 changed symbols across 8 indexed files, 0 affected processes.

## Checks

- `cd apps/web && npm run typecheck` — PASS.
- `cd apps/web && npx playwright test -c tests/electron-e16-playwright.config.ts --grep 'composer-drop-c'` — PASS, 3/3. `composer-drop-c2` directly proves PDF data URLs, other-binary `file:<filename>` handling, and the 20 MiB + 1 byte alert/pending/no-send guard.
- `cd apps/web && RHYTHM_ISSUE_1580_CONTRACT=1 npx playwright test -c tests/contract/issue-1580-playwright.config.ts --grep 'provider-search-c'` — PASS, 5/5.
- `cd apps/web && RHYTHM_ISSUE_1580_CONTRACT=1 npx playwright test -c tests/contract/issue-1580-playwright.config.ts` — PASS, 15/15, including the existing axe serious/critical scan and 390px accessibility/overflow coverage.
- Nested-interactive assertion — PASS for every populated provider search (`closest('button') === null`).
- `git diff --check` — PASS.
- UI review — PASS: pending image/text chips remain compact; provider no-results state and search remain legible without an extra panel.
- Accessibility review — PASS: drag status uses `role=status`; provider searches have provider-specific accessible names; provider toggle remains a separate keyboard button.

## Notes

- Review repair restored `expect(net.denied).toEqual([])` in `e16-c1` and added inert responses for the newer usage-budget, model-provenance, and workspace-member reads so the safety assertion remains meaningful rather than weakened.
- Review repair cleaned the accidental `disabledReason` ternary indentation drift without changing behavior.
- `cd apps/web && npx playwright test -c tests/electron-e16-playwright.config.ts --grep 'e16-c1|composer-drop-c'` — PASS, 3/3.
- `cd apps/web && RHYTHM_ISSUE_1580_CONTRACT=1 npx playwright test -c tests/contract/issue-1580-playwright.config.ts` — PASS, 15/15 after the review repair.
- UI review blocker RED: `cd apps/web && RHYTHM_ISSUE_1580_CONTRACT=1 npx playwright test -c tests/contract/issue-1580-playwright.config.ts --grep 'provider-search-c3|provider-search-c5'` — FAIL, 2/2: missing dynamic displayed-set labels and missing status role.
- UI review blocker repair makes `All / none shown` and `Show all displayed <provider> models` conditional on either global or provider-local search, while preserving the unfiltered labels; the no-results message now has `role=status`.
- Final `cd apps/web && RHYTHM_ISSUE_1580_CONTRACT=1 npx playwright test -c tests/contract/issue-1580-playwright.config.ts` — PASS, 15/15. Tests cover visible/accessibility labels under local and global filtering plus the exact no-results status-role attribute.
- Final `cd apps/web && npm run typecheck` — PASS.
- Final `git diff --check` — PASS.
- Evidence repair `cd apps/web && npx playwright test -c tests/electron-e16-playwright.config.ts --grep 'composer-drop-c'` — PASS, 3/3; includes direct PDF, other-binary, and oversized-file assertions in `composer-drop-c2`.
- Evidence repair `cd apps/web && RHYTHM_ISSUE_1580_CONTRACT=1 npx playwright test -c tests/contract/issue-1580-playwright.config.ts` — PASS, 15/15.
- Evidence repair `cd apps/web && npm run typecheck` — PASS.
- Evidence repair `cd apps/web && npm run build` — PASS; Vite built 1,744 modules (pre-existing chunk-size warning only).
- Evidence repair `cd apps/web && npm run test:dist-smoke` — PASS; index and 2 relative assets verified.
- Evidence repair `git diff --check` — PASS.
- Active-drag screenshot review — PASS: `composer-drag-active.png` visibly captures the restrained composer highlight and `Drop files to attach` status before drop.
- No API server, production server, packaged app, live port, commit, or push was used.
- Existing file/PDF/text resolution and 20 MiB send guard were not changed.
- Unrelated dirty/untracked docs were preserved and are excluded from this run's file list.
