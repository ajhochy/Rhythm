---
date: 2026-07-16
repo: Rhythm
branch: epic1116/cluster-b-org-library
pr: pending
issues: [1054, 1056]
status: pass
tags: [run, Rhythm]
---

# #1054 (wire skills.urls to org index) + #1056 (publish approved skills to org library)

## Files

- `apps/api_server/src/services/opencode_plugin_config.ts` — new
  `ensureOrgSkillIndex()` + exported `resolveProdApiBase()`.
- `apps/api_server/src/server.ts` — calls `ensureOrgSkillIndex()` +
  `reloadSkills()` at boot, right before the engine spawns.
- `apps/api_server/src/routes/org_skills_routes.ts` — fixed the file-serving
  route from `/files/:name/:file` to `/:name/:file` (see decision doc; the
  original path never matches what the fork's `Discovery.pull` requests).
- `apps/api_server/src/config/env.ts` — doc comment noting `prodApiUrl`/
  `prodAuthToken` are now also used by org-skills wiring/publish.
- `apps/api_server/src/services/org_proposal_appliers_wiring.ts` — new
  `publish-skill-to-org` validator + applier, registered in
  `registerAllProposalAppliers`.
- `apps/api_server/src/repositories/agent_org_proposals_repository.ts` —
  added `'failed'` to `ALLOWED_TRANSITIONS`.
- `apps/api_server/src/controllers/org_proposals_controller.ts` — `approve()`
  now accepts `'failed'` (retry) alongside `'proposed'`.
- `apps/api_server/src/services/org_risk_classifier.ts` — explicit
  `publish-skill-to-org` entry in `HIGH_RISK_KINDS`.
- `apps/api_server/src/models/agent_org_proposal.ts` — doc comment updates
  (kind list, status state machine).
- New tests: `__tests__/opencode_plugin_config_org_skills.test.ts` (9),
  `__tests__/issue_1056_publish_skill_to_org.test.ts` (12); updated
  `__tests__/org_skills_routes.test.ts` (route-path fix) and
  `__tests__/org_proposals_routes.test.ts` (+1 retry test).

## Checks

- `cd apps/api_server && npx tsc --noEmit` — clean, no errors.
- `npx vitest run` — 2875 passed, 32 skipped (326 files), 0 failed. Full
  suite, not just the touched files.
- `gitnexus impact`/`detect_changes` — the worktree's gitnexus index has no
  `.gitnexus` directory of its own (it reflects the main checkout at
  `/Users/ajhochhalter/Documents/Rhythm`, not this worktree's branch), so
  `impact({target:"orgSkillsRouter"/"OrgSkillsRepository"})` and
  `detect_changes()` both returned "not found"/"no changes detected" against
  symbols that only exist on this branch. Did a manual grep-based blast-radius
  check instead: the `org_skills_routes.ts` file-route path has exactly one
  internal consumer (its own test file, updated) plus the external,
  unindexable forked engine; the new `'failed'` status is written by exactly
  one applier (`publishToOrgApplier`), so every other proposal kind's
  existing behavior is unaffected (confirmed by the full suite staying green).

## Live e2e (RHYTHM_LIVE_E2E-equivalent — real forked engine + real server, manual)

Built the fork and api_server, then ran two real spawned instances against
isolated sandboxes (never touching the real `~/.config/opencode` or `:4001`):

```sh
cd apps/opencode_fork/packages/opencode  # binary already built at
                                          # dist/opencode-darwin-arm64/bin/opencode
cd apps/api_server && npm run build

# Instance 1 — happy path (self-referential prod: PROD_API_URL points at
# this same server, since /org-skills is mounted on every role).
HOME=<sandbox>/home \
RHYTHM_OPENCODE_CONFIG_PATH=<sandbox>/home/.config/opencode/opencode.json \
RHYTHM_MANAGED_SKILLS_DIR=<sandbox>/managed-skills \
PROD_API_URL=http://localhost:4144 \
PROD_AUTH_TOKEN=<minted session token> \
RHYTHM_OPENCODE_BIN=<fork bin> \
AGENT_LOCAL=true PORT=4144 DB_PATH=<sandbox>/e2e.db \
node dist/server.js
```

Pre-seeded (direct repository calls, before spawn): a published org skill
`e2e-org-skill`, an unpublished `e2e-hidden-skill`, a user + session (for the
bearer token), a managed local skill `e2e-publish-me` on disk, and a
pre-existing user `skills.urls` entry (`https://example.com/.well-known/skills/`)
plus a `skills.paths` entry in the managed config.

**#1054 observed:**
- Managed `opencode.json` after boot: `skills.urls` =
  `["https://example.com/.well-known/skills/", "http://localhost:4144/org-skills"]`
  — pre-existing entry preserved, new entry appended. `skills.paths` =
  `["~/my-custom-skill-path"]` — untouched.
- `GET /org-skills/index.json` → `{"skills":[{"name":"e2e-org-skill","files":["SKILL.md"]}]}`
  — `e2e-hidden-skill` correctly excluded.
- `GET /opencode/skills` (the real engine, via Rhythm's proxy) →
  includes `e2e-org-skill` with `location` under
  `<sandbox>/home/.cache/opencode/skills/e2e-org-skill/SKILL.md` — proof the
  REAL fork engine's `Discovery.pull` fetched the index AND downloaded the
  file (this is exactly the path the pre-existing `/files/` route bug would
  have broken).
- Second boot (separate sandbox) with `PROD_API_URL=http://localhost:1`
  (unreachable): server still bound its port and `/health` returned 200;
  `GET /opencode/skills` returned normally (just the built-in skill, no
  crash); the fork's own log
  (`~/.local/share/opencode/log/*.log`) recorded:
  `ERROR ... service=skill-discovery url=http://localhost:1/org-skills/index.json
  err=Transport error ... failed to fetch index` — the documented graceful
  degradation, confirmed live.

**#1056 observed (same instance 1, then the unreachable-prod instance for the
failure case):**
- Created a `publish-skill-to-org` proposal for `e2e-publish-me`
  (`action:'publish'`) via direct repository insert (no REST create route
  exists for any proposal kind — mirrors the established test precedent).
  `POST /agent-org-proposals/:id/approve` → 200, status `applied`;
  `GET /org-skills/index.json` now includes `e2e-publish-me`;
  `GET /org-skills/e2e-publish-me/SKILL.md` returns the exact managed-skill
  body (frontmatter included).
- A second proposal (`e2e-reject-me`) → `POST .../reject` → status
  `rejected`; index.json unchanged (never contained it).
- An `action:'unpublish'` proposal for the now-published `e2e-publish-me` →
  approve → 200; index.json no longer lists it; direct file fetch now 404s.
- On the unreachable-prod instance: created a publish proposal, approved →
  HTTP 500, proposal status `failed` (confirmed via
  `GET /agent-org-proposals?status=failed`); re-approving the SAME proposal
  (still unreachable) → HTTP 500 again but NOT a 409 conflict — proving the
  retry path is accepted, not blocked as an illegal transition. (A retry
  actually *succeeding* once prod is reachable is covered by the unit test
  `#1056-prod-down: ... can be retried and succeeds once prod is reachable
  again`, using the same real `applyProposal`/repository code with only the
  network boundary mocked — the same pattern already established by
  `sync_orchestrator_service.test.ts` for this exact class of external-API
  failure test.)
- The real `~/.config/opencode/opencode.json` was confirmed byte-identical
  (sha256 `0ba2d1a9...` and mtime unchanged) before and after the entire
  session — the managed-config isolation held throughout.

Both spawned instances and the two sandbox directories were torn down after
the run; two throwaway seed scripts used to seed the sandboxes
(`__e2e_seed_1054_1056.ts`, `__e2e_create_publish_proposal.ts`) were deleted
and are not part of the commits.

## Notes

- `#1053`'s file-serving route bug (see decision doc) was a genuine
  pre-existing defect, not something introduced by this work — it shipped in
  the prior commit on this same branch (`c16a5d573`). Fixing it was necessary
  for #1054's own acceptance criterion ("engine GET /skill lists org skills")
  to be provably true; without the fix, `index.json` would resolve but every
  skill's file download would silently 404 and no org skill would ever
  actually appear in a live engine.
- Did not attempt to wire a live "user changed the production URL in
  Settings" trigger — no such event currently reaches the local Node
  process (confirmed by reading `ApiServerService.buildApiServerEnvironment`
  in Flutter: only `PORT`/`DB_PATH`/`AGENT_LOCAL`/memory-vault vars are
  passed at spawn). `ensureOrgSkillIndex()` re-running on every boot, plus
  its idempotent replace-in-place behavior, is what currently exists for
  "changing the server URL updates the entry" — proven at the unit level
  (two calls with different URLs replace, not duplicate).
