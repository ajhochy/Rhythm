/// OCU-05 (#1046): composer message queuing while the agent is busy.
///
/// The composer stays enabled while status=working; a mid-run send is
/// optimistically inserted and flagged `queued` so the user bubble renders a
/// "Queued" chip. The flag clears when the engine's authoritative
/// `message.updated` (role: user) reconciles the optimistic insert.
///
/// CONTRACT (controller queued-state transitions):
///   - send while idle    → not queued.
///   - send while working  → queued (chip shown).
///   - message.updated echo → queued flag clears (chip removed).
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
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

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
      : _msg = StreamController.broadcast(),
        _conn = StreamController.broadcast();
  final StreamController<AgentWsMessage> _msg;
  final StreamController<bool> _conn;

  void emit(AgentWsMessage m) => _msg.add(m);

  @override
  Stream<AgentWsMessage> get messages => _msg.stream;
  @override
  Stream<bool> get connectivityStream => _conn.stream;
  @override
  bool get isConnected => true;
  @override
  Future<void> connect() async {}
  @override
  Future<void> dispose() async {
    await _msg.close();
    await _conn.close();
  }

  @override
  void send(Map<String, dynamic> msg) {}
  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async =>
      [_makeSession('s1')];
  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async =>
          (session: _makeSession(id), messages: const <AgentSessionMessage>[]);
  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

({AgentsController ctrl, _StubAgentsRepository repo}) _build() {
  final repo = _StubAgentsRepository();
  final ctrl = AgentsController(
    repo,
    _ReadyAgentServerController(),
    LocalNotificationService(),
    NotificationsController(
      NotificationsRepository(NotificationsDataSource()),
    ),
  );
  return (ctrl: ctrl, repo: repo);
}

String _userMsgId(AgentsController ctrl) =>
    ctrl.chatMessagesFor('s1').where((m) => m.role == 'user').single.id;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'send while idle: message is NOT queued',
    () async {
      final (:ctrl, :repo) = _build();
      addTearDown(ctrl.dispose);
      await ctrl.initialize();
      await ctrl.selectSession('s1');

      ctrl.sendInput('s1', 'first prompt\n');

      final id = _userMsgId(ctrl);
      expect(ctrl.isMessageQueued(id), isFalse,
          reason: 'an idle session accepts input immediately — no queued chip');
    },
  );

  test(
    'send while working: message is queued, then clears on server echo',
    () async {
      final (:ctrl, :repo) = _build();
      addTearDown(ctrl.dispose);
      await ctrl.initialize();
      await ctrl.selectSession('s1');

      // Drive the session into the working state via a real status frame.
      repo.emit(const SessionStatusMessage(
        id: 's1',
        working: true,
        source: 'test',
        status: 'busy',
      ));
      await Future<void>.delayed(Duration.zero);
      expect(ctrl.isWorking('s1'), isTrue);

      // Send while busy → optimistic insert flagged queued.
      ctrl.sendInput('s1', 'queued prompt\n');
      final id = _userMsgId(ctrl);
      expect(id, startsWith('optimistic-'));
      expect(ctrl.isMessageQueued(id), isTrue,
          reason: 'a send during a working turn shows the queued chip');

      // Engine acknowledges the queued input via message.updated → chip clears.
      repo.emit(const MessageUpdatedMessage(
        sessionId: 's1',
        info: {'id': 'msg_real_1', 'role': 'user'},
      ));
      await Future<void>.delayed(Duration.zero);

      expect(ctrl.isMessageQueued('msg_real_1'), isFalse,
          reason: 'the reconciled message id is no longer queued');
      expect(ctrl.isMessageQueued(id), isFalse,
          reason: 'the optimistic id is cleared once reconciled');
    },
  );

  testWidgets(
    'mounted user bubble: queued chip shows when queued, absent otherwise',
    (tester) async {
      final part = ChatPart(
        id: 'part-text',
        messageId: 'msg-1',
        type: 'text',
        text: 'queued prompt',
      );

      Widget host({required bool isQueued}) => MaterialApp(
            theme: AppTheme.light(),
            home: Scaffold(
              body: UserBubbleTestHarness(
                parts: [part],
                isQueued: isQueued,
              ),
            ),
          );

      await tester.pumpWidget(host(isQueued: true));
      await tester.pump(Duration.zero);
      expect(find.byKey(const ValueKey('queued-chip')), findsOneWidget);
      expect(find.text('Queued'), findsOneWidget);

      await tester.pumpWidget(host(isQueued: false));
      await tester.pump(Duration.zero);
      expect(find.byKey(const ValueKey('queued-chip')), findsNothing);
    },
  );
}
