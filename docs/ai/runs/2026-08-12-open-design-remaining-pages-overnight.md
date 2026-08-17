---
date: 2026-08-12
repo: Rhythm
branch: codex/cloud-gateway-mobile-release (repo untouched; work in Open Design project)
pr: none (fixture-only prototype run — no commits/PRs per handoff)
issues: [2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009]
status: complete
tags: [run, Rhythm, open-design, overnight-swarm]
index: "[[Rhythm]]"
---

# Overnight swarm — Rhythm remaining-page redesign (web-only)

Lead integrator: Claude (this session). Page owners: Local Codex `gpt-5.6-sol` via
codex-companion tasks (`--write --cwd <prototype>`), two turns per page (recon/contract →
implementation). Lead owns all shared files and runs every verification (Codex sandbox
cannot bind sockets, so Playwright/build runs are lead-executed by design).

Prototype: `/Users/ajhochhalter/Library/Application Support/Open Design/namespaces/release-stable/data/projects/fc0be6da-6e7a-4650-aa68-3bd044a0712c/rhythm-desktop-agents`

## Packet 0 — baseline quarantine (COMPLETE, all green)

- Preserved paused live-mode evidence: `docs/ai/contracts/issue-0-live-mode.json`,
  `tests/contract/issue-0-live-mode.spec.ts` (untouched), plus the broken live Vite config
  verbatim at `docs/ai/paused-live-mode/vite.config.live.ts.txt` with `PAUSED.md` notes.
- Excluded the paused spec from both Playwright configs unless `RHYTHM_LIVE_E2E=1`.
- Restored ordinary `vite.config.ts` (relative assets, strict ports, no live proxy/middleware).
- Removed `live:dev` + `test:live` scripts (`test:live` referenced a never-generated spec);
  repointed `test:contract` at `tests/contract/`.
- Removed empty Electron leftover `release/mac-arm64/`; removed stale compiled
  `vite.config.js`/`vite.config.d.ts`/tsbuildinfo artifacts.
- Added lead-owned `openPage` helper to `tests/helpers.ts` (fixed clock, reduced motion,
  loopback-only network; page readiness left to per-test assertions).

Checks (2026-08-12 ~23:30–23:50 PT):
- `npm run build` — PASS (tsc -b + vite build, dist regenerated).
- `npm run test:list` — 58 tests in 12 files (exact baseline).
- `npm run test:external:chrome` — **58/58 PASS** (1.9m, installed Chrome).
- `npm run test:dist-smoke` — PASS (launcher target, index, 2 relative assets).
- Electron audit — `npm ls electron electron-builder --depth=0` empty; no electron-named
  files outside node_modules; no release/ dir.

## Known planned deviations

- `tests/shell.spec.ts` asserts Facilities nav → placeholder; will be updated to assert the
  real Facilities page when issue 2007 lands (placeholder replacement is the point of the run).
- Turn-2 (implementation) Codex dispatches are fresh tasks pointed at the recon artifacts on
  disk rather than `--resume-last` — three concurrent tasks share one workspace, making
  resume-last ambiguous.

## Wave 1 — Dashboard 2001, Planner 2002, Tasks 2003

- 23:51 PT: three recon tasks dispatched concurrently (companion jobs running).
- 00:00–00:15 PT: all three recon turns completed. Contracts: 2001 = 12 criteria, 2002 = 15
  (with proper not_tested entries), 2003 = 14. Recon corrected seeds from Flutter truth
  (Tasks: no owner filter — tag/min-priority/Open-All/date-window; Planner: inspector fields
  Flutter discards on save; misrouted project-step collaborator controls).
- Lead decisions recorded in impl prompts: `#/` stays Agents (baseline preservation);
  path-style deep links approved; dead/broken Flutter controls (Dashboard nextStep parsing gap,
  Planner discarded fields/misrouted collaborators) modeled as intended-behavior or suppressed,
  never replicated as dead controls; receipts show wire payloads verbatim (incl. scheduledOrder).
- 00:19 PT: Dashboard red PROVEN — 12/12 failed, all `element(s) not found` for page testids
  (missing behavior, zero harness errors). Implementation turn dispatched.
- 00:30 PT: Planner+Tasks red PROVEN — 29/29 failed for missing behavior. Implementation turns
  dispatched for both.
- 00:40–01:05 PT: all three implementations returned (each self-verified `tsc --noEmit` clean,
  CSS scope clean, no weakened assertions; Planner declared one contract correction — c13
  focus target moved to the notes field with Flutter citations — approved). Lead wired
  `/dashboard`, `/planner`, `/tasks` in App.tsx; tsc clean after each.
- **Harness finding 1 (root-caused via trace):** a second `openPage` inside one test that
  changed only hash/query was a same-document navigation — the page component never remounted,
  so mount-time `?state=` reads went stale and the Dashboard c3 state-matrix loop failed while
  the identical assertions passed in a fresh file. Fix: lead-owned `openPage` now hops through
  `about:blank` so every call is a true deep-link document load.
- **Harness finding 2:** Playwright's `toBeDisabled()` does not recognize `disabled` on a
  `<fieldset>` itself. All pages use a `<slug>-mutations` disabled-fieldset readonly gate, so
  the gates now also carry `aria-disabled="true"` (truthful ARIA mirror). Brief updated;
  landed pages patched.
- (in flight) Wave-1 green chain (3 contract + 3 page suites) then Wave-2 red proofs.

- 01:12 PT Wave-1 green chain: 54/60 pass. Failures triaged: 2 Planner strict-mode locator
  collisions with toast text (lead disambiguated to element-scoped locators — strictly
  stronger); 3 Tasks defects sent back as a fix turn (self-defeating `.check()` on a checkbox
  whose success removes the row under the Open filter — verb correction authorized with
  citation; missing persistent `tasks-clear-search`; REAL axe catch: scrollable readonly
  inspector lacked keyboard access); 1 shared root cause fixed.
- Lead-owned dynamic unread badge landed: store exposes `unreadThreads` (seed 6, reset to 6),
  Shell renders it (baseline "6 unread" assertion preserved); Messages page will drive it.

## Wave 2 — Rhythms 2004, Projects 2005, Messages 2006

- 01:05–01:15 PT: all three recon turns completed (2004: 14 criteria, 2005: 14, 2006: 12; all
  with not_tested entries). Red PROVEN 40/40 in one run. Lead rulings: Rhythms keeps
  seed-mandated collaborator mgmt + next-due display (API-backed; Flutter render gap
  documented); Projects gets hydrated-default + delete-confirmation hardening (documented
  adaptations); Messages enforces "2 or more" group validation, truthful create/send failure
  (no swallow-and-close), dynamic badge via lead store.
- 01:25 PT: three implementation turns dispatched.
- 01:55 PT **Wave-1 gate PASS**: build ✓, 118/118 installed-Chrome (58 baseline + 60 Wave-1,
  4.5m) ✓, dist smoke ✓, Electron audit ✓. Contracts 2001–2003 flipped to pass with evidence
  stamp. (Wave-1 repair details: Tasks self-defeating `.check()` verb corrected with citation;
  persistent clear-search added; scrollable regions made keyboard-reachable; Kanban dragTo
  stabilized via the contract-proven slim-board recipe.)
- 02:0x PT Wave-2 first integration: 47/56 green. Nine failures triaged to owners:
  Projects (empty aria-selected value, missing programmatic focus on empty-state escape, ARIA
  required-children/parent role nesting, one more self-defeating `.check()`); Messages
  (case-sensitive "read-only" copy assertion, real axe violations in ready+dialog, invalid
  regex `(?:?|$)` in its own spec); Rhythms (create-dialog fields lacked visible labels —
  caught by its own RTL/200% test). Three fix turns dispatched.
- Wave-3 red PROVEN 45/45 (2007/2008/2009); three implementation turns dispatched.
- Follow-up flagged for Rhythm repo (not this prototype): automation-reservation preview API
  is only authenticated while Flutter treats it as manager-only — server-side gate candidate.

- 02:3x PT Wave-2 GREEN: after two fix rounds, 56/56 (round-2 fixes: step-title focus,
  danger-button contrast override 10.02:1, truthful completed-instance removal per Flutter
  citation, toggle names made hide-proof, dialog close button + lead tab-order restructure).
  Contracts 2004–2006 flipped to pass. Full-suite run: **216 passed** (baseline + Waves 1–2)
  + build + dist smoke.
- Shell placeholder era ended: `tests/shell.spec.ts` Facilities assertion updated to the real
  page (planned change); `ModulePlaceholder` replaced by a recoverable `RouteNotFound` with
  Dashboard/Agents escapes; `openFixture` fallback readiness updated accordingly.
- Endpoint map now carries 208 contracts (zero duplicate ids; cross-page duplicates
  de-duped/prefixed).

## Wave 3 — Facilities 2007, Automations 2008, Integrations 2009

- All recons done (15/15/15 criteria), red proven 45/45, implementations landed and wired.
- First integration: 11 failures triaged (duplicate close testids, missing edit toast,
  scrollable `<output>` ledger not focusable; ambiguous group locator, focus restoration,
  nested-interactive cards, case-sensitive "reconnect"; forbidden literal in Gmail reassurance
  copy, aria-label on plain spans). Automations delete-confirmation contract edit made by lead
  (owner correctly refused to self-edit; edit adds Cancel-preservation, strictly stronger).
  Three fix turns dispatched.

- 03:0x PT Wave-3 repairs: round-1 fixes (dup close testids, edit toast, focusable ledger;
  group-locator strictness, focus restore, nested-interactive, reconnect case; forbidden literal,
  aria-prohibited spans) + lead inline finishers (aria-current instead of aria-selected on bare
  sections — ARIA-correct, contract updated with justification; fieldset/main nesting swap so the
  scrollable list isn't inside the disabled gate — root-caused with an in-page probe showing
  disabledAncestor:true; Facilities dialog header close; danger-button contrast override).
  Wave-3 suites 53/53 → full set green.

## Final gates (all PASS, 2026-08-13 ~02:30–03:30 PT)

1. All nine contract JSONs: every automated criterion `pass` with evidence stamps; manual
   visual-parity + lead-global-gate notes in `not_tested`.
2. Build ✓ (tsc -b + vite).
3. **Full installed-Chrome Playwright 230/230** (9.3m→6.9m runs) — 58-test baseline preserved,
   total far exceeds it.
4. Dist smoke ✓.
5. All routes load by click and direct hash; `ModulePlaceholder` retired for a recoverable
   `RouteNotFound` (manual click verified recovery).
6. Endpoint audit: 208 unique control-to-endpoint contracts in the Endpoint Map; per-page receipt
   honesty enforced by contract criteria (client-only controls never fabricate receipts).
7. Dead-control audit: per-page C4-class criteria all pass (every enabled control has a stable
   testid and an observable outcome; disabled controls expose prerequisites).
8. Axe: zero serious/critical across ready + representative non-ready states on all pages.
9. Screenshot sweep: 50 artifacts (`test-results/sweep/`) — 1440/1024/768/390 × 10 surfaces +
   200%/RTL/forced-colors representatives + light theme; none blank.
10. Network audit: per-page isolation tests + live observation — zero runtime HTTP requests to any
    host; loopback-only document loads.
11. Electron audit: no dependency, file, or bundle.
12. Manual Chrome click-through (production dist via vite preview): PASS — Dashboard task-add
    (POST receipt, counts), Planner week nav (URL + receipt), Tasks board, Rhythms enable PATCH,
    Messages deep-link read + reply + live badge 6→5, Facilities reserve dialog, Automations
    ledger, Integrations providers, not-found recovery, Agents workspace intact, zero console
    errors. Two cosmetic notes (Facilities double close, Automations gap) →
    `.agent-stack/postmortems/2026-08-13-open-design-remaining-pages-overnight-smoke.json`.
13. README/inventories/contracts/endpoint map/test counts updated; this run log finalized.
14. Studio conversation + Chrome preview opened for morning review.

## Notes

- Codex authored ~everything page-scoped (9 recon + 9 implementation + 8 fix turns, all
  `gpt-5.6-sol`); the lead executed all builds/tests/gates (Codex sandbox cannot bind sockets),
  owned all shared files, and made documented inline fixes when diagnosis needed live tooling.
- Two durable harness findings (openPage same-document navigation; fieldset toBeDisabled) are
  recorded in the postmortem's suggested follow-up for brief/skill seeding.
