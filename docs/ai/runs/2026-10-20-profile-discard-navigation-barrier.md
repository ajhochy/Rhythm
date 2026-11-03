---
date: 2026-10-20
repo: rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: pass
tags: [run, rhythm, profiles, playwright]
---

# Wait for the discarded profile editor to unmount before reloading

## Files

- `apps/web/tests/packaged/packaged-ai-followon.spec.ts`: after Discard, require the Agents route, Profiles unmount, and Agents workspace visibility. On returning to Profiles, require `No unsaved changes`, absence of the nonce draft label and discard dialog, then force the fresh catalog GET and full-page reload. The saved-profile identity digest and zero non-GET `/agent-configs` assertions remain.

## Checks

- Exact signed local bundle `5dfffb5d9978795935becfe4723c8196bb2f883d`, first broad synthetic selection: **59 passed / 1 failed**, 0 skipped/flaky. The sole failure was this test's `Page.handleJavaScriptDialog: No dialog is showing` during `page.reload()`. Log `/private/tmp/rhythm-private-5dff-broad-native-confirm-20261020.log`; private preserved trace and error context `/private/tmp/rhythm-profile-discard-5dff-evidence-9lPmUgLX/` (0700 directory, 0600 files; trace SHA-256 `a77a726cbf5fd25ecc2a217774a78024155a4faa6c90dd6348176260718c11e6`).
- Trace order: Discard click completed, then the test immediately navigated by hash back to Profiles and called reload. A `beforeunload` JavaScript dialog appeared during reload; the failure snapshot still showed the unsaved nonce draft. `Profiles.tsx` installs that unload guard while dirty, and `performNavigation('back')` initiates SPA navigation. The trace supports a test navigation race; it does not establish a persisted-profile write or a product discard defect.
- Guarded strict TypeScript for the packaged spec: `npm run build:guard -- ./apps/web/node_modules/.bin/tsc -p /private/tmp/rhythm-profile-discard-tsconfig-20261020.json --noEmit` — exit 0. Guarded Playwright discovery of `packaged-ai-followon.spec.ts` — 2 tests found, exit 0. `git diff --check` — clean.
- Independent rerun on the same exact signed bundle: `npm run build:guard -- node tools/testing/run_packaged_ai.mjs --synthetic packaged-ai-000-primary-first-use.spec.ts packaged-ai-001-primary-missing-cwd.spec.ts packaged-ai-companions.spec.ts packaged-ai-cookbook.spec.ts packaged-ai-followon.spec.ts packaged-ai-hermes-provider-setup.spec.ts packaged-ai-mcp-stdio.spec.ts packaged-ai-owned-history.spec.ts packaged-ai-owner-identity.spec.ts packaged-ai-private-approvals.spec.ts packaged-ai-private-gallery-research.spec.ts packaged-ai-private-live-artifact.spec.ts packaged-ai-private-memory-metadata.spec.ts packaged-ai-private-memory-paging.spec.ts packaged-ai-private-playbook.spec.ts packaged-ai-private-skills.spec.ts packaged-ai-profile-save.spec.ts packaged-ai-private-profile-dirty-switch.spec.ts packaged-ai-private-schedule-delete.spec.ts packaged-ai-private-disabled-schedule.spec.ts packaged-ai-private-schedule-timing.spec.ts packaged-ai-retention-settings.spec.ts packaged-ai-tool-pins.spec.ts packaged-ai-tools.spec.ts packaged-rhythm-primary-chat.spec.ts packaged-sessions.spec.ts packaged-session-project-scope.spec.ts packaged-ai-settings.spec.ts packaged-approval-expiry.spec.ts --grep-invert UNVERIFIED` — **60 passed / 0 failed/skipped/flaky**, 152.939s. This profile-discard case passed in 609ms. Report `/private/tmp/rhythm-private-5dff-broad-green-evidence-20261020/report.json`; log `/private/tmp/rhythm-private-5dff-broad-discard-confirm-20261020.log`.

## Notes

The green selection used a wholly synthetic private fixture with the model gate off. Its 60 scoped cases do not close the remaining AI behavior inventory or the explicitly excluded `UNVERIFIED` contracts. No production code, saved profile, normal account, or operator data was changed by this test repair.
