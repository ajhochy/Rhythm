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
  }) async =>
      [];

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
    'issue-635-c1: sendInput adds optimistic user message to transcriptFor',
    () {
      test(
        'transcriptFor(sessionId) contains role=input message after sendInput',
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

          // Precondition: empty transcript.
          expect(controller.transcriptFor('sid-1'), isEmpty);

          // Act — send user input.
          const inputText = 'hello, what is the weather?';
          controller.sendInput('sid-1', inputText);

          // THE FAILING ASSERTION (today):
          // sendInput sends the WS frame but does NOT add an optimistic
          // AgentSessionMessage to _transcriptsBySession, so transcriptFor
          // returns []. The mini-bubble therefore shows no user message.
          //
          // AFTER FIX: an optimistic role='input' message is prepended so the
          // bubble can render it immediately.
          final transcript = controller.transcriptFor('sid-1');
          expect(
            transcript,
            isNotEmpty,
            reason: 'transcriptFor(sid-1) must contain at least one message '
                'immediately after sendInput — no await needed.',
          );

          final userMsg = transcript.firstWhere(
            (m) => m.role == 'input',
            orElse: () => throw StateError(
              'No role=input message found in transcriptFor after sendInput. '
              'Fix: add optimistic AgentSessionMessage(role: "input") to '
              '_transcriptsBySession[sessionId] inside sendInput().',
            ),
          );

          expect(
            userMsg.strippedText,
            inputText,
            reason: 'The optimistic user message must carry the sent text.',
          );
        },
      );
    },
  );

  // -------------------------------------------------------------------------
  // c2 — UNIT: optimistic insert is synchronous (no round-trip needed)
  // -------------------------------------------------------------------------
  group(
    'issue-635-c2: optimistic user message is added synchronously',
    () {
      test(
        'transcriptFor contains user message immediately after sendInput, no await',
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

          // No await here — the insert must be visible immediately.
          expect(
            controller.transcriptFor('sid-sync').any(
                  (m) =>
                      m.role == 'input' &&
                      m.strippedText == 'sync test message',
                ),
            isTrue,
            reason:
                'Optimistic insert must be synchronous so the UI re-renders '
                'immediately after sendInput without waiting for a server response.',
          );
        },
      );
    },
  );
}
