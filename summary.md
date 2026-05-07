# rhythm_add_rhythm_step

Workflow `wf-2026-05-07-2yo8tk`.

## Description

Adds two new MCP tools to `@ajhochy/rhythm-mcp-server`:

- `rhythm_add_rhythm_step` — adds a step (with optional `day_of_week` and `sort_order`) to an existing rhythm via `POST /rhythms/:id/steps`.
- `rhythm_delete_rhythm_step` — removes a step from a rhythm via `DELETE /rhythms/:rhythm_id/steps/:step_id`.

Mirrors the pattern of `rhythm_add_project_step`. Auth via `RHYTHM_API_TOKEN` against `https://api.vcrcapps.com`.

Package version bumped `0.2.0 → 0.3.0`.

## Issues completed

- #437 — Verify package version is 0.3.0 in `apps/mcp_server/package.json` (verified: 0.3.0 on `rhythm_add_rhythm_step`).
- #438 — Surface npm publish as manual setup (no code change; documented below).

Underlying implementation commits already on the branch:
- `5de9ed3` feat(430): Add `day_of_week` string→number helper in `rhythms.ts`
- `f46973b` feat(431): Implement `rhythm_add_rhythm_step` MCP tool
- `fae93bd` feat(432): Implement `rhythm_delete_rhythm_step` MCP tool
- `0038986` feat(433): Bump `@ajhochy/rhythm-mcp-server` 0.2.0 → 0.3.0

## Manual setup needed

### Publish `@ajhochy/rhythm-mcp-server@0.3.0` to npm

Publishing requires interactive `npm login` with 2FA, which an automated agent cannot perform.

1. `cd /Users/ajhochhalter/Documents/wt-wf-2026-05-07-2yo8tk-base/apps/mcp_server`
2. `npm login` (enter username, password, and 2FA OTP)
3. `npm publish --access public`
4. Verify: `npm view @ajhochy/rhythm-mcp-server version` → should print `0.3.0`
5. Close GitHub issue #435 once published
