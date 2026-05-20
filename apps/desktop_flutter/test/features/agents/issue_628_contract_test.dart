/// Acceptance contract for issue #628 — cold mini-bubbles render empty
/// until the session is selected.
///
/// This test MUST fail before implementation and pass after the fix.
///
/// Diagnosis (from failure-triage):
///   AgentsController.reconnectSession back-fills `_transcriptsBySession[id]`
///   on line 683, but only calls `notifyListeners()` inside the
///   `if (_selectedSessionId == id)` branch (line 686). Cold bubbles that
///   observe `transcriptFor(sessionId)` via Provider therefore never rebuild
///   after the REST back-fill completes — the data lands in the map but no
///   notification fires, so the bubble keeps showing an empty transcript.
///
/// The fix must call notifyListeners() unconditionally after the write to
/// `_transcriptsBySession[id]`, regardless of `_selectedSessionId`.
///
/// (The widget-level wiring — `_ExpandedSessionBubbleState.initState`
/// calling `agents.reconnectSession(sessionId)` — is covered by manual smoke
/// per the contract JSON; pumping the private state class with full
/// provider scaffolding has a higher bug surface than the one-line fix.)
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

  @override
  bool isAgentAvailable(String kind) => true;

  @override
  Future<void> initialize() async {}

  @override
  Future<void> retry() async {}
}

class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository(this._messagesById);

  final Map<String, List<AgentSessionMessage>> _messagesById;

  final StreamController<AgentWsMessage> _msg = StreamController.broadcast();
  final StreamController<bool> _conn = StreamController.broadcast();

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
      [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    final msgs = _messagesById[id] ?? const <AgentSessionMessage>[];
    final session = AgentSession(
      id: id,
      agentId: 'claude-code',
      name: 'cold session $id',
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
    );
    return (session: session, messages: msgs);
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeLocalNotificationService extends LocalNotificationService {
  @override
  Future<void> showMessageNotification({
    required int id,
    required String title,
    required String body,
  }) async {}
}

class _FakeNotificationsController extends NotificationsController {
  _FakeNotificationsController()
      : super(NotificationsRepository(NotificationsDataSource()));

  @override
  void pushAgentNotification({
    required int id,
    required String title,
    required String body,
  }) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('issue-628-c1: reconnectSession notifies listeners for any session', () {
    test(
      'cold-session reconnect back-fills transcriptFor AND fires notifyListeners',
      () async {
        // Arrange: controller with no selected session, repo serves one
        // message for sessionId "cold-1".
        final message = AgentSessionMessage(
          id: 1,
          sessionId: 'cold-1',
          role: 'output',
          rawText: 'hello from cold session',
          strippedText: 'hello from cold session',
          createdAt: DateTime.now(),
        );
        final repo = _StubAgentsRepository({'cold-1': [message]});
        final controller = AgentsController(
          repo,
          _ReadyAgentServerController(),
          _FakeLocalNotificationService(),
          _FakeNotificationsController(),
        );
        addTearDown(controller.dispose);

        // Confirm precondition: no selection, empty transcript map.
        expect(controller.transcriptFor('cold-1'), isEmpty);

        var listenerCalls = 0;
        controller.addListener(() => listenerCalls++);

        // Act: reconnect a session that is NOT the selected one.
        await controller.reconnectSession('cold-1');

        // Assert 1 — data contract: transcriptFor must return the
        // back-filled messages, proving the REST round-trip landed.
        expect(controller.transcriptFor('cold-1'), hasLength(1));
        expect(controller.transcriptFor('cold-1').first.id, equals(1));

        // Assert 2 — UI rebuild contract: notifyListeners must fire even
        // though sessionId != _selectedSessionId. THIS IS THE FAILING
        // ASSERTION before the fix — current code (line 686) only notifies
        // inside the `if (_selectedSessionId == id)` branch, so a cold
        // bubble using Provider.of/context.watch will never rebuild.
        expect(
          listenerCalls,
          greaterThan(0),
          reason: 'notifyListeners must fire after reconnectSession back-fills '
              'a non-selected session so cold mini-bubbles rebuild.',
        );
      },
    );
  });
}
