---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
status: partial
tags: [recon, packaged, ai]
---

# AI follow-on packaged recon

Source under test: `b9eaca6b421425403fc8788ae77ef7d3bc4464f1`.

Command: `node tools/testing/run_packaged_ai.mjs packaged-ai-followon-recon.spec.ts --output /private/tmp/rhythm-ai-colony-diagnostic-recon --reporter=list,json > /private/tmp/rhythm-ai-colony-diagnostic-recon.log 2>&1`

Runner summary relayed by the parent: 3 probes, 2 passed, 1 failed, 220.5 seconds. This is recon evidence only, not a qualification run.

## Profile draft discard

- The packaged Profiles workspace and profile label control were visible before the reload.
- Forced reload produced `GET /agent-configs` status 200 with 54 records.
- Creating a fresh `[smoke]` draft displayed `Unsaved changes` and enabled Save.
- Back displayed the discard confirmation. Discard followed by forced reload produced another 200 response with 54 records.
- Captured `/agent-configs` request methods were GET only; no non-GET write was observed.
- The codified regression additionally compares saved profile identities and `updatedAt` values by digest before and after dismissal; labels and identifiers are not emitted.

## Gallery missing media

- The actual Gallery request returned `GET /agent-designs` status 200 with 22 records.
- One image/video candidate had both `artifactUrl` and `thumbnailUrl` absent (`null`).
- Selecting the matching row displayed the detail inspector and a visible disabled action labeled `Deliverable unavailable`.
- No open, preview, or native action was invoked. The follow-on regression adds a before/after API readback digest and a non-GET request check; that test confirmation is pending.
- This covers only the missing-media unavailable inspector. Available-media rendering, authenticated asset loading, folder operations, and playback remain unqualified.

## Bot Crossing readiness

- After the bounded 60-second observation, the scene had no `.boot` element, `.scan-notice` was present and not hidden, and the populated project-row count was zero.
- The successful-ready condition was false. Search, inventory observation, and generation cancellation were therefore not attempted, so the observer did not interfere with the scene-owned inventory request.
- The packaged run reported a strict IPC error audit failure; the source graph reason was `scene-ready-invalid` while the worker service reported ready. This is an unsuccessful scene recon, not search or inventory evidence.
- The first later probe on build `72ac` reached a populated scene but timed out waiting for `No sessions match these filters.` in the selected-project pane. No project was selected, so that pane had no such empty state; this was a recon-instrumentation error, not product evidence.

## Bot Crossing search and return recon

Build: `72ac1a93e60618ec1448bcf9255879632ec01f6b` functional local package.

Command: `node tools/testing/run_packaged_ai.mjs packaged-ai-followon-recon.spec.ts --grep 'recon.*Bot Crossing' --output /private/tmp/rhythm-ai-colony-search-recon --reporter=list,json > /private/tmp/rhythm-ai-colony-search-recon.log 2>&1`

Runner summary relayed by the parent: 1 probe passed; the test body took about 34 seconds, with about 70 seconds including app startup and teardown. This remains recon, not packaged follow-on test confirmation.

- Initial scene: boot count 0, notice hidden, 58 project rows.
- After navigating away and returning: same child page retained; boot count 0, notice hidden, 58 project rows.
- Actual search UI before query: 58 project rows; private row text digest `d6ea53e8`; no-locations empty note absent.
- A unique `[smoke]` no-match query produced 0 project rows; digest `811c9dc5`; no-locations empty note present.
- Clearing the query restored 58 rows and the original digest; no-locations empty note absent.
- Read-only scene IPC returned a `threads` page with 5 records. Response keys were `collection`, `generation`, `nextCursor`, `records`, and `scannedAt`; a next cursor was present and `scannedAt` was numeric. Private record content and identifiers were not captured here.
- The temporary query was cleared. No project was selected and no camera action was taken.
- This recon supports codification of actual search/clear behavior and retained populated data in `apps/web/tests/packaged/packaged-ai-companions.spec.ts`, which installs the native renderer error audit and uses its existing child/readiness helpers. Packaged test confirmation remains pending; other native authority and source-store behaviors remain unqualified.
