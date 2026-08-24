# Automations wiring note — issue 2008

## Route registration ask

Register `AutomationsPage` in lead-owned `src/App.tsx` for the collection and rule-inspection deep links, passing the route without hash/query:

```tsx
if (route === '/automations' || route.startsWith('/automations/')) {
  content = <AutomationsPage route={route} />;
}
```

`#/automations` renders the grouped list. `#/automations/<ruleId>` opens the existing preview/inspection surface for the matching fixture rule; `#/automations/rule-calendar-room` is canonical. Unknown IDs show a recoverable not-found state and Back to automations. Query state remains after the path. Builder create/edit stay modal controls on the collection route; no extra route registration is needed.

## `EndpointContract` additions

Ready-to-merge objects for lead-owned `src/endpointMap.ts`:

```ts
{ id: 'automation-rule-list', control: 'Automations initial load / Retry / post-resync reload', method: 'GET', route: '/automation-rules', handler: 'listAutomationRules', flutterSource: 'automation_rules_data_source.dart:fetchAll', test: 'issue-2008-c5: bootstrap ledger records exact catalog dependency receipts' },
{ id: 'automation-trigger-catalog', control: 'Builder trigger catalog', method: 'GET', route: '/automation-catalog/triggers', handler: 'listAutomationTriggers', flutterSource: 'automation_rules_data_source.dart:fetchTriggers', test: 'issue-2008-c5: bootstrap ledger records exact catalog dependency receipts' },
{ id: 'automation-action-catalog', control: 'Builder action catalog', method: 'GET', route: '/automation-catalog/actions', handler: 'listAutomationActions', flutterSource: 'automation_rules_data_source.dart:fetchActions', test: 'issue-2008-c5: bootstrap ledger records exact catalog dependency receipts' },
{ id: 'automation-provider-catalog', control: 'Builder source catalog', method: 'GET', route: '/automation-catalog/providers', handler: 'listAutomationProviders', flutterSource: 'automation_rules_data_source.dart:fetchProviders', test: 'issue-2008-c5: bootstrap ledger records exact catalog dependency receipts' },
{ id: 'automation-integration-accounts', control: 'Connected provider prerequisite / statistics', method: 'GET', route: '/integrations/accounts', handler: 'listIntegrationAccounts', flutterSource: 'automation_rules_data_source.dart:fetchAccounts', test: 'issue-2008-c9: provider prerequisites and dependency failures remain explicit' },
{ id: 'automation-pco-options', control: 'Planning Center team and position filters', method: 'GET', route: '/integrations/planning-center/task-options', handler: 'getPlanningCenterTaskOptions', flutterSource: 'automation_rules_data_source.dart:fetchPlanningCenterTaskOptions', test: 'issue-2008-c10: builder choices follow provider trigger and action catalogs' },
{ id: 'automation-gmail-labels', control: 'Gmail label filter', method: 'GET', route: '/integrations/gmail/labels', handler: 'listGmailLabels', flutterSource: 'automation_rules_data_source.dart:fetchGmailLabels', test: 'issue-2008-c10: builder choices follow provider trigger and action catalogs' },
{ id: 'automation-project-templates', control: 'Create project from template picker', method: 'GET', route: '/project-templates', handler: 'listProjectTemplates', flutterSource: 'automation_rules_data_source.dart:fetchProjectTemplateNames', test: 'issue-2008-c10: builder choices follow provider trigger and action catalogs' },
{ id: 'automation-facilities', control: 'Builder reservation facility picker', method: 'GET', route: '/facilities', handler: 'listAutomationFacilities', flutterSource: 'facilities_data_source.dart:getFacilities', test: 'issue-2008-c10: builder choices follow provider trigger and action catalogs' },
{ id: 'automation-rule-preview', control: 'Rule card / Inspect', method: 'GET', route: '/automation-rules/:id/preview', handler: 'previewAutomationRule', flutterSource: 'automation_rules_data_source.dart:fetchPreview', test: 'issue-2008-c13: preview renders historical match evidence without mutation' },
{ id: 'automation-rule-create', control: 'Builder Create', method: 'POST', route: '/automation-rules', handler: 'createAutomationRule', flutterSource: 'automation_rules_data_source.dart:create', test: 'issue-2008-c11: create edit and delete update the list with exact receipts', payload: '{name,source,triggerKey,actionType,triggerConfig?,actionConfig?,sourceAccountId?,enabled,conditions?}' },
{ id: 'automation-rule-update', control: 'Builder Save / enabled switch', method: 'PATCH', route: '/automation-rules/:id', handler: 'updateAutomationRule', flutterSource: 'automation_rules_data_source.dart:update', test: 'issue-2008-c11: create edit and delete update the list with exact receipts', payload: '{name?,source?,triggerKey?,actionType?,triggerConfig?,actionConfig?,sourceAccountId?,enabled?,conditions}' },
{ id: 'automation-rule-delete', control: 'Delete rule', method: 'DELETE', route: '/automation-rules/:id', handler: 'deleteAutomationRule', flutterSource: 'automation_rules_data_source.dart:delete', test: 'issue-2008-c11: create edit and delete update the list with exact receipts' },
{ id: 'automation-rule-resync', control: 'Trigger / Resync', method: 'POST', route: '/automation-rules/:id/resync', handler: 'resyncAutomationRule', flutterSource: 'automation_rules_data_source.dart:resync', test: 'issue-2008-c14: resync exposes progress result receipt and deterministic reload' },
```

Visible simulated receipts are exact:

- `GET /automation-rules → 200`
- `GET /automation-catalog/triggers → 200`
- `GET /automation-catalog/actions → 200`
- `GET /automation-catalog/providers → 200`
- `GET /integrations/accounts → 200`
- `GET /integrations/planning-center/task-options → 200`
- `GET /integrations/gmail/labels → 200`
- `GET /project-templates → 200`
- `GET /facilities → 200` when a builder opens
- `GET /automation-rules/:id/preview → 200`
- `POST /automation-rules {name,source,triggerKey,actionType,triggerConfig?,actionConfig?,sourceAccountId?,enabled,conditions?} → 201`
- `PATCH /automation-rules/:id {…}` → 200; enabled-only uses `{enabled}`
- `DELETE /automation-rules/:id → 204`
- `POST /automation-rules/:id/resync → 200`, followed by the eight bootstrap GETs

Source/group organization, opening/closing dialogs, template example/placeholder chips, conditions, catalog selection, review rendering, not-found recovery, and Integrations navigation are client-side and append no fake receipt.

## Cross-page consistency

- Integration account IDs, provider names/statuses, last-sync stamps, reauth/error messages, and the fixture handoff route must match the Integrations page owner. Missing prerequisites navigate only to `#/integrations`; fixture mode never opens OAuth.
- Project template names must match Projects fixtures. Automations reads only names; it does not add/edit templates.
- Reservation facility IDs/names/buildings must match Facilities fixtures. Automations reads only the facility list; reservation creation occurs later through automation evaluation, not directly from this page.
- If Dashboard or Tasks surface an automation-created item, use the same automation rule IDs and source labels. Canonical inspection fixture is `rule-calendar-room`.
- Provider catalog is account-filtered by the API. Do not show disconnected providers as selectable new-rule sources merely because the static service catalog knows them.

## Shared style/icon asks

None. Keep all eventual layout, fixture, and CSS work page-local under `src/pages/automations/` and `.pg-automations`. Reuse existing shell buttons, fields, menu/dialog patterns, state panels, tokens, and icons. Add accessible text labels to edit/inspect/delete icon buttons locally.

## Resolved lead decisions and documented divergences

- Flutter has no list search/filter control (`automation_rules_view.dart:42-106,346-550`), so the web page intentionally adds neither. Source grouping and API-created order are the complete deterministic organization.
- `#/automations/<ruleId>` is the only rule deep-link. Unknown ids render a local recoverable 404 state and append no fabricated detail receipt.
- Delete is hardened with the shared Tasks/Projects/Rhythms confirmation pattern: the dialog names the rule, Cancel preserves it and appends no receipt, and Confirm alone appends `DELETE /automation-rules/:id → 204`. This intentionally diverges from Flutter's immediate delete (`automation_rules_view.dart:406,544`; `automation_rules_controller.dart:171-184`).
- Resync exposes the API response counts as `2 matched · 1 action executed`, then appends the exact eight-request reload. Flutter preserves the progress/reload sequence but discards the response body (`automation_rules_controller.dart:186-200`); the web result closes that visibility gap without inventing a second endpoint.
- Zero selected Planning Center triggers retain Flutter's first-trigger fallback, and blank condition rows are omitted without an error (`automation_rules_view.dart:1301-1313,2030-2062`).
- Missing integration prerequisites disable only affected mutation controls and point to the fixture-only `#/integrations` handoff. No OAuth or provider URL is opened.
