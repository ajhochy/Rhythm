---
date: 2026-09-18
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [1513, 1509]
status: partial
tags: [run, rhythm]
---

# Adversarial review: shared inspector and reading comfort

The source of expected behavior is the original local issue bodies at `docs/ai/runs/mega-2026-09-18/issues/1513.md` and `1509.md`, including their later scope clarifications. This review separates rendered fixture proof from live gateway behavior and native Electron/AJ visual acceptance. The main Tasks tab in #1509 is a reading-comfort example; **Agents → Tasks** is the #1513 list-and-inspector reference.

## #1513 — exposed Agent Tools inventory

Every row below is exposed by `SessionRail.tsx`; Agent Settings is exposed through the tool route. The before/after descriptions are checked against the migration inventory and current `ToolWorkspace.tsx`, `Profiles.tsx`, and `tools/AgentSettingsTool.tsx`. “Rendered” refers to fixture-mode browser checks only.

| Tool | Before | Expected after / preserved functions | Review evidence |
| --- | --- | --- | --- |
| Brain | Expandable memories / flat live list | Memory title/source rows; inspector metadata, edit/delete in fixture, live refresh/search | Shared primitive present; two-item fixture selection/actions covered by Agent Tools spec |
| Deep Research | Bespoke project/report split | Project rows; inspector run report, evidence, start/cancel/resume, archive, export, magazine, discussion, retry | Shared primitive present; two-item fixture selection and action reachability covered |
| Tasks | Existing split reference | Compact schedules, selected prompt/type/timezone, enable/edit/delete, trigger, real run history and linked root session | Fixture primitive tests cover two rows and actions; live-gateway-mocked test covers owned root selection after history click; real action effect remains separate |
| Webhooks | Action-heavy flat rows | Endpoint rows; URL/prompt/metadata and copy/delete; create and one-time receive URL outside row | Fixture two-row setup/action coverage; live path explicitly displays unavailable because no registered gateway |
| Profiles | Existing list and profile inspector | Preserve arrangement and controls; per-profile editor belongs to #1523 | Explicit #1513 exception; not force-converted to `ListInspector` |
| Skills | Bespoke catalog split | Searchable skill rows; content and managed actions in inspector, live refresh/reload | Fixture two-item rendered coverage; live effects unverified here |
| Playbooks | Bespoke catalog split | Searchable command rows; template/managed actions, read-only policy | Fixture two-item rendered coverage; live effects unverified here |
| Cookbook | Action-heavy recipe rows | Recipe title/steps; inspector steps, run/open session, delete and creation | Fixture second recipe created and selected; actions covered |
| Review Queue | Proposal card grid | Proposal rows; evidence, safety projection, gated approval/reject/revert | Fixture two-item rendered/action coverage; no live mutation attempted |
| Report Card | Bespoke agent/report split | Agent rows; inspector quality metrics, time-window and evidence | Fixture two-item rendered/action coverage |
| Email | Bespoke signal split | Subject/sender rows; inspector context and seeded assistant launch | Fixture two-item rendered/action coverage |
| Gallery | Artifact card grid | Artifact rows; inspector image/video/icon fallback, metadata, deliverable/project/assistant actions | Fixture two-item rendered/action coverage |
| Agent Settings | Existing fixture/live configuration list | Same list/inspector structure; inner settings redesign belongs to #1523 | Separate Agent Settings spec; shared styling/source review only here |

## #1513 — expected-behavior checklist

- [x] **C1 inventory:** All 13 exposed entries and their old/new presentations accounted for above; `ToolWorkspace.contract.test.mjs` also checks the names. Existing inventory: `docs/ai/runs/2026-09-18-issue-1513-agent-tools-inventory.md`.
- [x] **C2 compact rows and inspector:** In-scope tool render sites use `ListInspector` with title/subtitle items and `inspector` callbacks. Rendered fixture Agent Tools spec selects two entries and reaches selected actions, including created second webhook/cookbook records. Profiles remains the stated exception. Live Webhooks is an explicit unavailable state, not fixture data masquerading as live.
- [x] **C3 common contract:** `ListInspector.tsx/.css` owns row/listbox semantics, common rail/detail, splitter, focus styling, query selection, and narrow pane behavior; ToolWorkspace's former bespoke rails/grids are absent from adopted sections per source contract.
- [x] **C4 Agents → Tasks baseline:** Fixture schedule selection, linked history receipt, trigger/edit/delete/toggle availability, loading/error/read-only states, deletion and refresh/deep link pass rendered primitive checks. `LiveSchedulesTool` calls schedule gateway list/runs/update/trigger/remove/create. A red-first rendered live-gateway-mocked test caught history lookup followed by generic Agents navigation; `openRun` now selects the verified owned root session before navigation. Real live side effects are not established by these fixture/gateway-mocked passes.
- [x] **C5 specialized functions:** Fixture action reachability is covered for research, review, gallery, skills/playbooks, cookbook, email, and other tools; dialogs remain outside compact rows and selected item actions remain in inspector. Profiles controls preserve the existing arrangement.
- [x] **C6 input and state:** Mouse changes selected item/heading; Arrow/Home/End then Enter/Space changes selection; selected `aria-selected`, focus outline, and inspector accessible heading are asserted in rendered tests.
- [x] **C7 resilience in rendered fixture:** Long multilingual title, RTL/200% zoom, narrow single-pane Back/focus return, no results, loading, error recovery, and read-only disabled actions are tested on representative pages. Coverage is representative rather than a live exhaustive matrix on all 13 tools.
- [x] **C8 persistence and stale selection:** Query-key selection retains unrelated hash parameters, refresh restores selection, and missing/deleted items show “Item not found” with stale actions removed in rendered tests. Live selection after a server deletion was not mutated here.
- [ ] **Required live/native evaluation:** Same-zoom visual comparison with Agents → Tasks and real live-backed action effects are assigned to the parent visual/hosted run. Fixture assertions cannot establish production behavior.

## #1509 — expected-behavior checklist

- [x] **C1 task scale:** List titles compute at 14px/400/20px and metadata at least 11px at normal zoom in both themes (`pages/tasks/styles.css:75-77`; rendered test). The existing font family stays Inter/system, with actual rendered-font receipt attached by Playwright.
- [ ] **C2 dark before/after and AJ acceptance:** Shared dark tokens now use charcoal `#252727`, primary `#dedfdf`, and softer secondary tokens (`styles.css:1-9`). Same-size/same-fixture capture tests produce current Tasks screenshots; an actual before/after pair and AJ preference judgment require visual review.
- [x] **C3 useful metadata:** Before repair, dark and light rendered tests failed on `Open · Past due · P1`. Now default `Open` and bucket-duplicated `Past due`, `Today`, or `No date` are omitted visually, while priority, source/read-only distinctions, nondefault status and nonredundant dates remain. The row's accessible name explicitly retains complete status/date context (`pages/tasks/index.tsx`, `renderTaskRow`). Both themes pass the red-first test.
- [x] **C4 task states/hit areas:** Hover/selected/completed/disabled/focus states, 44×44 completion and row-action controls, and keyboard activation pass rendered tests in both themes.
- [x] **C5 actual contrast:** Rendered foreground/background composition checks enforce text ≥4.5:1 on task default/hover/selected states and focus/control treatment ≥3:1; checked dark and light, not inferred from source token values.
- [x] **C6 long/narrow/zoom/light:** Long unbroken task title, RTL narrow viewport, 200% CSS zoom, accessible controls, opening inspector and completing a task pass rendered tests.
- [x] **C7 chat typography/theme:** `Transcript.css` scopes 14px regular prose at 1.6 line-height, softened labels, timestamps, activity/tool/reasoning text and action controls in both themes. `Transcript.tsx` continues to render real message blocks; fixture computed-style/contrast checks pass.
- [x] **C8 hierarchy/focus:** Assistant/user prose, links/headings/tables, metadata, bubble and action contrasts, hover and focus checks pass in dark/light fixture rendering. A native subjective comfort comparison remains with C10.
- [x] **C9 bounded width/paragraphs:** `styles.css:267,276` still sets the 840px transcript and 72ch markdown bounds; `Transcript.css` does not override them. Rendered measurement at 1440 and 1920 and two intentional paragraphs pass. No full-window measure expansion.
- [ ] **C10 chat before/after and AJ acceptance:** Current same-content/same-pane screenshots exist in Playwright attachments in both themes; the real Electron comparison and AJ preference judgment remain the parent visual gate.
- [x] **C11 chat interactions (fixture):** Rendered narrow/200% tests cover markdown code/table, link contrast, selection, clipboard copy, tool/reasoning expansion and no horizontal overflow; transcript scroll/history anchoring and streaming are implemented in `Transcript.tsx:229-263,334-356` but are not independently proven by this focused test. Existing E25A/E51/E52A transcript suites and live runtime remain separate gates.

## Red → green evidence and checks

1. Added a rendered `reading-comfort-1509.spec.ts` test before editing `TasksPage`. Command from `apps/web`: `RHYTHM_E2E_PORT=4289 RHYTHM_DIST_PORT=4290 npx playwright test tests/reading-comfort-1509.spec.ts --grep 'grouped open tasks omit' --reporter=list` → **2 failed / 0 passed**, dark and light; actual row metadata `Open · Past due · P1` failed `not.toContain('Open')`.
2. GitNexus `node .gitnexus/run.cjs impact TasksPage --direction upstream --repo /Users/ajhochhalter/Documents/Rhythm/.mega-wt/integration` → **LOW**, one direct dependent, four impacted symbols, zero indexed execution flows. Index was stale relative to HEAD; this is structural risk guidance, not live proof.
3. After the narrow source change, `RHYTHM_E2E_PORT=4289 RHYTHM_DIST_PORT=4290 npx playwright test tests/reading-comfort-1509.spec.ts tests/list-inspector-primitive.spec.ts --reporter=list` → **19 passed / 0 failed** (both themes, narrow/RTL, 200% zoom, contrast, shared primitive).
4. `cd apps/web && npm run typecheck` → **pass** (`tsc -b`, exit 0). Playwright's web-server production build completed with Vite's existing large-chunk warning. Parent owns the default full suite, Electron-native visual smoke, hosted live checks, and final PR gate.
5. `RHYTHM_E2E_PORT=4291 RHYTHM_DIST_PORT=4292 npx playwright test tests/pages/agent-tools-list-inspector.spec.ts --reporter=list` → **3 passed / 1 timed out**. The last test retained a 640px viewport from its narrow step, then attempted to click an intentionally hidden Gallery list row after 200% zoom. Corrected the test to activate the visible “Back to list” control before selecting. Focused rerun with ports 4293/4294 and `--grep 'edge states'` → **1 passed**. This was a spec sequencing error; no Gallery source behavior changed.
6. Added `issue-1513-c4` to `post-m1-phase-7-schedules-quality.redspec.ts` before changing `LiveSchedulesTool`. Correct runner: `npx playwright test --config tests/post-m1-phase-7-fixture-playwright.config.ts tests/post-m1-phase-7-schedules-quality.redspec.ts --grep 'issue-1513-c4' --reporter=list` → **1 failed**, Agents header was `Live sessions` instead of `Owned schedule run`. The default Playwright config did not discover this `.redspec.ts` file (`No tests found`); the dedicated config owns it.
7. GitNexus impact on `LiveSchedulesTool` → **LOW**, one direct dependent, three impacted symbols, zero indexed processes. After selecting the authorized root session, the same red test → **1 passed**; the entire focused Phase 7 schedule/quality file → **4 passed / 0 failed**. `cd apps/web && npm run typecheck` → **pass** again.

## Decisions

- Use the original #1513/#1509 issue text as the acceptance authority. Keep the 13-entry inventory explicit, and distinguish the Profiles/#1523 exception and live Webhooks unavailable boundary from fixture coverage.
- Preserve full status/date in the task row's accessible name while removing repeated visual `Open`/bucket dates. Retain status when it is not `open`, a named source, read-only/source guidance, priority and dates that are not already conveyed by a group heading.
- Treat a successful run-history lookup as authorization to select that owned session, then navigate Agents. This preserves the specific run rather than an unrelated previously active conversation; the renderer-owned `selectLiveSession` path fetches its details and records the selection.
- Keep the transcript's 840px/72ch reading measure, theme tokens and Agents → Tasks list baseline. Do not generalize the main Tasks row metadata rule to Agent Tools rows.
- Treat AJ's subjective before/after acceptance and real Electron/live action behavior as separate pending gates; a fixture screenshot or passing unit assertion cannot substitute for them.
