/// Contract tests for issue #48 — Refine PCO automation rule editor UX
///
/// UI criteria tested here:
///   c4 — PCO action dropdown excludes tag_task, send_notification, auto_schedule
///   c5 — PCO team + position multi-select FilterChips render
///   c6 — Service-week day picker includes Saturday (6) and Sunday (7)
///   c7 — Placeholder insert chips appear and insert {{token}} at cursor
///
/// Run: cd apps/desktop_flutter && flutter test test/issue_48_contract_test.dart

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/services/server_config_service.dart';
import 'package:rhythm_desktop/features/integrations/models/integration_account.dart';
import 'package:rhythm_desktop/features/integrations/models/planning_center_task_options.dart';
import 'package:rhythm_desktop/features/tasks/controllers/automation_rules_controller.dart';
import 'package:rhythm_desktop/features/tasks/data/automation_rules_data_source.dart';
import 'package:rhythm_desktop/features/tasks/models/automation_catalog.dart';
import 'package:rhythm_desktop/features/tasks/models/automation_rule.dart';
import 'package:rhythm_desktop/features/tasks/repositories/automation_rules_repository.dart';
import 'package:rhythm_desktop/features/tasks/views/automation_rules_view.dart';

// ---------------------------------------------------------------------------
// Helpers — reuse the same fake repository pattern from automation_rules_test
// ---------------------------------------------------------------------------

class _FakeRepo extends AutomationRulesRepository {
  _FakeRepo()
    : super(AutomationRulesDataSource(baseUrl: 'http://example.invalid'));

  List<AutomationRule> rulesFixture = [];
  List<AutomationTriggerCatalogItem> triggersFixture = [];
  List<AutomationActionCatalogItem> actionsFixture = [];
  List<AutomationProviderCatalogItem> providersFixture = [];
  List<IntegrationAccount> accountsFixture = [];
  PlanningCenterTaskOptions? pcoOptionsFixture;
  List<String> gmailLabelsFixture = [];
  List<String> projectTemplateNamesFixture = [];
  AutomationRulePreview previewFixture = const AutomationRulePreview(
    ruleId: 'r',
    summary: '',
  );

  @override
  Future<List<AutomationRule>> getAll() async => rulesFixture;
  @override
  Future<List<AutomationTriggerCatalogItem>> getTriggers() async =>
      triggersFixture;
  @override
  Future<List<AutomationActionCatalogItem>> getActions() async =>
      actionsFixture;
  @override
  Future<List<AutomationProviderCatalogItem>> getProviders() async =>
      providersFixture;
  @override
  Future<List<IntegrationAccount>> getAccounts() async => accountsFixture;
  @override
  Future<PlanningCenterTaskOptions?> getPlanningCenterTaskOptions() async =>
      pcoOptionsFixture;
  @override
  Future<List<String>> getGmailLabels() async => gmailLabelsFixture;
  @override
  Future<List<String>> getProjectTemplateNames() async =>
      projectTemplateNamesFixture;
  @override
  Future<AutomationRulePreview> getPreview(String id) async => previewFixture;
}

/// Builds a minimal PCO-connected provider+trigger setup.
_FakeRepo _pcoRepo({
  List<AutomationActionCatalogItem>? actions,
  PlanningCenterTaskOptions? pcoOptions,
  List<String> projectTemplates = const [],
}) {
  final repo = _FakeRepo()
    ..triggersFixture = const [
      AutomationTriggerCatalogItem(
        key: 'planning_center.plan_upcoming',
        source: 'planning_center',
        label: 'Plan upcoming',
        description: 'A plan is coming up.',
        signalTypes: ['plan_upcoming'],
        configSchema: {},
      ),
      AutomationTriggerCatalogItem(
        key: 'planning_center.plan_published',
        source: 'planning_center',
        label: 'Plan published',
        description: 'A plan was published.',
        signalTypes: ['plan_published'],
        configSchema: {},
      ),
    ]
    ..actionsFixture =
        actions ??
        [
          const AutomationActionCatalogItem(
            key: 'create_task',
            label: 'Create task',
            description: 'Create task.',
            configSchema: {},
          ),
          const AutomationActionCatalogItem(
            key: 'create_project_from_template',
            label: 'Create project from template',
            description: 'Create project.',
            configSchema: {},
          ),
          const AutomationActionCatalogItem(
            key: 'tag_task',
            label: 'Tag task',
            description: 'Tag task.',
            configSchema: {},
          ),
          const AutomationActionCatalogItem(
            key: 'send_notification',
            label: 'Send notification',
            description: 'Send notification.',
            configSchema: {},
          ),
          const AutomationActionCatalogItem(
            key: 'auto_schedule',
            label: 'Auto-schedule task',
            description: 'Auto-schedule.',
            configSchema: {},
          ),
        ]
    ..providersFixture = const [
      AutomationProviderCatalogItem(
        source: 'planning_center',
        label: 'Planning Center',
        description: 'PCO sync.',
        syncSupport: 'push_capable',
        triggerKeys: [
          'planning_center.plan_upcoming',
          'planning_center.plan_published',
        ],
      ),
    ]
    ..accountsFixture = [
      IntegrationAccount(
        id: 'pco-1',
        provider: 'planning_center',
        status: 'connected',
        connected: true,
        email: 'team@church.test',
        accountLabel: 'team@church.test',
        providerDisplayName: 'Planning Center',
        availableTriggerFamilies: const ['planning_center'],
        syncSupportMode: 'push_capable',
      ),
    ]
    ..pcoOptionsFixture = pcoOptions
    ..projectTemplateNamesFixture = projectTemplates;
  return repo;
}

/// Pumps [AutomationRulesView] and opens the "New automation" dialog
/// already set to Planning Center source.
Future<void> _openPcoBuildDialog(WidgetTester tester, _FakeRepo repo) async {
  final serverConfig = ServerConfigService();
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AutomationRulesController(repo)),
        ChangeNotifierProvider<ServerConfigService>.value(value: serverConfig),
      ],
      child: const MaterialApp(home: AutomationRulesView()),
    ),
  );
  await tester.pumpAndSettle();

  // Open the builder dialog via the "Create automation" empty-state button
  // or "New automation" header button.
  final createBtn = find.text('Create automation');
  final newBtn = find.text('New automation');
  if (tester.any(createBtn)) {
    await tester.tap(createBtn.last);
  } else {
    await tester.tap(newBtn.last);
  }
  await tester.pumpAndSettle();
}

void main() {
  // ---------------------------------------------------------------------------
  // c4 — PCO action dropdown excludes tag_task / send_notification / auto_schedule
  // ---------------------------------------------------------------------------
  testWidgets(
    'issue-48-c4: PCO action dropdown excludes tag_task, send_notification, auto_schedule',
    (tester) async {
      final repo = _pcoRepo();
      await _openPcoBuildDialog(tester, repo);

      // The dialog must be open — find the Action step header
      expect(find.text('4. Action'), findsOneWidget);

      // The allowed actions must be present
      // (They appear in the dropdown list when opened.)
      // Check by finding Action dropdown; open it.
      final actionDropdown = find.byWidgetPredicate(
        (w) =>
            w is DropdownButtonFormField<String> &&
            w.decoration.labelText == 'Action',
      );
      expect(actionDropdown, findsOneWidget);

      // The disallowed labels must NOT appear anywhere in the dialog
      expect(find.text('Tag task'), findsNothing);
      expect(find.text('Send notification'), findsNothing);
      expect(find.text('Auto-schedule task'), findsNothing);

      // The allowed labels must be present in the widget tree
      // (they're shown in the dropdown value slot even when closed)
      expect(find.text('Create task'), findsWidgets);
    },
  );

  // ---------------------------------------------------------------------------
  // c5 — PCO team + position multi-select FilterChips render
  // ---------------------------------------------------------------------------
  testWidgets('issue-48-c5: PCO team and position multi-select chips render', (
    tester,
  ) async {
    final repo = _pcoRepo(
      pcoOptions: PlanningCenterTaskOptions(
        teams: [
          PlanningCenterTeamOption(
            id: 'team-1',
            name: 'Band',
            serviceTypeId: 'svc-1',
            serviceTypeName: 'Weekend Service',
          ),
          PlanningCenterTeamOption(
            id: 'team-2',
            name: 'Vocals',
            serviceTypeId: 'svc-1',
            serviceTypeName: 'Weekend Service',
          ),
        ],
        positionsByTeamId: const {
          'team-1': ['Guitar', 'Keys'],
          'team-2': ['Soprano', 'Alto'],
        },
      ),
    );
    await _openPcoBuildDialog(tester, repo);

    // Team chips rendered
    expect(find.text('Weekend Service · Band'), findsOneWidget);
    expect(find.text('Weekend Service · Vocals'), findsOneWidget);

    // Before selecting a team, all positions from all teams should be shown
    expect(find.text('Guitar'), findsOneWidget);
    expect(find.text('Soprano'), findsOneWidget);
  });

  // ---------------------------------------------------------------------------
  // c6 — Day-of-week picker includes Saturday (6) and Sunday (7)
  // ---------------------------------------------------------------------------
  testWidgets('issue-48-c6: service-week day picker includes Saturday and Sunday', (
    tester,
  ) async {
    final repo = _pcoRepo();
    await _openPcoBuildDialog(tester, repo);

    // Scroll to the Action section; the target-day dropdown for PCO create_task
    // is rendered when actionType == create_task and source == planning_center.
    // Scroll down to find it.
    await tester.drag(
      find.byType(SingleChildScrollView),
      const Offset(0, -800),
    );
    await tester.pumpAndSettle();

    // Open the "Schedule in service week" dropdown
    final dayDropdown = find.byWidgetPredicate(
      (w) =>
          w is DropdownButtonFormField<int> &&
          (w.decoration.labelText?.contains('service week') ?? false),
    );
    expect(
      dayDropdown,
      findsOneWidget,
      reason: 'Service week day picker not found',
    );

    await tester.ensureVisible(dayDropdown);
    await tester.pumpAndSettle();
    await tester.tap(dayDropdown, warnIfMissed: false);
    await tester.pumpAndSettle();

    // All 7 day labels must appear in the dropdown menu
    expect(find.text('Monday'), findsWidgets);
    expect(find.text('Tuesday'), findsWidgets);
    expect(find.text('Wednesday'), findsWidgets);
    expect(find.text('Thursday'), findsWidgets);
    expect(find.text('Friday'), findsWidgets);
    // These two are the new additions — they must be present
    expect(find.text('Saturday'), findsOneWidget);
    expect(find.text('Sunday'), findsOneWidget);
  });

  // ---------------------------------------------------------------------------
  // c7 — Placeholder insert chips insert {{token}} at cursor
  // ---------------------------------------------------------------------------
  testWidgets(
    'issue-48-c7: placeholder insert chips insert {{token}} at cursor in title field',
    (tester) async {
      final repo = _pcoRepo();
      await _openPcoBuildDialog(tester, repo);

      // Find the task title template field
      final titleField = find.widgetWithText(TextField, 'Task title template');
      expect(
        titleField,
        findsOneWidget,
        reason: 'Task title template field not found',
      );

      // Tap the field so it has focus
      await tester.tap(titleField, warnIfMissed: false);
      await tester.pumpAndSettle();

      // The placeholder chip buttons must be present below the title field.
      // For PCO source the expected tokens are: title, serviceType, team, position, date.
      // {{title}} appears once under the title field and once under the notes field —
      // both rows are rendered, so we use findsWidgets.
      final titleChips = find.text('{{title}}');
      expect(
        titleChips,
        findsWidgets,
        reason: '{{title}} chip not found below template fields',
      );

      // Tap the first {{title}} chip — it belongs to the title template row.
      // Ensure it's visible first.
      await tester.ensureVisible(titleChips.first);
      await tester.pumpAndSettle();
      await tester.tap(titleChips.first, warnIfMissed: false);
      await tester.pumpAndSettle();

      // Verify the title template field now contains the placeholder
      final titleController = tester.widget<TextField>(titleField).controller;
      expect(
        titleController!.text,
        contains('{{title}}'),
        reason:
            'Tapping {{title}} chip should insert {{title}} into the title template field',
      );
    },
  );
} // end main
