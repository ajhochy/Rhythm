# Prompt for a new Codex session

Use Local Codex with `gpt-5.6-sol`. Do not use DeepSeek or Open Design Cloud for this run.

You are the lead integrator for an overnight, web-only redesign swarm. Continue working until the full acceptance gate passes or a genuine safety/authority blocker prevents progress. Do not stop after planning and do not claim completion from a build alone.

## Read first

1. `/Users/ajhochhalter/Documents/Rhythm/AGENTS.md`
2. `/Users/ajhochhalter/Documents/Rhythm/docs/ai/plans/2026-08-12-open-design-remaining-pages.md`
3. `/Users/ajhochhalter/Documents/Rhythm/docs/ai/handoffs/2026-08-12-open-design-remaining-pages.md`
4. `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/app/core/layout/navigation_sidebar.dart`
5. The Flutter feature directories named in the handoff, read-only.
6. The current Open Design prototype README, App, Shell, fixtures/store, endpoint map, Playwright config, and tests.
7. `rhythm-dashboard-redesign.html` in the Open Design project.

## Project and authority

- Open Design project: `fc0be6da-6e7a-4650-aa68-3bd044a0712c`
- Prototype directory: `rhythm-desktop-agents`
- Studio conversation: `8b1f3e39-6ce5-4d48-8fa4-6322873e8f0d`
- Shipping Rhythm repo: `/Users/ajhochhalter/Documents/Rhythm` — read-only except for final prototype handoff/run documentation if needed.
- Flutter is behavior truth. The HTML reference is visual truth. The React Agents implementation supplies reusable interaction/testing patterns.

This run is fixture-only. Live-server testing is paused. Do not call `api.vcrcapps.com`, do not call Rhythm localhost APIs, do not start an api_server or dev sandbox, do not use a live database, and do not store real user data. Do not install, execute, package, or test Electron. Do not commit, push, open a PR, or modify the shipping Flutter/API application code.

## First repair the baseline

The canceled live-mode attempt left a broken `vite.config.ts`, partial live scripts in `package.json`, and paused files at `docs/ai/contracts/issue-0-live-mode.json` and `tests/contract/issue-0-live-mode.spec.ts`.

Preserve the live contract as paused evidence, exclude it from ordinary fixture tests unless `RHYTHM_LIVE_E2E=1`, remove/quarantine incomplete live wiring, restore the ordinary web Vite config, and prove the known fixture baseline:

- production build passes;
- existing installed-Chrome Playwright suite passes 58/58;
- dist smoke passes;
- no Electron dependency/artifact exists.

Do not dispatch page implementation until this baseline is green.

## Spawn and manage the swarm

Use all available subagent capacity in three waves:

1. Dashboard (issue 2001), Planner (2002), Tasks (2003)
2. Rhythms (2004), Projects (2005), Messages (2006)
3. Facilities (2007), Automations (2008), Integrations (2009)

For each page, reuse one page owner in two explicit turns:

1. **Recon/acceptance turn:** inspect Flutter view/controller/repository/data source plus relevant api_server routes; write `docs/ai/inventories/<page>.md`; write canonical `docs/ai/contracts/issue-<id>.json`; write one executable failing Playwright contract test per criterion; run the contract and prove red for missing behavior, not harness errors. Do not implement yet.
2. **Implementation turn:** after lead review, send a follow-up that authorizes implementation only inside `src/pages/<page>/**` plus that page's tests. The implementer must make the contract green without weakening assertions.

The lead exclusively owns `src/App.tsx`, `src/components/Shell.tsx`, global styles/icons/store/fixtures, package/config files, README, and dist. Page agents must never edit shared files. Each page agent returns a wiring note; the lead integrates after the agent finishes. If a reusable component is needed, keep it page-local until the lead extracts it.

Use the applicable repo skills faithfully: workflow orchestration, acceptance contracts before coding, design/frontend quality, responsive adaptation, accessibility review, hardening, verification gate, manual smoke, and failure postmortem. Do not let skill ceremony replace actual implementation.

## Required implementation behavior

- Replace every top-level placeholder route: Dashboard, Planner, Tasks, Rhythms, Projects, Messages, Facilities, Automations, and Integrations.
- Preserve the verified Agents page, Profiles, endpoint map, 12 Tool routes, deterministic Tool states, keyboard behavior, and receipts.
- Use semantic HTML, ordered landmarks/headings, labelled forms, keyboard-accessible menus/dialogs, focus restoration, live status/errors, and 44px touch targets.
- Match the mineral design reference: its dark blue-green neutrals, restrained green accent, typography, borders, radii, spacing, density, responsive navigation, and focus treatment. Do not substitute a generic dashboard aesthetic.
- Give each page deterministic synthetic ready/loading/empty/retryable-error/forbidden/unavailable/read-only states when supported by Flutter.
- Every enabled control must produce an observable route/state/dialog/menu/filter/receipt/status result. If an action cannot be exercised in fixture mode, disable it natively and explain the prerequisite accessibly. No dead controls.
- Every API-backed control must trace the exact method, path, meaningful payload fields, response status, and UI outcome using the existing endpoint-receipt/map convention. Client-only controls must be explicitly identified as client-side, never assigned fake endpoints.
- Add page-specific deep-link routes and ensure direct hash loads work.
- Block accidental production/local/external network traffic in Playwright.

The detailed common and page-specific acceptance criteria, Flutter sources, and endpoint families are mandatory in `/Users/ajhochhalter/Documents/Rhythm/docs/ai/handoffs/2026-08-12-open-design-remaining-pages.md`. Treat its page criteria as minimum seeds; reconcile and expand them from Flutter before implementation. Do not invent or omit secondary controls.

## Integration and verification

After each page: run its contract, page click-through, axe serious/critical checks, and responsive checks. After each wave: wire routes through the lead-owned App/Shell and run the full build and Playwright suite.

Final gate:

1. All nine canonical contract JSON files have every automated criterion marked pass; manual criteria are explicitly listed in `not_tested` with reasons.
2. Build passes.
3. Installed-Chrome Playwright passes on strict unique ports; total coverage is greater than the preserved 58-test baseline.
4. Dist smoke passes.
5. Every global navigation item works by click and direct route; no `ModulePlaceholder` remains.
6. Endpoint audit finds zero enabled API controls without exact traceability and zero fake endpoint mappings.
7. Dead-control audit finds zero enabled controls without an observable outcome.
8. Automated serious/critical accessibility violations are zero across ready and representative non-ready states.
9. Screenshot/responsive sweep covers 1440, 1024, 768, and 390 widths, plus representative 200% text, RTL, long text/CJK/emoji, forced colors, and reduced motion.
10. Network audit proves fixture isolation.
11. Electron audit proves no dependency, process, configuration, or generated bundle.
12. Perform a real manual Chrome click-through after automation; run failure-postmortem whether it passes or fails.
13. Update README, inventories, contracts, endpoint map, test counts, and a dated run log with exact commands/results.
14. Open the final Open Design Studio view and the working Chrome preview for the user.

Keep progressing while safe work remains. If a subagent fails, triage and reassign the bounded packet. If time runs short, stop only at a green wave boundary and report exact remaining criterion IDs. Never delete, skip, or weaken tests to claim success.
