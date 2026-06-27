/// End-to-end regression for the agent live-streaming fix chain
/// (#759 + #761 + #762): once the engine `convertEvent` fix (#762) makes
/// `message.updated` / `message.part.updated` reach the `/event` stream again,
/// a full real turn must render with:
///   1. exactly one user bubble and one assistant bubble (no duplicates),
///   2. no duplicated assistant text (delta-accumulated part reconciled with the
///      authoritative `message.part.updated` for the same part id),
///   3. populated context/token usage (the gauge reads `message.updated.info.tokens`).
///
/// The unit-level tests covered each event type in isolation and all passed
/// while the shipped app was still broken — this drives the WHOLE sequence the
/// fork engine emits during one turn so the three symptoms cannot silently
/// regress together again.
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

Future<void> _tick() => Future<void>.delayed(Duration.zero);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'a full turn with message.updated flowing renders one user + one assistant '
    'bubble, no duplicated text, and live token/context usage',
    () async {
      final (:ctrl, :repo) = _build();
      addTearDown(ctrl.dispose);

      await ctrl.initialize();
      await ctrl.selectSession('s1');

      // 1. User sends a prompt → optimistic user bubble.
      ctrl.sendInput('s1', 'ping\n');
      expect(
        ctrl.chatMessagesFor('s1').where((m) => m.role == 'user'),
        hasLength(1),
        reason: 'sendInput inserts exactly one optimistic user bubble',
      );

      // 2. Server echoes the user message with its real id (message.updated).
      repo.emit(MessageUpdatedMessage(
        sessionId: 's1',
        info: const {'id': 'msg_user_1', 'role': 'user'},
      ));
      await _tick();

      // 3. Assistant streams text via message.part.delta (the #761 path
      //    synthesizes the assistant bubble from the first delta).
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
      await _tick();

      // 4. The authoritative full-text part arrives (#762 restored) for the
      //    SAME part id — must replace, not append, the delta-accumulated text.
      repo.emit(const MessagePartUpdatedMessage(
        sessionId: 's1',
        part: {
          'id': 'prt_1',
          'messageID': 'msg_asst_1',
          'type': 'text',
          'text': 'PONG',
        },
      ));
      await _tick();

      // 5. The assistant message.updated arrives (#762 restored) carrying
      //    tokens + cost — must update the SAME bubble, not create a second.
      repo.emit(MessageUpdatedMessage(
        sessionId: 's1',
        info: const {
          'id': 'msg_asst_1',
          'role': 'assistant',
          'cost': 0.0123,
          'tokens': {
            'input': 4096,
            'output': 128,
            'reasoning': 0,
            'cache': {'read': 0, 'write': 0},
          },
        },
      ));
      await _tick();

      // ── Symptom #1: no duplicate bubbles ────────────────────────────────
      final users =
          ctrl.chatMessagesFor('s1').where((m) => m.role == 'user').toList();
      expect(users, hasLength(1), reason: 'exactly one user bubble');
      expect(users.single.id, 'msg_user_1',
          reason: 'optimistic user reconciled to the real id');

      final assistants = ctrl
          .chatMessagesFor('s1')
          .where((m) => m.role == 'assistant')
          .toList();
      expect(assistants, hasLength(1),
          reason: 'the synthesized assistant bubble and the message.updated '
              'bubble must dedupe by message id — not render twice');
      expect(assistants.single.id, 'msg_asst_1');

      // ── Symptom #1 (text): no duplicated assistant text ─────────────────
      final asstText = ctrl
          .chatPartsFor('msg_asst_1')
          .where((p) => p.type == 'text')
          .map((p) => p.text)
          .join();
      expect(asstText, 'PONG',
          reason: 'delta-accumulated part and the authoritative part.updated '
              'share a part id, so the text is replaced, not doubled');

      // ── Symptom #3: context/token usage populated ───────────────────────
      expect(assistants.single.tokens, isNotNull,
          reason:
              'message.updated.info.tokens must reach the assistant bubble');
      expect(assistants.single.cost, 0.0123);
      expect(ctrl.sessionContextTokens('s1'), greaterThan(0),
          reason:
              'the context-usage gauge reads sessionContextTokens, which is '
              'starved until message.updated delivers info.tokens (#762/#3)');
    },
  );
}
