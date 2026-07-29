/// Acceptance contract for issue #635
/// "Mini-bubble hides user messages, shows only assistant"
///
/// CONTRACT:
///   c1: After sendInput(sessionId, text) is called, controller.transcriptFor(sessionId)
///       must contain an AgentSessionMessage with role == 'input' whose strippedText
///       equals the sent text. The mini-bubble reads transcriptFor() directly so this
///       is the data-layer gate for the bubble showing user messages.
///
///   c2: The optimistic user message must be added synchronously (no await needed)
///       so the bubble can re-render immediately on sendInput — not after a server
///       round-trip. Calling sendInput and then immediately checking transcriptFor
///       must yield the new entry without any Future.delayed.
library;

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Stubs
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
  @override
  bool isAgentAvailable(String kind) => true;
  @override
  Future<void> initialize() async {}
  @override
  Future<void> retry() async {}
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

/// Fake repository that captures sent messages but never delivers WS events.
class _RecordingRepository implements AgentsRepository {
  final StreamController<AgentWsMessage> _msgCtrl =
      StreamController<AgentWsMessage>.broadcast();
  final StreamController<bool> _connCtrl = StreamController<bool>.broadcast();

  final List<Map<String, dynamic>> sent = [];

  @override
  Stream<AgentWsMessage> get messages => _msgCtrl.stream;
  @override
  Stream<bool> get connectivityStream => _connCtrl.stream;
  @override
  bool get isConnected => true;
  @override
  Future<void> connect() async {}
  @override
  Future<void> dispose() async {
    await _msgCtrl.close();
    await _connCtrl.close();
  }

  @override
  void send(Map<String, dynamic> msg) => sent.add(msg);

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async => [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
  getSession(String id) async => (
    session: AgentSession(
      id: id,
      agentId: 'claude-code',
      name: 'Test session',
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    ),
    messages: const <AgentSessionMessage>[],
  );

  void push(AgentWsMessage msg) => _msgCtrl.add(msg);

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // -------------------------------------------------------------------------
  // c1 — UNIT (STRICT: FAILS today, PASSES after sendInput optimistic insert)
  // -------------------------------------------------------------------------
  group(
    'issue-635-c1: sendInput adds optimistic user message to chatMessagesFor',
    () {
      test(
        'chatMessagesFor(sessionId) contains role=user ChatMessage after sendInput',
        () async {
          final repo = _RecordingRepository();
          final controller = AgentsController(
            repo,
            _ReadyAgentServerController(),
            _FakeLocalNotificationService(),
            _FakeNotificationsController(),
          );
          addTearDown(controller.dispose);

          await controller.initialize();

          // Register session via WS so the controller knows about it.
          repo.push(
            SessionCreatedMessage(
              session: AgentSession(
                id: 'sid-1',
                agentId: 'claude-code',
                name: 'Test',
                cwd: '/tmp',
                status: AgentSessionStatus.idle,
                createdAt: DateTime(2026),
                updatedAt: DateTime(2026),
              ),
            ),
          );
          await Future<void>.delayed(Duration.zero);

          // Precondition: empty chat messages.
          expect(controller.chatMessagesFor('sid-1'), isEmpty);

          // Act — send user input.
          const inputText = 'hello, what is the weather?';
          controller.sendInput('sid-1', inputText);

          // OPC-M1-3: sendInput creates an optimistic ChatMessage with role='user'
          // in chatMessagesBySession. The parts-based render path picks it up.
          final chatMsgs = controller.chatMessagesFor('sid-1');
          expect(
            chatMsgs,
            isNotEmpty,
            reason:
                'chatMessagesFor(sid-1) must contain at least one message '
                'immediately after sendInput — no await needed.',
          );

          final userMsg = chatMsgs.firstWhere(
            (m) => m.role == 'user',
            orElse: () => throw StateError(
              'No role=user ChatMessage found in chatMessagesFor after sendInput. '
              'Fix: add optimistic ChatMessage(role: "user") to '
              '_chatMessagesBySession[sessionId] inside sendInput().',
            ),
          );

          // The text is stored in the associated ChatPart.
          final parts = controller.chatPartsFor(userMsg.id);
          expect(
            parts.any((p) => p.text == inputText),
            isTrue,
            reason: 'The optimistic user ChatPart must carry the sent text.',
          );
        },
      );
    },
  );

  // -------------------------------------------------------------------------
  // c2 — UNIT: optimistic insert is synchronous (no round-trip needed)
  // -------------------------------------------------------------------------
  group('issue-635-c2: optimistic user message is added synchronously', () {
    test(
      'chatMessagesFor contains user ChatMessage immediately after sendInput, no await',
      () async {
        final repo = _RecordingRepository();
        final controller = AgentsController(
          repo,
          _ReadyAgentServerController(),
          _FakeLocalNotificationService(),
          _FakeNotificationsController(),
        );
        addTearDown(controller.dispose);

        await controller.initialize();

        repo.push(
          SessionCreatedMessage(
            session: AgentSession(
              id: 'sid-sync',
              agentId: 'claude-code',
              name: 'Sync test',
              cwd: '/tmp',
              status: AgentSessionStatus.idle,
              createdAt: DateTime(2026),
              updatedAt: DateTime(2026),
            ),
          ),
        );
        await Future<void>.delayed(Duration.zero);

        // Send input and check WITHOUT any await — must be synchronous.
        controller.sendInput('sid-sync', 'sync test message');

        // No await here — OPC-M1-3: chatMessagesBySession must be updated
        // synchronously so the single render path re-renders immediately.
        expect(
          controller.chatMessagesFor('sid-sync').any((m) => m.role == 'user'),
          isTrue,
          reason:
              'Optimistic insert must be synchronous so the UI re-renders '
              'immediately after sendInput without waiting for a server response.',
        );
      },
    );
  });
}
