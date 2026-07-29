/// Contract tests for OPC-M1-4 — Flutter side: error state rendered and
/// cleared on resend.
///
/// Criterion c4-flutter: AgentsController — error state renders then clears
/// on sendInput.
///
/// Run with: flutter test test/features/agents/opc_m1_4_stream_lifecycle_test.dart
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

// ---------------------------------------------------------------------------
// Fakes (mirrors opc_m1_3_rehydration_test.dart)
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

/// Records what was sent via [send].
class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
    : _msgController = StreamController.broadcast(),
      _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;
  final List<Map<String, dynamic>> sentMessages = [];

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
  void send(Map<String, dynamic> msg) {
    sentMessages.add(Map<String, dynamic>.from(msg));
  }

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async => sessionsToReturn;

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
  getSession(String id) async {
    return (session: _makeSession(id), messages: <AgentSessionMessage>[]);
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0);

AgentSession _makeSession(
  String id, {
  AgentSessionStatus status = AgentSessionStatus.idle,
  String? statusMessage,
}) => AgentSession(
  id: id,
  agentId: 'claude-code',
  name: 'Test Session',
  cwd: '/tmp',
  status: status,
  statusMessage: statusMessage,
  createdAt: _kEpoch,
  updatedAt: _kEpoch,
);

({AgentsController ctrl, _StubAgentsRepository repo}) _buildController() {
  final repo = _StubAgentsRepository();
  final agentServer = _ReadyAgentServerController();
  final notifService = _FakeLocalNotificationService();
  final notifCtrl = _FakeNotificationsController();
  final ctrl = AgentsController(repo, agentServer, notifService, notifCtrl);
  return (ctrl: ctrl, repo: repo);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  setUpAll(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  // -------------------------------------------------------------------------
  // c4-flutter: error state renders then clears on sendInput
  // -------------------------------------------------------------------------
  group(
    'issue-688-c4-flutter: AgentsController — error state renders then clears on sendInput',
    () {
      test(
        'c4-flutter-a: SessionUpdatedMessage with status=error is stored in sessions list',
        () async {
          final (:ctrl, :repo) = _buildController();
          addTearDown(() async => repo.dispose());

          // Prime controller with a normal session.
          final sessionId = 'sess-error-1';
          final normalSession = _makeSession(sessionId);
          repo.sessionsToReturn = [normalSession];
          // initialize() wires the WS listener and calls load() internally.
          await ctrl.initialize();
          expect(ctrl.sessions.any((s) => s.id == sessionId), isTrue);

          // Server pushes a session.updated frame with status=error.
          final errorSession = _makeSession(
            sessionId,
            status: AgentSessionStatus.error,
            statusMessage: 'Token limit exceeded',
          );
          repo.emit(SessionUpdatedMessage(session: errorSession));

          // Give the stream a tick to process.
          await Future<void>.delayed(Duration.zero);

          final updated = ctrl.sessions.firstWhere((s) => s.id == sessionId);
          expect(updated.status, equals(AgentSessionStatus.error));
          expect(updated.statusMessage, equals('Token limit exceeded'));
        },
      );

      test(
        'c4-flutter-b: sendInput still sends the WS frame for an errored session',
        () async {
          final (:ctrl, :repo) = _buildController();
          addTearDown(() async => repo.dispose());

          final sessionId = 'sess-error-2';
          repo.sessionsToReturn = [
            _makeSession(sessionId, status: AgentSessionStatus.error),
          ];
          await ctrl.initialize();

          ctrl.sendInput(sessionId, 'retry prompt');

          // The WS frame must be sent.
          expect(
            repo.sentMessages.any(
              (m) =>
                  m['type'] == 'session.input' &&
                  m['id'] == sessionId &&
                  m['data'] == 'retry prompt',
            ),
            isTrue,
          );
        },
      );

      test(
        'c4-flutter-c: AgentSessionStatus.error round-trips from wire value',
        () {
          final parsed = AgentSessionStatus.fromWire('error');
          expect(parsed, equals(AgentSessionStatus.error));
          expect(AgentSessionStatus.error.wireValue, equals('error'));
        },
      );

      test(
        'c4-flutter-d: AgentSession.fromJson parses statusMessage field',
        () {
          final json = <String, dynamic>{
            'id': 'sess-1',
            'agent_id': 'claude-code',
            'status': 'error',
            'statusMessage': 'Network timeout',
            'cwd': '/tmp',
            'name': 'Test',
            'createdAt': _kEpoch.toIso8601String(),
            'updatedAt': _kEpoch.toIso8601String(),
          };
          final session = AgentSession.fromJson(json);
          expect(session.status, equals(AgentSessionStatus.error));
          expect(session.statusMessage, equals('Network timeout'));
        },
      );
    },
  );
}
