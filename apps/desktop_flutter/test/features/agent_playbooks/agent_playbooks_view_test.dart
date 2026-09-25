/// Widget test for #1051 (OCU-10) — Playbooks manager UI, pumping the real
/// production `AgentPlaybooksView` (list/create/edit paths), mocked data
/// source. Built-in (unmanaged) rows must stay read-only.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_playbooks/controllers/agent_playbooks_controller.dart';
import 'package:rhythm_desktop/features/agent_playbooks/data/agent_playbooks_data_source.dart';
import 'package:rhythm_desktop/features/agent_playbooks/views/_playbook_editor_sheet.dart';
import 'package:rhythm_desktop/features/agent_playbooks/views/agent_playbooks_view.dart';
import 'package:rhythm_desktop/features/agents/data/agent_models_data_source.dart';
import 'package:rhythm_desktop/features/agents/models/catalog_model_entry.dart';

class _FakeModelsDataSource extends AgentModelsDataSource {
  @override
  Future<List<CatalogModelEntry>> fetchCatalog() async => const [
        CatalogModelEntry(
          agent: 'codex',
          provider: 'openai',
          modelId: '',
          displayName: 'openai',
          route: 'direct',
          authorized: false,
          authProvider: 'openai',
        ),
        CatalogModelEntry(
          agent: 'codex',
          provider: 'openai',
          modelId: 'gpt-5.6-sol',
          displayName: 'gpt-5.6-sol',
          route: 'direct',
          authorized: true,
          authProvider: 'openai',
        ),
      ];
}

class _FakeAgentPlaybooksDataSource implements AgentPlaybooksDataSource {
  List<PlaybookEntry> entries = [];

  /// Records (method, name, template) for create/update calls.
  final List<(String, String, String)> writes = [];
  final List<String> deletes = [];

  @override
  Future<List<PlaybookEntry>> list() async => entries;

  @override
  Future<PlaybookContent> getContent(String name) async => PlaybookContent(
        name: name,
        frontmatter: const {'description': 'existing desc'},
        template: 'existing template',
      );

  @override
  Future<PlaybookContent> create({
    required String name,
    String? description,
    String? agent,
    String? model,
    bool? subtask,
    required String template,
  }) async {
    writes.add(('create', name, template));
    entries = [
      ...entries,
      PlaybookEntry(
          name: name,
          description: description,
          source: 'command',
          managed: true),
    ];
    return PlaybookContent(
      name: name,
      frontmatter: {if (description != null) 'description': description},
      template: template,
    );
  }

  @override
  Future<PlaybookContent> update(
    String name, {
    String? description,
    String? agent,
    String? model,
    bool? subtask,
    required String template,
  }) async {
    writes.add(('update', name, template));
    entries = entries
        .map((e) => e.name == name
            ? PlaybookEntry(
                name: name,
                description: description,
                source: e.source,
                managed: e.managed)
            : e)
        .toList();
    return PlaybookContent(
      name: name,
      frontmatter: {if (description != null) 'description': description},
      template: template,
    );
  }

  @override
  Future<void> delete(String name) async {
    deletes.add(name);
    entries = entries.where((e) => e.name != name).toList();
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Widget _harness({
  required AgentPlaybooksController controller,
  required AgentConfigsController configsController,
}) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentPlaybooksController>.value(value: controller),
      ChangeNotifierProvider<AgentConfigsController>.value(
          value: configsController),
    ],
    child: const MaterialApp(home: AgentPlaybooksView()),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _FakeAgentPlaybooksDataSource ds;
  late AgentPlaybooksController controller;
  late AgentConfigsController configsController;

  setUp(() {
    ds = _FakeAgentPlaybooksDataSource();
    controller = AgentPlaybooksController(ds);
    configsController = AgentConfigsController(
      AgentConfigsRepository(AgentConfigsDataSource()),
    );
  });

  testWidgets('empty state renders when there are no playbooks',
      (tester) async {
    await tester.pumpWidget(
        _harness(controller: controller, configsController: configsController));
    await tester.pumpAndSettle();

    expect(find.text('No playbooks yet'), findsOneWidget);
  });

  testWidgets(
      'review:review-findings.md:60 playbook model picker excludes provider Connect rows',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PlaybookEditorSheet(
            dataSource: ds,
            existingNames: const {},
            availableAgents: const [],
            modelsDataSource: _FakeModelsDataSource(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('playbook-model-picker')));
    await tester.pumpAndSettle();

    expect(find.text('openai/openai'), findsNothing);
    expect(find.text('openai/gpt-5.6-sol'), findsOneWidget);
  });

  testWidgets(
      'managed playbook shows edit/delete; built-in shows lock and no actions',
      (tester) async {
    ds.entries = const [
      PlaybookEntry(
          name: 'weekly-bulletin',
          description: 'Draft the weekly bulletin',
          source: 'command',
          managed: true),
      PlaybookEntry(
          name: 'init',
          description: 'Built-in init',
          source: 'command',
          managed: false),
    ];

    await tester.pumpWidget(
        _harness(controller: controller, configsController: configsController));
    await tester.pumpAndSettle();

    expect(find.text('/weekly-bulletin'), findsOneWidget);
    expect(find.text('/init'), findsOneWidget);

    expect(find.byKey(const ValueKey('edit-playbook-weekly-bulletin')),
        findsOneWidget);
    expect(find.byKey(const ValueKey('delete-playbook-weekly-bulletin')),
        findsOneWidget);
    expect(find.byKey(const ValueKey('edit-playbook-init')), findsNothing);
    expect(find.byKey(const ValueKey('delete-playbook-init')), findsNothing);
    expect(
        find.byKey(const ValueKey('readonly-playbook-init')), findsOneWidget);
  });

  testWidgets('create a playbook via the New playbook sheet', (tester) async {
    await tester.pumpWidget(
        _harness(controller: controller, configsController: configsController));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('new-playbook-button')));
    await tester.pumpAndSettle();

    await tester.enterText(
        find.byKey(const ValueKey('playbook-name-field')), 'weekly-bulletin');
    await tester.enterText(
        find.byKey(const ValueKey('playbook-template-field')),
        'Draft the bulletin for \$ARGUMENTS');
    await tester.tap(find.text('Create playbook'));
    await tester.pumpAndSettle();

    expect(
        ds.writes,
        contains((
          'create',
          'weekly-bulletin',
          'Draft the bulletin for \$ARGUMENTS'
        )));
    expect(find.text('/weekly-bulletin'), findsOneWidget);
  });

  testWidgets('edit round-trips a managed playbook body', (tester) async {
    ds.entries = const [
      PlaybookEntry(
          name: 'weekly-bulletin',
          description: 'old desc',
          source: 'command',
          managed: true),
    ];

    await tester.pumpWidget(
        _harness(controller: controller, configsController: configsController));
    await tester.pumpAndSettle();

    await tester
        .tap(find.byKey(const ValueKey('edit-playbook-weekly-bulletin')));
    await tester.pumpAndSettle();

    // Content is fetched async on open — settle again for the fetched body.
    await tester.pumpAndSettle();

    await tester.enterText(
        find.byKey(const ValueKey('playbook-template-field')),
        'updated template body');
    await tester.tap(find.text('Save playbook'));
    await tester.pumpAndSettle();

    expect(ds.writes,
        contains(('update', 'weekly-bulletin', 'updated template body')));
  });

  testWidgets('delete removes a managed playbook after confirmation',
      (tester) async {
    ds.entries = const [
      PlaybookEntry(
          name: 'weekly-bulletin',
          description: 'desc',
          source: 'command',
          managed: true),
    ];

    await tester.pumpWidget(
        _harness(controller: controller, configsController: configsController));
    await tester.pumpAndSettle();

    await tester
        .tap(find.byKey(const ValueKey('delete-playbook-weekly-bulletin')));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();

    expect(ds.deletes, ['weekly-bulletin']);
    expect(find.text('No playbooks yet'), findsOneWidget);
  });
}
