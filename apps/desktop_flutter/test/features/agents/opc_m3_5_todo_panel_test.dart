/// Contract tests for OPC-M3-5 — Session todo panel.
///
/// Covers acceptance criteria c3–c6 from the issue spec:
///
/// c3 — Selecting a session fetches todos once and renders the panel when
///      nonempty; empty list → no panel (widget tests).
///      Includes a REAL-SURFACE test: pumps the actual SessionSidePanel with
///      a stub that returns todos, asserting the todo rows are visible.
///
/// c4 — A todo.updated WS frame replaces the session's todo state and the
///      panel re-renders (controller test: state keyed per session — an update
///      for session B does not touch session A).
///
/// c5 — Panel header shows completed/total count; rows reuse the M2-3
///      checklist styling with status-driven check state.
///
/// c6 — Panel collapse state persists while switching between sessions in the
///      same app run.
///
/// c1/c2 are covered by the vitest server-side test.
/// c7 (ai-workflow checks --level pr exit 0) is manual / gate-level.
///
/// Run with:
///   flutter test test/features/agents/opc_m3_5_todo_panel_test.dart
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_session_side_panel.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Fakes and stubs
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

/// Stub repository with injectable todo response.
class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  /// Todos returned by fetchSessionTodos (injected per test).
  List<Map<String, dynamic>> stagedTodos = const [];

  /// Number of times fetchSessionTodos was called.
  int fetchTodoCallCount = 0;

  // Inject WS messages for testing WS event handling.
  void injectWsMessage(AgentWsMessage msg) => _msgController.add(msg);

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
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      const [];

  @override
  Future<List<Map<String, dynamic>>> fetchSessionTodos(String id) async {
    fetchTodoCallCount++;
    return stagedTodos;
  }

  @override
  Future<void> revertSession(String sessionId, String messageId) async {}

  @override
  Future<void> unrevertSession(String sessionId) async {}

  @override
  Future<void> summarizeSession(String sessionId) async {}

  @override
  Future<void> dispatchCommand(
      String sessionId, String command, String args) async {}

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

AgentsController _buildController(_StubAgentsRepository repo) =>
    AgentsController(
      repo,
      _ReadyAgentServerController(),
      LocalNotificationService(),
      NotificationsController(
        NotificationsRepository(NotificationsDataSource()),
      ),
    );

Widget _wrap(AgentsController controller, Widget child) =>
    ChangeNotifierProvider<AgentsController>.value(
      value: controller,
      child: MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(body: child),
      ),
    );

const _kTodosFixture = [
  {
    'id': 'todo-1',
    'content': 'First task',
    'status': 'completed',
    'priority': 'high'
  },
  {
    'id': 'todo-2',
    'content': 'Second task',
    'status': 'in-progress',
    'priority': 'medium'
  },
  {
    'id': 'todo-3',
    'content': 'Third task',
    'status': 'pending',
    'priority': 'low'
  },
];

const _kEmptyTodos = <Map<String, dynamic>>[];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  late _StubAgentsRepository repo;
  late AgentsController controller;

  setUp(() {
    repo = _StubAgentsRepository();
    controller = _buildController(repo);
  });

  tearDown(() => controller.dispose());

  // ── c3: REAL-SURFACE — selecting a session renders the todo panel ──

  group(
      'issue-698-c3: session select fetches todos; nonempty → panel; empty → no panel',
      () {
    testWidgets(
      'c3a: REAL-SURFACE — SessionSidePanel shows todo panel when fetchSessionTodos returns items',
      (tester) async {
        final session = _makeSession('session-c3a');
        repo.stagedTodos = _kTodosFixture;

        // Pre-populate the controller's todo state (simulating a fetch after selection).
        controller.setSessionTodosForTest('session-c3a', _kTodosFixture);

        await tester
            .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
        await tester.pump();

        // The todo panel should be visible with the three items.
        expect(find.text('First task'), findsOneWidget);
        expect(find.text('Second task'), findsOneWidget);
        expect(find.text('Third task'), findsOneWidget);
      },
    );

    testWidgets(
      'c3b: SessionSidePanel hides the todo panel when todos list is empty',
      (tester) async {
        final session = _makeSession('session-c3b');
        controller.setSessionTodosForTest('session-c3b', _kEmptyTodos);

        await tester
            .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
        await tester.pump();

        // None of the todo item texts should be in the tree.
        expect(find.text('First task'), findsNothing);
        expect(find.text('Second task'), findsNothing);
      },
    );

    test('c3c: fetchSessionTodos is called exactly once on selectSession',
        () async {
      repo.stagedTodos = _kTodosFixture;
      await controller.selectSession('session-c3c');
      // pump to let async fetch complete
      await Future.delayed(Duration.zero);

      expect(repo.fetchTodoCallCount, equals(1));
    });
  });

  // ── c4: todo.updated WS frame replaces session todo state; cross-session isolation ──

  group(
      'issue-698-c4: todo.updated WS frame replaces state; session-keyed isolation',
      () {
    test('c4a: SessionTodoUpdatedMessage for session A replaces its todos',
        () async {
      await controller.initialize();
      controller.setSessionTodosForTest('session-A', _kTodosFixture);

      final updatedTodos = [
        {
          'id': 'todo-x',
          'content': 'Updated item',
          'status': 'completed',
          'priority': 'high'
        },
      ];

      repo.injectWsMessage(SessionTodoUpdatedMessage(
        sessionId: 'session-A',
        todos: updatedTodos,
      ));
      await Future<void>.delayed(Duration.zero);

      final todos = controller.sessionTodosFor('session-A');
      expect(todos.length, equals(1));
      expect(todos[0]['content'], equals('Updated item'));
    });

    test(
        'c4b: SessionTodoUpdatedMessage for session B does not touch session A',
        () async {
      await controller.initialize();
      // Set up A with 3 todos and B with 0.
      controller.setSessionTodosForTest('session-A', _kTodosFixture);
      controller.setSessionTodosForTest('session-B', _kEmptyTodos);

      // Update B only.
      final updatedBTodos = [
        {
          'id': 'todo-b1',
          'content': 'B item',
          'status': 'pending',
          'priority': 'low'
        },
        {
          'id': 'todo-b2',
          'content': 'B item 2',
          'status': 'completed',
          'priority': 'high'
        },
      ];
      repo.injectWsMessage(SessionTodoUpdatedMessage(
        sessionId: 'session-B',
        todos: updatedBTodos,
      ));
      await Future<void>.delayed(Duration.zero);

      // A must be unchanged.
      expect(controller.sessionTodosFor('session-A').length, equals(3));
      // B must be updated.
      expect(controller.sessionTodosFor('session-B').length, equals(2));
    });
  });

  // ── c5: panel header shows completed/total; checklist row check states ──

  group(
      'issue-698-c5: panel header shows completed/total count and correct check states',
      () {
    testWidgets('c5a: header shows completed/total count (e.g. "1/3")',
        (tester) async {
      final session = _makeSession('session-c5a');
      // 1 completed, 1 in-progress, 1 pending.
      controller.setSessionTodosForTest('session-c5a', _kTodosFixture);

      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
      await tester.pump();

      // The header progress text "1/3" should be visible.
      expect(find.text('1/3'), findsOneWidget);
    });

    testWidgets(
        'c5b: completed todos have checked checkbox; pending are unchecked',
        (tester) async {
      final session = _makeSession('session-c5b');
      controller.setSessionTodosForTest('session-c5b', _kTodosFixture);

      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
      await tester.pump();

      // Find all Checkbox widgets; the first (completed) should be checked.
      final checkboxes =
          tester.widgetList<Checkbox>(find.byType(Checkbox)).toList();
      // At least 3 checkboxes (one per todo).
      expect(checkboxes.length, greaterThanOrEqualTo(3));

      // First = completed → value: true.
      expect(checkboxes[0].value, isTrue);
      // Second = in-progress → value: null (tristate).
      expect(checkboxes[1].value, isNull);
      // Third = pending → value: false.
      expect(checkboxes[2].value, isFalse);
    });
  });

  // ── c6: collapse state survives session switch ──

  group(
      'issue-698-c6: todo panel collapse state persists across session switches',
      () {
    testWidgets(
        'c6: collapsing the todo panel then switching sessions preserves collapsed state',
        (tester) async {
      final sessionA = _makeSession('session-c6-A');
      final sessionB = _makeSession('session-c6-B');

      controller.setSessionTodosForTest('session-c6-A', _kTodosFixture);
      controller.setSessionTodosForTest('session-c6-B', _kTodosFixture);

      // Pump A's SessionSidePanel.
      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: sessionA)));
      await tester.pump();

      // Todo panel is expanded by default — find the collapse button and tap it.
      expect(find.byIcon(Icons.expand_less), findsOneWidget);
      await tester.tap(find.byIcon(Icons.expand_less));
      await tester.pump();

      // After collapse, the todo content text should be hidden.
      expect(find.text('First task'), findsNothing);

      // Switch to session B (re-pump with new session).
      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: sessionB)));
      await tester.pump();

      // Session B panel starts fresh (expanded — todos visible).
      expect(find.text('First task'), findsOneWidget);

      // Switch back to session A — collapsed state must be remembered.
      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: sessionA)));
      await tester.pump();

      // Content hidden again (still collapsed).
      expect(find.text('First task'), findsNothing);
    });
  });
}
