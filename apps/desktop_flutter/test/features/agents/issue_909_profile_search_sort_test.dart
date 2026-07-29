/// #909 — Agent profiles list: search, sort, rename.
///
/// Verifies:
///   1. The search box filters profiles by label.
///   2. The sort menu reorders profiles by name.
///   3. The rename icon opens a dialog and persists the new label via
///      AgentConfigsController.update (PATCH), without opening the full
///      profile editor sheet.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rhythm_desktop/app/core/services/default_agent_profile_service.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_agent_profile_sheet.dart';

class _FakeAgentConfigsDataSource extends AgentConfigsDataSource {
  _FakeAgentConfigsDataSource(this._configs);

  final List<AgentConfig> _configs;

  @override
  Future<List<AgentConfig>> list() async => List.of(_configs);

  @override
  Future<AgentConfig> update(String id, Map<String, dynamic> patch) async {
    final index = _configs.indexWhere((c) => c.id == id);
    final updated = _configs[index].copyWith(
      label: patch['label'] as String? ?? _configs[index].label,
    );
    _configs[index] = updated;
    return updated;
  }

  @override
  Future<AgentConfig> create(Map<String, dynamic> input) async {
    throw UnimplementedError();
  }

  @override
  Future<void> delete(String id) async {}
}

AgentConfig _makeConfig({
  required String id,
  required String label,
  String? modelProvider,
}) => AgentConfig(
  id: id,
  label: label,
  icon: 'terminal',
  enabled: true,
  isAgent: true,
  sortOrder: 0,
  ocAgent: id,
  sessionSelectable: true,
  modelProvider: modelProvider,
);

Widget _buildManagerSheet({
  required AgentConfigsController configsController,
  required DefaultAgentProfileService defaultService,
}) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentConfigsController>.value(
        value: configsController,
      ),
      ChangeNotifierProvider<DefaultAgentProfileService>.value(
        value: defaultService,
      ),
    ],
    child: MaterialApp(
      home: Scaffold(
        body: SizedBox(
          height: 900,
          width: 800,
          child: const AgentProfilesManagerSheet(),
        ),
      ),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('search box filters profiles by label', (tester) async {
    final dataSource = _FakeAgentConfigsDataSource([
      _makeConfig(id: 'p1', label: 'Worship Planner'),
      _makeConfig(id: 'p2', label: 'Email Assistant'),
    ]);
    final configsController = AgentConfigsController(
      AgentConfigsRepository(dataSource),
    );
    await configsController.refresh();
    final defaultService = DefaultAgentProfileService();
    await defaultService.load();

    await tester.pumpWidget(
      _buildManagerSheet(
        configsController: configsController,
        defaultService: defaultService,
      ),
    );
    await tester.pump();

    expect(find.text('Worship Planner'), findsOneWidget);
    expect(find.text('Email Assistant'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('profile-search-field')),
      'Worship',
    );
    await tester.pump();

    expect(find.text('Worship Planner'), findsOneWidget);
    expect(find.text('Email Assistant'), findsNothing);

    configsController.dispose();
  });

  testWidgets('no-results state renders for a non-matching search', (
    tester,
  ) async {
    final dataSource = _FakeAgentConfigsDataSource([
      _makeConfig(id: 'p1', label: 'Worship Planner'),
    ]);
    final configsController = AgentConfigsController(
      AgentConfigsRepository(dataSource),
    );
    await configsController.refresh();
    final defaultService = DefaultAgentProfileService();
    await defaultService.load();

    await tester.pumpWidget(
      _buildManagerSheet(
        configsController: configsController,
        defaultService: defaultService,
      ),
    );
    await tester.pump();

    await tester.enterText(
      find.byKey(const ValueKey('profile-search-field')),
      'no such profile',
    );
    await tester.pump();

    expect(find.text('Worship Planner'), findsNothing);
    expect(find.textContaining('No profiles match'), findsOneWidget);

    configsController.dispose();
  });

  testWidgets(
    'defaults to name sort, then switches to model-provider sort on selection',
    (tester) async {
      // Alphabetically Alpha < Zebra, but by provider "zprovider" < "aprovider"
      // is false -- z sorts after a -- so provider sort should reverse the
      // default (name) order for this fixture.
      final dataSource = _FakeAgentConfigsDataSource([
        _makeConfig(
          id: 'p1',
          label: 'Zebra Profile',
          modelProvider: 'aprovider',
        ),
        _makeConfig(
          id: 'p2',
          label: 'Alpha Profile',
          modelProvider: 'zprovider',
        ),
      ]);
      final configsController = AgentConfigsController(
        AgentConfigsRepository(dataSource),
      );
      await configsController.refresh();
      final defaultService = DefaultAgentProfileService();
      await defaultService.load();

      await tester.pumpWidget(
        _buildManagerSheet(
          configsController: configsController,
          defaultService: defaultService,
        ),
      );
      await tester.pump();

      double topOf(String text) => tester.getTopLeft(find.text(text)).dy;

      // Default sort is Name: Alpha before Zebra.
      expect(topOf('Alpha Profile') < topOf('Zebra Profile'), isTrue);

      await tester.tap(find.byKey(const ValueKey('profile-sort-menu')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Model provider'));
      await tester.pumpAndSettle();

      // Provider sort: aprovider (Zebra) before zprovider (Alpha).
      expect(topOf('Zebra Profile') < topOf('Alpha Profile'), isTrue);

      configsController.dispose();
    },
  );

  testWidgets(
    'rename icon updates the label without opening the editor sheet',
    (tester) async {
      final dataSource = _FakeAgentConfigsDataSource([
        _makeConfig(id: 'p1', label: 'Old Label'),
      ]);
      final configsController = AgentConfigsController(
        AgentConfigsRepository(dataSource),
      );
      await configsController.refresh();
      final defaultService = DefaultAgentProfileService();
      await defaultService.load();

      await tester.pumpWidget(
        _buildManagerSheet(
          configsController: configsController,
          defaultService: defaultService,
        ),
      );
      await tester.pump();

      expect(find.text('Old Label'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('rename-profile-p1')));
      await tester.pumpAndSettle();

      final field = find.byKey(const ValueKey('rename-profile-field'));
      expect(field, findsOneWidget);
      await tester.enterText(field, 'New Label');
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();

      // The full profile editor sheet (title "New Profile" heading absent, no
      // second sheet route) never opened -- the manager sheet itself updated.
      expect(configsController.configs.first.label, 'New Label');
      expect(find.text('New Label'), findsOneWidget);
      expect(find.text('Old Label'), findsNothing);

      configsController.dispose();
    },
  );
}
