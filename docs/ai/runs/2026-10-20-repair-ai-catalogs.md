---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: verified-scoped
tags: [run, Rhythm]
---

# AI catalog repair

## Files

- `apps/api_server/src/routes/opencode_skills_routes.ts` and its route test: read engine content for a live compiled `<built-in>` skill while retaining 404 for a missing filesystem skill.
- `apps/api_server/src/services/run_quality_service.ts`, its service test, and `apps/web/src/components/ToolWorkspace.tsx`: preserve run grouping and give blank historical identities a visible label; the web row also handles empty or null API values.
- `apps/api_server/src/repositories/agent_designs_repository.ts`, its public URL test, and `ToolWorkspace.tsx`: check local file availability with the serving route's approved Studio boundary before advertising generated asset URLs. Keep valid explicit HTTP(S) URLs on mixed historical rows and show unavailable local deliverables.
- `apps/api_server/src/__tests__/issue_1208_gallery_mp4_thumbnail.test.ts`: allow the invalid-video negative case 10 seconds so the real 5-second Quick Look child timeout completes before Vitest ends the assertion. The test still requires thumbnail 404 and working artifact access.

## Checks

- Before fixes, guarded route/service tests reproduced built-in skill 404 and blank run label. A guarded public URL test reproduced a missing-file URL being advertised.
- `npm run build:guard -- npm --prefix apps/api_server exec -- vitest run src/__tests__/agent_design_public_urls.test.ts src/__tests__/issue_1208_gallery_mp4_thumbnail.test.ts src/__tests__/opencode_skills_routes.test.ts src/services/run_quality_service.test.ts`: 35 passed, 1 platform case skipped.
- `RHYTHM_PLATFORM_POSTER_E2E=1 npm run build:guard -- npm --prefix apps/api_server exec -- vitest run src/__tests__/issue_1208_gallery_mp4_thumbnail.test.ts`: 4 passed, including a real temporary MP4 and PNG poster through Quick Look.
- `npm run build:guard -- ./node_modules/.bin/tsc -p apps/api_server/tsconfig.json --noEmit`: exit 0.
- `npm run build:guard -- npm --prefix apps/web run typecheck`: exit 0.
- A separate guarded `npm --prefix apps/api_server run build` completed before the final Gallery refinement. The final API source was checked by `tsc --noEmit`; the parent owns the exact combined rebuild and packaged confirmation.

## Notes

- The earlier combined run timed out at Vitest's 5-second limit in the invalid MP4 test because `generateLocalVideoPoster` permits its Quick Look child the same 5 seconds. The bounded negative rerun and real positive poster run both passed. No Quick Look child remained afterward.
- GitNexus's original-checkout index is stale (indexed 2026-08-26 at `d341516`) and returned LOW/0 indexed callers for the available symbols. Manual callers include the Skills editor/Flutter, run-quality route/web view, and Gallery API/web view. No high-risk result was reported.
- No API or app process was launched here. The parent will collect packaged skill content, Report Card label, and Gallery row/file evidence against the rebuilt candidate. This run is source-level evidence only.


## Actual combined runtime confirmation

The parent rebuilt and locally Developer-ID signed product `cf49da55af7b9066b4478c391ac9e3efc499afa9`, then ran the focused packaged command recorded in [the combined repair run](2026-10-20-mega-ai-repairs.md). All 18 real catalog render/reload/503-recovery cases and all five tool-detail cases passed, including real Skills content and Report Card window readback. The first combined command was 33 pass/4 fail overall; its four other failures must not be counted as catalog failures or erased.

`npm run build:guard -- bash /private/tmp/rhythm-ai-repair-sandbox-check.sh` passed all three actual fork+API tests using a wholly synthetic read-only fixture source: compiled built-in content agrees with the engine; a historical blank-kind run is still counted and visibly labelled; a missing local Gallery deliverable keeps its record but has null asset URLs. Sandbox started only through `tools/dev/sandbox.sh` on 4098/4097/4099 and tore down successfully. Full command/fixture/receipt details are in the combined run, private log `/private/tmp/rhythm-ai-repair-sandbox-check.log`.

A later b9 packaged recon observed the missing-media row's disabled `Deliverable unavailable` action; the stronger no-write/readback follow-on test is codified but awaits confirmation. These receipts qualify the repaired paths, not creative generation, available-media playback or all AI execution.
