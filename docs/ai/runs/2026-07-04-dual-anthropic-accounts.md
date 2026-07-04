---
date: 2026-07-04
repo: Rhythm
branch: feature/dual-anthropic-accounts
pr: 898
issues: []
status: verified — draft PR open, awaiting manual smoke
tags: [run, Rhythm]
---

# Dual Anthropic accounts (team + personal) in the opencode integration

Overnight autonomous run (AJ asleep): brainstorm → spec → plan → 6 subagent
implementation tasks → verification gate → draft PR #898.

## Files

- `docs/superpowers/specs/2026-07-04-dual-anthropic-accounts-design.md` — approved spec
- `apps/api_server/src/services/anthropic_accounts_{store,service}.ts` (+tests) — single-writer
  accounts file `~/Library/Application Support/Rhythm/anthropic-accounts.json`, N-account
  15-min refresh loop (single-use refresh-token rotation persisted)
- `apps/api_server/src/services/anthropic_oauth_service.ts` + routes on `opencode_auth_routes.ts`
  — in-app Claude Pro/Max PKCE (`/opencode/auth/accounts*`, login-start/login-complete
  paste-code flow, client `9d1c250a-…`, token endpoint `claude.ai/v1/oauth/token`)
- `apps/api_server/opencode_plugins/rhythm-anthropic-accounts/` — vendored
  `opencode-claude-auth@1.5.3` (MIT; pristine commit `1e36ad199`, mods `0d0437ea8`):
  per-request account routing via `x-session-affinity`, quota failover + spillover POST,
  `RHYTHM_FORCE_SPILLOVER` / `RHYTHM_ANTHROPIC_BASE_URL` knobs; swapped into
  `REQUIRED_PLUGINS` (legacy entry stripped, user entries preserved)
- `apps/api_server/src/routes/opencode_spillover_routes.ts` + controller/repo/migrations —
  `agent_sessions.anthropic_account_id`, `agent_configs.default_anthropic_account_id`,
  create-time resolution (body → profile → app default), `session.spillover` WS event
- Flutter: `anthropic_accounts_data_source.dart`, reworked `ai_account_section.dart`
  (account slots + Add Claude account + connect dialog), profile-default picker,
  new-session override, header badge, spillover toast + transcript marker
- `.github/workflows/desktop_release.yml` — bundles `opencode_plugins/` into Resources

## Checks

- api_server vitest: 279 files, 2385 passed / 1 skipped, exit 0 (one load-flake in
  `agent_profile_sync.test.ts` on a mid-gate run; 10/10 isolated; clean full re-run)
- `tsc --noEmit` clean; `npm run build` clean; `ai-workflow checks --level pr` all ✓
- Flutter: `dart format --set-exit-if-changed` clean; analyze at 269-info baseline (0 new);
  88/88 tests on touched files; `flutter build macos --debug` ✓
- Live smoke (branch server + engine + branch app): /health ✓, accounts endpoints ✓
  (real PKCE URL), spillover 202 contract ✓, engine boots with vendored plugin (no errors),
  screenshots of new account UI captured; migration correctly skipped with no keychain creds
- Deferred to manual smoke: real two-account OAuth connect, simultaneous sessions on both
  accounts, `RHYTHM_FORCE_SPILLOVER` drill (checklist in PR #898 body)

## Notes

- **Vendoring decision:** `opencode-claude-auth` does load-bearing request transforms
  (billing-header signing as system[0], OAuth identity split, `mcp_` PascalCase tool
  prefixing, beta management). Vendor+modify beat reimplementation; VENDORED.md records it.
- **Single-writer rule** exists because Anthropic refresh tokens rotate (single-use);
  the plugin never writes the store, spillover persists via POST → api_server.
- Two environment incidents, both external: (1) something deleted the branch ref mid-run
  (repaired from reflog by the Task C subagent); (2) a case-collided `refs/heads/Feature/`
  dir broke `git push` (repaired via update-ref + pack-refs). Watch for whatever session
  is doing git surgery in this checkout.
- Stale dev app instance (Jul 3) was quit and replaced with the branch debug build;
  branch api_server left running in the session's background shell (may die when the
  session ends — restart per smoke checklist step 1).
