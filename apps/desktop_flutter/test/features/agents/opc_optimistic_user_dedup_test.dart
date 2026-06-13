/// Regression: a sent message must not render twice.
///
/// sendInput inserts an optimistic user ChatMessage with a temporary
/// 'optimistic-input-*' id. When the server's authoritative `message.updated`
/// (role: user) arrives with the real id, _upsertChatMessage previously matched
/// only by id, found no match, and ADDED a second user bubble — so one send
/// rendered as two "try now?" bubbles. The fix reconciles the optimistic insert
/// in place (adopts the real id), leaving exactly one user message.
library;

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
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

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'optimistic user message reconciles with server echo — one bubble, not two',
    () async {
      final (:ctrl, :repo) = _build();
      addTearDown(ctrl.dispose);

      await ctrl.initialize();
      await ctrl.selectSession('s1');

      // Send → optimistic user bubble inserted.
      ctrl.sendInput('s1', 'try now?\n');
      final afterSend =
          ctrl.chatMessagesFor('s1').where((m) => m.role == 'user').toList();
      expect(afterSend, hasLength(1),
          reason: 'sendInput inserts one optimistic user message');
      expect(afterSend.single.id, startsWith('optimistic-'));

      // Server echoes the same turn with the real message id.
      repo.emit(MessageUpdatedMessage(
        sessionId: 's1',
        info: const {'id': 'msg_real_1', 'role': 'user'},
      ));
      await Future<void>.delayed(Duration.zero);

      final afterEcho =
          ctrl.chatMessagesFor('s1').where((m) => m.role == 'user').toList();
      expect(afterEcho, hasLength(1),
          reason: 'server echo must reconcile the optimistic message in place, '
              'not add a second user bubble');
      expect(afterEcho.single.id, 'msg_real_1',
          reason: 'the reconciled message adopts the server id');
    },
  );
}
