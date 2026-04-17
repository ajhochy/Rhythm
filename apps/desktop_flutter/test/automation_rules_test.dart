import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/integrations/models/integration_account.dart';
import 'package:rhythm_desktop/features/integrations/models/planning_center_task_options.dart';
import 'package:rhythm_desktop/features/tasks/controllers/automation_rules_controller.dart';
import 'package:rhythm_desktop/features/tasks/data/automation_rules_data_source.dart';
import 'package:rhythm_desktop/features/tasks/models/automation_catalog.dart';
import 'package:rhythm_desktop/features/tasks/models/automation_rule.dart';
import 'package:rhythm_desktop/features/tasks/repositories/automation_rules_repository.dart';
import 'package:rhythm_desktop/features/tasks/views/automation_rules_view.dart';

void main() {
  test(
    'AutomationRulesController loads catalog, accounts, and preview metadata',
    () async {
      final repository = _FakeAutomationRulesRepository()
        ..rulesFixture = [
          _rule(
            id: 'rule-1',
            source: 'gmail',
            triggerKey: 'gmail.unread_message_matching_filter',
            actionType: 'create_task',
            previewSample: const {
              'subject': 'Invoice approval',
              'fromEmail': 'finance@example.com',
            },
          ),
        ]
        ..triggersFixture = const [
          AutomationTriggerCatalogItem(
            key: 'gmail.unread_message_matching_filter',
            source: 'gmail',
            label: 'Unread Gmail message matches filter',
            description: 'Match unread Gmail messages by sender and subject.',
            signalTypes: ['gmail_unread_message_seen'],
            configSchema: {
              'fields': ['sender', 'subjectContains'],
            },
          ),
        ]
        ..actionsFixture = const [
          AutomationActionCatalogItem(
            key: 'create_task',
            label: 'Create task',
            description: 'Create a follow-up task in Rhythm.',
            configSchema: {
              'fields': ['titleTemplate'],
            },
          ),
        ]
        ..providersFixture = const [
          AutomationProviderCatalogItem(
            source: 'gmail',
            label: 'Gmail',
            description: 'Metadata-driven Gmail message triggers.',
            syncSupport: 'push_capable',
            triggerKeys: ['gmail.unread_message_matching_filter'],
          ),
        ]
        ..accountsFixture = [
          IntegrationAccount(
            id: 'gmail-account-1',
            provider: 'gmail',
            status: 'connected',
            connected: true,
            email: 'owner@example.com',
            accountLabel: 'owner@example.com',
            providerDisplayName: 'Gmail',
            lastSyncedAt: '2026-04-01T18:00:00.000Z',
            availableTriggerFamilies: const ['gmail'],
            syncSupportMode: 'push_capable',
          ),
        ]
        ..planningCenterTaskOptionsFixture = PlanningCenterTaskOptions(
          teams: [
            PlanningCenterTeamOption(
              id: 'team-1',
              name: 'Band',
              serviceTypeId: 'svc-1',
              serviceTypeName: 'Weekend Service',
            ),
          ],
          positionsByTeamId: const {
            'team-1': ['Guitar'],
          },
        )
        ..previewFixture = const AutomationRulePreview(
          ruleId: 'rule-1',
          summary:
              'Finance unread: gmail.unread_message_matching_filter -> create_task',
          previewSample: {'subject': 'Invoice approval'},
          lastMatchedAt: '2026-04-01T18:00:00.000Z',
          lastEvaluatedAt: '2026-04-01T18:00:00.000Z',
          matchCountLastRun: 1,
        );
      final controller = AutomationRulesController(repository);

      await controller.load();
      await controller.loadPreview('rule-1');

      expect(controller.status, AutomationRulesStatus.idle);
      expect(controller.rules, hasLength(1));
      expect(controller.triggers.single.source, 'gmail');
      expect(controller.accounts.single.accountLabel, 'owner@example.com');
      expect(
        controller.planningCenterTaskOptions?.positionsByTeamId['team-1'],
        ['Guitar'],
      );
      expect(
        controller.selectedPreview?.summary,
        'Finance unread: gmail.unread_message_matching_filter -> create_task',
      );
    },
  );

  testWidgets(
    'AutomationRulesView shows grouped provider cards with account and match metadata',
    (tester) async {
      final repository = _FakeAutomationRulesRepository()
        ..rulesFixture = [
          _rule(
            id: 'rule-1',
            source: 'planning_center',
            triggerKey: 'planning_center.plan_person_declined',
            actionType: 'create_task',
            sourceAccountId: 'pco-account-1',
            matchCountLastRun: 2,
            lastMatchedAt: '2026-04-01T18:00:00.000Z',
            previewSample: const {
              'serviceTypeName': 'Weekend Service',
              'positionName': 'Guitar',
            },
          ),
        ]
        ..triggersFixture = const [
          AutomationTriggerCatalogItem(
            key: 'planning_center.plan_person_declined',
            source: 'planning_center',
            label: 'Volunteer declined',
            description: 'Declined volunteer',
            signalTypes: ['team_member_declined'],
            configSchema: {
              'fields': ['teamId'],
            },
          ),
        ]
        ..actionsFixture = const [
          AutomationActionCatalogItem(
            key: 'create_task',
            label: 'Create task',
            description: 'Create task.',
            configSchema: {
              'fields': ['titleTemplate'],
            },
          ),
        ]
        ..providersFixture = const [
          AutomationProviderCatalogItem(
            source: 'planning_center',
            label: 'Planning Center',
            description: 'Sync-derived staffing triggers.',
            syncSupport: 'push_capable',
            triggerKeys: ['planning_center.plan_person_declined'],
          ),
        ]
        ..accountsFixture = [
          IntegrationAccount(
            id: 'pco-account-1',
            provider: 'planning_center',
            status: 'connected',
            connected: true,
            email: 'team@church.test',
            accountLabel: 'team@church.test',
            providerDisplayName: 'Planning Center',
            lastSyncedAt: '2026-04-01T18:00:00.000Z',
            availableTriggerFamilies: const ['planning_center'],
            syncSupportMode: 'push_capable',
          ),
        ];

      await tester.pumpWidget(
        ChangeNotifierProvider(
          create: (_) => AutomationRulesController(repository),
          child: const MaterialApp(home: AutomationRulesView()),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Planning Center'), findsOneWidget);
      expect(find.text('team@church.test'), findsOneWidget);
      expect(find.text('Connected'), findsOneWidget);
      expect(find.text('2 match(es)'), findsOneWidget);
      expect(find.text('Weekend Service · Guitar'), findsOneWidget);
    },
  );

  testWidgets(
    'AutomationRulesView builder shows Gmail-specific trigger controls for Gmail source',
    (tester) async {
      final repository = _FakeAutomationRulesRepository()
        ..triggersFixture = const [
          AutomationTriggerCatalogItem(
            key: 'gmail.unread_message_matching_filter',
            source: 'gmail',
            label: 'Unread Gmail message matches filter',
            description: 'Match unread Gmail messages by sender and subject.',
            signalTypes: ['gmail_unread_message_seen'],
            configSchema: {
              'fields': ['sender', 'subjectContains', 'label'],
            },
          ),
        ]
        ..actionsFixture = const [
          AutomationActionCatalogItem(
            key: 'create_task',
            label: 'Create task',
            description: 'Create task.',
            configSchema: {
              'fields': ['titleTemplate'],
            },
          ),
        ]
        ..providersFixture = const [
          AutomationProviderCatalogItem(
            source: 'gmail',
            label: 'Gmail',
            description: 'Metadata-driven Gmail message triggers.',
            syncSupport: 'push_capable',
            triggerKeys: ['gmail.unread_message_matching_filter'],
          ),
        ]
        ..accountsFixture = [
          IntegrationAccount(
            id: 'gmail-account-1',
            provider: 'gmail',
            status: 'connected',
            connected: true,
            email: 'owner@example.com',
            accountLabel: 'owner@example.com',
            providerDisplayName: 'Gmail',
            availableTriggerFamilies: const ['gmail'],
            syncSupportMode: 'push_capable',
          ),
        ];

      await tester.pumpWidget(
        ChangeNotifierProvider(
          create: (_) => AutomationRulesController(repository),
          child: const MaterialApp(home: AutomationRulesView()),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Create automation').last);
      await tester.pumpAndSettle();

      expect(find.text('Sender contains'), findsOneWidget);
      expect(find.text('Subject contains'), findsOneWidget);
      expect(find.text('Received within last hours'), findsOneWidget);
    },
  );
}

AutomationRule _rule({
  required String id,
  required String source,
  required String triggerKey,
  required String actionType,
  String? sourceAccountId,
  int matchCountLastRun = 0,
  String? lastMatchedAt,
  Map<String, dynamic>? previewSample,
}) {
  return AutomationRule(
    id: id,
    name: 'Automation $id',
    source: source,
    triggerKey: triggerKey,
    actionType: actionType,
    enabled: true,
    sourceAccountId: sourceAccountId,
    lastMatchedAt: lastMatchedAt,
    matchCountLastRun: matchCountLastRun,
    previewSample: previewSample,
    createdAt: '2026-04-01T18:00:00.000Z',
    updatedAt: '2026-04-01T18:00:00.000Z',
  );
}

class _FakeAutomationRulesRepository extends AutomationRulesRepository {
  _FakeAutomationRulesRepository()
      : super(AutomationRulesDataSource(baseUrl: 'http://example.invalid'));

  List<AutomationRule> rulesFixture = [];
  List<AutomationTriggerCatalogItem> triggersFixture = [];
  List<AutomationActionCatalogItem> actionsFixture = [];
  List<AutomationProviderCatalogItem> providersFixture = [];
  List<IntegrationAccount> accountsFixture = [];
  PlanningCenterTaskOptions? planningCenterTaskOptionsFixture;
  List<String> gmailLabelsFixture = [];
  List<String> projectTemplateNamesFixture = [];
  AutomationRulePreview previewFixture = const AutomationRulePreview(
    ruleId: 'rule-1',
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
      planningCenterTaskOptionsFixture;

  @override
  Future<List<String>> getGmailLabels() async => gmailLabelsFixture;

  @override
  Future<List<String>> getProjectTemplateNames() async =>
      projectTemplateNamesFixture;

  @override
  Future<AutomationRulePreview> getPreview(String id) async => previewFixture;
}
