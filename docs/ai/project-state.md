# Project State

## Current focus

**PR #898 (`feature/dual-anthropic-accounts`) — dual Anthropic accounts (team +
personal Pro) in the opencode integration. Implementation + verification gate
complete; DRAFT, awaiting AJ's manual smoke (checklist in the PR body).**

- One engine + a vendored `rhythm-anthropic-accounts` plugin (from
  `opencode-claude-auth@1.5.3`, MIT) routes every Anthropic request per session via
  `x-session-affinity` → Rhythm-owned accounts store; automatic in-place failover on
  quota exhaustion with a `session.spillover` WS event.
- api_server owns the store (single writer: refresh-token rotation), in-app PKCE
  OAuth (`/opencode/auth/accounts*`), session→account resolution (body → profile
  default → app default), spillover intake.
- Flutter: account slots + connect dialog (agent settings sheet), profile default,
  new-session override, header badge, spillover toast/marker.
- Migration: first boot imports the existing Claude Code keychain credential as
  account #1; keychain poll retires once the store has accounts.

## Active branch / PR (open — never auto-merge)

- **#898** `feature/dual-anthropic-accounts` → main. DRAFT. All checks green
  (vitest 2385/2385, tsc, dart format, analyze baseline, macOS debug build, live
  server/engine smoke). Blocks on manual smoke: real 2-account OAuth connect,
  simultaneous sessions, `RHYTHM_FORCE_SPILLOVER` drill.
- **#887** `workflow/run-2026-07-03` — prior run's closeout (delegation/auth/default
  profile), was open for review before this run.

## In progress / next step

1. AJ morning smoke of #898 per PR checklist (start server: `cd apps/api_server &&
   AGENT_LOCAL=true PORT=4001 node dist/server.js`; branch debug app already built).
2. After smoke passes: un-draft, merge manually, then release build (bundling of
   `opencode_plugins/` added to `desktop_release.yml` — verify in release CI).
3. Deferred by design: proactive rate-limit-header switching; profile-create-mode
   account field (edit-mode only today).

## Risks

- Fork/plugin drift: vendored plugin tracks `opencode-claude-auth@1.5.3`; upstream
  transform changes (betas, billing header) need a re-vendor. Routing tests import
  the real vendored module and will catch load failures.
- Concurrent-session git surgery in this checkout: branch ref deleted once
  mid-run + a case-collided `refs/heads/Feature/` dir broke push (both repaired).
- OAuth exchange shape (JSON-first, form-encoded retry) is unverified against the
  live token endpoint until the first real connect (smoke step 2).

## Test status

api_server 2385 passed / 1 skipped (279 files); Flutter analyze at 269-info
baseline, 88/88 on touched files; macOS debug build green; live branch-stack smoke
green (health, accounts, PKCE URL, spillover 202, engine + plugin boot).
