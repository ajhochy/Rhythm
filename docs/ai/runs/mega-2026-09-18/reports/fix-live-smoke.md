# Summary

- Added one `GET /auth/me` hosted bearer probe in `beforeAll`. A `200` enables hosted domain coverage; a `401` or `403` logs the required single line and skips hosted tests without aborting the suite.
- Kept agent local coverage on the isolated API. Hosted marker cleanup now runs only while the hosted bearer is accepted, while sandbox project and profile cleanup continues independently.
- Classified every smoke target from the renderer gateway map. The hosted email tool and remote domain pages are gated; the schedules based `#1513 tasks` tool and the other agent local surfaces remain ungated.
- Applied the final marker write audit separately to the hosted and sandbox origins without requiring either origin to have writes.
- Kept the remote HTTPS production base security rule and product code unchanged.

# Files changed

- `apps/web/tests/live/mega-2026-09-18-smoke.spec.ts` — documented the two run modes, added the hosted probe and skip gates, guarded cleanup, and audited both origins.
- `REPORT.md` — recorded this handoff.

# Checks run

- Launch discipline — passed: worktree `/Users/ajhochhalter/Documents/Rhythm/.mega-wt/fix-live-smoke`, branch `mega/fix-live-smoke`, and write probe succeeded; checkout started clean.
- GitNexus pre-edit impact — passed with LOW risk for `cleanMarkerRows` and `writeIsSafe`; each affected only the smoke spec and no product execution flow.
- `cd apps/web && npm run typecheck` — passed, exit 0.
- `cd apps/web && ./node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM,DOM.Iterable --types node,@playwright/test --skipLibCheck tests/live/mega-2026-09-18-smoke.spec.ts tests/live-smoke-playwright.config.ts` — passed, exit 0.
- `git diff --check` — passed, exit 0.
- Static hosted gate audit — passed: 11 hosted gates cover the email tool, Facilities, Messages, Projects, Automations, Integrations, main Settings, and task row typography.
- GitNexus `detect_changes --scope unstaged` — unavailable because this exact worktree is not registered; no commit was requested or created. Manual scope inspection showed only the smoke spec plus this report.
- Live Playwright and sandbox execution — not run because the task explicitly prohibited sockets.

# Decisions

- Treated the `email` Agent Tool as hosted because it reads `gateway.domains.integrations`; treated the `#1513 tasks` Agent Tool as agent local because it reads `gateway.domains.schedules`.
- Treated `/tasks` typography as hosted because the page reads `gateway.domains.tasks`.
- Gated the main Settings test because workspace values use the hosted settings gateway; kept splitter coverage ungated because layout persistence is browser local.
- Kept Agent Settings ungated as requested; its asserted profiles, accounts, and runtime sections use the sandbox session and MCP paths.
- A cleanup `401` or `403` marks hosted coverage unavailable and logs once. Other hosted probe or cleanup errors remain failures.
- Left `tests/live-smoke-playwright.config.ts` unchanged because it already supplies the sandbox local base and a remote HTTPS production base.
- Did not publish the Dev Dashboard run tracker because its required publisher uses a socket and this task prohibited sockets.
- Did not commit, stash, check out another branch, start a server, or open a socket.
