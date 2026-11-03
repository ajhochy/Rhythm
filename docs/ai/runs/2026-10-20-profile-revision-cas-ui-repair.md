---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, Rhythm]
---

## Files

- `apps/web/src/gateway/sessions.ts`: retain a valid server profile revision and send it as optional `expectedRevision` on PATCH.
- `apps/web/src/store.tsx`: preserve the editor's captured revision through the live save and return server readback.
- `apps/web/src/components/Profiles.tsx`: save with the draft's revision and adopt the returned revision after success.
- `apps/web/tests/profiles-editor-redesign.spec.ts`: rendered stale-save conflict contract.
- `apps/web/tests/packaged/packaged-ai-profile-save.spec.ts`: expect revisioned retry and add real packaged stale-save conflict with nonce-owned cleanup.

## Checks

- Native private Recon `/private/tmp/rhythm-ai-fixture-Qyk2j6/recon.json`: observed create revision 0, normal API advance to revision 1, then UI PATCH `{label: UI draft}` without `If-Match` returned 200/revision 2 and overwrote the API winner. Exact owned profile cleanup returned 204 and SQLite had no row.
- RED: `cd apps/web && npx playwright test --config playwright.profile-cas.temp.config.ts -g 'live profile edit rejects a stale revision' --workers=1` failed at the expected request body: `expectedRevision: 0` absent. Temporary config selected already-installed Chrome; removed after checks.
- GREEN: `cd apps/web && npx playwright test --config playwright.profile-cas.temp.config.ts -g 'live profile edit' --workers=1` passed 2/2 after the source change, including a second successful edit using revision 1.
- `cd apps/web && npx tsc -b --pretty false` passed.
- Broader rendered file on installed Chrome before the second revision-progression test was added: 35 passed, 1 skipped, 1 unrelated fixture-mode failure at `profiles-editor-redesign.spec.ts:108` (a filtered skill checkbox remained hidden). The same case failed alone. Profile save/CAS cases passed.
- `cd apps/web && npx playwright test -c tests/packaged/packaged-playwright.config.ts tests/packaged/packaged-ai-profile-save.spec.ts --list` discovered both packaged cases. They have not run against a rebuilt signed app.

## Notes

- The API's `expectedRevision` predicate already existed; this change only propagates it through the web editor. Other callers with no known revision retain the optional legacy request shape.
- The renderer keeps its draft on conflict and does not retry automatically. A new signed-app native Confirm remains required before claiming the packaged behavior fixed.
- GitNexus index was 296 commits behind this worktree and reported LOW/zero callers; manual blast is high across profile editing, so the change stayed within the profile editor/store/gateway path.
