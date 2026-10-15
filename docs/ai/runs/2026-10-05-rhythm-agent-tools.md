---
date: 2026-10-05
repo: Rhythm
branch: source-export-no-git-metadata
pr: null
issues: []
status: repair-implemented-unverified
tags: [run, rhythm, agent-tools, open-design]
---

# Rhythm Agent Tools / OpenDesign scoped slice

## Run 1: initial implementation (Terra, session 01a10abb-ae2e-78f0-b0bb-e29b46208f13)

Terra created the new owned files. The repair turn hit model capacity before making any corrective edits.

- RED before implementation: `node --test` exited 1 with three `ERR_MODULE_NOT_FOUND` failures. **That is a runner error from missing modules, not behavioral evidence.**
- After implementation, the 6 initial Node tests passed and both typechecks exited 0. Sol later found those tests too shallow (see below).
- Sol's source UI review (`../orchestration/review-source-ui.mjs`, read-only, reviewer-owned) failed: Dayflow default pin was `true`, expected `false` (source assertion line 16).

## Run 2: repair (exact claude-opus-5-5, normal CLI permissions)

This worker could not read `../orchestration/terra-corrections-prompt.md` or the review files it references: they are outside the permitted directory, and reads there were denied. Fixes follow the delegation's enumerated Sol findings plus the dated plan. Sol should diff this run against the review text.

### Files (owned only)

- `apps/electron/src/rhythm-agent-tools.mjs` / `.d.mts`:
  - real route map (Dayflow → `/settings?settingsSection=dayflow`, the existing `DayflowSettingsSection`);
  - `AGENT_TOOLS_CATALOG_ROUTE = '/tools/agent-tools'`;
  - Dayflow `defaultPinned: false`, the other three true;
  - user-facing descriptions without service/lifecycle wording.
- `apps/electron/src/open-design-runtime.mjs`:
  - exact canonical literal URL (`url.href === input`, so `127.1`, hex, and leading-zero ports are rejected);
  - single canonical `pid` field, and headless/web pids must be equal;
  - identity reads must be realpath-contained, a direct child of the runtime directory, a regular file, and within the size bound before reading;
  - health must be `text/html` + 200 + title;
  - executable and listener re-checked after health.
- `apps/electron/src/open-design-view.mjs`:
  - matching `ws:` allowed for requests only, navigation HTTP only;
  - requests must come from the owned guest `webContentsId`;
  - explicit `{ok:false, reason}` for non-owners;
  - cached attach reused only for the same frame and runtime;
  - delayed discovery/load revoked and closed;
  - renderer closed before guards are removed;
  - all listeners registered and removed by name;
  - every callback bound to its own record;
  - `disposeCurrent` (profile/document) vs `dispose` (quit).
- `apps/web/src/agentTools/pins.ts`:
  - `localStorage` getter errors caught;
  - toggles read fresh state (`toggleAgentToolPin`);
  - read results carry `scope` so another owner's pins are never shown or written;
  - key-based events (also `clear()`);
  - `resetAgentToolPins`.
- `apps/web/src/agentTools/hosts.ts` (new): `availableAgentToolIds()`, one shared host check for Shell and ToolWorkspace.
- `apps/web/src/components/tools/AgentToolsCatalog.{tsx,css}`:
  - scope-guarded state, fresh toggles, Reset pins;
  - no lifecycle text;
  - existing tokens only (`--surface`, `--border-soft`, `--muted`, `--accent`, `--warning`, `--fg`, `--r-md`), no hard-coded fallbacks.
- `apps/web/src/pages/open-design/{index.tsx,bridge.ts,styles.css}`:
  - a missing or non-ok attach response is an error, never a blank success;
  - the nonce is not exposed to the renderer (bridge type has no `attachment`);
  - unmount calls `detach` (suspend);
  - fixed copy without service/packaging details;
  - existing tokens.
- `apps/web/tests/open-design-tools-fixture.tsx`: `?bridge=missing-attach|unavailable|absent` modes, `{ ok: true }` attach.
- Tests:
  - `apps/electron/test/{rhythm-agent-tools,open-design-runtime,open-design-view}.test.mjs`: 4 + 9 + 10 tests;
  - `apps/web/src/agentTools/pins.test.mjs`: 6 tests;
  - `apps/web/tests/open-design-tools.sourcespec.ts` + `open-design-tools-playwright.config.ts`: 8 tests including parameterized ones. No `webServer`; it targets the existing `127.0.0.1:5495` fixture.
- Docs:
  - `docs/ai/contracts/task-rhythm-agent-tools.json`: stable `AT-*` criteria with `test_file` / `test_id` / `status` / `mode` and `AT-MAN-*` manual gates;
  - `docs/ai/handoffs/2026-10-05-rhythm-agent-tools-integration-hooks.md`: full exact hook snippets, the private preload nonce, `disposeCurrent` vs `dispose`, the actual route map, default tabs, permanent coordinator, Shell `nativeRoute` reserves, the catalog slug, and the real Dayflow named export (removed the fabricated `dayflow-desktop:*` / `exportDayflowTool()`).

### Checks

**None executed by this worker.** Bash `node --test` and the typecheck commands required approval in this non-interactive session. Per delegation, there were no retries or stronger modes. Commands for Sol:

```sh
cd apps/electron && node --test --test-concurrency=1 test/rhythm-agent-tools.test.mjs test/open-design-runtime.test.mjs test/open-design-view.test.mjs
cd apps/web && node --test src/agentTools/pins.test.mjs
cd apps/electron && npm run typecheck
cd apps/web && npm run typecheck
cd apps/web && npx playwright test --config tests/open-design-tools-playwright.config.ts   # uses the running :5495 fixture; set OPEN_DESIGN_FIXTURE_PATH if it is not served at /tests/open-design-tools-fixture.html
node ../orchestration/review-source-ui.mjs   # reviewer-owned
```

All contract criteria are `written-unrun`. Tests were desk-checked line by line against the implementation, but that is not evidence.

Sol's result after Run 2: the source React fixture passed 5 checks once the public bridge was fixed. Sol's read-only production URL assertion failed with exit 1 (actual `null`, expected the literal URL), recorded in `../orchestration/sol-production-url-red.log`. Run 2 had required a trailing slash, but the production `web-root.json.url` has none. Run 2's Dayflow Settings route was also wrong; it is superseded by the frozen owner packet in Run 3.

## Run 3: Sol second-pass blockers (same session, exact claude-opus-5-5)

All findings were supplied inline. No reads outside the workdir and no Bash test runs were attempted.

### Changes

1. **Production URL.**
   - `parseOpenDesignUrl` accepts exactly `/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/` with port 1..65535 and rejects the trailing slash.
   - It returns the normalised `URL.origin` plus the explicit port, so port 80 still reaches `lsof` as `:80` while the origin is `http://127.0.0.1`.
   - The guest HTTP/WS predicates compare normalised origins.
   - The tests are production-shaped: equal paired pid and a `next-server (v16.2.6)` listener. A strict positive deepEqual fails unless discovery returns ready.
2. **Private nonce.**
   - The renderer type and page accept `{ ok: true }`; void and malformed results fail.
   - The fixture gained a `malformed-attach` mode.
   - The preload block in the handoff strips the nonce and has a behavioral test.
3. **Dayflow.** The descriptor route is `/tools/dayflow`, mounted with the owner's `DayflowTool` (frozen packet). `defaultPinned` stays false. `hosts.ts` checks `rhythmShell.dayflowDesktop.{getDayflowDesktopStatus,openDayflowDesktop}` through a local intersection. No Dayflow file is edited.
4. **Bounded trusted discovery.**
   - Discovery stats up to 64 runtime dirs, verifies at most 25, newest mtime first.
   - The scan has an absolute 10 s deadline, and each HTTP call is capped at 3 s and the remaining budget. Injected health is also wrapped in a deadline and has its body bounded.
   - Trusted executables are `/Applications/...` and `<home>/Applications/...` only, and each must be canonical (realpath equal to itself).
   - `lsof` is invoked exactly as `-nP -a -iTCP@127.0.0.1:<port> -sTCP:LISTEN -Fp`.
   - `readBoundedFile` opens with `O_NOFOLLOW`, checks fstat `isFile`, and reads `limit + 1` bytes.
   - The identity pair is re-read after health, along with the process and listener re-checks.
5. **Native exception safety.**
   - Constructor, config, add, setBounds, and load exceptions all return the fixed failure, and the partial guest is closed and awaited.
   - `disposeRecord` removes guards and listeners in `finally`, and `dispose` removes channels in `finally`.
   - Loads race against record revocation, so a hung load cannot block the serialized queue or disposal.
   - The optional `isTrustedSender` must return exactly `true`; a throw denies.
6. **Hooks.** The handoff is fully rewritten:
   - main uses `createAgentToolAdapterRegistry` / `registerAgentToolAdapter` with the existing `hermesView`, `colonyHost`, and the frozen Dayflow host, plus `isTrustedSender`;
   - profile reset calls `disposeCurrent` and quit calls `dispose`;
   - the complete marked preload block uses discard-only stale completion;
   - App gets its import and route;
   - Shell gets owner scope, `descriptor.route` mapping that keeps `nav-hermes`/`nav-colony`, an unchanged More list, and `nativeRoute` including `/open-design`;
   - SessionRail gets an additive `agent-tools` entry, and ToolWorkspace a slug;
   - the security receipt gets `openDesignView` with `OPEN_DESIGN_VIEW_KEYS`, a smoke probe, closed allowlists, and same-origin HTTP redirects allowed;
   - also covered: package support files and test registration.
7. **Playwright.** AT-UI-04 asserts only catalog and page copy (the fixture banner is excluded). The config uses the cached headless shell when present.

### Files (Run 3)

`apps/electron/src/{open-design-runtime,open-design-view,rhythm-agent-tools}.mjs`; `apps/electron/test/{open-design-runtime,open-design-view,rhythm-agent-tools,open-design-preload-hook}.test.mjs` (the preload-hook test is new); `apps/web/src/agentTools/hosts.ts`; `apps/web/tests/{open-design-tools-fixture.tsx,open-design-tools.sourcespec.ts,open-design-tools-playwright.config.ts}`; `docs/ai/{contracts/task-rhythm-agent-tools.json,handoffs/2026-10-05-rhythm-agent-tools-integration-hooks.md,runs/2026-10-05-rhythm-agent-tools.md}`.

### Checks (Run 3)

None were executed by this writer; Sol owns execution. Commands:

```sh
cd apps/electron && node --test --test-concurrency=1 test/rhythm-agent-tools.test.mjs test/open-design-runtime.test.mjs test/open-design-view.test.mjs test/open-design-preload-hook.test.mjs
cd apps/web && node --test src/agentTools/pins.test.mjs
cd apps/electron && npm run typecheck
cd apps/web && npm run typecheck
cd apps/web && npx playwright test --config tests/open-design-tools-playwright.config.ts
```

Every contract status stays `written-unrun` / `pending-*` until Sol records independent output.

### Residual risks for Sol

1. Requests with no `webContentsId` (for example, from service workers) are cancelled, which fails closed.
2. The Dayflow availability check reads `rhythmShell.dayflowDesktop`, the bridge location the earlier frozen-packet summary gave. If the frozen bridge is a top-level `window.dayflowDesktop` instead, change the single line in `hosts.ts`.
3. AT-RT-07 writes three small files to a temporary directory and deletes them afterwards. This is the only real filesystem use, and it touches no service.
4. AT-RT-10 waits about 50 ms of real time for the deadline.

## Run 4: Sol focused execution findings (same session, exact claude-opus-5-5)

Sol reported the following inline. These results come from Sol's runs, not from this writer:

- Second-pass discovery is green against the existing service (`sol-existing-runtime-green.json`: root PID 43324, listener 43575, origin `http://127.0.0.1:49545`), with no launch or mutation.
- The source browser checks passed 5/5.
- The pin tests passed 6/6.
- The focused Electron command exited 1 (`electron-second-pass-check.tap`). The registry mismatch there came from a stale test that was being rewritten during the run.

Fixes:

1. **`bounded()`** no longer unrefs its timer. The timer stays referenced until settlement and is cleared in `finally`. The AT-RT-10 "event loop resolved while pending" cancellation is gone.
2. **`readHtmlHealth`** is now exported and takes an injectable `request` seam.
   - An absolute timer destroys the actual request when the deadline passes.
   - The timer is cleared on end, error, or close.
   - Exceeding the byte bound also destroys the request.
   - Redirects are not followed.
   - New tests: AT-RT-16, AT-RT-17, AT-RT-18.
3. **View test fixture:** every injected failure flag is checked with `=== true`. `fail.constructor` had been resolving to `Object.prototype.constructor`, which made every positive attach fail.
4. **Teardown.** Teardown order is:
   - zero bounds;
   - remove from the window;
   - drop host listeners;
   - close;
   - clear storage;
   - then remove the guest guards only once the guest is destroyed: immediately if it already is, otherwise on its `destroyed` event. Each guard removal runs independently.

   Tests: AT-VIEW-11 is rewritten (a surviving guest keeps its denials; host listeners and channels go immediately; cleanup finishes on `destroyed`), and AT-VIEW-16 is new.
5. **Preload, registry, and Dayflow.** No change was needed:
   - the preload test already executes the exact documented block (AT-PRE-03);
   - the main hook already uses `registerAgentToolAdapter`;
   - Dayflow is already `/tools/dayflow` / `DayflowTool` / `rhythmShell.dayflowDesktop`.

Files changed in Run 4:

- `apps/electron/src/open-design-runtime.mjs`
- `apps/electron/src/open-design-view.mjs`
- `apps/electron/test/open-design-runtime.test.mjs`
- `apps/electron/test/open-design-view.test.mjs`
- the contract, the handoff (one teardown-semantics paragraph), and this run record

None were executed by this writer. The contract status stays `written-unrun` until Sol reruns the commands.

### Remaining independent stages (expected, not failures)

- Sol: run the commands above, re-run the read-only production URL/discovery probe against the existing service, source UI review, and actual source UI screenshots before any production build.
- Builder: apply the shared hooks; native combined build and `AT-MAN-*` smoke.
- Parent: native combined build. Plugin replacement stays deferred.

No full-product or integrated PASS is claimed.

## Independent Sol final source verification

42 focused Electron tests, six pin tests, nine source Playwright tests, five actual-source fixture browser checks, and both Electron/web typechecks passed (all commands exit0). The paired-PID regression caught an isolated /tmp mutant (exit1); reviewed source hash stayed unchanged. Final read-only existing-runtime discovery returned ready at the existing loopback origin; no service launch/stop or live data change. Both actual-source UI screenshots were inspected and saved to Library before production build. Final logs/receipts and source manifest are in ../orchestration and ../ui-evidence relative to this source export.

A final hook review prevents simultaneous Agents and pinned Dayflow aria-current highlights while preserving default nav-hermes/nav-colony IDs and every existing destination/More entry. Shared owner files remain untouched. Combined Electron route/auth/menu/toast/package smoke and deferred plugin retirement stay builder owned and unverified. No production build/sign/install was run.
