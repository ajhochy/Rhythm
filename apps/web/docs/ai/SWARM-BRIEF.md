# Swarm brief — remaining-page redesign (issues 2001–2009)

You are one page owner in an overnight swarm completing the fixture-only React/Vite
redesign of Rhythm Desktop. Read this whole brief before touching anything.

## Ground truth, in priority order

1. **Behavior truth (READ-ONLY):** `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/app/features/<feature>/` — views, controllers, repositories, data sources, models.
2. **Endpoint truth (READ-ONLY):** `/Users/ajhochhalter/Documents/Rhythm/apps/api_server/src/` — routes/controllers/services, when Flutter is ambiguous.
3. **Visual truth:** `../rhythm-dashboard-redesign.html` (one directory above this project root) — the mineral dark blue-green language — plus the tokens and component classes already in `src/styles.css`.
4. **Convention truth:** the existing Agents implementation (`src/components/*`, `tests/*.spec.ts`) — interaction, fixture, testid, and test patterns only. It never overrides Flutter behavior.

Never infer behavior from an endpoint name. If Flutter doesn't do it, the page doesn't do it.

## Absolute constraints (violations end the run)

- Fixture-only. NO network calls at runtime or in tests except 127.0.0.1 Playwright servers. Never call `api.vcrcapps.com`, `localhost:4001/4000/4096`, analytics, or OAuth hosts. Connect actions render an explicit fixture handoff state instead of opening real URLs.
- Do not start servers, do not run `npm install`, do not add dependencies, do not touch Electron in any form.
- Do not modify the shipping Rhythm repo (`/Users/ajhochhalter/Documents/Rhythm`) — it is reference only.
- Write ONLY inside your owned paths (listed in your task prompt). Shared files are lead-owned and off-limits: `src/App.tsx`, `src/components/**`, `src/styles.css`, `src/icons.tsx`, `src/store.tsx`, `src/fixtures.ts`, `src/endpointMap.ts`, `src/types.ts`, `src/sessionState.ts`, `src/main.tsx`, `package.json`, any `*.config.ts`, `tests/helpers.ts`, `README.md`, `dist/`, and every other page's directories. If you need a shared change, put it in your wiring note instead.
- Do not run Playwright or the build; the sandbox cannot bind sockets. The lead runs all verification and reports results back to you.
- Never weaken, skip, or delete a test to make something pass.

## Page module contract

- Entry: `src/pages/<slug>/index.tsx` exporting `export function <Pascal>Page({ route }: { route: string })`. `route` is the current hash path (no `#`, no query), e.g. `/messages/thread-weekend-team`. Parse sub-paths yourself.
- Root element: `<section className="page-shell pg-<slug>" data-testid="page-<slug>" aria-labelledby="<slug>-title">` containing exactly one `<h1 id="<slug>-title">`.
- Navigation: import `{ navigate }` from `../../components/Shell`. Query params live after `?` inside the hash (`#/tasks?state=empty&view=kanban`); read them with `new URLSearchParams(window.location.hash.split('?')[1] ?? '')` and write them with `history.replaceState` like `src/components/ToolWorkspace.tsx` does.
- Toasts: import `{ useFixtures }` from `../../store` and use `notify(message)` for the global toast. All other page state is page-local React state seeded from your own `src/pages/<slug>/fixtures.ts` (deterministic, synthetic, timestamps pinned around `2026-08-12T15:48:00-07:00`). No `Date.now()`, no `Math.random()`, no localStorage — a browser reload must reproduce the identical state.
- Styles: `src/pages/<slug>/styles.css`, imported by your `index.tsx`. Every selector must be prefixed `.pg-<slug>` (element selectors only nested under it). Reuse the custom properties (`--bg`, `--surface`, `--surface-warm`, `--fg`, `--fg-2`, `--muted`, `--border`, `--border-soft`, `--accent`, `--success`, `--warning`, `--danger`, `--info`, `--r-sm/md/lg/pill`, `--focus`, `--font-ui`, `--font-mono`) and existing classes (`primary-button`, `secondary-button`, `icon-button`, `text-button`, `search-field`, `menu-popover`, `menu-item`, `eyebrow`, `sr-only`, `tool-state-panel` patterns) before writing new CSS. Match the reference: hairline dividers, restrained turquoise accent, compact density, 10–24px radii, Inter for UI, SF Mono for operational data. No generic light-dashboard look; support both dark (default) and light themes via the tokens.

## Deterministic state matrix (C3)

Support `?state=` values `ready` (default), `loading`, `empty`, `server-error`, `forbidden`, `unavailable`, and `readonly` wherever the Flutter surface can exhibit them — mirror `src/components/ToolWorkspace.tsx`. Render the non-ready panels with `data-testid="page-state-<state>"`; `server-error` must expose a working Retry (`data-testid="page-retry"`) that recovers to ready WITHOUT reload; `empty` exposes its primary escape hatch; `forbidden`/`unavailable`/`readonly` name the prerequisite. `readonly` disables every mutating control natively (fieldset[disabled] pattern) while keeping inspection possible — and the disabled fieldset MUST also carry `aria-disabled="true"` (Playwright's `toBeDisabled()` does not recognize `disabled` on a fieldset itself, and the ARIA mirror helps assistive tech). State changes update the URL query via `history.replaceState` so reload reproduces them.

## Endpoint receipts (C5)

Every API-backed control, on activation, must append to a visible page ledger with `data-testid="page-trace"` the exact receipt: `METHOD /exact/route` plus meaningful payload keys and simulated response status (e.g. `POST /tasks {title,dueDate,collaboratorIds} → 201`). Follow the `tool-trace` pattern in `ToolWorkspace.tsx`. Client-side-only controls (filters, view toggles, navigation) must NOT be given fake endpoints — classify them as client-side in your inventory. Every endpoint you represent must also appear in your wiring note as a ready-to-merge `EndpointContract` object (see `src/endpointMap.ts` for the schema: id, control, method, route, handler, flutterSource, test, payload?).

## Accessibility (C6) and responsiveness (C7)

Semantic landmarks and ordered headings; every form control labelled; dialogs/menus trap and restore focus, close on Escape (copy the `Menu`/`FocusDialog` patterns); status changes use `role="status"`/`aria-live="polite"`, errors `role="alert"`; every control keyboard-operable with visible focus (`--focus`); 44px minimum touch targets. Zero serious/critical axe violations (the pattern: `new AxeBuilder({ page }).analyze()` as in `tests/responsive-a11y.spec.ts`). No page-level horizontal overflow at 1440/1024/768/390 CSS px; usable at 200% text scale; survives RTL (`dir="rtl"`), long titles, CJK/emoji content (seed some in fixtures), forced-colors, and reduced motion.

## No dead controls (C4)

Every enabled control produces an observable outcome: route change, state update, dialog/menu, filter result, `page-trace` receipt, toast, or deterministic recovery. Anything that cannot work in fixture mode is natively `disabled` with an accessible reason (`aria-describedby` pointing at the prerequisite text, or `title` + visible hint). Give every interactive element a stable kebab-case `data-testid`.

## Tests

- Use `openPage` from `tests/helpers.ts` (fixed clock 2026-08-12T15:48-07:00, reduced motion, loopback-only network) — never `page.goto` directly.
- Contract spec: `tests/contract/issue-<id>-<slug>.spec.ts`, one `test('issue-<id>-c<n>: <criterion>')` per criterion, each with a `// Regression caught:` comment naming the exact regression it catches. Tests drive the UI (click/type/keyboard), never internal state.
- Click-through spec (implementation turn): `tests/pages/<slug>.spec.ts` — the full user journey plus responsive checks at 1024/768/390 and one axe scan per representative state.
- Contract JSON: `docs/ai/contracts/issue-<id>.json` in exactly the schema of `docs/ai/contracts/issue-0-live-mode.json` (`issue`, `generated`, `criteria[{criterion_id,text,mode,test_file,test_id,status:"pending"}]`, `stack:"typescript"`, `not_tested[{criterion_id,reason}]`). Visual parity (C2) goes in `not_tested` as manual-plus-screenshot; lead-run global gates (58-test regression, Electron audit) are noted there too.

## Inventory and wiring note

- `docs/ai/inventories/<slug>.md`: every visible Flutter control — label, type, precondition/permission, trigger, visible outcome, endpoint (exact method/path/payload) or `client-side`, loading/success/failure behavior; every route/deep-link; which matrix states the Flutter surface actually supports; explicit open questions. Cite the Flutter file/line for each claim.
- `docs/ai/inventories/<slug>-wiring.md`: what the lead must integrate — the route registration you need in `App.tsx`, your `EndpointContract` additions, any cross-page consistency notes, any genuinely shared style/icon needs. Keep asks minimal; everything else stays page-local.

Cross-page consistency seeds: the Shell's Messages badge is hard-coded at 6 unread — Messages fixtures must total 6 unread threads. The fixed "now" is 2026-08-12T15:48-07:00 (a Wednesday); date fixtures should make sense around it.
