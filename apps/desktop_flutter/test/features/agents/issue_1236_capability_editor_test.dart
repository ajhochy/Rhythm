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

class _Models extends AgentModelsDataSource {
  @override
  Future<List<CatalogModelEntry>> fetchCatalog() async => const [];
}

class _Skills extends OpencodeSkillsDataSource {
  @override
  Future<List<OpencodeSkillEntry>> list() async => const [
        OpencodeSkillEntry(
          name: 'sermon-research',
          description: 'Research a sermon topic',
          location: '/skills/sermon-research/SKILL.md',
          managed: true,
        ),
        OpencodeSkillEntry(
          name: 'volunteer-care',
          description: 'Coordinate volunteer care',
          location: '/skills/volunteer-care/SKILL.md',
          managed: false,
        ),
      ];
}

class _Mcps extends OpencodeMcpDataSource {
  @override
  Future<List<OpencodeMcpCapability>> listCapabilities() async => const [
        OpencodeMcpCapability(
          name: 'rhythm',
          tools: ['list_tasks', 'create_task'],
        ),
        OpencodeMcpCapability(
          name: 'pco-services',
          tools: ['list_services', 'get_plan'],
        ),
      ];

  @override
  Future<List<String>> listNames() async => const ['rhythm', 'pco-services'];

  @override
  Future<Set<String>> listNeedsAuthNames() async => const {};
}

class _Configs extends AgentConfigsDataSource {
  _Configs(this.config);
  AgentConfig config;
  Map<String, dynamic>? patch;

  @override
  Future<List<AgentConfig>> list() async => [config];

  @override
  Future<AgentConfig> update(String id, Map<String, dynamic> value) async {
    patch = value;
    return config;
  }
}

Widget _app(_Configs data) {
  final controller = AgentConfigsController(AgentConfigsRepository(data));
  return ChangeNotifierProvider.value(
    value: controller,
    child: MaterialApp(
      home: Scaffold(
        body: SizedBox(
          width: 900,
          height: 1100,
          child: AgentProfileSheet(
            config: data.config,
            modelsDataSource: _Models(),
            skillsDataSource: _Skills(),
            mcpDataSource: _Mcps(),
          ),
        ),
      ),
    ),
  );
}

Future<void> _showEditor(WidgetTester tester) async {
  await tester.pumpAndSettle();
  await tester.dragUntilVisible(
    find.text('CAPABILITIES'),
    find.byType(ListView).first,
    const Offset(0, -180),
  );
  await tester.tap(find.text('Edit capabilities'));
  await tester.pumpAndSettle();
}

void main() {
  AgentConfig config() => AgentConfig(
        id: 'profile-1236',
        label: 'Sunday Planner',
        icon: 'terminal',
        enabled: true,
        isAgent: true,
        sortOrder: 0,
        allowedSkills: const ['sermon-research'],
        allowedMcps: const ['rhythm'],
      );

  testWidgets('issue-1236-c1: renders a structured Skills and MCP tab editor',
      (tester) async {
    await tester.pumpWidget(_app(_Configs(config())));
    await _showEditor(tester);
    expect(find.text('Skills'), findsWidgets);
    expect(find.text('MCP'), findsOneWidget);
    expect(find.byKey(const ValueKey('capability-search')), findsOneWidget);
  });

  testWidgets('issue-1236-c2: category selection reports all, some, and none',
      (tester) async {
    await tester.pumpWidget(_app(_Configs(config())));
    await _showEditor(tester);
    expect(
        find.byKey(const ValueKey('skills-category-checkbox')), findsOneWidget);
    expect(find.text('1 of 2 selected'), findsOneWidget);
  });

  testWidgets('issue-1236-c3: MCP server expands to granular tools',
      (tester) async {
    await tester.pumpWidget(_app(_Configs(config())));
    await _showEditor(tester);
    await tester.tap(find.text('MCP'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('mcp-server-rhythm')), findsOneWidget);
    expect(find.textContaining('tools'), findsWidgets);
  });

  testWidgets('issue-1236-c4: search filters skills and nested MCP tools',
      (tester) async {
    await tester.pumpWidget(_app(_Configs(config())));
    await _showEditor(tester);
    await tester.enterText(
      find.byKey(const ValueKey('capability-search')),
      'volunteer',
    );
    await tester.pumpAndSettle();
    expect(find.text('volunteer-care'), findsOneWidget);
    expect(find.text('sermon-research'), findsNothing);
  });

  testWidgets(
      'issue-1236-c5: effective scope summary reflects staged selections',
      (tester) async {
    await tester.pumpWidget(_app(_Configs(config())));
    await _showEditor(tester);
    expect(find.text('Effective scope'), findsOneWidget);
    expect(find.textContaining('1 of 2 skills'), findsOneWidget);
    expect(find.textContaining('1 of 2 MCP servers'), findsOneWidget);
  });

  testWidgets('issue-1236-c6: cancel discards staged scope and save applies it',
      (tester) async {
    final data = _Configs(config());
    await tester.pumpWidget(_app(data));
    await _showEditor(tester);
    await tester.tap(find.text('volunteer-care'));
    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();
    await _showEditor(tester);
    expect(find.text('1 of 2 selected'), findsOneWidget);
    await tester.tap(find.text('volunteer-care'));
    await tester.tap(find.widgetWithText(FilledButton, 'Save capabilities'));
    await tester.pumpAndSettle();
    expect(find.textContaining('2 skills'), findsOneWidget);
  });
}
