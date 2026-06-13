/// Contract tests for OPC-M1-5 — Resume with real conversation continuity.
///
/// Run with: flutter test test/features/agents/opc_m1_5_resume_test.dart
library;

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/errors/app_error.dart';
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

// ---------------------------------------------------------------------------
// Fakes (same pattern as opc_m1_3_rehydration_test.dart)
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

// ---------------------------------------------------------------------------
// Stub repository
// ---------------------------------------------------------------------------

class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  /// When set, resumeSession returns this value.
  AgentSession? resumeResult;

  /// When set, resumeSession throws this exception.
  Exception? resumeException;

  /// How many times resumeSession was called.
  int resumeCallCount = 0;

  /// How many times getSession was called.
  int getSessionCallCount = 0;

  ({
    AgentSession session,
    List<AgentSessionMessage> messages
  })? getSessionResult;

  List<AgentSession> sessionsToReturn = [];

  void emit(AgentWsMessage msg) => _msgController.add(msg);

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
      sessionsToReturn;

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    getSessionCallCount++;
    if (getSessionResult != null) return getSessionResult!;
    return (session: _makeSession(id), messages: <AgentSessionMessage>[]);
  }

  @override
  Future<AgentSession> resumeSession(String id) async {
    resumeCallCount++;
    if (resumeException != null) throw resumeException!;
    if (resumeResult != null) return resumeResult!;
    return _makeSession(id, status: AgentSessionStatus.starting);
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0);

AgentSession _makeSession(
  String id, {
  AgentSessionStatus status = AgentSessionStatus.idle,
}) =>
    AgentSession(
      id: id,
      agentId: 'claude-code',
      name: 'Test Session',
      cwd: '/tmp',
      status: status,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );

AgentSessionMessage _makeMsg({
  required String sessionId,
  required String role,
  required String rawText,
  int id = 1,
  String? sdkMessageId,
}) =>
    AgentSessionMessage(
      id: id,
      sessionId: sessionId,
      role: role,
      rawText: rawText,
      strippedText: rawText,
      createdAt: DateTime.now(),
      sdkMessageId: sdkMessageId,
    );

// ---------------------------------------------------------------------------
// Build controller under test
// ---------------------------------------------------------------------------

({AgentsController ctrl, _StubAgentsRepository repo}) _buildController() {
  final repo = _StubAgentsRepository();
  final agentServer = _ReadyAgentServerController();
  final notifService = _FakeLocalNotificationService();
  final notifCtrl = _FakeNotificationsController();
  final ctrl = AgentsController(repo, agentServer, notifService, notifCtrl);
  return (ctrl: ctrl, repo: repo);
}

// ===========================================================================
// TESTS
// ===========================================================================

void main() {
  setUpAll(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  // -------------------------------------------------------------------------
  // c5: resuming triggers exactly one messages rehydrate fetch and renders parts
  // -------------------------------------------------------------------------
  group(
      'OPC-M1-5 c5: resumeSession triggers one rehydrate fetch and populates chatMessages',
      () {
    test(
      'c5: after resumeSession, chatMessagesFor has the rehydrated message parts',
      () async {
        final (:ctrl, :repo) = _buildController();
        addTearDown(ctrl.dispose);

        const sessionId = 'sess-resume-c5';

        // Set up the resumable session in the repo.
        final resumableSession =
            _makeSession(sessionId, status: AgentSessionStatus.resumable);
        repo.sessionsToReturn = [resumableSession];
        await ctrl.load();

        // Resume returns a starting-state session.
        final startingSession =
            _makeSession(sessionId, status: AgentSessionStatus.starting);
        repo.resumeResult = startingSession;

        // getSession (rehydrate) returns a prior message.
        repo.getSessionResult = (
          session: startingSession,
          messages: [
            _makeMsg(
              id: 1,
              sessionId: sessionId,
              role: 'output',
              rawText: 'Prior assistant response',
              sdkMessageId: 'sdk-msg-1',
            ),
          ],
        );

        // Perform the resume action.
        await ctrl.resumeSession(sessionId);
        // Allow async operations to settle.
        await Future<void>.delayed(Duration.zero);

        // c5a: exactly one getSession call (the rehydrate fetch).
        expect(
          repo.getSessionCallCount,
          equals(1),
          reason:
              'resumeSession must trigger exactly one getSession (rehydrate) call. '
              'If 0, rehydration is not wired. If >1, something is fetching redundantly.',
        );

        // c5b: chatMessagesFor is populated from the rehydrated REST payload.
        final msgs = ctrl.chatMessagesFor(sessionId);
        expect(
          msgs,
          isNotEmpty,
          reason:
              'After resumeSession, chatMessagesFor must be populated from the '
              'rehydrated REST messages. OPC-M1-5 requires the transcript to be '
              'visible after resume.',
        );

        // c5c: The message has parts.
        final parts = ctrl.chatPartsFor(msgs.first.id);
        expect(
          parts,
          isNotEmpty,
          reason:
              'Rehydrated message must have at least one ChatPart (text shim or '
              'real structured part). OPC-M1-5 requires prior parts to be visible.',
        );
      },
    );
  });

  // -------------------------------------------------------------------------
  // c6: 410 response surfaces start-fresh affordance
  // -------------------------------------------------------------------------
  group(
      'OPC-M1-5 c6: 410 response surfaces start-fresh affordance in controller state',
      () {
    test(
      'c6: when resumeSession throws a 410 AppError, controller exposes '
      'a startFreshSessionId (or equivalent affordance)',
      () async {
        final (:ctrl, :repo) = _buildController();
        addTearDown(ctrl.dispose);

        const sessionId = 'sess-resume-c6-gone';

        final resumableSession =
            _makeSession(sessionId, status: AgentSessionStatus.resumable);
        repo.sessionsToReturn = [resumableSession];
        await ctrl.load();

        // Simulate a 410 response from the server.
        repo.resumeException = AppError(
          'SDK session "Test Session" no longer exists on the server. '
          'Use start-fresh to create a new session.',
          statusCode: 410,
        );

        await ctrl.resumeSession(sessionId);
        await Future<void>.delayed(Duration.zero);

        // c6: the controller must surface a start-fresh affordance.
        // OPC-M1-5: the controller should expose `sessionGoneId` (the local
        // session id whose SDK backing has been lost) so the view can show a
        // "Start fresh" dialog or inline action.
        expect(
          ctrl.sessionGoneId,
          equals(sessionId),
          reason: 'After a 410 resume failure, the controller must surface the '
              'session id via sessionGoneId so the view can show the start-fresh '
              'affordance. OPC-M1-5 requires this UX path to be wired.',
        );
      },
    );

    test(
      'c6b: clearSessionGone resets the affordance state',
      () async {
        final (:ctrl, :repo) = _buildController();
        addTearDown(ctrl.dispose);

        const sessionId = 'sess-resume-c6b';
        final resumableSession =
            _makeSession(sessionId, status: AgentSessionStatus.resumable);
        repo.sessionsToReturn = [resumableSession];
        await ctrl.load();

        repo.resumeException = AppError(
          'SDK session no longer exists.',
          statusCode: 410,
        );

        await ctrl.resumeSession(sessionId);
        await Future<void>.delayed(Duration.zero);

        expect(ctrl.sessionGoneId, equals(sessionId));

        // Clearing should reset the affordance.
        ctrl.clearSessionGone();
        expect(
          ctrl.sessionGoneId,
          isNull,
          reason: 'clearSessionGone() must reset sessionGoneId to null.',
        );
      },
    );
  });
}
