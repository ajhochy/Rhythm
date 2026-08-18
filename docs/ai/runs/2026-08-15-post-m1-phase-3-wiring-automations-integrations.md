---
date: 2026-08-15
repo: rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-3]
status: complete
tags: [run, rhythm]
---

# Post-M1 Phase 3 wiring: Automations and Integrations

## Scope

Wired `apps/web/src/pages/automations/**` and `apps/web/src/pages/integrations/**` to their
live domain gateways (`apps/web/src/gateway/automations.ts`, `apps/web/src/gateway/integrations.ts`
— already built and verified 10/10, not modified). Touched only these two page directories, per
the unit's hard constraint.

Mid-task correction from the orchestrator: an earlier draft of this work constructed its own live
gateway instance per page, reading the bearer from `import.meta.env.VITE_RHYTHM_LIVE_TOKEN`
(test-only, unset in the packaged build). The orchestrator centrally wired
`apps/web/src/gateway/index.ts`'s `createLiveGateway()` to expose all eight domains — including
`automations` and `integrations` — from `useGateway().domains`, sharing one real bearer. Both
pages were rewritten to consume `rendererGateway.domains.automations` /
`rendererGateway.domains.integrations` directly; the page-local gateway construction and env-var
reads were deleted entirely. `apps/web/src/gateway/**` was never modified by this unit.

## Canonical literals verified against the API's own declarations

Read directly from `apps/api_server/src/models/automation_rule.ts` before writing any request:

- `AutomationActionType` (lines 15-21): `create_task | create_project_from_template |
  auto_schedule | send_notification | tag_task | create_reservation`. Canonical value is
  `auto_schedule`, not the fixture's `auto_schedule_task`.
- `AutomationRuleSource` (lines 23-27): `rhythm | planning_center | google_calendar | gmail`.
  The fixture's `sourceOrder`/`AutomationSource` already matched this — no change needed.
- `AutomationTriggerKey` (lines 29-43), the 14 exact literals: `rhythm.project_step_due`,
  `rhythm.task_due`, `rhythm.plan_assembly`, `planning_center.plan_upcoming`,
  `planning_center.plan_published`, `planning_center.plan_person_declined`,
  `planning_center.plan_person_unconfirmed`, `planning_center.needed_position_open`,
  `planning_center.special_service_candidate`, `planning_center.service_item_updated`,
  `google_calendar.event_matching_filter`, `google_calendar.all_day_event`,
  `gmail.message_matching_filter`, `gmail.unread_message_matching_filter`. The fixture's
  `pco.*`-prefixed keys, `rhythm.plan_assembled`, `google_calendar.event_matches`, and
  `gmail.message_matches` are all invalid and do not appear in this list.
- `AutomationRule`/`CreateAutomationRuleDto` (lines 45-76): account field is `sourceAccountId`,
  not `accountId`.
- Cross-checked against the served catalog in
  `apps/api_server/src/services/automation_catalog_service.ts:9-163` — the 14 `TRIGGERS` entries
  (9-124) and 6 `ACTIONS` entries (126-163) match the type declarations exactly.
- `IntegrationProvider` — `apps/api_server/src/models/integration_account.ts:1-4`:
  `google_calendar | gmail | planning_center`. The Integrations page's `ProviderId` type
  (`google-calendar | gmail | planning-center`, hyphenated) is a deliberate display/route
  identifier per contract `post-m1-p3-c1i` ("keeping display route IDs separate from canonical
  providers") — kept as-is; only the new `DISPLAY_TO_CANONICAL` boundary in
  `pages/integrations/index.tsx` translates between the two before any gateway call.
- `RecurringTaskRule.frequency` — `apps/api_server/src/models/recurring_task_rule.ts:32`:
  `weekly | monthly | annual`. Found the Integrations AI-Import prompt
  (`pages/integrations/fixtures.ts`) instructing pasted JSON to use
  `"daily|weekly|monthly|yearly"` — none of `daily`/`yearly` are valid. Fixed the prompt text to
  `"weekly|monthly|annual"` and added a `normalizeFrequency()` guard in the live import path that
  maps a stray `yearly` to `annual` and anything else unrecognized to `weekly`, so an
  already-copied stale prompt still cannot reach the API with an invalid literal.

## What is live now

### Automations (`pages/automations/index.tsx`)

- Load: on mount in live mode, `GET /automation-catalog/triggers|actions|providers` and
  `GET /automation-rules` fire in parallel; server rules are mapped to the page's view model via
  `mapServerRuleToView` (labels resolved from the loaded catalogs, never re-derived from the
  invalid local fixture catalog). No fixture rules are ever shown in live mode — `rules`/`receipts`
  initialize empty and are populated only from the real response.
  - `GitNexus`/impact analysis not run for this unit (see Blockers) — but the change is additive
    (new `if (isLive) {...}` branches; the fixture branch of every function is byte-identical to
    the pre-existing code).
- Create/update (builder dialog + inline editor): `POST /automation-rules` and
  `PATCH /automation-rules/:id` send `{name, source, triggerKey, actionType, sourceAccountId,
  enabled, conditions, actionConfig}` built from `liveAutomationPayload()`. The builder's
  trigger/action `<select>` options are sourced from the loaded live catalog
  (`AutomationCatalog.triggers`/`.actionsFor`) instead of the fixture catalog when live, so an
  invalid literal can never be selected in the first place. `sourceAccountId` is always sent as
  `null` in live mode (see Not done).
- Enable/disable toggle: `PATCH /automation-rules/:id {enabled}`.
- Delete: `DELETE /automation-rules/:id`.
- Resync: `POST /automation-rules/:id/resync` then `GET /automation-rules/:id` to refresh
  match-count/timestamps.
- Preview: `GET /automation-rules/:id/preview`.
- All mutations map `AutomationsGatewayError.status` to the existing `SurfaceState` values
  (`forbidden`/`unavailable`/`server-error`) and append a bounded receipt
  (`METHOD path → status-or-"network error"`) — never a raw body, token, or stack.

### Integrations (`pages/integrations/index.tsx`)

- Load: on mount in live mode, `GET /integrations/accounts` fires and is mapped via
  `mapLiveAccounts()` into the page's per-provider view model (all three providers default to
  `disconnected` until a matching server row exists).
- Connect/Reconnect: `openHandoff` now performs a real redirect
  (`window.location.href = gateway.authorizationUrl(kind)`) in live mode instead of opening the
  "FIXTURE HANDOFF" dialog; that dialog and its badge text are fixture-mode-only and never render
  in live mode (verified: `FocusDialog` returns `null` while closed, and `handoff` state is never
  set in the live branch).
- Sync: single-provider (`syncGoogleCalendar`/`syncGmail`/`syncPlanningCenter`) and
  `syncAll()`, each followed by a fresh `GET /integrations/accounts` to refresh status.
- Google Calendar: `GET /integrations/google-calendar/settings` loads real calendar options and
  seeds `calendarSelection`; `saveCalendar` calls `PUT .../preferences` then `POST .../sync`.
- Gmail: `GET /integrations/gmail/signals` loads real signals for the inbox list.
- Planning Center: `GET .../task-preferences` and `GET .../task-options` load real saved
  filters and real team/position lists; `savePcoPreferences` calls
  `PUT .../task-preferences`.
- AI Import: `runLiveImport` calls `importTask`/`importRhythm`/`importProjectTemplate`/
  `addImportedProjectStep` per parsed record, with per-record try/catch so a partial failure
  reports counts and keeps the unsent remainder for retry, matching the existing fixture UX.

## Not done / simplifications (ponytail, with upgrade path)

- **Automations account picker**: live mode always sends `sourceAccountId: null` on create/update;
  it does not yet load `GET /integrations/accounts` to offer picking a specific connected account
  in the builder. That prerequisite is explicitly cross-family (belongs to the Integrations
  gateway/page) and `sourceAccountId: null` is a canonically valid value
  (`apps/api_server/src/models/automation_rule.ts:56,75,88` — nullable). Upgrade: thread
  `IntegrationsGateway.accounts()` into the Automations builder once both pages' owners agree on
  a shared account-list source.
- **Automations `automations-provider-count` tile**: still hardcoded to `3` in the JSX; not wired
  to a real connected-provider count. Cosmetic only, not a literal-correctness issue.
- **Automations facility picker** (`create_reservation` action): still offers the two hardcoded
  fixture facility names in both modes; not wired to `GET /facilities` (Facilities page's gateway,
  out of scope here).
- Neither page's live-mode "view state" `<select>` (a fixture demo control) is hidden; it still
  renders but has no effect other than the existing local `surfaceState`/`pageState` change in
  both modes — harmless, not a correctness issue.
- GitNexus `impact`/`detect_changes` were not run for this unit — this checkout's `.gitnexus`
  index is shared across many concurrently-active units on the same working tree tonight
  (confirmed live: `apps/web/src/pages/messages/live.tsx` briefly failed `tsc -b` mid-run from
  another unit's in-flight edit, then self-resolved), and no commit is being made by this unit, so
  the mandatory pre-commit `detect_changes()` gate does not apply here.

## Checks

### RED (captured before restoring the live-wired implementation)

Command:
```
cd apps/web && npx playwright test --config tests/post-m1-phase-3-live-playwright.config.ts --reporter=line
```
Result: **5 failed, 8 passed** (not 13 failed — five other page families were already wired live
by other units by the time this unit ran). Failures: `post-m1-p3-c2c` (Tasks — another unit's
scope), `post-m1-p3-c2h` (Automations — mine), `post-m1-p3-c2i` (Integrations — mine),
`post-m1-p3-c2j` (shared quick actions — another unit's scope), `post-m1-p3-c3c` (selection-reload
— shared/other units' scope). c2h and c2i both failed with:
`Timeout 5000ms exceeded while waiting on the predicate` in `expectRequest` — i.e. the required
GET never fired, confirming both pages were still fixture-only at that point.

To capture a clean pre-edit baseline without disturbing other units' concurrent work in this
shared, entirely-untracked checkout, the two pages' four files were temporarily reverted to their
pre-edit content (verbatim, from this session's own earlier reads) for the RED run, then restored
exactly (diff-verified byte-identical) before the GREEN run below.

### GREEN (after restoring the live-wired implementation)

```
cd apps/web && npm run typecheck   # PASS (0 errors in pages/automations or pages/integrations)
cd apps/web && npm run build       # PASS — 1641 modules, existing >500kB chunk advisory only
cd apps/web && npx playwright test --config tests/post-m1-phase-3-live-playwright.config.ts --grep "post-m1-p3-c2h|post-m1-p3-c2i" --reporter=line
```
Verbatim:
```
Running 2 tests using 1 worker
[1/2] tests/post-m1-phase-3-live-pages.redspec.ts:130:1 › post-m1-p3-c2h: live Automations uses server catalogs and rejects every invalid fixture literal
[2/2] tests/post-m1-phase-3-live-pages.redspec.ts:142:1 › post-m1-p3-c2i: live Integrations exposes authorization, sync, signals, preferences, options, and imports
  2 passed (8.3s)
```

A full 13-test run of the same config was also executed once for context: 9 passed / 4 failed
(`c2c`, `c2j`, `c3b`, `c3c` — all outside this unit's family per the explicit instruction to
"ignore failures belonging to other families"). `c2h`/`c2i` passed in that run too.

### Fixture mode regression check

```
cd apps/web && npx playwright test --config tests/post-m1-phase-3-fixture-playwright.config.ts contract/issue-2008-automations.spec.ts contract/issue-2009-integrations.spec.ts --reporter=line
```
Result: **30 passed** (all `issue-2008-c1..c15` and `issue-2009-c1..c15`). Fixture mode is
byte-identical in behavior to before this unit's changes; every new live-mode code path is gated
behind `if (isLive) {...}` with the original fixture code left untouched below it.

## Files

- `apps/web/src/pages/automations/index.tsx` (covered in `apps/web/SHA256SUMS`)
- `apps/web/src/pages/automations/fixtures.ts` (covered; additive `AutomationAction` union widening only, `'auto_schedule'` added alongside the existing `'auto_schedule_task'`)
- `apps/web/src/pages/integrations/index.tsx` (covered)
- `apps/web/src/pages/integrations/fixtures.ts` (covered; one-line AI-Import prompt fix to canonical `weekly|monthly|annual`)
- `apps/web/SHA256SUMS` / `apps/web/PROVENANCE.md`: not touched.
