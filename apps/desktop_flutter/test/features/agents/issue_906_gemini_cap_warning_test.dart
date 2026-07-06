/// #906 — Gemini tool-declaration cap warning in the Agent Profile editor.
///
/// gemini_tool_cap.ts (#884) already trims an over-budget MCP allowlist at
/// dispatch time so a Gemini session never actually fails. This covers the
/// complementary config-time warning: when the profile's model provider is
/// 'google' and enough MCP servers are selected (or "Allow all" with a large
/// live server set) to exceed the estimated budget, a warning banner appears.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agents/data/agent_models_data_source.dart';
import 'package:rhythm_desktop/features/agents/data/opencode_mcp_data_source.dart';
import 'package:rhythm_desktop/features/agents/models/catalog_model_entry.dart';
import 'package:rhythm_desktop/features/agents/views/_agent_profile_sheet.dart';

class _FakeModelsDataSource extends AgentModelsDataSource {
  _FakeModelsDataSource(this._catalog);

  final List<CatalogModelEntry> _catalog;

  @override
  Future<List<CatalogModelEntry>> fetchCatalog() async => _catalog;
}

class _FakeMcpDataSource extends OpencodeMcpDataSource {
  _FakeMcpDataSource(this._names);

  final List<String> _names;

  @override
  Future<List<String>> listNames() async => _names;
}

class _FakeAgentConfigsDataSource extends AgentConfigsDataSource {
  _FakeAgentConfigsDataSource(this._config);

  final AgentConfig _config;

  @override
  Future<List<AgentConfig>> list() async => [_config];

  @override
  Future<AgentConfig> update(String id, Map<String, dynamic> patch) async =>
      _config;

  @override
  Future<AgentConfig> create(Map<String, dynamic> input) async => _config;

  @override
  Future<void> delete(String id) async {}
}

const _kConfigId = 'cfg-test-001';

AgentConfig _makeConfig({String? modelProvider}) => AgentConfig(
      id: _kConfigId,
      label: 'Test Profile',
      icon: 'terminal',
      enabled: true,
      isAgent: true,
      sortOrder: 0,
      modelProvider: modelProvider,
      modelId: modelProvider != null ? 'gemini-2.5-pro' : null,
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

/// 21 servers * 25-per-server estimate = 525, over the 500 budget.
List<String> _manyMcpServers() => List.generate(21, (i) => 'server-$i');

Widget _buildSheet({
  required AgentConfig config,
  required List<CatalogModelEntry> catalog,
  required List<String> mcpNames,
}) {
  final controller = AgentConfigsController(
    AgentConfigsRepository(_FakeAgentConfigsDataSource(config)),
  );
  return ChangeNotifierProvider<AgentConfigsController>.value(
    value: controller,
    child: MaterialApp(
      home: Scaffold(
        body: SizedBox(
          height: 1000,
          width: 800,
          child: AgentProfileSheet(
            config: config,
            modelsDataSource: _FakeModelsDataSource(catalog),
            mcpDataSource: _FakeMcpDataSource(mcpNames),
          ),
        ),
      ),
    ),
  );
}

Future<void> _scrollToMcpSection(WidgetTester tester) async {
  await tester.dragUntilVisible(
    find.text('ALLOWED MCPS'),
    find.byType(ListView).first,
    const Offset(0, -120),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
      'warns when provider is google and the live MCP set exceeds the estimated budget',
      (tester) async {
    final config = _makeConfig(modelProvider: 'google');
    await tester.pumpWidget(_buildSheet(
      config: config,
      catalog: [_makeEntry('google', 'gemini-2.5-pro')],
      mcpNames: _manyMcpServers(),
    ));
    await tester.pumpAndSettle();
    await _scrollToMcpSection(tester);

    expect(find.textContaining('may exceed Gemini'), findsOneWidget);
  });

  testWidgets('does not warn for a non-google provider with the same MCP set',
      (tester) async {
    final config = _makeConfig(modelProvider: 'anthropic');
    await tester.pumpWidget(_buildSheet(
      config: config,
      catalog: [_makeEntry('anthropic', 'claude-sonnet-4-5')],
      mcpNames: _manyMcpServers(),
    ));
    await tester.pumpAndSettle();
    await _scrollToMcpSection(tester);

    expect(find.textContaining('may exceed Gemini'), findsNothing);
  });

  testWidgets('does not warn for google when few MCP servers are available',
      (tester) async {
    final config = _makeConfig(modelProvider: 'google');
    await tester.pumpWidget(_buildSheet(
      config: config,
      catalog: [_makeEntry('google', 'gemini-2.5-pro')],
      mcpNames: ['rhythm', 'gmail-work'],
    ));
    await tester.pumpAndSettle();
    await _scrollToMcpSection(tester);

    expect(find.textContaining('may exceed Gemini'), findsNothing);
  });
}
