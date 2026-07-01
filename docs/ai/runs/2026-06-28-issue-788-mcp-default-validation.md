---
date: 2026-06-28
repo: Rhythm
branch: worktree-agent-ab13d5db46bec7b0d (off feature/mcp-unify)
pr: none (do not push — worktree branch)
issues: [788]
status: verified-pass
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# #788 — Validate agent_profile_sync MCP defaults vs live ids; document auto-installers

Part of the "Unify MCP source of truth" milestone (mcp-unify-04). Builds on the
integrated #785/#786/#787 state on `feature/mcp-unify`.

## Files changed

- `apps/api_server/src/services/agent_profile_sync.ts` — added
  `validateMcpsAgainstLive()` (mirrors the skill-side `filterAllowlistToLive`) and
  a try/catch `liveMcpNames` fetch (`Object.keys(listMcp())`). Both the insert and
  backfill sites now validate the importer default `["rhythm"]` against the live
  engine id set before persisting. A dead name is dropped + logged loudly (never
  persisted as #765 scope); an empty/unavailable live set (engine down) → default
  unchanged, never throws.
- `apps/api_server/src/services/__tests__/agent_profile_sync_mcp_alignment.test.ts`
  — new (4 tests): default persisted when live; dead name dropped + warned (asserts
  persisted row is null, not silently scoped); two boundary cases (`listMcp` throws /
  returns `{}` → default `["rhythm"]` preserved, `{synced:1}`).
- `apps/desktop_flutter/lib/app/core/agents/curated_mcp_auto_installer.dart`,
  `rhythm_mcp_auto_installer.dart` — header doc comment: materialize-on-install
  trigger; live engine (`GET /opencode/mcp`) = single source of truth; KEEP
  decision. Behavior unchanged.
- `docs/ai/decisions/2026-06-28-unify-mcp-source-of-truth.md` — addendum recording
  the auto-installer KEEP fate + rationale + the MCP-default validation.

## Checks run

- `npm run build` (tsc -p tsconfig.json) → exit 0.
- `npx vitest run agent_profile_sync mcp_names_alignment curated_mcp_no_display`
  → 6 files / 44 tests pass (includes the new #788 file + the #785/#787 guards,
  no regression).
- Falsification: reverting the insert-site validation to the raw constant makes
  the dead-name test fail (`expected '["rhythm"]' to be null`); restored.
- `flutter analyze --no-fatal-infos` on the two edited Dart files → 0 issues
  (`dart format` → 0 changed). Pre-existing `ansi_strip.dart` info (PR #552) is
  unrelated/out of scope.

## Notes

- **Decision — auto-installer fate: KEEP + document.** The two client-side
  installers are the materialize-on-install trigger for the curated/rhythm
  templates, gated on engine-ready + authenticated + cloud-server (auth/cloud
  gating that lives naturally on the client). Not a second MCP source — display
  comes exclusively from the engine list. Folding into a server-side ensure was
  rejected (re-plumbs gating for no source-of-truth benefit). See decision doc.
- **Deviation from dispatch framing:** the dispatch prompt assumed #789
  (`mcp_name_alignment.ts` / `normalizeDerivedAllowedMcps`) was already merged on
  `feature/mcp-unify`. It is NOT — verified the helper is absent on that branch.
  Validation was therefore built self-contained, deliberately mirroring the
  skill-side `filterAllowlistToLive` shape so #789 can later fold both onto one
  shared helper (incl. alias normalization like `ableton`→`ableton-mcp`, which is
  a #789 concern; this run only validates exact live-id membership).
- No new DB columns; no OAuth / #765 enforcement changes; persisted USER
  `allowed_mcps_json` rows untouched.
- `apps/api_server/node_modules` in this worktree is a symlink to the main
  checkout (NOT committed).
- Worktree branch — do NOT push; merges back into `feature/mcp-unify`.
