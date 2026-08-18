# Integrations wiring note — issue 2009

## Route registration ask

Import `IntegrationsPage` in lead-owned `src/App.tsx` and route the collection plus every page-owned section deep link:

```tsx
else if (route === '/integrations' || route.startsWith('/integrations/')) {
  content = <IntegrationsPage route={route} />;
}
```

Approved paths:

- `#/integrations`
- `#/integrations/google-calendar`
- `#/integrations/gmail`
- `#/integrations/planning-center`
- `#/integrations/assistant-tools`
- `#/integrations/import`

Provider/assistant paths identify and focus the corresponding visible section. `/integrations/import` opens the existing AI Import dialog. Unknown subpaths retain the page shell and expose Back to integrations. Query state remains after the path. Shell already includes Integrations in primary/overflow navigation, so no Shell edit is requested.

## `EndpointContract` additions

Ready-to-merge objects for lead-owned `src/endpointMap.ts`:

```ts
{ id: 'integration-accounts', control: 'Integrations initial load / Retry / post-sync refresh', method: 'GET', route: '/integrations/accounts', handler: 'getIntegrationAccounts', flutterSource: 'integrations_data_source.dart:fetchAccounts', test: 'issue-2009-c1: integrations routes render the real page and section deep links' },
{ id: 'integration-google-begin', control: 'Connect/Reconnect Google', method: 'GET', route: '/auth/google/begin?sessionToken=…', handler: 'beginGoogleOAuthFixtureHandoff', flutterSource: 'integrations_data_source.dart:googleBeginUri', test: 'issue-2009-c9: connect actions expose explicit OAuth fixture handoffs without navigation' },
{ id: 'integration-google-agent-begin', control: 'Enable Google tools for the assistant', method: 'GET', route: '/auth/google/begin?intent=agent&sessionToken=…', handler: 'beginGoogleAgentOAuthFixtureHandoff', flutterSource: 'integrations_data_source.dart:googleAgentBeginUri', test: 'issue-2009-c13: assistant Google consent remains separate and fixture safe' },
{ id: 'integration-planning-center-begin', control: 'Connect/Reconnect Planning Center', method: 'GET', route: '/auth/planning-center/begin?sessionToken=…', handler: 'beginPlanningCenterOAuthFixtureHandoff', flutterSource: 'integrations_data_source.dart:planningCenterBeginUri', test: 'issue-2009-c9: connect actions expose explicit OAuth fixture handoffs without navigation' },
{ id: 'integration-google-calendar-settings', control: 'Calendar sources load / preference refresh', method: 'GET', route: '/integrations/google-calendar/settings', handler: 'getGoogleCalendarSettings', flutterSource: 'integrations_data_source.dart:fetchGoogleCalendarSettings', test: 'issue-2009-c10: calendar sources select validate save sync and recover truthfully' },
{ id: 'integration-google-calendar-preferences', control: 'Calendar sources Save', method: 'PUT', route: '/integrations/google-calendar/preferences', handler: 'saveGoogleCalendarPreferences', flutterSource: 'integrations_data_source.dart:saveGoogleCalendarPreferences', test: 'issue-2009-c10: calendar sources select validate save sync and recover truthfully', payload: '{selectedCalendarIds}' },
{ id: 'integration-google-calendar-sync', control: 'Sync Calendar / save follow-up / Retry Calendar', method: 'POST', route: '/integrations/google-calendar/sync', handler: 'syncGoogleCalendar', flutterSource: 'integrations_data_source.dart:syncGoogleCalendar', test: 'issue-2009-c10: calendar sources select validate save sync and recover truthfully' },
{ id: 'integration-gmail-signals-list', control: 'Recent inbox signals load / refresh', method: 'GET', route: '/integrations/gmail/signals', handler: 'getGmailSignals', flutterSource: 'integrations_data_source.dart:fetchGmailSignals', test: 'issue-2009-c11: Gmail signals dedupe display sync failure and retry' },
{ id: 'integration-gmail-sync', control: 'Sync Gmail / Retry Gmail', method: 'POST', route: '/integrations/gmail/sync', handler: 'syncGmail', flutterSource: 'integrations_data_source.dart:syncGmail', test: 'issue-2009-c11: Gmail signals dedupe display sync failure and retry' },
{ id: 'integration-pco-task-preferences-get', control: 'Planning Center saved task-filter load', method: 'GET', route: '/integrations/planning-center/task-preferences', handler: 'getPlanningCenterTaskPreferences', flutterSource: 'integrations_data_source.dart:fetchPlanningCenterTaskPreferences', test: 'issue-2009-c12: Planning Center dependent team and position preferences save exactly' },
{ id: 'integration-pco-task-preferences-put', control: 'Planning Center task-filter Save', method: 'PUT', route: '/integrations/planning-center/task-preferences', handler: 'savePlanningCenterTaskPreferences', flutterSource: 'integrations_data_source.dart:savePlanningCenterTaskPreferences', test: 'issue-2009-c12: Planning Center dependent team and position preferences save exactly', payload: '{teamIds,positionNames}' },
{ id: 'integration-pco-task-options', control: 'Planning Center Choose lazy options load', method: 'GET', route: '/integrations/planning-center/task-options', handler: 'getPlanningCenterTaskOptions', flutterSource: 'integrations_data_source.dart:fetchPlanningCenterTaskOptions', test: 'issue-2009-c12: Planning Center dependent team and position preferences save exactly' },
{ id: 'integration-pco-sync', control: 'Sync Planning Center / Retry Planning Center', method: 'POST', route: '/integrations/planning-center/sync', handler: 'syncPlanningCenter', flutterSource: 'integrations_data_source.dart:syncPlanningCenter', test: 'issue-2009-c14: individual and sync all operations expose progress partial failure and retry' },
{ id: 'integration-sync-all', control: 'Sync all', method: 'POST', route: '/integrations/sync-all', handler: 'syncAllIntegrations', flutterSource: 'integrations_data_source.dart:syncAll', test: 'issue-2009-c14: individual and sync all operations expose progress partial failure and retry' },
```

AI Import reuses existing cross-page contracts rather than duplicating IDs:

```ts
{ id: 'tasks-create', control: 'AI Import task', method: 'POST', route: '/tasks', handler: 'create', flutterSource: 'tasks_local_data_source.dart:create', test: 'issue-2009-c15: AI Import validates formats reports exact outcomes and retries safely', payload: '{title,notes?,scheduledDate?,preferredAgent:null}' },
{ id: 'recurring-rule-create', control: 'AI Import rhythm', method: 'POST', route: '/recurring-rules', handler: 'createRecurringRule', flutterSource: 'rhythms_data_source.dart:create', test: 'issue-2009-c15: AI Import validates formats reports exact outcomes and retries safely', payload: '{title,frequency,dayOfWeek?,dayOfMonth?,month?}' },
{ id: 'project-template-create', control: 'AI Import project template', method: 'POST', route: '/project-templates', handler: 'createProjectTemplate', flutterSource: 'projects_local_data_source.dart:create', test: 'issue-2009-c15: AI Import validates formats reports exact outcomes and retries safely', payload: '{name,description?}' },
{ id: 'project-template-step-create', control: 'AI Import project-template step', method: 'POST', route: '/project-templates/:templateId/steps', handler: 'createProjectTemplateStep', flutterSource: 'projects_local_data_source.dart:addStep', test: 'issue-2009-c15: AI Import validates formats reports exact outcomes and retries safely', payload: '{title,offsetDays,offsetDescription?,sortOrder,assigneeId:null}' },
```

Before appending the four reuse objects, merge with any existing IDs from Tasks/Rhythms/Projects; update their `control`/`test` references rather than creating duplicate endpoint rows.

## Exact visible receipts

Initial ready load, in Flutter order:

- `GET /integrations/accounts → 200`
- `GET /integrations/google-calendar/settings → 200`
- `GET /integrations/gmail/signals → 200`
- `GET /integrations/planning-center/task-preferences → 200`

Calendar Save appends: `PUT /integrations/google-calendar/preferences {selectedCalendarIds} → 200`, `GET /integrations/google-calendar/settings → 200`, `POST /integrations/google-calendar/sync → 200`, `GET /integrations/accounts → 200`.

PCO Choose lazily appends `GET /integrations/planning-center/task-options → 200`; PCO Save appends `PUT /integrations/planning-center/task-preferences {teamIds,positionNames} → 200`.

Individual sync appends its POST and then the normal conditional load sequence. Sync all appends `POST /integrations/sync-all → 200` and the normal load sequence. A partial `errors[]` response remains a 200 receipt but also renders provider failures and retry actions; do not falsify it as a 500.

OAuth receipt text is explicit and simulated:

- `GET /auth/google/begin?sessionToken=fixture-session → 302 FIXTURE HANDOFF`
- `GET /auth/google/begin?intent=agent&sessionToken=fixture-session → 302 FIXTURE HANDOFF`
- `GET /auth/planning-center/begin?sessionToken=fixture-session → 302 FIXTURE HANDOFF`

No OAuth host or production/local API host is contacted. All/None, checkboxes/chips, dialog open/close/cancel, Copy prompt, tab changes, deep-link focus, and Retry presentation logic are client-side and add no fake receipt.

## Cross-page and shared notes

- Dashboard/Planner may consume Calendar shadow events; integration preference changes stay page-local but receipts must describe that sync follows Save.
- Automations consumes provider trigger families and PCO options. Integrations displays only connection/preference context and does not invent automation-rule editors.
- AI Import mutates Tasks, Rhythms, and project templates. Reuse their deterministic fixture collections/endpoint identities when the lead later wires cross-page persistence; this page-owned prototype still resets on reload.
- The Shell already has `nav-integrations` and overflow navigation. No Shell changes beyond route rendering are needed.
- No new shared icon or style is required. Keep all provider marks/text treatments and responsive behavior page-local and use existing button, status, dialog, state-panel, trace, and token patterns.

## Lead decisions requested

1. Approve the web correction that surfaces `sync-all` HTTP-200 partial errors and retries only failed providers.
2. Approve truthful partial AI Import results/idempotent retry even though Flutter controllers currently swallow create failures.
3. Confirm the proposed provider/assistant/import deep-link scheme; Flutter itself is index-based and has no URL canon.
