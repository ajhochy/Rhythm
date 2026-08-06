/// Regression for #761: the assistant response must render live from
/// streaming parts even when `message.updated` never arrives.
///
/// The bundled fork opencode engine delivers `message.part.delta` over the
/// `/event` stream but NOT `message.updated` / `message.part.updated` (those
/// SyncEvents don't reach the wildcard stream). `message.updated` is the only
/// event that previously created the assistant ChatMessage bubble, so a
/// delta-only turn left the streamed parts orphaned in `_chatPartsByMessage`
/// with no bubble to render under — the response only appeared after a REST
/// refetch on session reselect. The fix synthesizes the assistant bubble from
/// the first live part.
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
  bool send(Map<String, dynamic> msg) => true;
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

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'assistant response renders live from delta-only streaming (no message.updated)',
    () async {
      final (:ctrl, :repo) = _build();
      addTearDown(ctrl.dispose);

      await ctrl.initialize();
      await ctrl.selectSession('s1');

      // Simulate the fork engine: ONLY message.part.delta reaches the client for
      // the assistant turn (message.updated / message.part.updated never arrive
      // over /event). Pre-fix, these deltas land in _chatPartsByMessage with no
      // assistant bubble, so nothing renders until a reselect refetch.
      repo.emit(const MessagePartDeltaMessage(
        sessionId: 's1',
        messageId: 'msg_asst_1',
        partId: 'prt_1',
        field: 'text',
        delta: 'PO',
      ));
      repo.emit(const MessagePartDeltaMessage(
        sessionId: 's1',
        messageId: 'msg_asst_1',
        partId: 'prt_1',
        field: 'text',
        delta: 'NG',
      ));
      await Future<void>.delayed(Duration.zero);

      final assistant = ctrl
          .chatMessagesFor('s1')
          .where((m) => m.role == 'assistant')
          .toList();
      expect(assistant, hasLength(1),
          reason: 'a live assistant bubble must be synthesized from streaming '
              'parts even when message.updated never arrives (#761)');
      expect(assistant.single.id, 'msg_asst_1');

      final text = ctrl
          .chatPartsFor('msg_asst_1')
          .where((p) => p.type == 'text')
          .map((p) => p.text)
          .join();
      expect(text, 'PONG',
          reason: 'streamed deltas render under the synthesized bubble');
    },
  );

  test(
    'message.part.updated also synthesizes the assistant bubble when message.updated is absent',
    () async {
      final (:ctrl, :repo) = _build();
      addTearDown(ctrl.dispose);

      await ctrl.initialize();
      await ctrl.selectSession('s1');

      repo.emit(const MessagePartUpdatedMessage(
        sessionId: 's1',
        part: {
          'id': 'prt_1',
          'messageID': 'msg_asst_2',
          'type': 'text',
          'text': 'hello from the assistant',
        },
      ));
      await Future<void>.delayed(Duration.zero);

      final assistant = ctrl
          .chatMessagesFor('s1')
          .where((m) => m.role == 'assistant')
          .toList();
      expect(assistant, hasLength(1));
      expect(assistant.single.id, 'msg_asst_2');
      expect(
        ctrl.chatPartsFor('msg_asst_2').single.text,
        'hello from the assistant',
      );
    },
  );
}
