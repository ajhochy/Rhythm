/// Widget tests for the model picker row in [AgentProfileSheet].
///
/// Asserts:
///   1. The profile sheet renders a Model section when catalog entries are
///      provided via the injected [AgentModelsDataSource].
///   2. Selecting a model and tapping "Save changes" calls controller.update
///      with modelProvider and modelId populated.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agents/data/agent_models_data_source.dart';
import 'package:rhythm_desktop/features/agents/models/catalog_model_entry.dart';
import 'package:rhythm_desktop/features/agents/views/_agent_profile_sheet.dart';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/// A fake [AgentModelsDataSource] that returns a fixed catalog without hitting
/// the network.
class _FakeAgentModelsDataSource extends AgentModelsDataSource {
  final List<CatalogModelEntry> _catalog;

  _FakeAgentModelsDataSource(this._catalog);

  @override
  Future<List<CatalogModelEntry>> fetchCatalog() async => _catalog;
}

/// Records what was passed to update() so tests can assert on it.
class _RecordingAgentConfigsDataSource extends AgentConfigsDataSource {
  final AgentConfig _config;

  _RecordingAgentConfigsDataSource(this._config);

  Map<String, dynamic>? lastUpdatePatch;
  String? lastUpdatedId;

  @override
  Future<List<AgentConfig>> list() async => [_config];

  @override
  Future<AgentConfig> update(String id, Map<String, dynamic> patch) async {
    lastUpdatedId = id;
    lastUpdatePatch = patch;
    // Return an updated config with the model fields applied.
    return AgentConfig(
      id: id,
      label: (patch['label'] as String?) ?? _config.label,
      icon: (patch['icon'] as String?) ?? _config.icon,
      enabled: _config.enabled,
      isAgent: _config.isAgent,
      sortOrder: _config.sortOrder,
      modelProvider: patch['modelProvider'] as String?,
      modelId: patch['modelId'] as String?,
    );
  }

  @override
  Future<AgentConfig> create(Map<String, dynamic> input) async => _config;

  @override
  Future<void> delete(String id) async {}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _kConfigId = 'cfg-test-001';

AgentConfig _makeConfig({String? modelProvider, String? modelId}) =>
    AgentConfig(
      id: _kConfigId,
      label: 'Test Profile',
      icon: 'terminal',
      enabled: true,
      isAgent: true,
      sortOrder: 0,
      modelProvider: modelProvider,
      modelId: modelId,
    );

CatalogModelEntry _makeEntry(String provider, String modelId) =>
    CatalogModelEntry(
      agent: 'claude-code',
      provider: provider,
      modelId: modelId,
      displayName: modelId,
      route: 'direct',
      authorized: true,
      authProvider: provider,
    );

Widget _buildSheet({
  required AgentConfig config,
  required _RecordingAgentConfigsDataSource dataSource,
  required AgentModelsDataSource modelsDataSource,
}) {
  final controller = AgentConfigsController(
    AgentConfigsRepository(dataSource),
  );
  return ChangeNotifierProvider<AgentConfigsController>.value(
    value: controller,
    child: MaterialApp(
      home: Scaffold(
        // DraggableScrollableSheet requires bounded height — provide it via a
        // fixed-size SizedBox so the sheet content is fully rendered in tests.
        body: SizedBox(
          height: 900,
          width: 800,
          child: AgentProfileSheet(
            config: config,
            modelsDataSource: modelsDataSource,
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AgentProfileSheet — model picker', () {
    final catalogEntry = _makeEntry('anthropic', 'claude-sonnet-4-6');

    testWidgets(
      'MODEL section is shown when catalog entries are provided',
      (tester) async {
        final config = _makeConfig();
        final dataSource = _RecordingAgentConfigsDataSource(config);
        final modelsDs = _FakeAgentModelsDataSource([catalogEntry]);

        await tester.pumpWidget(
          _buildSheet(
            config: config,
            dataSource: dataSource,
            modelsDataSource: modelsDs,
          ),
        );

        // Allow the async _loadCatalog to complete.
        await tester.pumpAndSettle();

        // The section label "MODEL" should be visible.
        expect(
          find.text('MODEL'),
          findsOneWidget,
          reason: 'Model section label should be visible',
        );
      },
    );

    testWidgets(
      'pre-selects existing model when config has modelProvider/modelId',
      (tester) async {
        final config = _makeConfig(
            modelProvider: 'anthropic', modelId: 'claude-sonnet-4-6');
        final dataSource = _RecordingAgentConfigsDataSource(config);
        final modelsDs = _FakeAgentModelsDataSource([catalogEntry]);

        await tester.pumpWidget(
          _buildSheet(
            config: config,
            dataSource: dataSource,
            modelsDataSource: modelsDs,
          ),
        );
        await tester.pumpAndSettle();

        // The dropdown should show the pre-selected model text.
        expect(
          find.text('anthropic / claude-sonnet-4-6'),
          findsOneWidget,
          reason: 'Dropdown should show the pre-selected model',
        );
      },
    );

    testWidgets(
      'saving in edit mode sends modelProvider and modelId in the patch',
      (tester) async {
        final config = _makeConfig();
        final dataSource = _RecordingAgentConfigsDataSource(config);
        final modelsDs = _FakeAgentModelsDataSource([catalogEntry]);

        await tester.pumpWidget(
          _buildSheet(
            config: config,
            dataSource: dataSource,
            modelsDataSource: modelsDs,
          ),
        );
        await tester.pumpAndSettle();

        // Open the dropdown and select the catalog entry.
        await tester
            .tap(find.byType(DropdownButtonFormField<CatalogModelEntry>));
        await tester.pumpAndSettle();

        // Tap the model option (not the "No preference" option).
        await tester.tap(
          find.text('anthropic / claude-sonnet-4-6').last,
        );
        await tester.pumpAndSettle();

        // Scroll to ensure the save button is visible inside the DraggableScrollableSheet.
        await tester.dragUntilVisible(
          find.widgetWithText(FilledButton, 'Save changes'),
          find.byType(ListView).first,
          const Offset(0, -100),
        );
        await tester.pumpAndSettle();

        // Tap the save button.
        final saveButton = find.widgetWithText(FilledButton, 'Save changes');
        expect(saveButton, findsOneWidget);
        await tester.tap(saveButton);
        await tester.pumpAndSettle();

        // Verify update was called with the model fields.
        expect(
          dataSource.lastUpdatedId,
          equals(_kConfigId),
          reason: 'update() should have been called with the config id',
        );
        expect(
          dataSource.lastUpdatePatch?['modelProvider'],
          equals('anthropic'),
          reason: 'Patch should include modelProvider',
        );
        expect(
          dataSource.lastUpdatePatch?['modelId'],
          equals('claude-sonnet-4-6'),
          reason: 'Patch should include modelId',
        );
      },
    );

    testWidgets(
      'saving with no model selected sends null modelProvider and modelId',
      (tester) async {
        // Start with a pre-selected model, then clear it.
        final config = _makeConfig(
            modelProvider: 'anthropic', modelId: 'claude-sonnet-4-6');
        final dataSource = _RecordingAgentConfigsDataSource(config);
        final modelsDs = _FakeAgentModelsDataSource([catalogEntry]);

        await tester.pumpWidget(
          _buildSheet(
            config: config,
            dataSource: dataSource,
            modelsDataSource: modelsDs,
          ),
        );
        await tester.pumpAndSettle();

        // Open dropdown and select "No preference".
        await tester
            .tap(find.byType(DropdownButtonFormField<CatalogModelEntry>));
        await tester.pumpAndSettle();
        await tester.tap(find.text('No preference').last);
        await tester.pumpAndSettle();

        // Scroll to save button and tap.
        await tester.dragUntilVisible(
          find.widgetWithText(FilledButton, 'Save changes'),
          find.byType(ListView).first,
          const Offset(0, -100),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(FilledButton, 'Save changes'));
        await tester.pumpAndSettle();

        expect(dataSource.lastUpdatePatch?['modelProvider'], isNull);
        expect(dataSource.lastUpdatePatch?['modelId'], isNull);
      },
    );
  });
}
