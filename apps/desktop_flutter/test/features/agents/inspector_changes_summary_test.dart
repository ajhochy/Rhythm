/// Test for the Changes tab summary header + revert/restore controls
/// (inspector UI parity).
///
/// Pumps the real mounted SessionSidePanel surface (mirrors
/// opc_m3_1_changes_tab_mounted_test.dart), seeds the controller's session
/// diff via setSessionDiffForTest, switches to the Changes tab, and asserts:
///   - a `changes-summary` header showing files / +adds / −dels
///   - a `changes-revert-button` is rendered
///   - the summary is absent when there are no diff entries.
///
/// Run with:
///   flutter test test/features/agents/inspector_changes_summary_test.dart
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
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_session_side_panel.dart';
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
    String? scope,
  }) async =>
      const [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async => (
            session: _makeSession(id),
            messages: const <AgentSessionMessage>[],
          );

  List<Map<String, dynamic>> stagedDiff = const [];

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      stagedDiff;

  @override
  Future<void> revertSession(String sessionId, String messageId) async {}

  @override
  Future<void> unrevertSession(String sessionId) async {}

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

// Two entries totaling +10 / −3.
const _kDiffFixture = [
  {
    'file': 'lib/a.dart',
    'before': 'old',
    'after': 'new',
    'additions': 7,
    'deletions': 1,
  },
  {
    'file': 'lib/b.dart',
    'before': 'old',
    'after': 'new',
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
    'Changes tab shows a summary header (files / +adds / −dels) and an ENABLED '
    'revert button when a diff is present and a user message exists',
    (tester) async {
      final session = _makeSession('s1');
      // Seed the diff the Changes tab fetches when selected.
      repo.stagedDiff = _kDiffFixture;

      // Seed a user message so the revert button has a safe target.
      controller.setMessageForTest(
        ChatMessage(
          id: 'msg-user-1',
          sessionId: 's1',
          role: 'user',
          createdAt: DateTime.fromMillisecondsSinceEpoch(1000),
        ),
      );

      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
      await tester.pump();

      await tester.tap(find.text('Changes'));
      await tester.pump();
      await tester.pump();

      final summary = find.byKey(const ValueKey('changes-summary'));
      expect(summary, findsOneWidget);
      final txt = tester.widget<Text>(summary).data!;
      expect(txt, contains('2')); // files
      expect(txt, contains('10')); // additions
      expect(txt, contains('3')); // deletions

      // Revert button must be rendered.
      expect(
        find.byKey(const ValueKey('changes-revert-button')),
        findsOneWidget,
      );
      // With a user message present the button must be ENABLED (onPressed != null).
      final revertBtn = tester.widget<TextButton>(
        find.byKey(const ValueKey('changes-revert-button')),
      );
      expect(revertBtn.onPressed, isNotNull);
    },
  );

  testWidgets(
    'Revert button is present but DISABLED when there are diff entries but no '
    'user message has arrived yet',
    (tester) async {
      final session = _makeSession('s1');
      // Seed a diff — but do NOT seed any messages.
      repo.stagedDiff = _kDiffFixture;

      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
      await tester.pump();

      await tester.tap(find.text('Changes'));
      await tester.pump();
      await tester.pump();

      // Summary header and revert button should be rendered.
      expect(find.byKey(const ValueKey('changes-summary')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('changes-revert-button')),
        findsOneWidget,
      );
      // No user message → button must be DISABLED (onPressed == null).
      final revertBtn = tester.widget<TextButton>(
        find.byKey(const ValueKey('changes-revert-button')),
      );
      expect(revertBtn.onPressed, isNull);
    },
  );

  testWidgets(
    'Changes tab summary is absent and the empty state shows when there are '
    'no diff entries',
    (tester) async {
      final session = _makeSession('s1');
      // No diff seeded.

      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
      await tester.pump();

      await tester.tap(find.text('Changes'));
      await tester.pump();
      await tester.pump();

      expect(find.byKey(const ValueKey('changes-summary')), findsNothing);
      expect(find.text('No file changes yet'), findsOneWidget);
    },
  );
}
