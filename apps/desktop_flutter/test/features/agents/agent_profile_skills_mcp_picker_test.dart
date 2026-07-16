/// Widget tests for the live skills + MCP pickers in [AgentProfileSheet]
/// (issues unify-04 and unify-05).
///
/// Asserts:
///   - Skills picker renders live names from the injected skills data source;
///     no hardcoded array remains.
///   - A managed skill exposes edit + delete affordances; an external skill
///     exposes neither (scope-only).
///   - Restricting + selecting persists allowed_skills_json with names verbatim
///     from the live set (#775 — no transform/prefix).
///   - MCP picker renders live server names; empty live list → empty-state
///     banner (no crash, no stale fallback).
///   - The managed-skill editor blocks an empty name and a colliding name.
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
import 'package:rhythm_desktop/features/agents/views/_managed_skill_editor_sheet.dart';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class _FakeModelsDataSource extends AgentModelsDataSource {
  @override
  Future<List<CatalogModelEntry>> fetchCatalog() async => const [];
}

class _FakeSkillsDataSource extends OpencodeSkillsDataSource {
  _FakeSkillsDataSource(this._entries);

  List<OpencodeSkillEntry> _entries;

  Map<String, dynamic>? lastCreate;
  String? lastDeleted;

  @override
  Future<List<OpencodeSkillEntry>> list() async => _entries;

  @override
  Future<OpencodeSkillEntry> create({
    required String name,
    String? description,
    required String content,
  }) async {
    lastCreate = {'name': name, 'description': description, 'content': content};
    final entry = OpencodeSkillEntry(
      name: name,
      description: description,
      location: '/managed/$name/SKILL.md',
      managed: true,
    );
    _entries = [..._entries, entry];
    return entry;
  }

  @override
  Future<void> delete(String name) async {
    lastDeleted = name;
    _entries = _entries.where((s) => s.name != name).toList();
  }
}

class _FakeMcpDataSource extends OpencodeMcpDataSource {
  _FakeMcpDataSource(this._names, {Set<String> needsAuth = const {}})
      : _needsAuth = needsAuth;

  final List<String> _names;
  final Set<String> _needsAuth;

  @override
  Future<List<String>> listNames() async => _names;

  @override
  Future<Set<String>> listNeedsAuthNames() async => _needsAuth;
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
    return AgentConfig(
      id: id,
      label: (patch['label'] as String?) ?? _config.label,
      icon: (patch['icon'] as String?) ?? _config.icon,
      enabled: _config.enabled,
      isAgent: _config.isAgent,
      sortOrder: _config.sortOrder,
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

AgentConfig _makeConfig() => AgentConfig(
      id: _kConfigId,
      label: 'Test Profile',
      icon: 'terminal',
      enabled: true,
      isAgent: true,
      sortOrder: 0,
    );

OpencodeSkillEntry _skill(String name,
        {bool managed = false, String? source}) =>
    OpencodeSkillEntry(
      name: name,
      description: 'desc of $name',
      location:
          managed ? '/managed/$name/SKILL.md' : '/external/$name/SKILL.md',
      managed: managed,
      source: source,
    );

Widget _buildSheet({
  required AgentConfig config,
  required _RecordingAgentConfigsDataSource configsDs,
  required OpencodeSkillsDataSource skillsDs,
  required OpencodeMcpDataSource mcpDs,
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
            skillsDataSource: skillsDs,
            mcpDataSource: mcpDs,
          ),
        ),
      ),
    ),
  );
}

// The MCP + Skills sections live near the bottom of the scrollable sheet, so
// scroll their section label into view before tapping its "Restrict" button.
// MCP is built before Skills: once both labels are on screen, "Restrict"
// index 0 = MCP, index 1 = Skills.
Future<void> _scrollIntoView(WidgetTester tester, Finder target) async {
  await tester.dragUntilVisible(
    target,
    find.byType(ListView).first,
    const Offset(0, -120),
  );
  await tester.pumpAndSettle();
}

Future<void> _tapRestrictMcp(WidgetTester tester) async {
  await _scrollIntoView(tester, find.text('ALLOWED MCPS'));
  await tester.tap(find.text('Restrict').first);
  await tester.pumpAndSettle();
}

Future<void> _tapRestrictSkills(WidgetTester tester) async {
  await _scrollIntoView(tester, find.text('ALLOWED SKILLS'));
  await tester.tap(find.text('Restrict').last);
  await tester.pumpAndSettle();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AgentProfileSheet — live skills picker', () {
    testWidgets('renders live skill names after Restrict', (tester) async {
      final config = _makeConfig();
      final configsDs = _RecordingAgentConfigsDataSource(config);
      final skillsDs = _FakeSkillsDataSource([
        _skill('release-notes', managed: true),
        _skill('engineering:code-review'),
      ]);

      await tester.pumpWidget(
        _buildSheet(
          config: config,
          configsDs: configsDs,
          skillsDs: skillsDs,
          mcpDs: _FakeMcpDataSource(const []),
        ),
      );
      await tester.pumpAndSettle();

      await _tapRestrictSkills(tester);

      expect(find.text('release-notes'), findsOneWidget);
      expect(find.text('engineering:code-review'), findsOneWidget);
    });

    testWidgets('managed skill has edit+delete; external has neither', (
      tester,
    ) async {
      final config = _makeConfig();
      final configsDs = _RecordingAgentConfigsDataSource(config);
      final skillsDs = _FakeSkillsDataSource([
        _skill('release-notes', managed: true),
        _skill('docx'),
      ]);

      await tester.pumpWidget(
        _buildSheet(
          config: config,
          configsDs: configsDs,
          skillsDs: skillsDs,
          mcpDs: _FakeMcpDataSource(const []),
        ),
      );
      await tester.pumpAndSettle();

      await _tapRestrictSkills(tester);

      // Managed skill exposes edit + delete affordances.
      expect(
        find.byKey(const ValueKey('edit-skill-release-notes')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('delete-skill-release-notes')),
        findsOneWidget,
      );

      // External skill exposes neither.
      expect(find.byKey(const ValueKey('edit-skill-docx')), findsNothing);
      expect(find.byKey(const ValueKey('delete-skill-docx')), findsNothing);
    });

    // #1055 — an org skill (pulled from the shared org index — read-only) must
    // remain selectable in the allowlist like any other skill, with no
    // edit/delete affordance (same scope-only treatment as external).
    testWidgets(
      'org skill is selectable with no edit/delete, and persists like any other name',
      (tester) async {
        final config = _makeConfig();
        final configsDs = _RecordingAgentConfigsDataSource(config);
        final skillsDs = _FakeSkillsDataSource([
          _skill('release-notes', managed: true),
          _skill('shared-onboarding', source: 'org'),
        ]);

        await tester.pumpWidget(
          _buildSheet(
            config: config,
            configsDs: configsDs,
            skillsDs: skillsDs,
            mcpDs: _FakeMcpDataSource(const []),
          ),
        );
        await tester.pumpAndSettle();

        await _tapRestrictSkills(tester);

        // Org skill has no edit/delete (scope-only, like external).
        expect(
          find.byKey(const ValueKey('edit-skill-shared-onboarding')),
          findsNothing,
        );
        expect(
          find.byKey(const ValueKey('delete-skill-shared-onboarding')),
          findsNothing,
        );

        // Restrict pre-selects all live names; deselect the managed one so
        // only the org skill remains selected, then verify it persists.
        await tester.tap(find.text('release-notes'));
        await tester.pumpAndSettle();

        await tester.dragUntilVisible(
          find.widgetWithText(FilledButton, 'Save changes'),
          find.byType(ListView).first,
          const Offset(0, -120),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(FilledButton, 'Save changes'));
        await tester.pumpAndSettle();

        final json = configsDs.lastUpdatePatch?['allowedSkillsJson'] as String?;
        expect(json, isNotNull);
        expect(jsonDecode(json!), equals(['shared-onboarding']));
      },
    );

    testWidgets('selecting persists allowed_skills_json verbatim', (
      tester,
    ) async {
      final config = _makeConfig();
      final configsDs = _RecordingAgentConfigsDataSource(config);
      final skillsDs = _FakeSkillsDataSource([
        _skill('release-notes', managed: true),
        _skill('engineering:code-review'),
      ]);

      await tester.pumpWidget(
        _buildSheet(
          config: config,
          configsDs: configsDs,
          skillsDs: skillsDs,
          mcpDs: _FakeMcpDataSource(const []),
        ),
      );
      await tester.pumpAndSettle();

      // Restrict pre-selects ALL live names.
      await _tapRestrictSkills(tester);

      // Deselect the external one so only 'release-notes' remains selected.
      await tester.tap(find.text('engineering:code-review'));
      await tester.pumpAndSettle();

      await tester.dragUntilVisible(
        find.widgetWithText(FilledButton, 'Save changes'),
        find.byType(ListView).first,
        const Offset(0, -120),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Save changes'));
      await tester.pumpAndSettle();

      final json = configsDs.lastUpdatePatch?['allowedSkillsJson'] as String?;
      expect(json, isNotNull);
      expect(jsonDecode(json!), equals(['release-notes']));
    });
  });

  group('AgentProfileSheet — live MCP picker', () {
    testWidgets('renders live MCP names after Restrict', (tester) async {
      final config = _makeConfig();
      final configsDs = _RecordingAgentConfigsDataSource(config);

      await tester.pumpWidget(
        _buildSheet(
          config: config,
          configsDs: configsDs,
          skillsDs: _FakeSkillsDataSource(const []),
          mcpDs: _FakeMcpDataSource(['rhythm', 'obsidian']),
        ),
      );
      await tester.pumpAndSettle();

      await _tapRestrictMcp(tester);

      expect(find.text('rhythm'), findsOneWidget);
      expect(find.text('obsidian'), findsOneWidget);
    });

    testWidgets('empty live MCP list shows empty-state, no crash', (
      tester,
    ) async {
      final config = _makeConfig();
      final configsDs = _RecordingAgentConfigsDataSource(config);

      await tester.pumpWidget(
        _buildSheet(
          config: config,
          configsDs: configsDs,
          skillsDs: _FakeSkillsDataSource(const []),
          mcpDs: _FakeMcpDataSource(const []),
        ),
      );
      await tester.pumpAndSettle();

      await _tapRestrictMcp(tester);

      expect(find.text('No MCP servers'), findsOneWidget);
    });

    testWidgets(
      'stale persisted MCP gets warning/stale affordance; live one does not',
      (tester) async {
        // Profile persisted a selection that no longer matches the live engine
        // id (`nfl-mcp` vs the live `nfl_mcp`) plus one valid live name.
        final config = _makeConfig().copyWith(
          allowedMcps: const ['nfl-mcp', 'rhythm'],
        );
        final configsDs = _RecordingAgentConfigsDataSource(config);

        await tester.pumpWidget(
          _buildSheet(
            config: config,
            configsDs: configsDs,
            skillsDs: _FakeSkillsDataSource(const []),
            mcpDs: _FakeMcpDataSource(['rhythm', 'nfl_mcp']),
          ),
        );
        await tester.pumpAndSettle();

        // Section is already in Restrict mode (allowedMcps is non-null), so just
        // bring it into view.
        await _scrollIntoView(tester, find.text('ALLOWED MCPS'));

        // The stale persisted name renders with the dedicated stale-chip key +
        // a warning icon; the live name does not.
        expect(
          find.byKey(const ValueKey('stale-chip-nfl-mcp')),
          findsOneWidget,
        );
        expect(find.byKey(const ValueKey('stale-chip-rhythm')), findsNothing);
        expect(find.byIcon(Icons.warning_amber_rounded), findsOneWidget);

        // Both chips are present and labelled.
        expect(find.text('nfl-mcp'), findsOneWidget);
        expect(find.text('rhythm'), findsOneWidget);
      },
    );

    testWidgets('stale MCP chip is still toggleable (unselect removes it)', (
      tester,
    ) async {
      final config = _makeConfig().copyWith(
        allowedMcps: const ['nfl-mcp', 'rhythm'],
      );
      final configsDs = _RecordingAgentConfigsDataSource(config);

      await tester.pumpWidget(
        _buildSheet(
          config: config,
          configsDs: configsDs,
          skillsDs: _FakeSkillsDataSource(const []),
          mcpDs: _FakeMcpDataSource(['rhythm', 'nfl_mcp']),
        ),
      );
      await tester.pumpAndSettle();

      await _scrollIntoView(tester, find.text('ALLOWED MCPS'));

      // Unselect the stale chip — it must remain interactive.
      await tester.tap(find.byKey(const ValueKey('stale-chip-nfl-mcp')));
      await tester.pumpAndSettle();

      // Once unselected it is no longer in the persisted set, so the stale
      // affordance disappears (the union no longer surfaces it).
      expect(find.byKey(const ValueKey('stale-chip-nfl-mcp')), findsNothing);

      await tester.dragUntilVisible(
        find.widgetWithText(FilledButton, 'Save changes'),
        find.byType(ListView).first,
        const Offset(0, -120),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Save changes'));
      await tester.pumpAndSettle();

      final json = configsDs.lastUpdatePatch?['allowedMcpsJson'] as String?;
      expect(json, isNotNull);
      expect(jsonDecode(json!), equals(['rhythm']));
    });

    testWidgets(
      '#922 — allowed server reported needs_auth shows a degraded badge',
      (tester) async {
        final config = _makeConfig().copyWith(
          allowedMcps: const ['rhythm', 'canva'],
        );
        final configsDs = _RecordingAgentConfigsDataSource(config);

        await tester.pumpWidget(
          _buildSheet(
            config: config,
            configsDs: configsDs,
            skillsDs: _FakeSkillsDataSource(const []),
            mcpDs: _FakeMcpDataSource(
              ['rhythm', 'canva'],
              needsAuth: {'canva'},
            ),
          ),
        );
        await tester.pumpAndSettle();

        await _scrollIntoView(tester, find.text('ALLOWED MCPS'));

        expect(find.textContaining('Degraded'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('needs-auth-chip-canva')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('needs-auth-chip-rhythm')),
          findsNothing,
        );
      },
    );

    testWidgets(
      '#922 — no needs_auth servers means no degraded badge',
      (tester) async {
        final config = _makeConfig().copyWith(allowedMcps: const ['rhythm']);
        final configsDs = _RecordingAgentConfigsDataSource(config);

        await tester.pumpWidget(
          _buildSheet(
            config: config,
            configsDs: configsDs,
            skillsDs: _FakeSkillsDataSource(const []),
            mcpDs: _FakeMcpDataSource(['rhythm']),
          ),
        );
        await tester.pumpAndSettle();

        await _scrollIntoView(tester, find.text('ALLOWED MCPS'));

        expect(find.textContaining('Degraded'), findsNothing);
      },
    );
  });

  group('AgentProfileSheet — deny-all scope surfacing (#931)', () {
    testWidgets(
        'deny-all MCP ([]) shows the deny-all banner, not "All allowed"',
        (tester) async {
      // Profile explicitly denies all MCP access ([] — not null). With live
      // servers available, this is a degraded state that must be visible, not
      // silently mistaken for "unrestricted" or "no servers".
      final config = _makeConfig().copyWith(allowedMcps: const <String>[]);
      final configsDs = _RecordingAgentConfigsDataSource(config);

      await tester.pumpWidget(
        _buildSheet(
          config: config,
          configsDs: configsDs,
          skillsDs: _FakeSkillsDataSource(const []),
          mcpDs: _FakeMcpDataSource(['rhythm', 'obsidian']),
        ),
      );
      await tester.pumpAndSettle();

      await _scrollIntoView(tester, find.text('ALLOWED MCPS'));

      expect(find.byKey(const ValueKey('deny-all-banner')), findsOneWidget);
      expect(find.textContaining('No MCP access'), findsOneWidget);
      // Falsification: the unrestricted banner must NOT be shown.
      expect(find.text('All MCPs allowed'), findsNothing);
    });

    testWidgets('deny-all skills ([]) shows the deny-all banner', (
      tester,
    ) async {
      final config = _makeConfig().copyWith(allowedSkills: const <String>[]);
      final configsDs = _RecordingAgentConfigsDataSource(config);

      await tester.pumpWidget(
        _buildSheet(
          config: config,
          configsDs: configsDs,
          skillsDs: _FakeSkillsDataSource([_skill('task-management')]),
          mcpDs: _FakeMcpDataSource(const []),
        ),
      );
      await tester.pumpAndSettle();

      await _scrollIntoView(tester, find.text('ALLOWED SKILLS'));

      expect(find.byKey(const ValueKey('deny-all-banner')), findsOneWidget);
      expect(find.textContaining('No skill access'), findsOneWidget);
      expect(find.text('All Skills allowed'), findsNothing);
    });
  });

  group('ManagedSkillEditorSheet — boundary guards', () {
    Widget editorHost({
      required OpencodeSkillsDataSource ds,
      required Set<String> existing,
    }) {
      return MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (ctx) => Center(
              child: ElevatedButton(
                onPressed: () => showManagedSkillEditorSheet(
                  ctx,
                  dataSource: ds,
                  existingNames: existing,
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
    }

    testWidgets('blocks empty name', (tester) async {
      final ds = _FakeSkillsDataSource(const []);
      await tester.pumpWidget(editorHost(ds: ds, existing: const {}));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();

      // Leave name empty, fill content, attempt save.
      await tester.enterText(find.byType(TextField).last, 'some body');
      await tester.tap(find.widgetWithText(FilledButton, 'Create skill'));
      await tester.pumpAndSettle();

      expect(find.text('Name is required.'), findsOneWidget);
      expect(ds.lastCreate, isNull);
    });

    testWidgets('blocks colliding name', (tester) async {
      final ds = _FakeSkillsDataSource(const []);
      await tester.pumpWidget(editorHost(ds: ds, existing: {'release-notes'}));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).first, 'Release-Notes');
      await tester.enterText(find.byType(TextField).last, 'some body');
      await tester.tap(find.widgetWithText(FilledButton, 'Create skill'));
      await tester.pumpAndSettle();

      expect(find.textContaining('already exists'), findsOneWidget);
      expect(ds.lastCreate, isNull);
    });

    testWidgets('valid create calls the write endpoint', (tester) async {
      final ds = _FakeSkillsDataSource(const []);
      await tester.pumpWidget(editorHost(ds: ds, existing: const {}));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).first, 'release-notes');
      await tester.enterText(find.byType(TextField).last, 'the body');
      await tester.tap(find.widgetWithText(FilledButton, 'Create skill'));
      await tester.pumpAndSettle();

      expect(ds.lastCreate?['name'], equals('release-notes'));
      expect(ds.lastCreate?['content'], equals('the body'));
    });
  });
}
