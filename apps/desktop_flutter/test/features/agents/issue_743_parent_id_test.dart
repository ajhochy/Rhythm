/// #743 — AgentSession.parentId fromJson/toJson and parent→children grouping.
///
/// Run with:
///   flutter test test/features/agents/issue_743_parent_id_test.dart
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

AgentSession _makeSession({
  required String id,
  String name = 'Session',
  String? parentId,
}) {
  return AgentSession.fromJson({
    'id': id,
    'agent_kind': 'opencode',
    'status': 'idle',
    'cwd': '/tmp',
    'name': name,
    'created_at': '2026-01-01T00:00:00.000Z',
    'updated_at': '2026-01-01T00:00:00.000Z',
    if (parentId != null) 'parentSessionId': parentId,
  });
}

/// Replicates the grouping logic from _buildSessionTree in _session_list_body.dart.
/// Returns a map of parentId → list of child sessions.
Map<String, List<AgentSession>> _childrenOf(List<AgentSession> sessions) {
  final sessionIds = {for (final s in sessions) s.id};
  final map = <String, List<AgentSession>>{};
  for (final s in sessions) {
    if (s.parentId != null && sessionIds.contains(s.parentId)) {
      map.putIfAbsent(s.parentId!, () => []).add(s);
    }
  }
  return map;
}

/// Returns only root sessions (those NOT appearing as children in the filtered list).
List<AgentSession> _rootSessions(List<AgentSession> sessions) {
  final sessionIds = {for (final s in sessions) s.id};
  return sessions
      .where((s) => s.parentId == null || !sessionIds.contains(s.parentId))
      .toList();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  group('AgentSession.parentId — fromJson/toJson', () {
    test('reads parentSessionId from JSON', () {
      final session = AgentSession.fromJson({
        'id': 'local-child-1',
        'agent_kind': 'opencode',
        'status': 'working',
        'cwd': '/tmp',
        'name': 'Subagent task',
        'created_at': '2026-01-01T00:00:00.000Z',
        'updated_at': '2026-01-01T00:00:00.000Z',
        'parentSessionId': 'local-parent-1',
      });
      expect(session.parentId, 'local-parent-1');
      expect(session.isChildSession, isTrue);
    });

    test('reads parentId key as fallback', () {
      final session = AgentSession.fromJson({
        'id': 'local-child-2',
        'agent_kind': 'opencode',
        'status': 'idle',
        'cwd': '/tmp',
        'name': 'Child',
        'created_at': '2026-01-01T00:00:00.000Z',
        'updated_at': '2026-01-01T00:00:00.000Z',
        'parentId': 'local-parent-2',
      });
      expect(session.parentId, 'local-parent-2');
    });

    test('parentId is null for root sessions', () {
      final session = AgentSession.fromJson({
        'id': 'local-root-1',
        'agent_kind': 'opencode',
        'status': 'idle',
        'cwd': '/tmp',
        'name': 'Root session',
        'created_at': '2026-01-01T00:00:00.000Z',
        'updated_at': '2026-01-01T00:00:00.000Z',
      });
      expect(session.parentId, isNull);
      expect(session.isChildSession, isFalse);
    });

    test('toJson includes parentSessionId when set', () {
      final session = _makeSession(id: 's1', parentId: 'p1');
      final json = session.toJson();
      expect(json['parentSessionId'], 'p1');
    });

    test('toJson omits parentSessionId when null', () {
      final session = _makeSession(id: 's2');
      final json = session.toJson();
      expect(json.containsKey('parentSessionId'), isFalse);
    });

    test('copyWith propagates parentId', () {
      final original = _makeSession(id: 's3', parentId: 'p2');
      final copy = original.copyWith();
      expect(copy.parentId, 'p2');
    });

    test('copyWith can clear parentId via sentinel', () {
      final original = _makeSession(id: 's4', parentId: 'p3');
      // Pass null explicitly to clear.
      final copy = original.copyWith(parentId: null);
      expect(copy.parentId, isNull);
    });
  });

  group('parent→children grouping', () {
    test('root session with one child is grouped correctly', () {
      final parent = _makeSession(id: 'parent-1', name: 'Parent');
      final child = _makeSession(
        id: 'child-1',
        name: 'Child',
        parentId: 'parent-1',
      );
      final sessions = [parent, child];

      final children = _childrenOf(sessions);
      final roots = _rootSessions(sessions);

      expect(roots, hasLength(1));
      expect(roots.first.id, 'parent-1');
      expect(children['parent-1'], hasLength(1));
      expect(children['parent-1']!.first.id, 'child-1');
    });

    test('child is excluded from root list', () {
      final parent = _makeSession(id: 'p-2', name: 'Parent');
      final child = _makeSession(id: 'c-2', name: 'Child', parentId: 'p-2');
      final sessions = [parent, child];

      final roots = _rootSessions(sessions);
      expect(roots.map((s) => s.id).toList(), isNot(contains('c-2')));
    });

    test('orphaned child (parent not in list) appears as root', () {
      // Parent is not in the filtered session list (e.g., archived).
      final orphan = _makeSession(
        id: 'orphan-1',
        name: 'Orphan',
        parentId: 'absent-parent',
      );
      final sessions = [orphan];

      final roots = _rootSessions(sessions);
      expect(roots.map((s) => s.id).toList(), contains('orphan-1'));
    });

    test('multiple children nested under same parent', () {
      final parent = _makeSession(id: 'p-3', name: 'Parent');
      final child1 = _makeSession(id: 'c-3a', name: 'Child A', parentId: 'p-3');
      final child2 = _makeSession(id: 'c-3b', name: 'Child B', parentId: 'p-3');
      final sessions = [parent, child1, child2];

      final children = _childrenOf(sessions);
      final roots = _rootSessions(sessions);

      expect(roots, hasLength(1));
      expect(children['p-3'], hasLength(2));
    });
  });
}
