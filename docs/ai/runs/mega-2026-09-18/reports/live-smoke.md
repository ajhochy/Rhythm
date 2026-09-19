# Summary

Added a dedicated live Playwright smoke suite for the 2026-09-18 mega PR. The suite uses the existing live gateway harness, production `https://api.vcrcapps.com` for production domains, and sandbox-local API/engine defaults on ports 4098/4097 for Agents, projects, profiles, and tools. It never hard-codes or writes credentials.

The suite records every page write to either API origin, captures IDs from create responses, rejects writes that do not contain the marker or a captured ID, removes marker-prefixed stragglers before the suite, after every test, and after the suite, and removes temporary project directories. UI lifecycle coverage creates, reads back, and deletes Facilities rooms/reservations, project templates, agent projects, and profiles.

Playwright was not run in this worker because the brief prohibits socket binding. The orchestrator must run the live command below after starting the isolated Rhythm sandbox.

# Files changed

- `apps/web/tests/live/mega-2026-09-18-smoke.spec.ts` — live production/sandbox smoke coverage, guarded writes, straggler cleanup, accessibility checks, lifecycle tests, browser boundaries, typography checks, and splitter persistence.
- `apps/web/tests/live-smoke-playwright.config.ts` — extends the existing live config, targets only the mega smoke spec, passes the bearer from process environment to Vite, and defaults to isolated ports 4098/4097.
- `REPORT.md` — this implementation and verification handoff.

# Checks run

- `cd /Users/ajhochhalter/Documents/Rhythm/.mega-wt/ws-live-smoke && pwd && git rev-parse --abbrev-ref HEAD` — pass; worktree `/Users/ajhochhalter/Documents/Rhythm/.mega-wt/ws-live-smoke`, branch `mega/ws-live-smoke`.
- `echo ok > .write-probe && rm .write-probe` — pass; worktree is writable.
- `cd apps/web && npm run typecheck` — pass, exit 0. Output tail: `rhythm-desktop-agents@1.0.0 typecheck` / `tsc -b`.
- `cd apps/web && node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck --strict --types node --lib ES2022,DOM,DOM.Iterable tests/live/mega-2026-09-18-smoke.spec.ts tests/live-smoke-playwright.config.ts` — pass, exit 0 with no diagnostics.
- `cd apps/web && npm run build` — pass, exit 0. Output tail: `✓ 1695 modules transformed` and `✓ built in 2.88s`; Vite emitted its existing chunk-size warning.
- `rg` surface/skip inventory plus trailing-whitespace check — pass, exit 0; 14 named `test.describe` surfaces and exactly two safety skips were found.
- Playwright — not run, as required by the worker brief. Live behavioral status remains pending orchestrator execution.

Orchestrator command, after `tools/dev/sandbox.sh up` reports API 4098 and engine 4097 healthy:

```bash
cd /Users/ajhochhalter/Documents/Rhythm/.mega-wt/ws-live-smoke/apps/web
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_TOKEN='<disposable-live-bearer>' RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 RHYTHM_LIVE_PRODUCTION_API_URL=https://api.vcrcapps.com npx playwright test --config tests/live-smoke-playwright.config.ts
```

Authentication comes only from the orchestrator's `RHYTHM_LIVE_TOKEN` environment variable. The config forwards it to the Vite child process as `VITE_RHYTHM_LIVE_TOKEN`; the suite does not persist or print it.

# Acceptance criteria

- Agent Tools, Facilities, Messages, Projects, Automations, Integrations, Settings, and Agent Settings ListInspector coverage — **done** for navigation, live readiness/explicit empty state, first-two-row selection when data exists, heading read-back, keyboard selection, zero selection writes, and ListInspector axe checks. Data-dependent cases use a reasoned `test.skip` when fewer than two live rows exist.
- Facilities room and reservation create → read-back → confirmed UI delete — **done** in the spec with marker names, captured numeric IDs, and hook cleanup.
- Messages thread plus message lifecycle — **partial**. The test is explicitly skipped because the UI/gateway expose create/send but no delete operation, so the required cleanup guarantee cannot be met.
- Project template create → read-back → confirmed UI delete — **done** in the spec with a marker name and captured ID.
- Paused Automation lifecycle — **partial**. The test is explicitly skipped because the create UI submits `enabled=true` and has no atomic paused option; creating a briefly executable live rule would violate the stricter safety rule.
- Integrations no-create behavior — **done** for inert provider settings inspection and opening/canceling the only cancellable no-create panel (AI Import) without submitting data.
- Main Settings no-create behavior — **done** for a device-local theme toggle and restoration with zero API writes.
- Agent Settings — **done** as read-only ListInspector assertions with no mutations.
- Agents rail archived view/back path, compact spacing, and no standalone checkbox rows — **done** in the spec.
- Optional `Load subagents` row — **done** when live children exist; otherwise skipped with the explicit no-live-children reason.
- Add project Cancel and create/select/empty-state/delete lifecycle — **done** in the spec. It uses a fresh OS temp directory and the source-backed `DELETE /projects/:id` route, then reloads and asserts removal.
- Profiles grouped sections, sticky footer, no-edit switching, Advanced JSON, and marked create/edit/save/reload/delete — **done** in the spec. No pre-existing profile is saved or deleted.
- Task and transcript readability — **done** in the spec: task title ≥14px and weight ≤450, metadata ≥11px, completion ≥44×44px, transcript line-height ratio ≥1.45, transcript width remains 840px-bounded, and prose remains 72ch-bounded.
- Hermes plain-browser boundary — **done** in the spec: `window.rhythmShell` absent, no nav entry, and `/hermes` disabled copy.
- Browser Browse fallback — **done** in the spec: Browse is visible and disabled, while manual working-directory input accepts a path.
- Shell, Agents rail/inspector, and ListInspector separators — **done** in the spec for separator role, orientation, current value, 80px pointer drag, CSS variable change, and reload persistence.
- Whole-suite network hygiene — **done** in the spec: page writes are recorded for both API origins, direct cleanup writes are recorded separately, and `afterAll` hard-fails any write without a marker or captured ID.
- Live execution against real services — **not done** in this worker, per the explicit no-sockets/no-Playwright restriction. The orchestrator command above is the remaining behavioral gate.

# Decisions

- Chose a sibling config that extends the existing live Playwright config; rejected changing the broad `test:live` suite and accidentally mixing sandbox receipt tests with production writes.
- Chose sandbox ports 4098/4097 as defaults to match the existing live config; rejected the general 4001/4096 defaults because they can collide with the shipping desktop runtime.
- Chose environment-only bearer injection; rejected stored sessions or token files because the available browser harness already supports `VITE_RHYTHM_LIVE_TOKEN` and the brief forbids credential persistence.
- Chose marker-prefix cleanup at suite start, after each test, and suite end; rejected cleanup only in test bodies because assertion failures would leave rows behind.
- Chose explicit safety skips for Messages and Automations; rejected undeletable message writes and even briefly enabled automation rules.
- Chose the Integrations provider inspector plus cancellable AI Import panel as the safe no-create path; rejected provider preference saves because those would mutate pre-existing integration configuration.
- Chose source-backed selectors and API routes without production component changes; rejected expanding scope to add missing delete/paused-create product capabilities.
- Chose not to run Playwright or start servers in this worker; rejected violating the brief's socket restriction.

# Follow-ups

- Add a thread/message delete operation to the Messages UI gateway before enabling its live lifecycle smoke.
- Add an atomic `enabled=false` option to Automation creation before enabling its live lifecycle smoke.
- If a dedicated cancellable Integration settings dialog is required, add a draft/cancel UI; the current live provider settings editors are direct-save surfaces.
- Run the command above through the orchestrator, inspect all explicit live-data skips, and feed any runtime failures back to this worktree.

# Needs a human

- AJ or the authorized orchestrator must supply a disposable live bearer in `RHYTHM_LIVE_TOKEN`. No password, token, signing, deployment, or production credential was added to the worktree.
