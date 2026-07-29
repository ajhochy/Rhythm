/// Widget tests for [AgentProfileSheet]'s Tool Permissions matrix (#1074 /
/// OCU-33) and "Show in agent picker" toggle (#1079).
///
/// Asserts:
///   - Tri-state Deny on a known key (websearch) persists corePermissionsJson
///     with only that key set.
///   - Unset rows leave frontmatter untouched: a pre-existing override on
///     another key round-trips unchanged when a different row is edited.
///   - Bash pattern add / re-toggle / remove round-trips into corePermissionsJson.
///   - "Show in agent picker" toggle persists sessionSelectable on save.
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agents/data/agent_models_data_source.dart';
import 'package:rhythm_desktop/features/agents/data/opencode_mcp_data_source.dart';
import 'package:rhythm_desktop/features/agents/data/opencode_skills_data_source.dart';
import 'package:rhythm_desktop/features/agents/models/catalog_model_entry.dart';
import 'package:rhythm_desktop/features/agents/views/_agent_profile_sheet.dart';

// ---------------------------------------------------------------------------
// Fakes (mirrors agent_profile_skills_mcp_picker_test.dart)
// ---------------------------------------------------------------------------

class _FakeModelsDataSource extends AgentModelsDataSource {
  @override
  Future<List<CatalogModelEntry>> fetchCatalog() async => const [];
}

class _FakeSkillsDataSource extends OpencodeSkillsDataSource {
  @override
  Future<List<OpencodeSkillEntry>> list() async => const [];
}

class _FakeMcpDataSource extends OpencodeMcpDataSource {
  @override
  Future<List<String>> listNames() async => const [];

  @override
  Future<Set<String>> listNeedsAuthNames() async => const {};
}

class _RecordingAgentConfigsDataSource extends AgentConfigsDataSource {
  _RecordingAgentConfigsDataSource(this._config);

  final AgentConfig _config;
  Map<String, dynamic>? lastUpdatePatch;

  @override
  Future<List<AgentConfig>> list() async => [_config];

  @override
  Future<AgentConfig> update(String id, Map<String, dynamic> patch) async {
    lastUpdatePatch = patch;
    return _config;
  }

  @override
  Future<AgentConfig> create(Map<String, dynamic> input) async => _config;

  @override
  Future<void> delete(String id) async {}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _kConfigId = 'cfg-test-perms-001';

AgentConfig _makeConfig({String? corePermissionsJson}) => AgentConfig(
  id: _kConfigId,
  label: 'Test Profile',
  icon: 'terminal',
  enabled: true,
  isAgent: true,
  sortOrder: 0,
  corePermissionsJson: corePermissionsJson,
);

Widget _buildSheet({
  required AgentConfig config,
  required _RecordingAgentConfigsDataSource configsDs,
}) {
  final controller = AgentConfigsController(AgentConfigsRepository(configsDs));
  return ChangeNotifierProvider<AgentConfigsController>.value(
    value: controller,
    child: MaterialApp(
      home: Scaffold(
        body: SizedBox(
          height: 1000,
          width: 800,
          child: AgentProfileSheet(
            config: config,
            modelsDataSource: _FakeModelsDataSource(),
            skillsDataSource: _FakeSkillsDataSource(),
            mcpDataSource: _FakeMcpDataSource(),
          ),
        ),
      ),
    ),
  );
}

Future<void> _scrollIntoView(WidgetTester tester, Finder target) async {
  await tester.dragUntilVisible(
    target,
    find.byType(ListView).first,
    const Offset(0, -150),
  );
  await tester.pumpAndSettle();
}

Future<void> _expandToolPermissions(WidgetTester tester) async {
  await _scrollIntoView(tester, find.text('Tool Permissions'));
  await tester.tap(find.text('Tool Permissions'));
  await tester.pumpAndSettle();
}

Future<void> _tapAction(
  WidgetTester tester,
  String selectorKey,
  String action,
) async {
  final selector = find.byKey(ValueKey(selectorKey));
  await _scrollIntoView(tester, selector);
  final label = '${action[0].toUpperCase()}${action.substring(1)}';
  await tester.tap(find.descendant(of: selector, matching: find.text(label)));
  await tester.pumpAndSettle();
}

Future<void> _tapSave(WidgetTester tester) async {
  final saveButton = find.widgetWithText(FilledButton, 'Save changes');
  await _scrollIntoView(tester, saveButton);
  await tester.tap(saveButton);
  await tester.pumpAndSettle();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AgentProfileSheet — Tool Permissions matrix (#1074 / OCU-33)', () {
    testWidgets('setting websearch=Deny persists corePermissionsJson', (
      tester,
    ) async {
      final config = _makeConfig();
      final configsDs = _RecordingAgentConfigsDataSource(config);

      await tester.pumpWidget(
        _buildSheet(config: config, configsDs: configsDs),
      );
      await tester.pumpAndSettle();

      await _expandToolPermissions(tester);
      await _tapAction(tester, 'permission-selector-websearch', 'deny');
      await _tapSave(tester);

      final json = configsDs.lastUpdatePatch?['corePermissionsJson'] as String?;
      expect(json, isNotNull);
      expect(jsonDecode(json!), equals({'websearch': 'deny'}));
    });

    testWidgets('unset rows leave frontmatter untouched', (tester) async {
      // Profile already has `read: allow` persisted. Editing a different row
      // (websearch) must round-trip `read` unchanged rather than dropping it
      // or overwriting it with an unset placeholder.
      final config = _makeConfig(
        corePermissionsJson: jsonEncode({'read': 'allow'}),
      );
      final configsDs = _RecordingAgentConfigsDataSource(config);

      await tester.pumpWidget(
        _buildSheet(config: config, configsDs: configsDs),
      );
      await tester.pumpAndSettle();

      await _expandToolPermissions(tester);
      await _tapAction(tester, 'permission-selector-websearch', 'ask');
      await _tapSave(tester);

      final json = configsDs.lastUpdatePatch?['corePermissionsJson'] as String?;
      expect(json, isNotNull);
      expect(jsonDecode(json!), equals({'read': 'allow', 'websearch': 'ask'}));
    });

    testWidgets('re-tapping the selected segment clears the row (unset)', (
      tester,
    ) async {
      final config = _makeConfig(
        corePermissionsJson: jsonEncode({'edit': 'deny'}),
      );
      final configsDs = _RecordingAgentConfigsDataSource(config);

      await tester.pumpWidget(
        _buildSheet(config: config, configsDs: configsDs),
      );
      await tester.pumpAndSettle();

      await _expandToolPermissions(tester);
      // Deny is already selected for 'edit' — tap it again to clear.
      await _tapAction(tester, 'permission-selector-edit', 'deny');
      await _tapSave(tester);

      final json = configsDs.lastUpdatePatch?['corePermissionsJson'] as String?;
      expect(json, isNull);
    });

    testWidgets('adding a bash pattern defaults to Ask and persists', (
      tester,
    ) async {
      final config = _makeConfig();
      final configsDs = _RecordingAgentConfigsDataSource(config);

      await tester.pumpWidget(
        _buildSheet(config: config, configsDs: configsDs),
      );
      await tester.pumpAndSettle();

      await _expandToolPermissions(tester);

      final field = find.byKey(const ValueKey('bash-add-pattern-field'));
      await _scrollIntoView(tester, field);
      await tester.enterText(field, 'rm *');
      await tester.tap(find.text('Add'));
      await tester.pumpAndSettle();

      await _tapSave(tester);
      final json = jsonDecode(
        configsDs.lastUpdatePatch?['corePermissionsJson'] as String,
      );
      expect(
        json,
        equals({
          'bash': {'rm *': 'ask'},
        }),
      );
    });

    testWidgets('an existing bash pattern can be re-toggled to Deny', (
      tester,
    ) async {
      final config = _makeConfig(
        corePermissionsJson: jsonEncode({
          'bash': {'rm *': 'ask'},
        }),
      );
      final configsDs = _RecordingAgentConfigsDataSource(config);

      await tester.pumpWidget(
        _buildSheet(config: config, configsDs: configsDs),
      );
      await tester.pumpAndSettle();

      await _expandToolPermissions(tester);
      await _tapAction(tester, 'bash-pattern-selector-rm *', 'deny');
      await _tapSave(tester);

      final json = jsonDecode(
        configsDs.lastUpdatePatch?['corePermissionsJson'] as String,
      );
      expect(
        json,
        equals({
          'bash': {'rm *': 'deny'},
        }),
      );
    });

    testWidgets('removing a bash pattern drops the bash key entirely', (
      tester,
    ) async {
      final config = _makeConfig(
        corePermissionsJson: jsonEncode({
          'bash': {'rm *': 'deny'},
        }),
      );
      final configsDs = _RecordingAgentConfigsDataSource(config);

      await tester.pumpWidget(
        _buildSheet(config: config, configsDs: configsDs),
      );
      await tester.pumpAndSettle();

      await _expandToolPermissions(tester);

      final removeButton = find.byKey(
        const ValueKey('bash-pattern-remove-rm *'),
      );
      await _scrollIntoView(tester, removeButton);
      await tester.tap(removeButton);
      await tester.pumpAndSettle();
      await _tapSave(tester);

      expect(configsDs.lastUpdatePatch?['corePermissionsJson'], isNull);
    });
  });

  group('AgentProfileSheet — "Show in agent picker" toggle (#1079)', () {
    testWidgets('defaults to checked (sessionSelectable: true)', (
      tester,
    ) async {
      final config = _makeConfig();
      final configsDs = _RecordingAgentConfigsDataSource(config);

      await tester.pumpWidget(
        _buildSheet(config: config, configsDs: configsDs),
      );
      await tester.pumpAndSettle();

      final toggleFinder = find.byKey(
        const ValueKey('session-selectable-toggle'),
      );
      await _scrollIntoView(tester, toggleFinder);
      final toggle = tester.widget<CheckboxListTile>(toggleFinder);
      expect(toggle.value, isTrue);
    });

    testWidgets('unchecking persists sessionSelectable: false on save', (
      tester,
    ) async {
      final config = _makeConfig();
      final configsDs = _RecordingAgentConfigsDataSource(config);

      await tester.pumpWidget(
        _buildSheet(config: config, configsDs: configsDs),
      );
      await tester.pumpAndSettle();

      await _scrollIntoView(
        tester,
        find.byKey(const ValueKey('session-selectable-toggle')),
      );
      await tester.tap(find.byKey(const ValueKey('session-selectable-toggle')));
      await tester.pumpAndSettle();
      await _tapSave(tester);

      expect(configsDs.lastUpdatePatch?['sessionSelectable'], isFalse);
    });
  });
}
