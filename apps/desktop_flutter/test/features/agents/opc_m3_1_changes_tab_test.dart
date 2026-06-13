/// Contract tests for OPC-M3-1 — Changes tab via real GET /session/{id}/diff.
///
/// Covers acceptance criteria c2–c5 from the issue spec:
///
/// c2 — Changes tab renders one expandable file row per diff entry (path +
///      "+N −M" counts) using _UnifiedDiffView (widget test on the fixture).
/// c3 — Empty diff renders "No file changes yet" empty state (distinct from
///      error state).
/// c4 — A session.diff WS event triggers fetchSessionDiff for the affected
///      session only (controller unit test).
/// c5 — Tab badge shows the changed-file count when nonzero.
///
/// c1 is covered by the vitest server-side test.
/// c6 (ai-workflow checks --level pr exit 0) is manual / gate-level.
///
/// Run with:
///   flutter test test/features/agents/opc_m3_1_changes_tab_test.dart
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_changes_tab.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';
import 'package:provider/provider.dart';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class _FakeApiServerService extends ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null, failureMessage: null);

  @override
  void stop() {}

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _ReadyAgentServerController extends AgentServerController {
  _ReadyAgentServerController() : super(_FakeApiServerService());

  @override
  AgentServerStatus get status => AgentServerStatus.ready;

  @override
  bool get isReady => true;

  @override
  bool get hasAnyAgent => true;
}

/// A stub repository that records fetchSessionDiff calls.
class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  /// Call count of fetchSessionDiff per sessionId.
  final Map<String, int> fetchDiffCallCount = {};

  /// Staged diff results per sessionId.
  final Map<String, List<Map<String, dynamic>>> stagedDiff = {};

  void emit(AgentWsMessage msg) => _msgController.add(msg);

  @override
  Stream<AgentWsMessage> get messages => _msgController.stream;

  @override
  Stream<bool> get connectivityStream => _connectivityController.stream;

  @override
  bool get isConnected => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> dispose() async {
    await _msgController.close();
    await _connectivityController.close();
  }

  @override
  void send(Map<String, dynamic> msg) {}

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
  }) async =>
      const [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async => (
            session: _makeSession(id),
            messages: const <AgentSessionMessage>[],
          );

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async {
    fetchDiffCallCount[id] = (fetchDiffCallCount[id] ?? 0) + 1;
    return stagedDiff[id] ?? const [];
  }

  @override
  Future<void> revertSession(String sessionId, String messageId) async {}

  @override
  Future<void> unrevertSession(String sessionId) async {}

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0);

AgentSession _makeSession(String id) => AgentSession(
      id: id,
      agentId: 'claude-code',
      name: 'Test Session',
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );

// ---------------------------------------------------------------------------
// Real-shape diff fixture (v1.14.49 FileDiff)
// ---------------------------------------------------------------------------

const _kDiffFixture = [
  {
    'file': 'lib/features/tasks/models/task.dart',
    'before': '// old line\nreturn false;',
    'after': '// new line\nreturn true;',
    'additions': 3,
    'deletions': 2,
  },
  {
    'file': 'lib/features/tasks/views/tasks_view.dart',
    'before': 'class TasksView {}',
    'after': 'class TasksView extends StatelessWidget {}',
    'additions': 1,
    'deletions': 0,
  },
];

// ---------------------------------------------------------------------------
// Widget pump helper
// ---------------------------------------------------------------------------

Widget _wrap(Widget child) => MaterialApp(
      theme: AppTheme.light(),
      home: Scaffold(body: child),
    );

AgentsController _buildController(_StubAgentsRepository repo) {
  final agentServer = _ReadyAgentServerController();
  return AgentsController(
    repo,
    agentServer,
    LocalNotificationService(),
    NotificationsController(
      NotificationsRepository(NotificationsDataSource()),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  late _StubAgentsRepository stubRepo;
  late AgentsController controller;

  setUp(() {
    stubRepo = _StubAgentsRepository();
    controller = _buildController(stubRepo);
  });

  tearDown(() {
    controller.dispose();
  });

  group('issue-694-c2: Changes tab renders one file row per diff entry', () {
    testWidgets(
      'issue-694-c2: renders file path and +N/-M counts for each entry',
      (tester) async {
        await tester.pumpWidget(
          ChangeNotifierProvider<AgentsController>.value(
            value: controller,
            child: _wrap(
              ChangesTab(
                sessionId: 'session-001',
                diffEntries: _kDiffFixture,
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        // Both file paths must be visible.
        expect(find.textContaining('task.dart'), findsAtLeastNWidgets(1));
        expect(find.textContaining('tasks_view.dart'), findsAtLeastNWidgets(1));

        // "+N" additions counts visible.
        expect(find.text('+3'), findsAtLeastNWidgets(1));
        expect(find.text('+1'), findsAtLeastNWidgets(1));

        // "−N" or "-N" deletions count visible.
        expect(find.text('-2'), findsAtLeastNWidgets(1));
      },
    );
  });

  group('issue-694-c3: Empty diff shows "No file changes yet"', () {
    testWidgets(
      'issue-694-c3: shows explicit empty state when diff is empty',
      (tester) async {
        await tester.pumpWidget(
          ChangeNotifierProvider<AgentsController>.value(
            value: controller,
            child: _wrap(
              const ChangesTab(
                sessionId: 'session-002',
                diffEntries: [],
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.textContaining('No file changes yet'), findsOneWidget);

        // Must NOT show error state text.
        expect(find.textContaining('Could not'), findsNothing);
      },
    );

    testWidgets(
      'issue-694-c3b: error state is distinct from empty state',
      (tester) async {
        await tester.pumpWidget(
          ChangeNotifierProvider<AgentsController>.value(
            value: controller,
            child: _wrap(
              const ChangesTab(
                sessionId: 'session-003',
                diffEntries: [],
                errorMessage: 'Could not load diff',
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        // Error state shows the error message.
        expect(find.textContaining('Could not load diff'), findsOneWidget);
        // Must NOT show the empty state text.
        expect(find.textContaining('No file changes yet'), findsNothing);
      },
    );
  });

  group(
      'issue-694-c4: session.diff WS event triggers fetchSessionDiff for affected session only',
      () {
    test(
      'issue-694-c4: handleSessionDiffEvent fires fetchSessionDiff for that session only',
      () async {
        const targetSessionId = 'ses-target';
        const otherSessionId = 'ses-other';

        // Pre-stage the diff entries so the fetch doesn't return empty.
        stubRepo.stagedDiff[targetSessionId] = _kDiffFixture;
        stubRepo.stagedDiff[otherSessionId] = _kDiffFixture;

        // Simulate a session.diff WS event arriving for targetSessionId.
        controller.handleSessionDiffEvent(targetSessionId);

        // Give the async fetch time to complete.
        await Future<void>.delayed(const Duration(milliseconds: 100));

        // Only the target session must have been fetched.
        expect(
          stubRepo.fetchDiffCallCount[targetSessionId] ?? 0,
          greaterThan(0),
        );
        expect(stubRepo.fetchDiffCallCount[otherSessionId] ?? 0, equals(0));
      },
    );

    test(
      'issue-694-c4b: sessionDiffFor returns fetched entries after fetchSessionDiff completes',
      () async {
        const sessionId = 'ses-fetch';
        stubRepo.stagedDiff[sessionId] = _kDiffFixture;

        await controller.fetchSessionDiff(sessionId);

        expect(controller.sessionDiffFor(sessionId), hasLength(2));
        expect(
          (controller.sessionDiffFor(sessionId).first)['file'],
          contains('task.dart'),
        );
      },
    );
  });

  group('issue-694-c5: Tab badge shows file count when nonzero', () {
    testWidgets(
      'issue-694-c5: badge shows count when diff has entries',
      (tester) async {
        const sessionId = 'ses-badge';
        // Pre-seed diff state in the controller.
        controller.setSessionDiffForTest(sessionId, _kDiffFixture);

        await tester.pumpWidget(
          ChangeNotifierProvider<AgentsController>.value(
            value: controller,
            child: _wrap(ChangesTabBadge(sessionId: sessionId)),
          ),
        );
        await tester.pumpAndSettle();

        // Badge must show the count (2 entries).
        expect(find.text('2'), findsAtLeastNWidgets(1));
      },
    );

    testWidgets(
      'issue-694-c5b: no visible count badge when diff is empty',
      (tester) async {
        const sessionId = 'ses-no-badge';
        // Diff is empty by default — no seed.

        await tester.pumpWidget(
          ChangeNotifierProvider<AgentsController>.value(
            value: controller,
            child: _wrap(ChangesTabBadge(sessionId: sessionId)),
          ),
        );
        await tester.pumpAndSettle();

        // SizedBox.shrink renders — no text with a positive integer.
        final textWidgets = tester.widgetList<Text>(find.byType(Text)).toList();
        final countTexts = textWidgets.where((t) {
          final s = t.data ?? '';
          final n = int.tryParse(s);
          return n != null && n > 0;
        }).toList();
        expect(countTexts, isEmpty);
      },
    );
  });
}
