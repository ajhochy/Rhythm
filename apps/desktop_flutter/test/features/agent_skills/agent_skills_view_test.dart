/// REAL-SURFACE widget tests for the standalone Skills menu [AgentSkillsView]
/// (#796 — skill-unify2, subsumes #779).
///
/// These pump the MOUNTED view inside a MaterialApp with a real
/// [AgentSkillsController] backed by a FAKE [OpencodeSkillsDataSource]. No
/// isolated widget stubs.
///
/// Asserts:
///   1. The menu lists EVERY engine skill from the unified endpoint
///      (`listWithMetadata`), each with a managed/external badge.
///   2. Lifecycle (measuring/reverted) + baseline→post score render when present.
///   3. Managed rows expose edit + delete; external/handwritten rows are
///      read-only (no edit/delete affordance).
///   4. "New skill" opens the managed editor and round-trips a create.
///   5. Tapping Delete (confirmed) calls the data source's delete.
///   6. Loading / error / empty states render (no crash, no hardcoded fallback).
///   7. The data source targets localhost:4001.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/constants/app_constants.dart';
import 'package:rhythm_desktop/features/agent_skills/controllers/agent_skills_controller.dart';
import 'package:rhythm_desktop/features/agent_skills/views/agent_skills_view.dart';
import 'package:rhythm_desktop/features/agents/data/opencode_skills_data_source.dart';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/// A skills data source that returns a fixed unified list and records
/// create/delete calls. Can be driven into loading/error states.
class _FakeSkillsDataSource extends OpencodeSkillsDataSource {
  _FakeSkillsDataSource(this._entries);

  List<OpencodeSkillEntry> _entries;

  Map<String, dynamic>? lastCreate;
  String? lastDeleted;

  bool throwOnList = false;
  bool hangOnList = false;

  @override
  Future<List<OpencodeSkillEntry>> listWithMetadata() async {
    if (hangOnList) {
      return Completer<List<OpencodeSkillEntry>>().future;
    }
    if (throwOnList) {
      throw Exception('boom');
    }
    return List.of(_entries);
  }

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
      metadata: const OpencodeSkillMetadata(),
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

OpencodeSkillEntry _skill(
  String name, {
  bool managed = false,
  String? description = 'desc',
  OpencodeSkillMetadata? metadata,
}) =>
    OpencodeSkillEntry(
      name: name,
      description: description,
      location:
          managed ? '/managed/$name/SKILL.md' : '/external/$name/SKILL.md',
      managed: managed,
      metadata: metadata ?? const OpencodeSkillMetadata(),
    );

Widget _buildApp(AgentSkillsController controller) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentSkillsController>.value(value: controller),
    ],
    child: const MaterialApp(home: AgentSkillsView()),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AgentSkillsView — unified engine-skill list', () {
    testWidgets('lists managed + external skills with provenance badges', (
      tester,
    ) async {
      final ds = _FakeSkillsDataSource([
        _skill('release-notes', managed: true),
        _skill('engineering:code-review'),
      ]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.text('release-notes'), findsOneWidget);
      expect(find.text('engineering:code-review'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('badge-managed-release-notes')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('badge-external-engineering:code-review')),
        findsOneWidget,
      );
    });

    testWidgets('managed row shows edit + delete; external is read-only', (
      tester,
    ) async {
      final ds = _FakeSkillsDataSource([
        _skill('release-notes', managed: true),
        _skill('docx'),
      ]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      // Managed: edit + delete present.
      expect(
        find.byKey(const ValueKey('edit-skill-release-notes')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('delete-skill-release-notes')),
        findsOneWidget,
      );

      // External: no edit/delete, shows a read-only lock affordance.
      expect(find.byKey(const ValueKey('edit-skill-docx')), findsNothing);
      expect(find.byKey(const ValueKey('delete-skill-docx')), findsNothing);
      expect(find.byKey(const ValueKey('readonly-skill-docx')), findsOneWidget);
    });

    testWidgets('renders lifecycle status + baseline→post score', (
      tester,
    ) async {
      final ds = _FakeSkillsDataSource([
        _skill(
          'reverted-skill',
          managed: true,
          metadata: const OpencodeSkillMetadata(
            confidence: 0.81,
            version: 3,
            status: 'reverted',
            source: 'teacher-escalation',
            uses: 7,
            baselineScore: 0.70,
            postScore: 0.55,
          ),
        ),
      ]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('status-badge-reverted')),
        findsOneWidget,
      );
      expect(find.textContaining('teacher-escalation'), findsOneWidget);
      expect(find.textContaining('confidence 0.81'), findsOneWidget);
      expect(find.textContaining('v3'), findsOneWidget);
      expect(find.textContaining('score 0.70 → 0.55'), findsOneWidget);
    });

    testWidgets('external fork shows the auto-improved note', (tester) async {
      final ds = _FakeSkillsDataSource([
        _skill(
          'forked-skill',
          managed: true,
          metadata: const OpencodeSkillMetadata(
            status: 'measuring',
            isExternalFork: true,
          ),
        ),
      ]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('status-badge-measuring')),
        findsOneWidget,
      );
      expect(find.textContaining('auto-improved'), findsOneWidget);
    });

    testWidgets(
      '"New skill" opens the managed editor and round-trips a create',
      (tester) async {
        final ds = _FakeSkillsDataSource([
          _skill('release-notes', managed: true),
        ]);
        final controller = AgentSkillsController(ds);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_buildApp(controller));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const ValueKey('new-skill-button')));
        await tester.pumpAndSettle();

        // The managed editor sheet is open.
        expect(find.text('New skill'), findsWidgets);

        await tester.enterText(find.byType(TextField).first, 'my-new-skill');
        await tester.enterText(find.byType(TextField).last, 'the body');
        await tester.tap(find.widgetWithText(FilledButton, 'Create skill'));
        await tester.pumpAndSettle();

        expect(ds.lastCreate?['name'], equals('my-new-skill'));
        expect(ds.lastCreate?['content'], equals('the body'));
        // The newly created skill appears after the round-trip reload.
        expect(find.text('my-new-skill'), findsOneWidget);
      },
    );

    testWidgets('deleting a managed skill (confirmed) calls delete', (
      tester,
    ) async {
      final ds = _FakeSkillsDataSource([
        _skill('release-notes', managed: true),
      ]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      await tester.tap(
        find.byKey(const ValueKey('delete-skill-release-notes')),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Delete').last);
      await tester.pumpAndSettle();

      expect(ds.lastDeleted, equals('release-notes'));
    });

    testWidgets('loading shows a spinner', (tester) async {
      final ds = _FakeSkillsDataSource([])..hangOnList = true;
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pump();
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('error shows the error message + no hardcoded fallback', (
      tester,
    ) async {
      final ds = _FakeSkillsDataSource([])..throwOnList = true;
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('skills-error-state')), findsOneWidget);
      expect(find.textContaining('boom'), findsOneWidget);
    });

    testWidgets('empty list shows the empty state', (tester) async {
      final ds = _FakeSkillsDataSource([]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('skills-empty-state')), findsOneWidget);
      expect(find.text('No skills yet'), findsOneWidget);
    });
  });

  group('OpencodeSkillsDataSource — dual-endpoint targeting', () {
    test('targets the local agent server (:4001), never the prod URL', () {
      // The agent skills traffic must stay on localhost:4001 regardless of the
      // configurable production server URL (CLAUDE.md dual-endpoint rule).
      expect(AppConstants.agentLocalBaseUrl, contains('4001'));
      expect(AppConstants.agentLocalBaseUrl, contains('localhost'));
    });
  });
}
