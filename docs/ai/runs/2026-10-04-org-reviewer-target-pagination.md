---
date: 2026-10-04
repo: Rhythm
branch: fix/org-review-target-pagination
pr: null
issues: [org-reviewer-target-pagination]
status: source-verified-runtime-pending
tags: [run, rhythm]
---

# Org Reviewer target-state pagination

## Files

- Added bounded target-state paging to `OrgReviewerService.context`, including
  stateless receipt-bound cursors, both legacy insertion-order and canonical
  whole-state pre-release scans on every page, and Unicode-safe offsets.
- Extended the MCP context tool schema, signed forwarding, existing
  trusted-context scan/taint-boundary handling, and untrusted fencing for
  `currentStatePage`.
- Updated the reviewer skill's exact target-page reconstruction loop and added
  the frozen R13 owned skill hash for safe adoption only.
- Added focused service, route, MCP, and seed regressions; updated the context
  budget contract and recorded the design decision.

## Checks

- `cd apps/api_server && npx vitest run src/services/__tests__/org_reviewer_service.test.ts --no-file-parallelism` — PASS, 59 tests (including legacy/canonical cross-field scanning, profile-revision staleness, skill-name continuation, and fragment-schema rejection).
- `cd apps/api_server && npx vitest run src/__tests__/org_reviewer_routes.test.ts` — PASS, 4 tests.
- `cd apps/api_server && npx vitest run src/__tests__/org_optimizer_seed_agent_binding.test.ts` — PASS, 13 tests.
- `cd apps/mcp_server && npx vitest run src/tools/__tests__/orgReviewer.test.ts` — PASS, 7 tests (including hostile `currentStatePage.text` withholding at ingress).
- `cd apps/api_server && npm run build` — PASS (`tsc -p tsconfig.json`, then the existing advisory copy postbuild).
- `cd apps/mcp_server && npm run typecheck` — PASS.
- `cd apps/mcp_server && npm run build` — PASS.
- A direct `npx tsc --noEmit` attempt in `apps/api_server` was not usable as a
  gate because its staged local binary link caused `npx` to try the unavailable
  registry; no dependency install was attempted. The repository's actual
  `npm run build` script used the staged compiler and passed.

## Notes

- No normal app, API, engine, live database, personal evidence, or unrelated
  existing model session was operated. Source checks used a synthetic route
  fixture and in-memory databases. Original source/index and cached dependency
  links were read; no other checkout's source was edited.
- No commit, push, or publish occurred. An independent Sol source review
  identified the legacy insertion-order versus canonical cross-field scanner
  gap; this run applies that correction and adds synthetic coverage. No further
  model review or private-evidence review was run in this session.
- The historical live entries in
  `docs/ai/contracts/org-reviewer-context-budget.json` predate this pagination
  change. They were marked pending for this change rather than represented as
  current acceptance evidence.

## Independent Sol verification

- Actual persisted local implementation session:
  `01a1089b-c2d6-7b23-acb3-8c2b81e4d61e`, model `gpt-5.6-terra`.
  The same session implemented the review correction; no duplicate producer.
- `cd apps/api_server && node node_modules/vitest/vitest.mjs run src/services/__tests__/org_reviewer_service.test.ts src/__tests__/org_reviewer_routes.test.ts src/__tests__/org_optimizer_seed_agent_binding.test.ts src/__tests__/org_reviewer_harness_isolation.test.ts --no-file-parallelism --no-cache` — PASS, 4 files / 82 tests.
- `cd apps/mcp_server && node node_modules/vitest/vitest.mjs run src/tools/__tests__/orgReviewer.test.ts src/security/__tests__/external_content_role_graph.test.ts --no-cache` — PASS, 2 files / 11 tests.
- Independent API `npm run build`, MCP `npm run build`, and MCP
  `node node_modules/typescript/bin/tsc --noEmit` — PASS.
- The first default-sandbox route attempt was denied `listen EPERM` for its
  ephemeral localhost fixture. The authorized synthetic suite passed through
  standard automatic approval review. No actual application server started.
- The first MCP assertion run passed 11 tests but exited 1 when Vitest tried
  to write results through an inherited cache symlink. API/MCP cache links
  were replaced with task-local cache directories and the final runs disabled
  cache; the final MCP run exited 0. No cache-write permission was broadened.
- Independent review reproduced the serialization-order safety gap using
  synthetic strings, then verified both complete representations are scanned
  before every page. Exact legacy skill fixture and adoption digest were
  compared with frozen R13. No unresolved source-review finding remains.
- Final verification is source/synthetic acceptance only. Normal runtime
  qualification remains pending, and no private-evidence model review ran.

## Pending normal-app qualification

In the normal authorized application integration environment, exercise a
target that pages because of a large profile, managed skill, and live catalog;
read every page with the identical target/window/session arguments; verify
receipt stability and exact JSON reconstruction; and verify full-state safety
withholding. The reviewer skill requires whole-state reconstruction before a
proposal; the unchanged stateless submit API validates exact receipts/checks
but does not durably track page consumption. Existing `boundSkills`
`bodyTruncated`/`bodyHash` and catalog omission metadata remain semantic limits
to inspect. Do this against disposable approved fixtures only, through the
normal integration process, not by starting a second API server.
