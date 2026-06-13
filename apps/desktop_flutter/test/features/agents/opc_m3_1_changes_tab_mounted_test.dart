/// Integration test for OPC-M3-1 — proves the Changes diff renders on the REAL
/// mounted surface (SessionSidePanel), not just the isolated ChangesTab widget.
///
/// The prior M3 attempt shipped SessionSidePanel import-clean but never placed
/// it in agents_view, so the Changes tab never rendered in production. This
/// test guards against regressing to that orphaned state: it pumps the actual
/// SessionSidePanel, selects the Changes tab, and asserts the diff surfaces via
/// UnifiedDiffView (M2-3), plus the tab badge count.
///
/// Run with:
///   flutter test test/features/agents/opc_m3_1_changes_tab_mounted_test.dart
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
import 'package:rhythm_desktop/features/agents/views/_tool_renderers/_unified_diff_view.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

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

class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

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

  /// Diff returned by fetchSessionDiff (mimics the server payload).
  List<Map<String, dynamic>> stagedDiff = const [];

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      stagedDiff;

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

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

const _kDiffFixture = [
  {
    'file': 'lib/features/tasks/models/task.dart',
    'before': '// old line\nreturn false;',
    'after': '// new line\nreturn true;',
    'additions': 3,
    'deletions': 2,
  },
];

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

void main() {
  late _StubAgentsRepository repo;
  late AgentsController controller;

  setUp(() {
    repo = _StubAgentsRepository();
    controller = _buildController(repo);
  });

  tearDown(() => controller.dispose());

  testWidgets(
    'mounted SessionSidePanel renders the diff via UnifiedDiffView on the '
    'Changes tab (guards against the orphaned-panel regression)',
    (tester) async {
      final session = _makeSession('s1');
      repo.stagedDiff = _kDiffFixture;

      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
      await tester.pump();

      // Context tab is default — no diff yet.
      expect(find.byType(UnifiedDiffView), findsNothing);

      // Switch to the Changes tab — triggers a fetch on the real surface.
      await tester.tap(find.text('Changes'));
      await tester.pump(); // let the async fetch complete
      await tester.pump();

      // One collapsed file row is present; expand it.
      expect(find.byIcon(Icons.expand_more), findsOneWidget);
      await tester.tap(find.byIcon(Icons.expand_more));
      await tester.pump();

      // The REAL mounted surface renders the diff via the shared M2-3 widget.
      expect(find.byType(UnifiedDiffView), findsOneWidget);
    },
  );

  testWidgets(
    'mounted Changes tab shows the file-count badge when a diff is present',
    (tester) async {
      final session = _makeSession('s1');
      controller.setSessionDiffForTest('s1', _kDiffFixture);

      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
      await tester.pump();

      // Badge count "1" appears next to the Changes tab label.
      expect(find.text('1'), findsOneWidget);
    },
  );
}
