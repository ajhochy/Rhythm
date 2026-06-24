/// REAL-SURFACE widget tests for AgentSkillsView.
///
/// These pump the MOUNTED view inside a MaterialApp with a real
/// AgentSkillsController backed by a FAKE data source (injected via the
/// repository). This mirrors the agent_schedules_edit_test harness — no
/// isolated widget stubs.
///
/// Asserts:
///   1. A draft skill renders a DRAFT badge.
///   2. A teacher-escalation skill renders the "learned from failure"
///      annotation.
///   3. Tapping Publish calls the data source's updateSkill with
///      status='published'.
///   4. Tapping Delete (and confirming) calls the data source's deleteSkill.
///   5. Loading shows a CircularProgressIndicator.
///   6. Error shows the error message.
///   7. An empty list shows "No skills yet".
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/agent_skills/controllers/agent_skills_controller.dart';
import 'package:rhythm_desktop/features/agent_skills/data/agent_skills_data_source.dart';
import 'package:rhythm_desktop/features/agent_skills/models/agent_skill.dart';
import 'package:rhythm_desktop/features/agent_skills/models/agent_skill_version.dart';
import 'package:rhythm_desktop/features/agent_skills/repositories/agent_skills_repository.dart';
import 'package:rhythm_desktop/features/agent_skills/views/agent_skills_view.dart';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/// A skills data source that records publish/delete calls and can be driven
/// into loading/error/empty states for the view tests.
class _FakeSkillsDataSource extends AgentSkillsDataSource {
  _FakeSkillsDataSource(this._skills);

  final List<AgentSkill> _skills;

  // Recorded calls.
  String? lastUpdatedId;
  String? lastUpdatedStatus;
  String? lastDeletedId;
  String? lastVersionsId;
  String? lastRollbackId;
  int? lastRollbackVersionNo;

  // Behaviour switches.
  bool throwOnGet = false;
  bool hangOnGet = false;

  // History the fake returns from getVersions().
  List<AgentSkillVersion> versions = const [];

  @override
  Future<List<AgentSkill>> getSkills() async {
    if (hangOnGet) {
      // Never completes — keeps the controller in the loading state.
      return Completer<List<AgentSkill>>().future;
    }
    if (throwOnGet) {
      throw Exception('boom');
    }
    return List.of(_skills);
  }

  @override
  Future<AgentSkill> updateSkill(String id, {required String status}) async {
    lastUpdatedId = id;
    lastUpdatedStatus = status;
    final existing = _skills.firstWhere((s) => s.id == id);
    return AgentSkill(
      id: existing.id,
      title: existing.title,
      whenToUse: existing.whenToUse,
      description: existing.description,
      steps: existing.steps,
      tags: existing.tags,
      confidence: existing.confidence,
      status: status,
      source: existing.source,
      uses: existing.uses,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    );
  }

  @override
  Future<void> deleteSkill(String id) async {
    lastDeletedId = id;
  }

  @override
  Future<List<AgentSkillVersion>> getVersions(String id) async {
    lastVersionsId = id;
    return List.of(versions);
  }

  @override
  Future<AgentSkill> rollback(String id, int versionNo) async {
    lastRollbackId = id;
    lastRollbackVersionNo = versionNo;
    final existing = _skills.firstWhere((s) => s.id == id);
    return AgentSkill(
      id: existing.id,
      title: existing.title,
      whenToUse: existing.whenToUse,
      description: existing.description,
      steps: existing.steps,
      tags: existing.tags,
      confidence: existing.confidence,
      status: existing.status,
      source: existing.source,
      uses: existing.uses,
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    );
  }
}

AgentSkillVersion _version({
  int versionNo = 1,
  String source = 'auto-refined',
  String description = 'a prior version',
}) =>
    AgentSkillVersion(
      id: 'ver-$versionNo',
      skillId: 'skill-draft-1',
      versionNo: versionNo,
      title: 'Draft Skill',
      whenToUse: 'When testing',
      description: description,
      steps: const ['old step'],
      tags: const ['test'],
      body: null,
      confidence: 0.6,
      source: source,
      createdAt: '2026-06-24T00:00:00.000Z',
    );

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _kEpoch = '1970-01-01T00:00:00.000Z';

AgentSkill _draftSkill({
  String id = 'skill-draft-1',
  String title = 'Draft Skill',
  String source = 'auto-extract',
}) =>
    AgentSkill(
      id: id,
      title: title,
      whenToUse: 'When testing',
      description: 'A drafted skill awaiting curation',
      steps: const ['step one', 'step two'],
      tags: const ['test'],
      confidence: 0.72,
      status: 'draft',
      source: source,
      uses: 0,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );

AgentSkillsController _controller(List<AgentSkill> skills,
    {_FakeSkillsDataSource? dataSource}) {
  final ds = dataSource ?? _FakeSkillsDataSource(skills);
  return AgentSkillsController(AgentSkillsRepository(ds));
}

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

  group('AgentSkillsView — real surface', () {
    testWidgets('draft skill renders a DRAFT badge', (tester) async {
      final controller = _controller([_draftSkill()]);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.text('DRAFT'), findsOneWidget);
      expect(find.text('Draft Skill'), findsOneWidget);
    });

    testWidgets(
        'teacher-escalation skill renders the learned-from-failure '
        'annotation', (tester) async {
      final controller = _controller([
        _draftSkill(
          id: 'skill-teacher-1',
          title: 'Escalated Skill',
          source: 'teacher-escalation',
        ),
      ]);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.textContaining('learned from failure'), findsOneWidget);
    });

    testWidgets('tapping Publish calls updateSkill with status published',
        (tester) async {
      final ds = _FakeSkillsDataSource([_draftSkill()]);
      final controller = _controller([], dataSource: ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      final publishButton =
          find.byKey(const ValueKey('publish-skill-skill-draft-1'));
      expect(publishButton, findsOneWidget);

      await tester.tap(publishButton);
      await tester.pumpAndSettle();

      expect(ds.lastUpdatedId, equals('skill-draft-1'));
      expect(ds.lastUpdatedStatus, equals('published'));
    });

    testWidgets('tapping Delete (confirmed) calls deleteSkill', (tester) async {
      final ds = _FakeSkillsDataSource([_draftSkill()]);
      final controller = _controller([], dataSource: ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      final deleteButton =
          find.byKey(const ValueKey('delete-skill-skill-draft-1'));
      expect(deleteButton, findsOneWidget);

      await tester.tap(deleteButton);
      await tester.pumpAndSettle();

      // Confirm in the dialog.
      await tester.tap(find.text('Delete').last);
      await tester.pumpAndSettle();

      expect(ds.lastDeletedId, equals('skill-draft-1'));
    });

    testWidgets('loading shows a spinner', (tester) async {
      final ds = _FakeSkillsDataSource([])..hangOnGet = true;
      final controller = _controller([], dataSource: ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      // First frame triggers loadSkills(); pump once so the post-frame
      // callback fires and the controller flips to loading.
      await tester.pump();
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('error shows the error message', (tester) async {
      final ds = _FakeSkillsDataSource([])..throwOnGet = true;
      final controller = _controller([], dataSource: ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.textContaining('boom'), findsOneWidget);
    });

    testWidgets('empty list shows "No skills yet"', (tester) async {
      final controller = _controller([]);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.text('No skills yet'), findsOneWidget);
    });

    testWidgets('tapping History renders the version list (P5-3)',
        (tester) async {
      final ds = _FakeSkillsDataSource([_draftSkill()])
        ..versions = [
          _version(versionNo: 2, description: 'second'),
          _version(versionNo: 1, description: 'first'),
        ];
      final controller = _controller([], dataSource: ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      await tester
          .tap(find.byKey(const ValueKey('history-skill-skill-draft-1')));
      await tester.pumpAndSettle();

      expect(ds.lastVersionsId, equals('skill-draft-1'));
      expect(find.textContaining('Version history'), findsOneWidget);
      expect(find.textContaining('v2 ·'), findsOneWidget);
      expect(find.textContaining('v1 ·'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('rollback-version-1')),
        findsOneWidget,
      );
    });

    testWidgets('tapping Rollback fires the repo/route with the version (P5-3)',
        (tester) async {
      final ds = _FakeSkillsDataSource([_draftSkill()])
        ..versions = [_version(versionNo: 1, description: 'first')];
      final controller = _controller([], dataSource: ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      await tester
          .tap(find.byKey(const ValueKey('history-skill-skill-draft-1')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('rollback-version-1')));
      await tester.pumpAndSettle();

      expect(ds.lastRollbackId, equals('skill-draft-1'));
      expect(ds.lastRollbackVersionNo, equals(1));
    });
  });
}
