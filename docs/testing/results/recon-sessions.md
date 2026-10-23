# P0 recon: sessions

Date: 2026-10-19. Test source base: `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`.
Locally built target: `/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app` **0.18.83**. Engine health reports
`0.0.0-rhythm-894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`. This bundle was built locally from the mega source head; the API build-identity JSON and engine version both match it. Ports were free before launch.
The existing `packaged-app.ts` fixture launched the app and quit it; no live
API process was started by hand. No messages to real people were sent. Model prompts recorded below used the explicit opt-in and nonce-owned sessions.

## Observations before codification

UI `GET :4001/agent-sessions?scope=chats&limit=100` → 200, object `{sessions, ancestors, pageInfo, resumable}`. Node tokenless GET works. Advanced dialog contains `advanced-name`, `advanced-profile`, `advanced-cwd`, `advanced-isolate-worktree`, `advanced-create`; blank-name Start is disabled. Session mutation recon pending.

Probe command (temporary recon spec, removed after codification):
`cd apps/web && RHYTHM_PACKAGED_APP=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app ./node_modules/.bin/playwright test -c tests/packaged/recon-playwright.config.ts`
Captured local output: `/private/tmp/rhythm-feature-recon-mega.log` (sanitized shape/count summaries; not committed).
Read-only probe: 1 test finished in 42.7s, no renderer errors. This only means
the probe completed; feature assertions had not yet been authored.

## Observed mutation and project contracts

Advanced create returns 201 with `id`, exact `name`, `cwd`, `profileId` and `sdkSessionId`. Detail returns 200 with `{session,messages}`; the read-only SQLite row agrees. Reload retains the named row. UI `DELETE /agent-sessions/<owned-id>/hard` returns 204, detail becomes 404, the DB row disappears and the SDK session endpoint returns 404. Soft close is not permanent cleanup.

Recon found two fixture preconditions: Advanced may open before the catalog arrives and leave profile unset; cwd can also be empty. Tests explicitly select the existing enabled `coding-agent` profile (configurable via RHYTHM_FEATURE_PROFILE_ID), supply their own temporary cwd, clear any retained branch, and disable worktree isolation before testing name validation or an injected failure. A valid name/profile with missing cwd triggers native form validation and sends no POST; that is not evidence of an API outage. Action waits are capped at 15 seconds.

Opening Advanced from an unassigned selection can request `GET /projects//branches`, producing an unexpected NOT_FOUND ERROR. This remains a failing log audit, even when session/UI/API/DB/engine assertions succeed. Exact owned deletion-proof 404s, including the observed `?transcriptLimit=50` form, are the only narrow log exception.

Owned project create returns 201 with name/cwd and `archivedAt:null`; API and read-only DB agree. Creation preserves other stored project choices. A user collapse stores false. After session hydration on reload, the selected group reopens while storage remains false, matching #1558 Repair 3. Finally the exact nonce-owned session and project are deleted, DB/list absence is checked, only the removed project's preference key is cleared, and its temporary directory is removed. Earlier probe runs did not snapshot layout keys, so complete layout restoration from those earlier probes is not asserted. Child pagination remains an explicit failing gap.

The final long-name probe preserved the full 60-repeat Unicode suffix in API detail and read-only SQLite after reload, with the owned prefix visible in the rail. Its assertions succeeded; invalid branch-request and missing OAuth configuration ERRORs kept the case red.
